# SI-A10 – Fizetett bérlet, fizikai alvás és fatigue

## Hatókör

A helyi/private LostCity meglévő `falador.south-house.main` egysége két,
egymástól különálló BedSlotot biztosít. A housing unit katalógus változatlan:
500 GP / 1440 szimulációs perc / egy férőhely. Az új
`config/native-housing.json` a két BedSlot konkrét engine koordinátáját és
szintjét adja meg, a Propertyhez kötve. Nincs ágy-, épület- vagy GP-spawn.
A fizikai helyvizsgálat tényleges Player koordinátát ellenőriz; nem új packed
bed-opcode vagy berendezésvásárlási rendszer. A térképi útvonal és a több
bejelentkezett avatár közös élő elfogadása az SI-A15 része.

Belépők: `server/gateway/admin/native-housing.ts`;
`reservePopulationRental`, `requestNativeHousing`, `finalizePopulationRental`.
A megbízható backend a meglévő tenant és landlord population memberből képez
actor/player/lifecycle/clock kötést. A landlord a kiválasztott Property valódi
`player` tulajdonosa; a title verziója is része a foglalásnak. Az ár, időtartam,
housing tier, pihenési hatás és cím a katalógusból származik.
Ez nem új, modelleknek publikált fizetési vagy mozgási eszköz.

A tokenes `/api/internal/admin/native-housing` endpoint csak
`{commandId, operation: pay|cancel|sleep|wake, operationId}` mezőket fogad.
Nem fogad feltöltött fizetési bizonylatot, egyenleget, username-et, árat vagy
koordinátát. A queue legfeljebb 50 parancsot tart, tickenként 10-et dolgoz fel,
5 másodperces lejárattal; a gateway timeoutja 8 másodperc. A válasz státusz,
nem fizetési bizonyíték.

## Foglalás → fizetés → bérleti jogosultság

1. A Housing DB `BEGIN IMMEDIATE` tranzakciója rögzíti az auditált, immutable
   feltételkötést és lefoglalja a tenantot/BedSlotot. A legacy tenancy író is
   tiszteletben tartja ezt a foglalást. Párhuzamos folyamatokból ugyanarra a
   férőhelyre csak egy admission sikerül. Lejárt, aktív bérlet lezárható és
   az ágy újra használható; ismeretlen fizetési kimenetelű foglalás nem törlődik vakon.
2. Az engine a két tényleges Player GP-készletén a meglévő
   PlayerInventoryEscrowStore hold/commit műveletét futtatja. A kötött escrow,
   mindkét végleges Player-save, a bilateral before/after mennyiségek és a
   natív fizetési receipt egyetlen Market/checkpoint SQLite tranzakcióban
   commitolódnak. Üres payer, túlcsorduló vagy teli payee, stale title/quote,
   inaktív lifecycle és checkpoint-hiba nem fizet.
3. A finalizer readonly megnyitja a kiválasztott világ kanonikus natív forrását,
   ellenőrzi a teljes auditot, az exact escrow/binding/felek/GP/időablakot,
   majd a meglévő HousingTenancyStoreban létrehozza az egy periódusra előre
   fizetett bérletet, rent paymentet és BedAccessEntitlementet. A tenancy,
   prepaid receipt és az `active` order közös Housing tranzakció.

A Housing és a Market külön DB: nincs distributed ACID állítás. Ha a fizetés
már commitolt, de a tenancy projekció hibázik, a foglalás és a natív paid
bizonylat megmarad. Ugyanazzal az operation/escrow ID-val a `finalize` újra
futtatható; a `pay` replay sem vonhat le még egyszer. Az entitlement a rögzített
admissionkori periódusra szól, késői recovery nem hosszabbítja meg ingyen.

A natív `cancel` csak még nem fizetett operationre írhat terminal no-payment
markert. Már fizetett műveletnél `paid` az eredmény, nincs automatikus refund.
A cancelled ID-n későn befutó pay nem fizet. Egyéb kompenzáció külön, igazolt
hiba utáni gazdasági döntés marad. A prepaid periódus lejáratakor nem keletkezik
második, ugyanarra az időszakra vonatkozó arrears-követelés.

## Fizikai alvás és PlayerTime

