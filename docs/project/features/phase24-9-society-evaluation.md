# Phase 24.9 – többcélú társadalmi értékelés

Dátum: 2026-10-16. Elkészült a tíz dimenzió mérési szerződése, determinisztikus
számítása és a meglévő natív forrásokhoz kötött, csak olvasó admin/CLI riport.
Ez értékelési funkció, nem élő társadalmi eredmény vagy paraméteroptimalizálás.

A felhasználó által meghatározott sorrend: funkciófejlesztés technikai tesztekkel,
majd a teljes társadalomszimuláció működési ellenőrzése és hibajavítása,
végül a 24.8 élő paraméterkísérletei. A 24.8 nem blokkolja a 24.9–24.11
funkcióit; további XP-attesztáció nem lett új előfeltétel.

## Értékelési szerződés

`society-metrics/evaluation.ts`: a szerződés mind a tíz célt, képletet, mértékegységet
és irányt rögzíti. A riport vektort őriz, `totalScore=null`; nincs súlyozott
„jó társadalom” pontszám, amelyben egy dimenzió elfedheti a másikat.

- Túlélés: a nyitó kohorsz túlélő tagjai / a nyitó kohorsz tagjai. A későbbi
  belépők nem helyettesíthetik az elhunyt alapítókat.
- Önfenntartás: igazolt belső végső felhasználás / összes igény, négy külön
  mutatóval: food, tools, housing, inputs. Nincs dimenziók közti átlagolás.
- Specializáció: szereplőnként a rögzített termelési lépésszámokból számolt HHI,
  `sum(count²)/sum(count)²`, recept szerint. Nem különböző termékek darabszámait
  adja össze. Leíró mutató: a nagyobb specializáció önmagában nem jobb társadalom.
- Mobilitás: azonos tagok két vagyoni pillanatképének abszolút rangmozgása,
  `sum(abs(rankEnd-rankStart))/(n*(n-1))`. Holtversenyben átlagrang, tört rangok
  egész kétszereseivel végzett pontos számítás. Leíró, nem esélyegyenlőségi állítás.
- Vagyoneloszlás: nemnegatív GP-vagyon Gini-együtthatója, a teljes GP-vagyonnal
  együtt. Az alacsonyabb Gini iránya nem vonatkozik a külön kiírt vagyonösszegre.
  Egyenlő nulla vagyon mellett a Gini meghatározatlan. Adósság és nem értékelt
  tárgyi vagyon nem tartozik ehhez a változathoz.
- Árstabilitás: előre rögzített termékkosár és súlyok mellett az abszolút
  relatív árváltozás súlyozott átlaga. Nincs eltérő termékárak nominális
  összekeverése vagy menet közbeni kosárcsere; nulla ár/súly elutasított.
- Munkanélküliség: munkaképes és dolgozni kívánó, de munka nélküli személyidő /
  összes munkaképes és dolgozni kívánó személyidő. Offline állapot nem helyettesíti.
- Innováció/beruházás: külön mutató az üzembe helyezett új receptek száma és
  a megvalósult termelő beruházás GP-kiadása. XP, receptismeret és általános
  termelési volumen nem helyettesíti az üzembe helyezést. Mindkettő leíró.
- Bűnözés: igazolt sértetti események / lefedett veszélyeztetett személyóra.
  A megfigyelt/felderített eseményráta nem azonos a valós incidencia mérésével.
- Rendszerkockázat: egy agent/Business kivonásakor elvesző rögzített termelési
  események legnagyobb száma / összes megfigyelt termelési esemény. Az egymást
  átfedő kieséseket nem adja össze; nem jósol helyettesítést vagy alkalmazkodást.

A törtek pontos számlálót/nevezőt őriznek decimális stringként, BigInt
aritmetikával. Aránymutatóknál a bázispont lefelé kerekített megjelenítés;
GP, darabszám és személyóránkénti ráta nem kap félrevezető bázispontot.
Hiányzó adat vagy nulla nevező: `inconclusive`, soha nem jóváírt nulla/siker.
A rossz tartomány, duplikált azonosító, túl nagy adatsor és kohorszon kívüli
szereplő elutasított. Vagyoni peremadatoknál minden kiválasztott tag kötelező.

`evaluateSocietyObservations(scope, observations)` tiszta számítási API,
mind a tíz dimenzióhoz. A bemenetet a hívó szolgáltatja; az eredmény
`evidenceAuthority=supplied-observations-not-native-attestation`. A digest
tartalomkötés, nem forráshitelesítés. Nincs HTTP végpont ilyen megfigyelések
feltöltésére vagy „hitelesként” való elfogadására.

