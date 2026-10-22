# SI-A09 – Véges natív food beszerzés és értékesítés

## Határ és belépők

A helyi/private LostCity világban a `karamja-kitchen` raw lobster (377)
beszerzése és cooked lobster (379) eladása ugyanahhoz az auditált művelethez
köti a Business készletét/pénztárát és a partner valódi Player inventoryját.
Nincs NPC-restock, reward-payout vagy igazolatlan settlement fallback.

- `server/gateway/admin/native-food-commerce.ts`:
  `reservePopulationFoodCommerce`, `requestNativeFoodCommerce`,
  `finalizePopulationFoodCommerce`.
- `agent-operated-shop/native-commerce-runtime.ts`: előkészítés, foglalás,
  forrásellenőrzött véglegesítés és legfeljebb 100 műveletes `recover`.
- `server/engine/src/mods/NativeCommerce.ts`: valódi kétoldali
  `BOTH_MOVEINV`, protected escrow és közös kanonikus Player-checkpoint.
- Az engine tokennel védett `/api/internal/admin/native-food-commerce`
  végpontja kizárólag `{commandId, operation: execute|cancel, operationId}`
  parancsot fogad. Az 50 elemű queue tickenként legfeljebb 10 parancsot vesz
  ki, 5 másodperces lejárattal. A gateway timeout 8 másodperc.

Az admission megbízható backend capability: a már kiválasztott két aktív
population membert kapja, azokból számolja az exact username/lifecycle/clock
azonosságokat. Nem új, modelleknek publikált inventory- vagy trade eszköz.
A két fél közös, felhatalmazott műveletét a későbbi rutin/orchestrator adja át;
ez a feladat nem aktivál önálló vásárló/supplier controllert és nem publikál
új verified skillt. Az endpoint nem fogad feltöltött feleket, itemeket,
árat, egyenleget, grantot vagy sikerbizonylatot.

## Véges készlet és pénz

A Business stock policy snapshot fix cooked eladási ára 40 GP/db, raw vételi
plafonja 20 GP/db. Raw reorder csak a minimum (0) elérésekor, legfeljebb 8-as
célkészletig; a párhuzamos prepared beszerzések is beleszámítanak. A teljes
stock-kapacitás 28. Natív eladás legfeljebb 8 darab/tranzakció. A két új
policy a meglévő hammer policy mellett van, annak tartalma változatlan.
A policy verified skill listája a már létező give-item skillt tartalmazza;
a natív food út `trusted-settlement` ága külön valódi forrásbizonyítékot kér,
ez a bejegyzés nem publikálja a draft food/receive skilleket.

Előkészítéskor a készletdöntés az aktuális Business inventoryból származik.
Sale esetén a készlet atomikusan kikerül az elérhető készletből és kötött
foglalásba kerül. Procurement esetén a Business outbox után a meglévő
InstitutionTreasury véges GP-foglalása készül, az eredeti determinista
trade settlement ID-val. Pénzhiánynál a prepared outbox megmarad, de az
engine nem hajthat végre cserét; feltöltés után ugyanazzal az ID-val folytatható.

Az engine újraellenőrzi az aktuális policy digesteit, a szerepkört,
facility/grant időablakot, a futó clockot, mindkét életciklust és a foglalást.
A worker tulajdonos, vagy aktív employment alapján inventory issue/receive
és logistics operate engedéllyel rendelkezik. A `storage.secure` entitlement
külön szükséges. Mindkét avatar életben, szabadon, a kijelölt konyhahely
közelében és egymástól legfeljebb két mezőre áll; futó script, másik ajánlat,
elégtelen forrás vagy konzervatívan számolt célkapacitás esetén nincs admission.

## Fizikai csere és véglegesítés

1. Az engine tartós `admitted` markert és mindkét eredeti Player-checkpointot
   ír. Ez után ismeretlen kimenetelű parancsot nem indít újra vakon.
2. Egyetlen Market/checkpoint SQLite tranzakción belül a Business kötött
   készletét vagy GP-jét védett kimenő escrow reprezentálja; a partner tényleges
   inventoryjából szintén hold/consume escrow készül. A Business kimenet
   forrása kizárólag az ellenőrzött véges domain-foglalás, nem a worker
   személyes inventoryja. Ez az SI-A06 custody-határ elvét követi.
3. Az exact ajánlatokon a meglévő két `BOTH_MOVEINV` opcode fut. A meglévő
   TradeEvidenceStore auditált natív trade-je és SI-A05 transfer witness készül.
   A Business bejövő item/GP-je kötött escrowba kerül, majd elfogyasztva a
   domain elszámolásának bizonyítéka lesz. A worker saját item/GP-egyenlege
   a művelet előtt és után egyezik.
