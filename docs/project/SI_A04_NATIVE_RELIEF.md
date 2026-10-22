# SI-A04 – Natív fogyasztásból egyszeri hunger-relief

Hatókör: kizárólag a helyi/private LostCity emulator. Az SI-A01 natív itemlevonás
és az SI-A03 tartós needs authority összekötése. A termelési/actor-közi lineage
SI-A05, a közös többavatáros élő acceptance SI-A15 feladata marad.

## Tartós határok

Az engine [native food store](../../server/engine/src/mods/NativeFoodConsumptionStore.ts)
ugyanabban a kanonikus Player-checkpoint tranzakcióban rögzíti az eredményt és
az új [delivery outboxot](../../server/engine/src/mods/NativeFoodDeliveryStore.ts).
Egy action-ID egy bejegyzés; azonos native retry a korábbi eredményt adja vissza.
Az outbox a `no-use` eredményt is megőrzi, nulla fogyasztással és receipt nélkül.

A [World](../../server/engine/src/engine/World.ts) a tick végén hívja a
[closeNativeFoodTick](../../server/engine/src/mods/NativeFoodDeliveryRuntime.ts)
határt. Az outbox headhez kötött clock/sequence/digest watermark csak az addig
lezárt natív történetet tanúsítja. A későbbi fogyasztás nem commitolhat a már
lezárt szimulációs idő elé. Pending intentből nincs kitalált consume; retrykor
az engine újra a hiteles clockot olvassa.

A gateway előbb engine health/death snapshotot, majd food snapshotot nyit.
A needs legfeljebb e két authority igazolt idejének minimumáig halad.
A hiányzó, 30 másodpercnél régebbi vagy eltérő clock/profile watermark blokkol;
nem jelent „nem történt étkezés” eredményt. A korábbi profil/status segmentre
nem vetítünk vissza igazolatlan időt.

A [gateway needs ciklusa](../../server/gateway/admin/needs-runtime.ts) a
lezárt outbox minden még nem nyugtázott eredményét sorrendben egyezteti,
**a normál fiziológiai előreléptetés előtt**. Nem ugorhat át korábbi pending,
ismeretlen actor/needs vagy hibás source bejegyzést. A natív action, username,
actor, world, lifecycle, clock és profile az aktuális membershiphez kötött;
a finite-avatar és death authority saját digestje is ellenőrzött.

## Lokálisan atomi relief

A [FoodNeedsPersistence](../../food-loop/needs-persistence.ts) közös kapcsolatán
a [NativeFoodConsumptionProjection](../../food-loop/native-consumption-store.ts):

1. Az exact sequence-hez a [read-only NativeFoodSource](../../food-loop/native-source.ts)
   képességből olvassa az eredményt. Nincs feltöltött vagy LLM által adott receipt.
2. World/source/cursor/digest ellenőrzés után az eredeti receipt időpontjára
   előrelépteti az egyetlen [NeedsStore](../../needs/store.ts) állapotát.
3. A meglévő lobster katalógus 1800 reliefjét clampeli:
   `effectiveRelief = min(hungerBefore, 1800)`, `hungerAfter = hungerBefore - effectiveRelief`.
   A fractional carry és a többi szükséglet megmarad; nem HP-healből számol.
4. Ugyanazon BEGIN IMMEDIATE tranzakcióban commitol a needs state+audit,
   native consumption application, egyszeri receipt-use lock és recovery cursor.

Az esemény tartalmazza a native source ID/sequence/digestet, action-ID-t,
receiptet, clockot, catalog/needs/dynamics digestet, before/after needs-state-et
és audit revisiont, valamint a tényleges mennyiséget és reliefet.
A needs auditban külön `lastFoodReceipt` marker őrzi az action/source kötést.
A teljes projection vagy egy lock törlése sem teszi újra felhasználhatóvá
a már alkalmazott receiptet; az eltérés blokkolt reconciliation.

Az azonos ID második kérése a tárolt applicationt adja vissza, régi expected
revision mellett is, ha minden source/binding/policy egyezik. Más kérés azonos
ID-val, rossz actor/lifecycle/world, catalog drift és időben visszalépő esemény
hibás. A no-use eredménynek nincs fiziológiai update-je vagy receipt lockja;
a cursor nyugtázza, a normál ciklus az eltelt időt később egyszer elszámolja.

A natív fogyasztás teljes HP mellett is valódi itemlevonást végez az eredeti
packed lobster contenttel, nulla HP-gain mellett. Nem kellett vanilla szabályt
átírni vagy mesterséges sebzést adni. Nulla hunger mellett is egy fogyasztott
egység, de nulla fiziológiai jóváírás kerül a mérhető eseménybe.

## Crash, konkurencia és olvasás

Az engine commit és a domain apply két külön adatbázis; nincs köztük állított
elosztott ACID. `native-committed/domain-pending` olvasható részállapot.
A gateway restart ugyanonnan folytatja a tartós cursort. A domain commit előtti
hiba mind a négy helyi írást rollbackeli; az engine-ben elfogyasztott étel nem
teremtődik vissza. Commit utáni hiba/retry nem második relief.

