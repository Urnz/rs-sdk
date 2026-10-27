# SI-C07/2 – Minimum-kiértékelő és natív forrástérkép

2026-10-27. **A 2. munkacsomag folyamatban; lezárási lista 2/11 kész.**
Ez a [rögzített bontás](SI_C07_REMAINING_WORK.md)2. pontjának részeredménye,
nem új munkacsomag és nem lezárt SI-C07.27/45, preflight NO-GO.
Az aktuális, rögzített feltételek és a korábbi számláló magyarázata a
[lezárási listában](SI_C07_PACKAGE2_CLOSURE.md); a lenti komponensleírás történeti részleteket is tartalmaz.

## Elkészült számítási mag

`society-minimum/assessment.ts` a meglévő immutable contract17 requirementjét
és8 integrity gate-jét használja. Policy-fájl, küszöb és időablak nem változott.
A frame pontosan az eredeti1 nap warmup után kezdődő7 nap evaluationt, a clock/
profile/world azonosságot, frozen founder ID-ket és a contract digestjét köti.
Ez backend-owned számítási környezet; nem hitelesíti önmagában a genesis vagy
névsor történetét.

A kötelező cellák a contract scope-jából keletkeznek: külön nyitó/záróhatár,
minden natív megfigyelési határ, minden founder minden napja, minden founder
teljes ablaka, minden tool type és az egész ablak. A caller nem hagyhat el
kedvezőtlen tagot/bucketet/cycle-t, nem tölthet fel idegen vagy duplikált cellát.
A nyitó founder-szám korlátjának tartalmaznia kell a frame frozen rosterének
méretét; három szereplő nem használhat négy alapítóról szóló számot.

A teljes natív boundary inventory source digesttel és legfeljebb az eredeti
trace-gap távolságú pontokkal szükséges az összes határra vonatkozó PASS-hoz.
Két tetszőleges endpoint vagy a complete flag egyedül kevés. Hiányos schedule
mellett egy megfigyelt sértés továbbra FAIL, a többi boundary-scope inconclusive.
Legfeljebb1000 founder,10000 bucket/boundary és50000 értékelési cella engedett;
a budget még a teljes mátrix létrehozása előtt ellenőrzött.

Az értékek a requirement egységében megadott egzakt BigInt-racionális alsó és/
vagy felső korlátok. A számítás nem kerekít a küszöb előtt:

- `at-least`: elegendő alsó korlát PASS; küszöb alatti felső korlát FAIL.
- `at-most`: küszöb feletti alsó korlát FAIL; elegendő felső korlát PASS.
- A többi eset inconclusive; alsó boundot nem szabad pontos értékké változtatni.
- Zero/unknown opportunity inconclusive. Pozitív, igazolt exposure melletti
  pontos nulla lehet sértés. Nullás denominator nem elfogadható mérési érték.
- Bármely hiteles cella/gate FAIL megmarad más hiányzó cellák mellett is.
  Global PASS-hoz minden kötelező cella, minden scope és mind a8 gate PASS kell.

Ez **belső számítási API**, nem observation-upload endpoint. Egy evidenciahash
azonosító, nem aláírás vagy a natív eredet bizonyítéka. A core all-PASS unit-
fixture csak a képleteket és kvantorokat igazolja, nem működő társadalmat.

## Natív bekötés és felületi eredmény

`society-minimum/source-map.ts` mind a17 szabály és8 gate forrásigényét megnevezi.
A preflight gépi riport is tartalmazza a térképet és a konkrét hiányt; nem
állít mért értéket a még hiányzó olvasók helyére.

`society-metrics/minimum-assessment.ts` a már validált natív outcome-readerekből
5 work/tool/capacity,3 population,4 needs,4 food/final-use és1 housing szabályhoz ad boundot, backend által kijelölt
eredeti források esetén. A frame nem választható HTTP query/body vagy LLM-output alapján.

- A korábbi completed-repair darabszám cyclecreditje 2026-10-27-én megszűnt:
  a [natív maintenance-reader](SI_C07_TOOL_MAINTENANCE.md) exact kopás/repair/reuse
  és inputfogyasztás bizonyítékot ad. Az ugyanaznapi
  [prospektív material-origin](SI_C07_MATERIAL_ORIGIN.md) a közvetlen lánchoz már
  belső eredetet is igazolhat; original founder/genesis/scope mellett teljes ciklus
  lower boundot ad. Javításból önmagában továbbra nincs minimumcredit vagy PASS.
