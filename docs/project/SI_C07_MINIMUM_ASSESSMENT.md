# SI-C07/2 – Minimum-kiértékelő és natív forrástérkép

2026-10-26. **A2. munkacsomag folyamatban; továbbra6 csomag maradt.**
Ez a [rögzített bontás](SI_C07_REMAINING_WORK.md)2. pontjának részeredménye,
nem új munkacsomag és nem lezárt SI-C07.27/45, preflight NO-GO.

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
4 szabályhoz ad korlátos bizonyítékot, backend által kijelölt eredeti run frame
esetén. A frame nem választható HTTP query/body vagy LLM-output alapján.

- Natív completed repair/effect: tool-maintenance alsó darabszám a támogatott
  bronze cycle-re, tényleges helyreállított kapacitással.
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
genesis/baseline attestációt. A natív builder egyik integrity gate-hez sem
szintetizál PASS-t konfigurációból vagy egy adatbázis létezéséből.
Az outcome riport clock/profile/actor/window scope-jának is egyeznie kell;
idegen vagy hiányzó scope-ból még diagnostic FAIL sem vehető át.

A meglévő, bizonyított scoped tool-hiány FAIL-je továbbra látszik hiányzó vagy
hibás run binding mellett is, külön diagnosticViolations eredettel. Ez nem
egy még el sem indított hosszú SI-C07 run hitelesített végeredménye.
Hiányzó új csatorna nem rejti el a korábbi igazolt sértést. A facade jelenlegi
natív kimenete nem tud teljes minimum PASS-t vagy qualifiesMinimum:true-t adni.

## A2. munkacsomag megmaradó munkája

1. Applied genesis, frozen lifecycle roster és teljes boundary/death forrás
   kötése a nyitó, mindenhatári és záró population-mérésekhez.
2. Needs critical/satisfied intervallumok, nutrition mutations és player-time
   pontos összekötése minden founder/bucket/whole-window scope-ban. Pillanatnyi
   szükségletszint nem időbeli elégedettség.
3. Napi belső food relief/final-use lineage, mindenhatári reserve és comparable
   opening/closing stock; nem a whole-window arány szétosztása napokra.
4. Legal housing ownership/access történet és minimum-tier exposure; a tenancy
   reservation, rent receipt vagy tényleges alvás önmagában nem teljes jogi
   hozzáférési nevező.
5. Teljes high-level request/demand coverage, comparable tool-service capacity,
   napi distinct-producer→consumer final-use és mind a8 natív integrity gate.

Ezek az ismert2. csomag részei. Nem csökkent a hátralévő csomagszám, nem indult
a3. baseline-csomag, C08, live világ vagy hosszú run. Nincs új providerjog/költség.
Nincs adatbázisséma-változás, migráció vagy történeti backup-read; csak readonly
reader-projekció és belső számítás. Runtime/SDK/engine/webclient változatlan.

Ellenőrzés: pontos racionalitás, egyetlen hiányzó/rossz actor-nap, directional
bounds, opportunity/denominator, sparse boundaries, roster-ellentmondás,
idegen/duplikált cellák, gate-failure; SQLite-native outcome→evaluation és
contract/survival/preflight fogyasztók. Konkrét ID-k és idők az
[átadásban](SOCIETY_DEVELOPMENT_HANDOFF.md), részletek a progressben.
