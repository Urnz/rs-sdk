# SI-C07/2 – Forráslefedettség és a meglévő lezárási pontok függősége

2026-10-28. A P2-03 kiértékelője és natív diagnosztikai bekötése elkészült;
**P2-03 teljes natív lezárása még nyitott.** A rögzített lista 4/11 kész,
7 nyitott pont, 4/8 pozitív natív kapuút. P2-04 és P2-05 kész, új pont nincs.
[Rögzített lezárási lista](SI_C07_PACKAGE2_CLOSURE.md).

## Elkészült kód

`society-minimum/source-coverage.ts` a meglévő 16 családos definícióból képezi
az elvárt forrásokat; nem a caller választhatja a szükséges sorokat. A belső,
reader-owned bizonyítékot contract/world/clock/profile/original founder/genesis/
window binding köti. Nem HTTP- vagy observation-upload séma, és a digest nem
aláírás. Egy tetszőleges caller által összeállított proof nem natív attestáció.

A számítás mind a 16 család teljes lefedettségét megköveteli. A nem opening
forrásokhoz az alkalmazott genesis időpontjától az evaluation végéig kell
hiánytalan történet, tehát a warmup sem hagyható el. Szomszédos/átfedő igazolt
intervallumok összeköthetők, rés nem interpolálható. A fizikai boundary-sorhoz
pontos nyitó/záró, minden előírt evaluation-határ és legfeljebb az eredeti
trace-gap távolságú pontok kellenek. Szükséges a head/evidence és a teljes
alapítói scope; rossz, hiányzó, duplikált vagy idegen bizonyíték unknown.

Az eredmény mind a 17 szabályhoz és 8 integritási kapuhoz megnevezi a szükséges
családokat és azok coverage-állapotát. Ez **forráslefedettség**, nem a szabály
numerikus PASS-a: egy teljesen dokumentált éhezés továbbra minimum FAIL lehet.
Az üres queue vagy egy elérhető ledger nem nulla nevező és nem coverage PASS.

`society-metrics/source-coverage.ts` a már validált natív és integration olvasók
adataiból állítja elő az inputot; a riport query nem adhat hozzá proofot/pathot.
`evaluation.minimumAssessment.sourceCoverage` soronként mutatja a kötelező
időhatárokat, a certifikált intervallumot/nyitópontot, head/evidence digestet,
hiánykódokat és az eredeti lezárási pontokhoz tartozó függőségeket.
A complete-source-coverage kapu csak az összesített PASS-ból kaphat PASS-t.
A meglévő hiteles gazdasági/integritási FAIL-t a coverage-hiány nem törli.

## Miért nincs még készre jelölve P2-03?

Az aktuális natív readerek több helyen eleve hiányosnak deklarálják a történetet.
Ezeket az összesítő nem írja felül. Most az applied opening, az immutable original
roster és megfelelő adatok mellett a native mortality-pass ablak kaphat teljes
család-lefedettséget. Azóta a [P2-04 runtime/clock/world-policy kapu](SI_C07_WORLD_POLICY_GATE.md)
is teljes pozitív család-adaptert kapott. A [P2-05 lifecycle join](SI_C07_FINITE_LIFECYCLE_GATE.md)
a native-health-deaths és login-respawn-enforcement családoknak adhat teljes
coverage-et. A valódi SQLite genesis-fixture 2/16 családot igazol;
a reader-contract fixture mortalityval 3/16-ot. Egyik sem valódi C07 run-eredmény.
A teljes 16/16 pozitív ág a tiszta kiértékelő szerződéspróbája, nem natív teljes PASS.

A hiányzó garanciák **már szerepelnek** a listában:

- P2-04: teljes clock/world-policy writer history – 2026-10-28 kész, explicit contracttal.
- P2-05: native health/lifecycle history – kész; P2-09 pozitív population-korlátjai nyitottak.
- P2-06 és P2-07: admin/fallback, illetve external shop/import producer coverage.
- P2-08: teljes tool/material/food ancestry forrásgaranciák.
- P2-10: warmup/needs/access/request/boundary/custody integráció.

A lista számozása nem volt függőségi sorrend. Az új végrehajtási sorrend:
**P2-04 → P2-05 → P2-06 → P2-07 → P2-08 → P2-09 → P2-10 → P2-03 végellenőrzés
→ P2-11.** Azonosítók és eredeti feltételek változatlanok; nincs hozzáírt új
observer- vagy attestációs feladatsor. P2-04 és P2-05 kész; következő kódmunka P2-06.

## Ellenőrzési határ

A tiszta kiértékelőben az összes család együtt pozitív, majd mind a 16 külön
elhagyása, warmup/1 ms gap/boundary density/head/cohort/foreign/malformed input
ellenőrzött. A natív bridge nem fogadja el a puszta available státuszt vagy a
riportba kézzel betett PASS-ot. A meglévő valódi SQLite/genesis és outcome/
evaluation fogyasztói próbák ellenőrzik a readonly bekötést és a FAIL megmaradását.
Konkrét eredmények/idők az [átadásban](SOCIETY_DEVELOPMENT_HANDOFF.md) és a
[progressben](SOCIETY_INTEGRATION_PROGRESS.md). Nincs séma, migráció, producer,
live telepítés/run, providerköltség vagy történeti backup payload-read.
