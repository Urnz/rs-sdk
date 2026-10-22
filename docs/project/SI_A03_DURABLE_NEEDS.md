# SI-A03 – Tartós szükséglet-állapot

Későbbi integráció: az [SI-A04](SI_A04_NATIVE_RELIEF.md) külön natív apply API-val
bővíti ezt az authorityt. Az alábbi leírás az SI-A03 eredeti scope-ját rögzíti;
a régi, opcionális closure-ág továbbra sem natív relief-apply útvonal.

Hatókör: kizárólag a helyi/private LostCity világ. Az SI-A03 az időbeli
éhség/fáradtság állapotot tárolja; a natív fogyasztás egyszeri reliefje és
recovery cursora az SI-A04 feladata. Nincs új planner, LLM-hívás vagy éles futás.

## Authority és API

A [NeedsStore](../../needs/store.ts) az egyetlen írható fiziológiai authority.
A meglévő [dynamics](../../needs/dynamics.ts) számítja az egész értékeket és
a 3 600 000 nevezőjű maradékokat; az eltelt idő kizárólag SimulationClock-idő.
A nulla/maximális értéknél kifelé mutató törtmaradék eldobódik, így az alvási
regeneráció nem gyárt a polling gyakoriságától függő negatív tartozást.

A kulcs world + actor + lifecycle; a mentett kötés ezen felül exact player,
clock, clock-profile, world-profile és lifecycle-policy digestet tartalmaz.
A needs/dynamics policy digest szintén kötelező. Az immutable lifecycle ID
ugyanazokat a mezőket és digestelést használja, mint az SI-A01 natív source.
Más életciklus adata nem kerül át az új karakterbe vagy örökösbe.

- `read/get`: explicit `unknown` vagy validált tartós snapshot. A read-only
  kapcsolaton nincs séma-létrehozás, migráció vagy implicit inicializálás.
- `initialize`: explicit `genesis`, `admission` vagy `legacy-explicit` source-ID
  és digest. Az induló érték a jelenlegi policy initial értéke; nincs korábbi
  időszakra visszagyártott éhségtörténet. Azonos admission retry nem nulláz.
- `advance`: optimistic revision, BEGIN IMMEDIATE, mentett fractional carry,
  időre előreléptetés és ugyanazon tranzakcióban audit-snapshot. Elavult revision
  ütközés; az azonos időig ismételt kérés nem terheli újra a karaktert.
- Terminal `deceased/reset`: csak az exact terminal időig történik frissítés,
  utána az állapot változatlan. Múltba érkező, a már elszámolt időnél korábbi
  halál bizonytalan egyeztetés: blokkolás, nem önkényes visszaírás.

A store a snapshot digestjét, a policyt és a teljes saját auditláncot ellenőrzi.
A read ugyanabból az SQLite snapshotból olvassa a state-et és auditot. Ez az
első bounded integráció; nagy állományos teljesítménymérést nem állítunk.

## Módváltás és kimaradás

A [SimulationClockStore](../../simulation-clock/store.ts) v5 sémája a
`simulation_player_time_history` táblában tárolja a teljes player-time állapotot,
revisiont, clock-profilet és láncolt digestet. Az online/offline, alvás/ébrenlét
változása és a history bejegyzés ugyanazon óra-tranzakcióban commitol. Az ismételt,
változatlan presence nem új váltás. A history read ellenőrzi a láncot;
a needs az eltárolt revision/digest cursort is visszaellenőrzi a forrásban.

Kimaradás után minden committed módváltás időrendben visszajátszható. Az új mód
csak a váltás időpontjától érvényes. A sleep-place access lejárati időpontja
külön időhatár: onnantól awake-rate jár, további alvási kedvezmény nélkül.
Ez nem helyettesíti az SI-A10 tenancy/sleep végrehajtási integrációját.

Az engine health/death source egy read-only SQLite snapshotban olvasódik.
A needs legfeljebb a forrás `confirmedThrough` idejéig haladhat, nem a későbbi
gateway falióráig. Az óra `observeThrough` API-ja a jelenlegi clock-segmenten
belül vetít erre az időpontra, az óra globális idejét nem tekeri vissza.
Régebbi pause/reconfiguration segment, hiányzó/stale forrás, hibás finite-avatar
kötés, idegen death/lifecycle/profile és hiányos history blokkolja az adott munkát.
Az authority hiánya nem „biztosan életben van” eredmény.

## Gateway és közös food persistence

