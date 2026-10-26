# SI-C07 – Hosszú önfenntartási próba előkészítése

2026-10-24, folyamatban; baseline `8b605589413687cc1bea934475b4e86c0d7e9402`,
ág `codex/si-c07-minimum-preflight`. SI-C07 nincs lezárva,27/45.

Az első,2026-10-24-i kör a run-plan és readonly belépési feltételek előkészítése.
A2026-10-25-i natív komponensbővítések és ellenőrzések alább szerepelnek.
Nincs hosszú futási vagy provider-költési jóváhagyás; B06 engedély nem általános.
Történeti SI-A15 payloadokat nem nyitjuk meg, élő világot nem indítunk.

Első valódi szoftveres rés: day-survival stagingben a needs/dynamics policy ID
eltér az eredeti minimum referencia-ID-jétől. A minimum betöltése ezért hibát
adott volna. A javítás kizárólag igazolt immutable survival selection esetén
köt effektív referencia-ID-t;17 requirement, ablak, küszöb és integrity gate
változatlan. Az eredeti minimum-policy fájl nem íródik át; declared/effective
policy és requirements digest külön rögzített. Legacy világon nincs változás.

Preflight: az eredeti1 nap warmup +7 nap evaluation, teljes founder/lifecycle,
needs/food/housing/tool/labor/integrity követelmények és forráshatárok.
Hiányzó natív nevező nem nulla és nem PASS. A korábbi véges food-only fixture
nem válik automatikusan teljes C07 baseline-ná. A pinning és a forrás-digest
önmagában nem igazol mérési lefedettséget vagy engine-enforcementet.

Ellenőrzés: célzott minimum-contract/survival binding és közvetlen metrics
fogyasztók; saját preparer-plan próbák, root TS, staged format. Full csak
konkrét shared invariant változására, nem C07 task/phase miatt. A valódi SI-A14
regresszió a teljes natív preflight/run belépésének része, nem hamis zöld
előfeltételként futtatott költség egy már ismert NO-GO tervhez.

## Elkészült előkészítés: NO-GO

[Géppel olvasható állapot és forráshash-ek](SI_C07_PREFLIGHT_RESULT.json),
generátor: `scripts/prepare-society-minimum-run.ts`. A `status:no-go` riport
**exit2**-vel tér vissza, nem indít futást vagy providert. Ez sikeres diagnosztika,
nem zöld M3 preflight. Nincs kiválasztott élő világ, új genesis vagy frozen
baseline. A `contractDigest` a repository definíciójáé; nem helyettesít egy
day-survival világ új effektív contract/pin digestjét. A17 szabály requirements
digestje a referencia-bekötés előtt/után azonos.

Az előkészítő az eredeti minimum-policy LF-normalizált forráshash-ét is rögzíti.
Más ablak, küszöb vagy referencia nem kap automatikusan `unchanged-minimum`
PASS-t. A negatív tesztben a9500→9400 módosítás blocked marad. A definícióból
nem származik tényleges mért szükséglet, reserve vagy stratégiai siker.

Kiinduló összevetés: az SI-A15 által is használt, már verified1.0.0 procedure-
verziókkal rendelkező1.3.0 native-travel fixture. Ezt nem alkalmaztuk egy világra.

- Az1+7 játéknap288:1 profilon40 perc névleges wall idő; execution-tervezet
 50 perc felső kerettel. Mintavételi javaslat5 s; az eredeti legfeljebb1 óra
 simulation trace-gap ennél a rátánál12,5 s wall. Az egyéb natív trace-források
  lefedettségét az observer mintavétele önmagában nem igazolja.
- A baseline capture-tervezet20 perc, result capture20 perc, új könyvtáras
  result restore25 perc; ezek külön IO-korlátok, nem40 perces összfutási ígéret.
  A tényleges runner-korlátot és stop/cleanup utat az engedélyezhető tervhez
  még hozzá kell kötni.1:1-nél8 valós nap, a day-survival live24:1-nél8 óra a
  névleges idő; a gyorsított arány jelenleg nem validált M3-ra.
- A32 véges harvest +4 opening portion összesen legfeljebb36 adag, főzési
  veszteség nélkül. A32 nominális napi adag +4 záróreserve mellett0 a tartalék.
  Ez terhelési forgatókönyv, nem bizonyított minimumfogyasztás, mért demand vagy
  önmagában matematikai FAIL; burn, lineage, napi tartalék és retention natív
  bizonyítéka szükséges. Nem növeltünk erőforrást vagy csökkentettünk küszöböt.
