# SI-C04 – Natív pénzügyi történet

2026-10-24. Ág: `codex/si-c04-native-finance-history`;
baseline `66d141fa66a95d171d91d39c57005241f0e6993e`.

Hipotézis: a SI-A12 meglévő, exact paused-clock/closed-tick/needs és physical
custody ellenőrzésű frozen boundary olvasójára immutábilis megfigyelés köthető.
Nyitó/záró actorcohort, source snapshot/digest és watermark együtt szolgálhatja
a meglévő Gini/rangmobilitás/árkosár képleteket. A riport újraolvassa a natív
forrást; felküldött JSON, jelenlegi egyenleg és falióra nem történeti authority.

Scope: személyes fizikai GP (inventory/equipment/bank/native escrow), külön
Business treasury és tulajdonosi kapcsolat. Deposit/loan/contract követelés és
tartozás elkülönített, nem még egyszer cash vagy becsült részvényérték. Tárgyi
eszközökre nincs kitalált GP-ár. Csak igazolt cash-for-single-item native trade
ad unit-price mintát; fixed basket és időablak előre kötött, hiány inconclusive.

Business revenue/input/wage/rent/capital csatornák source-hoz és szimulációs
stamphez kötöttek; worker-mediated commerce külön attribution, nem automatikus
Business treasury-bevétel. Hiányzó natív kategória/időbélyeg unplaced/unknown,
nem sikeres nulla. Alapítás/megszűnés csak megfigyelt transition, a hiányzó
gazdasági ok explicit unknown. A cash csökkenése nem tűnhet el a riportból.

A két frozen boundary a bérnek exact időpont nélkül is adhat időablakot: a
kifizetés nyitáskor nincs a paid-halmazban, záráskor viszont ugyanaz a work-order,
audited work-binding, canonical Player reward és treasury-debit egyezik. Ez
`boundary-transition` intervallum, `simulationTime:null`, nem faliórás stamp.
Korábban kifizetett bér nem új költség, eltűnt/átírt payment és félbemaradt
saga nem zárt határ. A SI-A12 jelenlegi, önmagában unplaced bérforrása ettől
nem kap utólag kitalált timestampet. Zero-wage munka nem monetáris kifizetés.

Határpolicy: backend-selected frozen SQLite készlet, readonly per-DB snapshot,
pontos paused clock és closed native watermark, stabil source-kettősolvasás.
Ez nem cross-DB ACID. Az observation binding saját append-only, exact replay;
hibás/módosult source vagy clock/cohort különbség nem válik történeti méréssé.
Nincs gameplay writer, bank/contract/treasury migráció vagy automatikus backfill.

Olcsó próba: disposable valódi Player-save/escrow, Business, treasury, bank,
contract, SimulationClock és native trade források; ismert cash/Gini/rang/tie,
belső transfer, veszteség, hiányos kosár, readonly replay, tamper/sourcegap és
clock drift. Natív child legfeljebb60 s, wrapper90 s; provider0, nincs live világ
vagy történeti SI-A15 backup érintés. Első hiba után szűk diagnosztika.

Ellenőrzés: új finance komponens és az evaluation/dashboard/integration közvetlen
fogyasztói; érintett root/engine TS és staged format. Full csak konkrét shared
alapváltozáskor, nem saját observation binding vagy taskzárás miatt.

SI-C07 jövőbeli futásainak adatából történő újraolvasás és SI-M3/MVS nem ennek
a mechanikai feladatnak a teljesítménymérése.

## Olvasási és perzisztenciaszerződés

- `finance-sources.ts`: a meglévő `readWealthBoundary` exportált, változatlan
  ellenőrzése, külön readonly bank/loan/contract/Business és trade források.
  A banki új exportált reader az auditot/postingokat és deposit-egyenleget
  egyezteti, a meglévő BankingLedgerStore writer/migrátor változatlan.