A [gateway adapter](../../server/gateway/admin/needs-runtime.ts) kezeli az
inicializálást, az olvasást és a ciklust. A normál gateway a meglévő tízmásodperces
population ciklusban futtatja, a death reconciliation után. Genesis apply és
population entry explicit inicializálást kér. A korábbi, már létező karakter
hiányzó needs állapota `unknown`; csak explicit legacy admission indíthatja.

Az entry identity-journal és a needs külön adatbázis. A needs-inicializálás
hibája nem törli a már felvett identitást: a kérés hibát ad, ugyanazon entry-ID
újrapróbálása a meglévő belépési receiptből befejezi az inicializálást.
Nem állítunk közöttük elosztott ACID-t. Egy régi, már applied genesis futás
újbóli lekérése önmagában nem migrálja a hiányzó régi needs-állapotot.

A [FoodNeedsPersistence](../../food-loop/needs-persistence.ts) egy kapcsolatot
birtokol a `.local/simulation/food-needs.sqlite` adatbázishoz. A food-ledger saját
`food_loop_closure`, `food_receipt_use`, `food_consumption_event` és audit táblái
megmaradnak. Az eddigi önálló FoodConsumptionStore API is kompatibilis marad;
közös connection esetén nem zárja le más tulajdonos kapcsolatát.

A `commit` typed needs-parancsot és opcionális, a kiszámított needs-before
digestjéhez kötött, nulla reliefű meglévő closure-könyvelést fog össze. Ennek tesztje a közös
receipt-lock/audit írás hibájánál mindkét domain rollbackjét bizonyítja.
**Ez még nem natív relief-apply API:** a nem nulla reliefet a közös adapter
elutasítja az SI-A04 natív source-bekötéséig; nincs ledgerbe írt, de az authorityn
nem alkalmazott éhségcsökkentés ezen a határon.
A gateway SI-A03 ciklusa ezt az opcionális closure-ágat nem használja.

## Világizoláció, migráció és rollback

A kezelt szerver saját workspace-éből származik a database és config útvonala,
valamint a server-ID. A writer és reader a normalizált és valós útvonalat is
ellenőrzi; idegen workspace, path traversal és junction/symlink escape tiltott.
A needs-adatbázis világkötése is tartós; egy másik világ ID-jával nem nyitható
authorityként. Az engine source-nak is a kiválasztott workspace-ben kell lennie.

- Needs schema v1: saját `needs_schema`, `needs_world`, `needs_state`, `needs_event`.
  Additive migráció; a food `PRAGMA user_version=1` változatlan. Az ismeretlen
  vagy hiányos needs-séma hibás forrás, nem automatikusan üres állapot.
- Clock v4 → v5: új history tábla, a jelenleg ismert player revision egyetlen
  baseline bejegyzésével. Ez nem pótol ismeretlen korábbi módváltásokat.
  Már inicializált needs elveszett history-cursora nem folytatható e baselineból.
- A normál stopped-world backup teljes workspace inventoryt ment; az új állapot
  a `.local` fákkal együtt bekerül. Valódi domain-DB-s backup/restore próba az
  óra és needs/food együttállását és a retired workspace megőrzését ellenőrzi.
- Rollback: az összes író leállítása, teljes kapcsolódó világ/DB/WAL/SHM és config
  együttes mentése. A régi clock v4 kód a v5 DB-t helyesen elutasítja. Régi kódra
  visszatéréshez a konzisztens, teljes upgrade előtti mentés vagy külön megírt,
  ellenőrzött migráció szükséges. Nincs user_version-visszaállítás, receipt- vagy
  audit-törlés, illetve committed gazdasági történet egyoldalú rewindja.
- Needs nem átruházható gazdasági vagyon. Halál/reset után a saját története
  megmarad; estate-adapter és örökös nem kapja meg a régi karakter éhségértékét.

## Bizonyítási kör és korlát

A tesztek tényleges Needs/FoodConsumption/SimulationClock/AgentState/
PlayerHealthEvidenceStore adatbázisokat, gateway genesis/entry adaptereket és
InstanceMaintenance backup/restore-t kötnek össze, ideiglenes könyvtárakban.
Van konkurens connection/revision, audit-insert hiba, clock/history atomic
rollback, restart/reopen, offline/sleep expiry, kétvilágos/junction/managed
kötés, terminal freeze és belépés utáni domain-pending recovery.

Az SI-A03-hoz külön élő E2E nem szükséges; a hálózati SI-A15 acceptance, a
négyavatáros megélhetés és a natív consume→relief SI-A04 továbbra is nyitott.
Az exact futási eredmények és az eredeti FAIL naplók a
[progressben](SOCIETY_INTEGRATION_PROGRESS.md) találhatók.