- Provider authorization0 kérés/0 microUSD, selectedWorld/baseline null.
  Nem kérünk most jóváhagyást egy ismerten alkalmatlan hosszú runra. Új modell-
  és költségkeret a kész, belépési feltételeket teljesítő tervhez szükséges.

## Konkrét belépési akadályok és következő munka

1. **Teljes natív minimum-assessment bridge hiányzik.** A riport részleges;
   a bizonyított natív tool-demand sértést már FAIL-ként továbbadja, teljes
   minimum PASS-t nem állapíthat meg.
   A17 rule minden required scope-ját és8 integrity gate-et a meglévő forrásokból
   kell összekötni, változatlan képlettel. Egy sikeres controller-trajectory
   vagy report-restore nem oldja ezt meg.
2. **Tool-unusable-demand időbeli lefedettsége hiányos.** 2026-10-25 óta a
   [natív Mining request-napló](SI_C07_NATIVE_TOOL_DEMAND.md) a befogadott,
   elutasított és committed próbákat tartósan köti a natív forráshoz. Most a
   [külön tartós kérés](SI_C07_STANDING_TOOL_DEMAND.md) expiry/cancel/fulfillment
   és konzervatív időintervallumai is elkészültek. A production gather-loc
   admission már [hitelesítetten bekötött](SI_C07_GATHER_ADMISSION.md), a teljes
   cohort coverage még hiányzik. Offline vagy üres
   skill-queue, illetve két elutasított kattintás közötti idő nem töltheti ki
   ezt a nevezőt. A C05 available-and-willing unemployment exposure külön mérés.
3. **A baseline food/travel-only.** Nincs a négy founderhez kötött teljes
   Mining→smelt→repair→reuse workflow, initial tool-service capacity, input,
   kompetencia és approved skill/grant csomag. A korábbi C03 mechanikai próba
   külön fixture, nem a C07 közös gazdaságának története.
4. **Housing exposure és ratio még unverified.** Két tenant slot és néhány
   sleep/rent receipt nem igazol minden founderre95% legal access-időt. Teljes
   tulajdon/hozzáférési történet kell. A288:1 környezeti clock nem bizonyítja,
   hogy a content tickek, work credit, utazás, harvest és meals egymáshoz mért
   aránya megfelelő; külön natív ratio-próba szükséges.
5. **Ezután** következik a teljes source-lista és C06 pin/baseline, SI-A14
   natív regresszió és a konkrét run/model/budget/maxwall/stop terv bemutatása.
   Hosszú futás csak a külön jóváhagyás után. Bizonyított minimumsértés FAIL,
   hiányzó mérési forrás inconclusive; egyik sem küszöbcsökkentésre felhívás.

## Ellenőrzés és továbbadás

- `20261024-234953-838-si-c07-preparation-contract-gate`:66 célzott teszt,
  root és preparer CLI TypeScript PASS,103,911 s. A runtime tesztek27,52 s,
  a wrapper az érintett két typecheck-et is tartalmazza; ez nem full regresszió.
- `20261024-235512-434-si-c07-policy-drift-and-candidate`:3 saját preparer
  teszt +CLI/transitive TS +friss NO-GO artifact PASS,4,556 s. A korábbi minimum/
  survival/metrics fogyasztók nem változtak; nem futtattuk újra őket. A körök
  átfednek, tesztszámuk/időtartamuk nem összeadandó.
- `20261024-234809-582-si-c07-thin-preparation`: korai3 mechanikai teszt PASS,
 1,209 s. Nincs hosszú run, SI-A14 run, providerhívás vagy történeti DB-read.

2026-10-25: a natív Mining request megfigyelési lánc és outcome-report bekötés
elkészült; [határ, séma/rollback és maradó rések](SI_C07_NATIVE_TOOL_DEMAND.md).
`20261025-100007-735-si-c07-demand-thin`:13 ellenőrzés PASS10,985 s;
`20261025-100143-108-si-c07-demand-consumers`:68 ellenőrzés és root/engine TS
PASS153,683 s, ebből runtime18,85 s. A számok tartalmaznak nested wrapper
teszteket, a körök átfednek. Full/provider/hosszú run nem futott.
`20261025-100734-190-si-c07-demand-opening-boundary`:20 ellenőrzés +engine TS
PASS40,022 s. Az explicit eszköznyitáskor üres demand-séma az első Mining alatt
nem változik, így nem az első használat bővíti a leendő baseline sémáját.
`20261025-100843-755-si-c07-demand-benchmark-restore`:1 célzott benchmark/
result-report/restore próba és friss NO-GO/sourcehash/link ellenőrzés PASS16,617 s.

