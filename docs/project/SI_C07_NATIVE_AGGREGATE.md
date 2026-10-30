# SI-C07/2 – A teljes natív összesítő

2026-10-30. **P2-11 kész, a rögzített lista11/11.** A hét munkacsomagból
az1–2. kész; a3. közös founder-baseline következik. A fő feladatlista27/45,
SI-C07 nyitott, tényleges preflight NO-GO; SI-M3/MVS nem PASS.

## Mit igazol a lezárás?

`society-metrics/minimum-assessment.ts` az eddigi állandó
`qualifiesMinimum:false` helyett az eredeti számítási mag eredményét adja át.
PASS csak bound eredeti frame, egyező natív scope, teljes sourceCoverage és
mind17 szabály/mind8 kapu PASS esetén lehetséges. Egy külön igazolt sértés
elsőbbséget élvez egy másik forrás hiányával szemben. Nincs feltöltött cellalista,
új képlet, küszöb- vagy policy-változás.

Az eredeti1 nap warmup +7 nap evaluation, ugyanazon applied genesis/world/
clock/cohort és193 határpont közös próbája egyszerre ad17/17 numerikus,
8/8 integrity és16/16 source-coverage PASS-t. A source-kötés ugyanaz a
P2-03–P2-10 által már ellenőrzött read-only backend út.

A bővített fixture a tényleges komponens-producereket és SQLite tárolókat
hajtja meg: admin genesis adapter/permit/nyugta, NeedsStore és native food
application, véges food production/trade/consume, lifecycle/cycle/repair,
material lot és single-spend escrow, paid rent, clock/player-time, prospective
executor source, mortality/census/policy/admin/external/lineage lezárások.
Az összesítőhöz sem szabálycellát, sem kész PASS-kaput nem ad át.

Ez **komponens-producer integrációs fixture**, nem új packed-engine futás,
autonóm gazdaság vagy a jövőbeli C07 baseline. A korábbi packed Mining→smelt→
repair→reuse és food-chain bizonyíték külön megmarad. A fixture konfigurációjának
négy ágyát, kilencnapos rent periódusát, ételkészletét és szükségleti ütemét
nem telepítettük világra, és nem fogadtuk el C07 indulócsomagnak.

Az eredeti csákány100 kapacitásáról a fixture a warmup valódi lifecycle-use
eseményeivel1-re jut. Az evaluationben az exact utolsó kopás, belső érc→bar
fedezetű javítás50-re és új használat49-re történik. Nem állítja, hogy egy
50-es javítás fenntartja egy virgin100-as evaluation opening kapacitását.
Az executor pozitív alkalma egy lezárt, natív admission előtti kérés: a teljes
lehetséges várakozás felső korlátja1 sim óra; üres naplóból továbbra nincs credit.

## Negatív és frozen bizonyíték

- Egy world-policy source elhagyása: inconclusive, nem PASS és nem nulla.
- Új, eldobható záró checkpointban ténylegesen üres founder-leltárból újraolvasott
  food reserve: FAIL. A másik hiányzó source ezt a FAIL-t nem törli.
- A teljes checkpoint és a külön mutation journal frozen read-only újraolvasása:
  az assessment, sourceCoverage és PASS azonos. A bemeneti fájlok hash-e változatlan.
- Az eldobható frozen másolaton a valódi watermark producer `fault()` jelzése:
  inconclusive, `qualifiesMinimum:false`. Az eredeti források változatlanok.
- A korábbi üres/numerikusan hibás joint fixture továbbra FAIL; a P2-03
  mind16 omission/warmup és native-fault próbája továbbra érvényes.

## Időkeretek és megőrzött diagnosztika

Az eredeti coverage-fixture50s keretét nem emeltük. Az új,64 étkezést és
teljes mechanikai/material/rent történetet tartalmazó külön pozitív fixture
125s összesített guardot kapott: setup60s, outcome-read30s, history-read60s,
aggregate10s, negative/frozen30s és cleanup5s fázislimittel; ezek nem
összeadható extra futási jogok. Minden24 sim óránál részidőt ír a build,
a kiolvasások külön eredményt és időt kapnak.

- `20261030-142416-566-si-c07-p211-short`: FAIL3,957s, az egyszeri food fixture
  ugyanazon véges forrásának kvótája elfogyott. Az ismétlődő teszt külön véges
  forráspontokat kapott, a termék kvótavédelme megmaradt.
- `20261030-142435-908-si-c07-p211-short-quota`: FAIL3,346s, a fixture a
  read-only food capabilityt snapshot nélkül kérte. A meglévő snapshot API javította.
- `20261030-142449-033-si-c07-p211-short-snapshot`: FAIL7,903s, a fixture-wallet
  nem változtatta a mért egyenleget. Valódi véges balance-map javította.