4. A két végső Player-save, a három protected escrow, a native receipt és
   az audit/head ugyanabban a Market tranzakcióban commitolódik. A partner
   item/GP-változása exact mennyiségre és árra ellenőrzött.
5. A finalizer readonly újranyitja a kiválasztott világ natív adatbázisát és
   a teljes trade auditot. Ezután a meglévő AgentOperatedShopLifecycle
   stock → treasury sagája fut az eredeti ID-kkal. Sale foglalásnál nincs
   második készletlevonás. Csak ezután válik a Business order `completed`-dé.

A sale-channel döntés raw beszerzésnél exact Business acquisition, eladásnál
exact buyer/seller player-trade. Ellenőrzési megfigyelés nélkül a beszerzés
`not-recognized`, provenance disposition `preserve`; nem keletkezik clean-title
vagy igazolt belső eredet. A transfer witness önmagában nem old fel SI-A05
eredethiányt. Rejtett partner-inventory megfigyelés nem kerül a piaci kontextusba;
az HTTP válasz kizárólag az operation ID-t és a fázist tartalmazza.

## Hiba és helyreállítás

- Trade ledger és Player checkpoint külön DB. A ledger commit utáni
  checkpoint-hiba esetén a memória és a Market tranzakció visszaáll, de a
  tartós trade sor megmarad: az állapot **egyeztetendő**, nem completed.
  Nincs automatikus retry, refund vagy új settlement ID.
- Natív `cancel` csak hiányzó trade sor mellett megengedett. Admitted állapotnál
  mindkét eredeti kanonikus checkpoint digestjének változatlannak kell lennie.
  A cancelled receipt terminal marker; későn befutó execute sem adhat értéket.
  A finalizer csak e readonly bizonyíték után adja vissza a készletet/pénzfoglalást.
- Általános treasury release nem oldhatja fel a trade-hez kötött `food.`
  foglalást. Sikertelen, soha nem finanszírozott outbox is lezárható igazolt
  natív no-trade markerrel, mesterséges pénzfoglalás létrehozása nélkül.
- Stock commit utáni treasury/projekcióhiba előrefelé javítható az eredeti
  lifecycle receipt/settlement ID-val. A bounded `recover` csak véglegesít;
  bizonytalan fizikai parancsot nem küld újra. Elveszett HTTP ACK nem sikerbizonyíték.
- A már végrehajtott trade véglegesítése az admissionkor rögzített katalogusokkal
  történik akkor is, ha az aktuális ár később módosult. Új fizikai execute a
  módosult/lejárt policyval már tiltott. Audit-, projection- vagy receipt-hiány
  esetén a forrás zártan hibázik.

## Migráció és rollback

Additív schema v1 a Business DB-ben: `business_food_commerce_schema`,
`business_food_commerce_order`, `business_food_commerce_audit`,
`business_food_commerce_head`, továbbá `business_stock_native_reservation`.
A Market/checkpoint DB-ben `native_food_commerce_schema`,
`native_food_commerce_operation`, `native_food_commerce_audit`,
`native_food_commerce_head`. A meglévő protected escrow/binding/audit táblákat
és shop/treasury receipt táblákat használjuk. Közös `user_version`, régi mentés,
clock, inventory vagy escrow történet nem konvertálódik. Ismeretlen verzió és
hiányos audit/head/projekció elutasított. Nincs régi adatokból visszagyártott siker.

Éles rollback előtt az írókat és a queue-t meg kell állítani. A Business,
treasury, shop journal, Market/checkpoint, natív trade és kapcsolódó clock/
provenance állapotot együtt kell menteni, a WAL/SHM fájlokkal. A prepared,
admitted, completed és cancelled ID-kat egyeztetni kell. A korábbi kód nem
futtatható tovább nyitott kötött foglalásokkal. Előbb forward settlement vagy
bizonyított no-trade cancellation, majd kompatibilis teljes snapshot-visszaállítás;
egyoldalú Player-visszamásolás, audit-törlés és vak készlet/GP-visszaadás tiltott.

## Elfogadási határ

Izolált packed-content engine teszt valódi Player, inventory, escrow,
`BOTH_MOVEINV`, TradeEvidenceStore és újranyitott domain/native SQLite
forrásokkal. Nem futott élő, hálózaton bejelentkezett többavatáros vásárlás;
ennek közös SI-A15 elfogadása, a food draftok publikálása és az automatikus
megélhetési rutin külön feladat marad. Tesztkörök és megőrzött hibák:
[implementációs napló](SOCIETY_INTEGRATION_PROGRESS.md).