- Native work: külön napi distinct physical producer alsó darabszám. Egy actor
  több receiptje egyszer számít. Az eseményablak `(start,end]`, így éjfél az
  előző naphoz tartozik.
- Native work: a három eredeti stage kind igazolt előfordulásai. Mining vagy
  smelting önmagában nem helyettesít food-gathering/processing/maintenance-t.
- Standing tool demand: az egyetlen leghosszabb bizonyított unusable interval
  alsó időkorlátja; nem külön actorok vagy kérések időinek összege.

`evaluation.minimumAssessment` mindig tartalmazza az eredeti17 és8 sort.
Hiányzó run frame-nél `bindingStatus:unbound`, hibás frame-nél redaktált invalid.
A `bound` csak strukturálisan egyező backend frame-et jelent, nem applied-
genesis/baseline attestációt. Az új population-forrás ettől külön ellenőrzi az
alkalmazott genesist és annak journal-anchorját. A natív builder egyik integrity gate-hez sem
szintetizál PASS-t konfigurációból vagy egy adatbázis létezéséből.
Az outcome riport clock/profile/actor/window scope-jának is egyeznie kell;
idegen vagy hiányzó scope-ból még diagnostic FAIL sem vehető át.

A meglévő, bizonyított scoped tool-hiány FAIL-je továbbra látszik hiányzó vagy
hibás run binding mellett is, külön diagnosticViolations eredettel. Ez nem
egy még el sem indított hosszú SI-C07 run hitelesített végeredménye.
Hiányzó új csatorna nem rejti el a korábbi igazolt sértést. A facade jelenlegi
natív kimenete nem tud teljes minimum PASS-t vagy qualifiesMinimum:true-t adni.

Az [új sourceCoverage kiértékelés](SI_C07_SOURCE_COVERAGE.md) mind a 16 szükséges
családhoz megmutatja a required warmup/evaluation időhatárokat, head/evidence
kötést, teljes/hiányos/hiányzó/hibás állapotot és a meglévő lezárási pontokhoz
tartozó hiányt. Puszta available státusz nem coverage PASS; a P2-03 teljes natív
lezárása a P2-04–P2-10 már felsorolt forrásgaranciái után ellenőrizhető.

## Alapítók és natív halálesetek

`society-metrics/population-outcomes.ts` két külön csatornát olvas. A
`populationBaseline` az explicit resultId/resultDigest szerinti applied genesis,
validált finite world/policy és ellenőrzött integrity-journal alkalmazási ideje
alapján a teljes eredeti alapítói névsort adja. Az összes ID-t ki kell választani;
három túlélő lekérdezése nem használhatja a négy alapító nevezőjét. Nem az
aktuális active/online lista a forrás. A native scope/profile világpolicyjának
az eredeti minimum contract függőségeivel is egyeznie kell.

A `populationDeaths` az AgentState immutable tagság/életciklus és a natív
PlayerHealthEvidenceStore ellenőrzött death/damage/binding auditjai alapján
köt. Az engine finite-avatar binding és a death membershipDigest is egyezik.
Az authoritative engine-halál az AgentState későbbi deceased-projekciója előtt
is számít; a projekció után is megmarad az eredeti founder. Más lifecycle vagy
clock/profile nem adhat halálesetet ehhez a cohorthoz.

A nyitó founder-szám az alkalmazott eredeti roster pontos mérete. Az igazolt
halálesetek a living-count és closing-survival **felső** korlátját adják, pontos
`remaining*10000/originalFounders` aránnyal. Warmup alatti és a boundaryvel
egyidejű halál számít; a későbbi halál nem dátumozható vissza. Az eredeti kezdő
időponttól induló, még befejezetlen evaluationban a már bizonyított sértés
`diagnosticViolations` útján FAIL marad; ettől nincs teljes7 napos assessment.