- `20261030-142508-372-si-c07-p211-short-custody`: az1 runtime eset PASS,
  wrapper FAIL15,288s; Bun `run` current-directory indítási hiba. A külön
  Bun run/direct TS próbák is launch FAIL; Node-dal induló compiler használható.
  `20261030-142556-784-si-c07-p211-types-node`: TS FAIL19,093s egy optional
  parser-slot miatt; a már ellenőrzött talált item-slot explicit narrowingot kapott.
- `20261030-142633-898-si-c07-p211-short-opening`: PASS15,467s; warmup-use
  az induló lineage frame után, történeti opening-gap nélkül.
- `20261030-142657-079-si-c07-p211-full-native`: FAIL72,967s; setup71,033s
  a60s fáziskeret fölött. Buildből58,6s natív producer/application,5,0s fizikai
  projection és5,5s snapshot. A még szükségtelenül sűrű6h meal helyett a
  változatlan dynamics mellett előre számolt3h awake/9h sleep és12h meal
  került a tesztbe; nincs termék-/policy-/küszöbhangolás.
- `20261030-142844-235-si-c07-p211-short-bounded-meals`: PASS14,305s.
- `20261030-142938-456-si-c07-p211-full-bounded-meals`: FAIL110,674s.
  Setup47,943s már kereten belül; mind17/8/16 PASS, de az egyetlen közös
  reader-blokk61,087s a60s limit fölött. Külön szakaszokra bontás, limitemelés nélkül.
- `20261030-143310-045-si-c07-p211-short-phases`:3 PASS18,492s.
- **`20261030-143359-938-si-c07-p211-native-final`:4 PASS109,962s.**
  Setup44,580s; outcomes2,484s; history54,893s; aggregate27ms; negative/frozen5,820s;
  összesített108,678/125,000ms. A rövid és a teljes eset7 külön célzott próba.
- `20261030-143734-318-si-c07-p211-consumers`:47 PASS7,224s: eredeti számítási
  mag, minimum/native/source-coverage adapter, evaluation/native-outcomes és preflight.

Root TypeScript és a korábbi genesis/joint út végső eredménye a rövid átadásban.
Teljes regresszió nem indokolt: a változás a minimum riport összesítője és
közvetlen fogyasztói; nincs shared persistence/clock/economic/auth/dependency
szemantikaváltozás. Nincs live world/start/import/enrollment/publication/provider,
új C07 baseline vagy történeti payload DB-read.


2026-10-30 végső kiegészítés: az old reader30s blokkja több körben túllépett,
31,287s (`143805-762`),31,949s (`144004-998`),30,845s (`144441-156`).
Az utóbbi kör4 pozitív native esete PASS, wrapper FAIL157,228s az old blokkon;
a régi összidő49709/50000ms volt. Ez nem lett PASS-ként elkönyvelve.
A readonly collector külön core/food/housing/tools lépéseket kapott, a sync
production facade ugyanazokat végigolvassa, részreport nélkül. Collection-local
validált policy reuse; minden snapshot/hash/DB/time/custody ellenőrzés megmaradt.
A két független facade-collection továbbra ellenőrzi a mozgó forrásokat.

- `20261030-145023-775-si-c07-p211-iterator-thin`:7 PASS3,870s; sync és
  lépcsőzött read eredménye egyenlő, bemeneti fájlok változatlanok.
- **`20261030-145035-029-si-c07-p211-iterator-original-window`:8 PASS46,059s.**
  Teljes eredeti193 pont: outcome1,758s, core171ms, food13,429s, housing10,082s,
  tool1,860s, history420ms; összesített44997/50000ms. A limit nem emelkedett.
- `20261030-150109-935-si-c07-final-types-and-consumers`:18 runtime PASS,
  wrapper TS FAIL64,475s. A projected food dependency helyett egyszer betöltött,
  teljes FoodLoopCatalog és literal phase-lista javította a két típushibát.
- **`20261030-150412-079-si-c07-types-final`:root TS PASS66,789s.**
- `20261030-150939-136-si-c07-final-runtime`:7 PASS55,228s: pozitív32h native,
  meglévő2h history/facade boundary és ZIP/source consumer. Nem új193 pontos soak.
- `20261030-150958-155-si-c07-final-artifacts`:egyező candidate/preflight digest,
  várt NO-GO és0 futási/provider jogosultság PASS1,538s.

A genesis13 esete a korábbi wrapperben mind PASS volt; nem ismétlődött újra.
A forrásgyűjtés módosítása readonly/report szintű; engine/world-clock, producer,
SQLite commit, migration vagy jogosultság alap nem változott.

- `20261030-151503-161-si-c07-artifacts-format-final`:203 aktuális source SHA,
  packed source SHA, változatlan eredeti policy,11/11 checklist,296 helyi link,
  egyező NO-GO artifact és changed-line formázás PASS2,997s. A dokumentációs
  eredménybejegyzés nem indokol új runtime/typecheck ismétlést.