## Natív adatforrások és jelenlegi lefedettség

`society-metrics/evaluation-report.ts` újraolvassa a meglévő auditált
önfenntartási és gazdasági függőségi forrásokat. A scope kanonikus szimulációs
időablak, clock ID/profile digest és explicit actorlista. Eseményhatár `(from,to]`,
személyidő `[from,to)`. A szerződés-, számítás-, forrás- és riportdigest megmarad.

Jelenleg két dimenzió kap közvetlen natív számértéket, ha van megfelelő adat:

- Specializáció: a kiválasztott, az esemény idején már regisztrált agentek
  receptenkénti rögzített felelőssége. A receptreferenciák és a termelési
  bizonyítékazonosítók külön kiolvashatók. Nem állít fizikai végrehajtást.
- Rendszerkockázat: a megfigyelt gazdasági ablak összes agent/Business kiesési
  forgatókönyve. Ez tágabb az actorlistánál, ezért a `metricScopes` külön
  megnevezi. A forráskorlátok és az érintett eseményhivatkozások megmaradnak.

Az önfenntartásnál a korábbi food/tool/housing/input diagnosztikák láthatók,
de nincs teljes keresleti/belső eredettörténet, ezért nincs igazolt belső hányad.
A többi hét dimenzióhoz ez a natív facade még nem gyűjt megfelelő történeti
adatot: például nincs azonos kohorszhoz kötött teljes nyitó/záró vagyontörténet,
fix árkosár és dolgozni kívánó személyidő. Ezek számítási funkciója elkészült,
a natív riportjuk értéke egyelőre `inconclusive`, konkrét hiányindokkal.
Ez a megkülönböztetés a 24.9 kész státuszának határa: nem tíz teljes natív
idősor elkészültét vagy egy működő társadalom igazolását jelenti.

Hiányzó, sérült, régi vagy pontos clock-kötés nélküli forrásból nincs kitalált
történet és nincs kedvező nulla. A források külön konzisztens snapshotok,
nem egy közös adatbázis-tranzakció. `completePopulationCoverage=false`,
`societyMinimumVerdict=inconclusive`; a jelenlegi natív riport nem adhat
teljes társadalmi minimumra vagy oksági kezeléshatásra vonatkozó ítéletet.

## Elérés

Adminhitelesítés mögött, csak GET:

```text
GET /api/admin/society/evaluation/contract
GET /api/admin/society/evaluation?from=<ISO>&to=<ISO>&actor=ada&clockId=world&clockProfileDigest=<64-hex>
```

Az `actor` ismételhető. Forrásútvonalat vagy mérési adatot HTTP-ről nem vesz át;
a szerver a meglévő `selfSufficiencySources`/`dependencyGraphOptions` kötést
használja. A hiányzó önfenntartási forrásbeállítás látható adathiány marad.

CLI, futás indítása nélkül:

```powershell
bun run society:evaluation --contract
bun run society:evaluation --from 2030-01-01T00:00:00.000Z --to 2030-01-02T00:00:00.000Z --actor ada --clock-id world --clock-profile-digest <64-hex>
```

Megbízható helyi operátor külön `--food`, `--tools`, `--housing`,
`--engine-trades`, `--production`, `--agents`, `--clock` útvonalat adhat.
A gazdasági/clock útvonalak alapértékei a meglévő natív dependency runtime-éval
azonosak. Az önfenntartási források explicit megadás nélkül hiányzónak látszanak.

## Migráció, visszavonás és ellenőrzés

Nincs új adatbázis, tartós séma vagy gazdasági írás. A riport nem migrál,
nem léptet clockot és nem indít botot/kísérletet. A SQLite olvasókapcsolat
WAL módban létrehozhat üres WAL/SHM koordinációs mellékfájlt; ezt a natív
teszt a fő adatbázisok változatlan tartalma mellett külön ellenőrzi.
Visszavonás: az új GET ágak, CLI és értékelési modul eltávolíthatók, a korábbi
adatbázisok visszaállítása nélkül. A v1 JSON-riportok önálló diagnosztikai exportok.

Technikai tesztek: mind a tíz képlet ismert eredményei, holtversenyes rangok,
nulla nevezők, nagy egész értékek, hiányzó/duplikált/kohorszon kívüli adatok;
natív kétlépéses termelés clock-kötéssel, időablak/profile eltérés, sérült és
hiányzó forrás, scope-különbségek, adminhitelesítés és feltöltés nélküli HTTP.
A futtatások eredménye: [PHASE24_PROGRESS](../PHASE24_PROGRESS.md).