Üres death ledger, current-active státusz vagy friss wall heartbeat nem bizonyít
folyamatos mortality coverage-et, így nem ad survival/living PASS-t. Teljes
boundary inventory és történeti mortality/enforcement lefedettség még kell.
Az eredeti roster kapuja a verified tagság és finite-avatar kötés alapján már
PASS-képes; ez nem a túlélés igazolása. A lifecycle és clock/world-policy külön
igazolt sértésre FAIL-t adhat. Az [applied-genesis/native opening kapu](SI_C07_GENESIS_OPENING.md)
azóta szintén pozitívan kiértékelhető; a további hat pozitív kapuút még hiányos.
Hiányzó/sérült death authority
mellett a külön hiteles roster továbbra olvasható; idegen source path és privát
parserhiba redaktált, nincs fallback vagy migration.

A reader readonly, store-onként256 MiB/100000 sor limittel, snapshot-digesttel
és olvasás közben változó adatbázis elutasításával működik; nem állít cross-store
atomicitást. A benchmark backend az archivált run eredeti planjából köti az
azonosságokat és a kijelölt workspace-ből a source pathokat. Health source
hiánya külön unavailable. A teljes source-lista/pin továbbra az5. csomag feladata.

## A2. munkacsomag megmaradó munkája

1. A már bekötött applied/frozen roster és terminal-death upper bound után
   teljes native boundary inventory és történeti mortality/enforcement coverage.
2. A [needs critical/satisfied replay](SI_C07_NEEDS_EXPOSURE.md) bekötött:
   player-time cursor, native meal mutations, sleep-expiry, founder/nap és
   longest critical bounds. A konkrét baseline hiánytalan fiziológiai történetét
   és forráslefedettségét még a run előtt kell igazolni; headcount/current need
   nem időbeli bizonyíték.
3. [Napi food share/final-use és frozen reserve/stock bounds](SI_C07_FOOD_MINIMUM.md)
   bekötve. A pontos mindenhatári inventory, frozen source-lista és teljes
   custody/access coverage még kell; jelenlegi készletből nincs történeti határ.
4. [Frozen legal housing access/exposure](SI_C07_HOUSING_ACCESS.md) adapter
   bekötve: változatlan ownership/reservation/payment epoch, auditált capacity,
   paid native tenant és szabad owner-hely; lejárat, gap és founder/nap nevező.
   A teljes kiválasztott point-inventory és visitor/access history még kell;
   a tényleges alvás önmagában nem teljes jogi hozzáférési nevező.
5. [Comparable tool-service capacity](SI_C07_TOOL_CAPACITY.md) bekötve:
   auditált wear/repair/replacement/transfer és fagyasztott fizikai checkpoint;
   bizonytalan identity/access upper-only, záró auditprefix a nyitó folytatása.
   Teljes high-level demand/source coverage, maintenance origin, mortality/
   enforcement és a fennmaradó hat pozitív natív integrity kapuút továbbra kell.
6. [Prospektív executor requested-use coverage](SI_C07_EXECUTOR_DEMAND_COVERAGE.md)
   bekötve: admission előtt is látható request, natív producer/prefix witness,
   policy/original-cohort/pozitív opportunity alapján lifetime upper. A lower
   és upper egy cellában egyesül; hiteles lower FAIL nem vész el. A megfigyelt
   restricted/sleep állapot és unknown offline/identity még külön rendezendő;
   ez nem teljes source-universe integrity PASS.
   Az [igazolt online alvás](SI_C07_SLEEP_OBSERVATION.md) azóta külön megfigyelt
   státusz, valódi natív witness/payment visszaolvasással; a kérések idejét nem
   csökkenti. Offline/terminal és igazolatlan restriction továbbra unknown.

Ezek az ismert2. csomag részei; aktuális lezárásukat a
[rögzített lista](SI_C07_PACKAGE2_CLOSURE.md) méri. Nem indult
a3. baseline-csomag, C08, live világ vagy hosszú run. Nincs új providerjog/költség.
Nincs adatbázisséma-változás, migráció vagy történeti backup-read; csak readonly
reader-projekció és belső számítás. Gameplay/SDK/engine/webclient változatlan.

Ellenőrzés: pontos racionalitás, egyetlen hiányzó/rossz actor-nap, directional
bounds, opportunity/denominator, sparse boundaries, roster-ellentmondás,
idegen/duplikált cellák, gate-failure; SQLite-native outcome→evaluation és
contract/survival/preflight fogyasztók. Konkrét ID-k és idők az
[átadásban](SOCIETY_DEVELOPMENT_HANDOFF.md), részletek a progressben.