2026-10-25 további részlépés: [tartós natív igény és időmérés](SI_C07_STANDING_TOOL_DEMAND.md),
explicit lifetime/cancel/expiry, valódi érc-receipthez kötött teljesítés és
source-gap védelem. Scoped, igazolt >1 óra hiány FAIL-ként továbbjut az evaluation
facade-ba, rövid/hiányos bizonyíték nem lesz PASS. A production admitted gather
run/step/parameters/checksum bekötés [később elkészült](SI_C07_GATHER_ADMISSION.md),
szűk source/SDK/gateway/HTTP/tick és natív receipt-kötéssel. Teljes cohort
watermark és17/8 minimum source-bridge még nincs; a preflight továbbra NO-GO.
Ellenőrzés:129 célzott runtime ellenőrzés PASS59,82 s, a kör root TS2322 miatt
FAIL76,892 s; explicit commit utáni return javítás után7 saját teszt +root/engine
TS PASS104,775 s. `si-c07-intent-preflight-and-benchmark`:3 preparer és1 konkrét
benchmark/restore próba +friss NO-GO artifact/sourcehash/link PASS9,702 s.
Részletes azonosítók és korlátok a tartós igény dokumentumában/átadásban.

2026-10-25: [prospektív cohort/window/head és native ingress napló](SI_C07_COHORT_COVERAGE.md)
elkészült komponensszinten. A kiválasztott teljes roster megfigyelése üres
queue mellett is működik; legacy/unbound/missing-identity/tick/session/source
gapek megmaradnak, a C06 selected source restore és outcome-read ellenőrzi őket.
Az aktív igénynek megfelelő kattintás csak `compatible-request`, mert az
executor→transport/native packet pontos eredet még nincs végigkötve. A teljes
demand-coverage és17/8 bridge továbbra hiányzik; preflight NO-GO.

Az [exact natív dispatch](SI_C07_NATIVE_DISPATCH.md) további lépése elkészült:
SDK source context +retarget ordinal, egyszer használható immutable admission,
valódi packed Mining és exact outputproof. Kijelölt cohort raw bányászatának
elutasítása, in-flight abort/late SDK send és replay/cancel védelme próbázott.
A `compatible-request` most már külön provenance-gap, `source-bound-request`
a tényleges native dispatch-hez köthető. A teljes high-level demand nevező
hiányos, ezért coverage továbbra nem teljes vagy minimum PASS.

**SI-C07 nyitott,27/45; SI-M3/MVS nem PASS.** A
[rögzített7 csomagból az1. kész,6 maradt](SI_C07_REMAINING_WORK.md).
Következő a17/8 minimum-assessment bridge és a teljes high-level demand/
housing/exposure forráskötés; ismert NO-GO mellett nincs hosszú run-jóváhagyás.

2026-10-26: [17/8 kiértékelőmag és natív source-map](SI_C07_MINIMUM_ASSESSMENT.md)
elkészült. A meglévő SQLite-native reader→evaluation út17/8 mátrixot ad,
megőrzi az igazolt scoped tool FAIL-t;4 work/tool alsókorlát-adapter működik.
Nincs teljes népességi/needs/food/housing/capacity/request/integrity attestáció,
ezért a2. csomag és a preflight továbbra nyitott/NO-GO;6 csomag maradt.
A következő task C07, nem C08; a hosszú futási
jóváhagyás még nem esedékes.

2026-10-26 további rész: applied/frozen eredeti roster és natív halálesetek
két külön readonly csatornán bekötve. A halál a későbbi domain-projekció előtt
is FAIL-t bizonyíthat, a meghalt/offline founder nem esik ki a nevezőből.
Üres ledger/heartbeat nem survival PASS; teljes mortality/boundary, physiological
exposure és a többi ismert adapter továbbra hiányzik. A2. csomag nyitott,
6 maradt,27/45, NO-GO. Nincs új run/baseline/providerköltség.

További2. csomagbeli rész: [natív needs-exposure](SI_C07_NEEDS_EXPOSURE.md),
genesis/lifecycle-kötött4 időfeltétel, naponta külön satisfied lower/upper bound
és napváltáson át mért longest critical. A módváltás-kurzor és natív étkezési
application/watermark újrajátszva; hiányos idő unknown.11/17 szabályhoz van
adapter, ez nem11 feltétel mért PASS-a. A8 integrity és a többi source-adapter
miatt továbbra NO-GO;6 csomag maradt.