- A megfigyelés a `.local/society-metrics/finance-boundaries/<id>.json` saját,
  additív schema1 fájlja. Source SQLite-serialize SHA-256, world/clock/profile,
  exact actor/lifecycle és fixed basket/freshness digest kötött. Temp-file és
  atomikus, kizárólagos link-publikálás: az ID nem írható felül, exact replay
  megengedett. Ugyanazon ID eltérő forrással/policyval hibás.
- A reporter nem hoz létre megfigyelést, DB-t vagy könyvtárat. Minden olvasás
  újraellenőrzi a frozen SQLite-készletet és a bindinget. Hiány, tamper, source-
  prefix gap, clock drift és eltérő cohort/policy inconclusive/invalid.
- Migráció/backfill nincs; régi boundary és ismeretlen schema nem kap kitalált
  történetet. Rollbacknél a JSON-bindings és a hozzájuk tartozó frozen SQLite
  készlet megőrzendő; a korábbi riport egyszerűen nem használja az opcionális
  finance csatornát. Gameplay gazdasági adat nem változik.
- A policy per-DB konzisztenciát és stabil dupla forrásellenőrzést támogat,
  nem distributed ACID-t. A backendnek frozen forráskészletet kell választania;
  élő fájl későbbi változása érvényteleníti a megfigyelést.

## Jelentés és használat

A `reportNativeFinance` és az opcionális `nativeFinance` evaluation adapter
ugyanazt a forráskötést használja. Az admin GET `/api/admin/society/finance`,
az evaluation és dashboard csak a backend `nativeFinanceOptions` konfigurációját
fogadja; HTTP source-path/observations JSON nem authority, capture POST nincs.
Konfiguráció nélkül a régi riport hiányként jelzi a csatornát.

CLI: a backend frozen mappák fájlnevei `checkpoint.sqlite`, `business.sqlite`,
`treasury.sqlite`, `clock.sqlite`, `needs.sqlite`; opcionális `banking.sqlite`,
`contracts.sqlite`, `trades.sqlite`. Mindkét könyvtár a kiválasztott világban
maradjon. A CLI nem állítja le a világot és nem készít automatikus DB-másolatot.

```powershell
bun scripts/capture-finance-boundary.ts --boundary=opening --opening-dir=<opening> --closing-dir=<closing> --from=<sim-start> --to=<sim-end> --clock-id=<id> --clock-profile-digest=<digest> --actor=<agent-id>
bun scripts/capture-finance-boundary.ts --boundary=closing --opening-dir=<opening> --closing-dir=<closing> --from=<sim-start> --to=<sim-end> --clock-id=<id> --clock-profile-digest=<digest> --actor=<agent-id>
bun scripts/report-society-evaluation.ts --opening-dir=<opening> --closing-dir=<closing> --from=<sim-start> --to=<sim-end> --clock-id=<id> --clock-profile-digest=<digest> --actor=<agent-id>
```

Az actor kapcsoló minden kiválasztott szereplőhöz ismétlendő. A basket/freshness
`config/native-finance.json` szerint kötött a capture során; később nem
cserélhető és a hiányzó item nem helyettesíthető. A default kosár raw/cooked
lobster, legfeljebb egy szimulációs napos utolsó igazolt unit-price mintával.
Pontosan racionális GP/darab arány számít; gift/barter/mixed offer nem ár.

A Gini és rangmobilitás kizárólag a kijelölt, egyező lifecycle-kohorsz személyes
fizikai/custodial GP-jét méri. A Business-lista és az összes recorded cash a
teljes befagyasztott forráskészlet diagnosztikája, nem a személyes Gini nevezője.
A cégtulajdonosi kapcsolat nem szorozza újra a cég pénzét a tulajdonos vagyonába.
Deposit/loan/conditional contract külön kötelezettség/követelés; net-worth és
tárgyi vagyon GP-értéke nincs becsülve. Reserved GP nem második pénzeszköz.

A Business bevétel/input csak egyező native trade + treasury-settlement mellett
kerül az időablakba. A munkás saját coins-változása önmagában nem cégbevétel.
A jelenlegi native rent player-accountok között fizet; ebből nem következik
Business rent expense. A fizikai capital-installációs source nem tartalmaz
megbízható GP-költséget, ezért capex nem becsülhető tárgyszámból. Mindkét
hiány külön látszik, a cég cash-deltája és az ismeretlen residual megmarad.
Az alapítás/aktív→closed megfigyelt átmenet, gazdasági cause hiányában explicit
`not-recorded-by-native-source`, nem becsült csőd vagy profit.