Két gateway folyamat ugyanazt a receiptet egy SQLite writer lock és az exact
source/action replay határán egyezteti. A busy timeout a kapcsolat létrehozása
után, a migrációs writer tranzakció előtt érvényes. Az
[OwnedFoodDatabase](../../food-loop/owned-database.ts) a saját prepared
statementjeit explicit finalizálja a szigorú close előtt; nem lenyelt close-hiba
vagy teszt assertion lazítás oldja meg a Windows SQLite handle-élettartamát.

Az olvasó API: `readPopulationFoodApplications`, exact sequence-re pedig
`NativeFoodConsumptionProjection.status`. Hiányzó saját DB/séma `unavailable`,
nem sikeres nulla eredmény. A projection read-only SQLite snapshotból olvas,
és visszaellenőrzi az engine forrást, receipt lockot, needs auditot és cursort.

A [natív nutrition metrika](../../society-metrics/native-food.ts) kizárólag
ezen ellenőrzött fiziológiai események mennyiségét és effektív reliefjét vetíti.
Hiányzó saját DB/séma `unavailable`; engine source-hiba blokkolt olvasás,
pending vagy nem lefedett ablak `inconclusive`. Az első igazolt megfigyelés
előtti időszakot a reader nem minősíti ismert nulla történetnek.
Ezekből nem készül nulla/PASS.
A `internalOrigin: unknown` szándékos: nem gyárt gather/cook/trade lineage-ot.
Nem ír vissza metrikát authorityként, és nem teljes SI-A12 reportintegráció.
A régi háromreceiptes closure/summary API külön scope marad; natívan elhasznált
receiptből nem készíthet második final-use closure-t.

## Migráció, világizoláció és rollback

- Engine: az SI-A01 `native_food_schema=1` és action táblája megmarad.
  Additive `native_food_delivery_schema=1`, delivery, head és watermark.
  A régi completed eredmény append-only legacy outbox bejegyzést kap; automatikus
  visszamenőleges reliefet nem. Legacy reconciliation nélkül a feldolgozás blokkol.
  Újabb/ismeretlen vagy hiányos séma nem írható felül.
- Domain: új `native_food_apply_schema=1`, `native_food_consumption_event`,
  `native_food_receipt_use`, `native_food_recovery` a közös food/needs DB-ben.
  A food saját táblái és `PRAGMA user_version=1`, valamint a needs v1 sémája
  megmaradnak. A `lastFoodReceipt` additive snapshot-metaadat a már meglévő auditban.
- A szükségletek inicializálása továbbra is explicit. A fiziológia nem adódik
  át estate/örökösnek; terminal needs nem kaphat új reliefet. Egy halál előtt
  commitolt, még pending receipt csak a terminal előtti bizonyított időre
  alkalmazható, a terminal előreléptetés előtt. Azonos/utólagos bizonytalan
  terminal idő blokkol, nem átminősített siker.
- A kezelt szerver saját workspace/ID/path bindingje és a fizikai útvonal
  is ellenőrzött, symlink/junction escape tiltott. Explicit
  `PLAYER_CHECKPOINT_DATABASE`/`GE_DATABASE` vagy a kiválasztott workspace
  egyetlen ismert outbox-authorityje használható. Ambiguity/unavailability blokkol;
  nincs más világ local-default adatbázisára történő fallback.
- Backup/restore: írók leállítása, teljes világállapot, mindkét adatbázis és
  DB/WAL/SHM, config és source cursor együtt mentendő. A meglévő teljes workspace
  backup az új táblákat is menti. A source-ID/cursor/needs marker eltérés miatt
  részleges restore nem nyugtázható vakon új sikernek.
- Régi kódra rollbackhez az upgrade előtti konzisztens, teljes mentés vagy külön
  ellenőrzött migráció szükséges. Nincs receipt/audit törlés, inventory-visszaadás,
  hunger kézi jóváírás vagy user_version visszaírás committed művelet javítására.

## Ellenőrzési scope

A [natív nutrition teszt](../../server/engine/src/mods/NativeFoodNutrition.test.ts)
valódi packed contentet, Player inventory/save-ot, kanonikus MarketStore-t,
delivery outboxot, NeedsStore-t, food receipt-use/cursort és readonly metrikát
köt össze egy izolált avatárral. A gateway külön integration tesztje a scheduling
és domain-pending rollback mechanikájához typed authority fixturet használ;
ez nem önálló fizikai inventory bizonyíték.

Öt forced-process-kill határ: needs előtt, needs után, event után, cursor után,
domain commit után. Mindegyik után reopen és ugyanazon receipt újrapróbálása;
ezen felül két tényleges gateway worker process párhuzamos apply-ja. A natív
commit előtti/utáni engine crash-próbákat az SI-A01 tesztjei továbbra is lefedik.

Nincs külön éles hálózati próba, szolgáltatás-restart vagy éles DB-migráció;
az SI-A01 egyavatáros izolált smoke itt teljes hunger-változással bővül.
Az exact eredmények és negatív naplók a [progressben](SOCIETY_INTEGRATION_PROGRESS.md)
szerepelnek. SI-A05 és SI-A15 nyitott.