A sleep admission újra ellenőrzi a paid natív forrást, a tenancy audit/headet,
a Property tulajdonát/verzióját, a tenant életciklusát és a futó clockot.
A Playernek a saját BedSlotja szintjén, legfeljebb egy mezőre kell állnia;
futó script, interakció, queue vagy busy állapot mellett nem kezdhet alvást.
Először auditált engine-helytanú és kanonikus Player-checkpoint készül, utána
a meglévő `startPlayerSleep` rögzíti az explicit alvást a PlayerTime historyban.
Checkpoint-hiba nem ír alvó PlayerTime-ot. Clock-hiba utáni gazdátlan helytanú
nem alvási jogosultság; a retry újra ellenőrzi a fizikai jelenlétet.

A motor a már tartós alvást újranyitás és login után is ellenőrzi. Az alvó
Player mozgása, scriptfuttatása és saját műveleti tickje korlátozott, de
szabályosan kijelentkezhet. A wake feloldja ezt. Helyelhagyás, időbeli lejárat,
tenancy end, title/policy változás, hiányzó bizonylat vagy tenant-death után
nem marad fizikai alvás/belépési jogosultság. A Property visitor szerepe csak
az exact ingatlanra kap paid-tenancy belépést, tulajdonosi/manage jogot nem ad.

A logout önmagában továbbra is `awake` offline állapot. A korábban fizikailag
megkezdett alvás offline is folytatható a paid periódus végéig. A housing tier
fatigue szorzója az alváskor rögzített PlayerTime history része, ezért az SI-A03
NeedsStore ugyanazt az idővonalat játssza vissza. A housing effect policy
`applyHousingFatigueRecoveryRate` függvénye csak az alvó fatigue recoveryt
módosítja; a világ clock rate-jét és más avatárok idejét nem. A lease végén
az SI-A03 időlépése akkor is awake-ra vált a számításban, ha az offline avatár
még nem jelentkezett vissza. Pausolt világ megtartja az explicit pihenést,
miközben a szimulációs idő és a fatigue változása is áll.

## Migráció és rollback

- Clock schema **5 → 6**: nullable `sleep_recovery_basis_points` oszlop a
  `simulation_player_time_state` táblában. NULL esetén az eredeti, 10000-es
  alapráta érvényes. Régi állapot/history JSON és digest nem íródik át;
  az új optional mező csak új, explicit sleep admissionnél jelenik meg.
  A NeedsStore v1 auditált payloadja optional recovery mezőt kap, nem számol
  wall time-ból és nem inicializálja újra a régi needs állapotokat.
- Housing: additív `housing_prepaid_period` és `housing_tenancy_audit_head`.
  Meglévő auditnál a migráció a jelenlegi tailt horgonyozza, nem gyárt korábbi
  fizetési bizonyítékot. A legacy postpaid út és a tenancy user_version 2 megmarad.
- Külön additív v1 domain journal: `housing_native_schema/operation/audit/head`.
  A Marketben `native_rent_schema/operation/audit/head`, továbbá
  `native_housing_sleep` és `native_housing_sleep_head`. A közös Market
  user_version és a meglévő escrow history változatlan.
- A régi alvás ismeretlen eredetét nem lehet natív housing tanúként elfogadni.
  Audit/projection/receipt törlése zártan hibázik. Ismeretlen schema tiltott.

Rollback: queue és írók leállítása, fizetett/pending operationök exact-ID
egyeztetése; Housing, Property, Market/checkpoint/escrow, clock és needs DB-k
együtt mentése WAL/SHM fájlokkal. Aktív natív alvást előbb fel kell oldani,
a már kifizetett bérleti követelést véglegesíteni vagy külön egyeztetni kell.
Schema 6 clockot a régi kód nem nyithat meg; összetartozó teljes snapshot vagy
előrefelé javítás szükséges. Egyoldalú Player-visszamásolás, történettörlés,
vak slot-release és GP-refund nem támogatott.

## Ellenőrzési határ

Izolált packed engine, valódi Player/escrow/Property/clock/needs SQLite
integráció és több független folyamatból indított slot race. Élő hálózati
avatárokon nem történt aktiválás vagy automatikus bérletkötés.
A többavatáros SDK alvás/logout/return elfogadása SI-A15, a rutinba kötés SI-A11.
A futások és a megőrzött hibák az
[eredménynaplóban](SOCIETY_INTEGRATION_PROGRESS.md) szerepelnek.