## Eredmény és ellenőrzési index

**SI-C04 kész;25/45, következő SI-C05 új kérésre.**
[Source-bound eredmény](SI_C04_NATIVE_RESULT.json): személyes cash100/100/100/100
→40/160/100/100, Gini2250 bp és átlagos holtversenyes rangmozgás2500 bp;
az5 GP/2 darab nyitóár10 GP/2 darabra változik, a másik kosárelem stabil,
így a fixed basket változása5000 bp. A teljes recorded cash600→550 GP:
a Business50 GP cash-csökkenése megmarad, nem becsült számviteli profit/veszteség.

Külön actual native BOTH_MOVEINV esetek:2 cooked lobster sale80 GP bevétel,
2 raw lobster procurement40 GP input. Kizárólag a treasury-settlement után
számolható; az önálló native trade nem elég. A raw native engine út és a
frozen snapshot olvasó külön vékony kapuk, nem egy önállóan futó élő gazdaság.
Deposit1000 és loan50 GP nem növeli újra a cash-t; conditional contract5 GP
külön szerepel. Egy40 GP-s belső treasury-transfer aggregált hatása0, a closed
Business pénze nem tűnik el. A50 GP bér tisztán a source-egyeztetés és a két
határ közti állapotátmenet unit próbája, nem új élő natív salary-futás.

Teljes log/result: `.local/verification/<azonosító>.log` és `.result.json`.
A körök átfednek, számok/idők nem összeadandók.

- `20261024-184407-230-si-c04-final-wage-boundary`: **11 PASS /0 FAIL**,
  finance8 +actual native commerce2 +wrapper; root/engine TS PASS,93,116 s.
  Végső runtime-forrás és a boundary wage-proof/partial-saga ellenőrzés.
- `20261024-183247-263-si-c04-final-consumers`: **79 PASS /0 FAIL**,47,784 s;
  finance, SI-A12 integration, tíz képlet, evaluation-native, dashboard,
  bank ledger és régi food-commerce26 native eset. Ezután csak a finance
  wage-projection és annak source-kötése bővült, fent célzottan ismételve.
- `20261024-183305-448-si-c04-root-types`: root TS PASS,35,796 s;
  `20261024-183308-442-si-c04-engine-types`: engine TS PASS,29,274 s.
  A későbbi wage-bővítés a végső gate-ben újra ellenőrzött.
- `20261024-183650-028-si-c04-cli-types-smoke`: a két CLI külön, ideiglenes
  tsconfigból is típusellenőrzött, report `--contract` smoke PASS,10,725 s.
  A globális build/test discovery konfiguráció változatlan.
- `20261024-184937-302-si-c04-staged-format`: staged format PASS,1,537 s.
- Korábbi FAIL-ok megmaradnak: első parser/ternary hiba; zero-rate fixture
  helyett a tényleges society policy; treasury-fixture hiányzó bindSettlement;
  native próba a még nem inicializált commerce-sémát olvasta. Tuple-típus és
  az engine által újonnan elért `save-reader` type-import `.js` suffix javítva.
  Nem gyengítettünk policyt/assertiont és nem indult teljes új baseline.

Full nem futott. Az új `readNativeBankingLedger` és finance reader kizárólag
olvas; a közös bank/treasury/contract writer, migráció és gazdasági tranzakció
szemantikája, SimulationClock és általános auth-gate változatlan. A SI-A12
wealth olvasó csak exportot kapott. Az evaluation új racionális árágát és
közvetlen dashboard/CLI/admin/native fogyasztóit célzott kör fedi.
Nincs providerhívás/költség, live világindítás vagy publication. A források
hiányosságai megmaradnak: ez mérési mechanika, nem teljes gazdasági történet,
SI-C07, SI-M3/MVS vagy önfenntartási PASS.
