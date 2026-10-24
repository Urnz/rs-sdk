# SI-C07 – Hosszú önfenntartási próba előkészítése

2026-10-24, folyamatban; baseline `8b605589413687cc1bea934475b4e86c0d7e9402`,
ág `codex/si-c07-minimum-preflight`. SI-C07 nincs lezárva,27/45.

E kör a konkrét run-plan és a readonly belépési feltételek előkészítése.
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

1. **Natív minimum-assessment bridge hiányzik.** A jelenlegi integration/
   evaluation riport szándékosan részleges, minimumverdiktje inconclusive.
   A17 rule minden required scope-ját és8 integrity gate-et a meglévő forrásokból
   kell összekötni, változatlan képlettel. Egy sikeres controller-trajectory
   vagy report-restore nem oldja ezt meg.
2. **Tool-unusable-demand history hiányzik.** A committed Mining/repair receipt
   nem naplózza a teljes kért/meghiúsult tool-használati igényt. Offline vagy
   üres skill-queue nem töltheti ki ezt a nevezőt. Ez külön fogalom a C05
   available-and-willing unemployment exposure-jától; egyikből sincs automatikus
   következtetés a másikra. Először ezt a natív gapet és assessment-bekötést kell
   pótolni, aztán a source/audit/reopen határt célzottan tesztelni.
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

Az előkészítési lépés és a referencia-betöltési javítás elkészült. **SI-C07
nyitott,27/45; SI-M3/MVS nem PASS.** Következő konkrét kódmunka a natív tool-
demand history és a minimum assessment bridge. A következő task továbbra C07,
nem C08; a hosszú futási jóváhagyás még nem esedékes.
