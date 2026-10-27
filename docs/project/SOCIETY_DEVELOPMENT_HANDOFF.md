# Rövid fejlesztési átadás

Frissítve: 2026-10-27. Belépő, nem futási napló.
Checkbox-forrás: [feladatlista](TASKS_SOCIETY_INTEGRATION.md).

## Aktuális állapot és következő kódmunka

- **SI-A technikailag lezárt; SI-B01–B06 és SI-C01–C06 kész; 27/45.
  SI-C07 nyitott, preflight NO-GO; SI-M3/MVS nem PASS.**
  Ág: `codex/si-c07-minimum-preflight`. C06 baseline `8b6055894`.
  [Run-tervezet](SI_C07_RUN_PREPARATION.md), [diagnosztika](SI_C07_PREFLIGHT_RESULT.json).
- **Tervkorrekció:** a [hét csomagból](SI_C07_REMAINING_WORK.md) az 1. kész,
  a 2. folyamatban, a 3–7. későbbi fázis. A 2. csomagban 15 commit készült
  `e9d852b63` és `2785e6fee` között; az ismételt „6 maradt” elfedte a belső
  haladást és a még lezárt natív PASS-ágat. Hosszú C07 gazdasági próba nem indult.
- **Rögzített implementációs lezárás:** [P2-01–P2-11](SI_C07_PACKAGE2_CLOSURE.md),
  **2/11 kész**, 9 nyitott feltétel; nem 9 ígért chatkör. 17/17 részleges
  szabályadapter és 2/8 pozitív natív kapuút. A lifecycle és clock/world-policy
  egyelőre FAIL-képes, a többi négy kapunak sincs pozitív natív útja.
- **Kész P2-01:** `frozen-founder-roster` pozitív natív adapter. Applied
  genesis + integrity anchor + teljes immutable eredeti tagság + natív finite
  avatar binding ellenőrzése. Halott/offline tag sem tűnik el; hibás/hiányos/
  dupla/idegen kötés és hibás frame nem PASS. Nem bizonyít túlélést vagy
  respawn-mentességet; globális `qualifiesMinimum:false` megmaradt.
- **Kész P2-02:** [applied-genesis/native opening](SI_C07_GENESIS_OPENING.md).
  Application/rollback/receipt + verified bootstrap snapshot/consumed permit
  és explicit paused post-apply canonical player/population/needs/Business/
  treasury/property állapot összevetése. Egyezés PASS, hiteles eltérés FAIL,
  hiány/rossz binding unknown; prefix FAIL másik hiányos source mellett megmarad.
  Backend `population.opening` választja a forrásokat; nincs current fallback.
- **P2-03 számítás/bekötés elkészült, teljes natív pont nyitott:**
  [16 családos sourceCoverage és függőségek](SI_C07_SOURCE_COVERAGE.md).
  Kötelező source/head/cohort/warmup/evaluation/boundary időkövetelmények;
  minden 17/8 sorhoz mapping, unknown sosem nulla vagy FAIL. A valódi SQLite
  genesis-fixture 2/16 családot igazol; ez nem C07 run vagy 16/16 natív PASS.
  A pure 16/16 ág csak a kiértékelő szerződéspróbája. Eredeti scoped FAIL megmarad.
- **Következő konkrét pont P2-04:** `unchanged-clock-and-world-policy`.
  A meglévő policy/mutation/clock/build readerekből teljes natív kapuadapter,
  igazolt pozitív/failure/gap és a megfelelő sourceCoverage sor bekötésével.
  A jelenlegi `completeWorldPolicyEnforcement:false` nem írható át puszta
  available státusz alapján. Ne indíts általános új megfigyelési/host-attesztációs
  ágat: az eredeti gate konkrét writer/history hiányát nevezd meg és zárd.
- **Rögzített függőségi sorrend:** P2-04 → P2-05 → P2-06 → P2-07 → P2-08 →
  P2-09 → P2-10 → P2-03 végellenőrzés → P2-11. A lista számozása nem volt
  fejlesztési függőségi sorrend; nincs új pont. Ezért 2/11 kész, 9 nyitott maradt.
  A P2-03 alatt ne nyiss új belső feladatsort; a hiányok a meglévő pontoké.
- A 2. csomag implementációs képessége különválik a 3–7. csomag tényleges
  baseline/source-kijelölésétől és a hosszú run adataitól. Nem kell még nem létező
  teljes run-eredményt elvárni a kiértékelő kódjának lezárásához. A végső C07
  elfogadás változatlanul a tényleges hosszú próba összes eredeti kapujának PASS-a.

## Releváns kód és meglévő bizonyítékcsatornák

- `society-minimum/assessment.ts`: exact 17/8 mag, actor/bucket/cycle/boundary
  scope, lower/upper bounds, positive opportunity, teljes mátrix és all-PASS út.
- `society-minimum/source-coverage.ts`, `society-metrics/source-coverage.ts` és
  két `test/source-coverage.test.ts`: tiszta lefedettségi szerződés, natív bridge
  és a meglévő closure-ID-kre visszavezetett hiánymátrix; új journal nincs.
- `society-metrics/minimum-assessment.ts`, `population-outcomes.ts`,
  `genesis-opening.ts` és `test/genesis-opening.test.ts`: projection és readonly
  applied/original/death források; evaluation és native-outcomes közvetlen fogyasztó.
- [Minimum-assessment](SI_C07_MINIMUM_ASSESSMENT.md), [needs](SI_C07_NEEDS_EXPOSURE.md),
  [food](SI_C07_FOOD_MINIMUM.md), [housing](SI_C07_HOUSING_ACCESS.md),
  [capacity](SI_C07_TOOL_CAPACITY.md), [requested-use](SI_C07_EXECUTOR_DEMAND_COVERAGE.md),
  [sleep](SI_C07_SLEEP_OBSERVATION.md), [maintenance](SI_C07_TOOL_MAINTENANCE.md),
  [material-origin](SI_C07_MATERIAL_ORIGIN.md).
- [Mortality/source inventory](SI_C07_MORTALITY_COVERAGE.md),
  [lifecycle attempts](SI_C07_LIFECYCLE_ATTEMPTS.md),
  [watermarks/census](SI_C07_LIFECYCLE_WATERMARKS.md),
  [policy/build](SI_C07_LIFECYCLE_POLICY.md),
  [C06 environment/mutations](SI_C07_POLICY_MUTATIONS.md).
  Ezek meglévő csatornák; jelenlétük önmagában nem a teljes integrity PASS.

## Ellenőrzési bizonyíték

- `20261027-231009-129-si-c07-source-coverage-consumers`: **42 célzott eset és
  root TS PASS, 37,243 s** (runtime 15,92 s). Source-coverage core/bridge,
  minimum-assessment, valódi SQLite genesis opening, native-outcomes és preflight.
  Head/cohort/foreign/warmup/1 ms gap/boundary/available-only és meglévő FAIL-védelem.
- `20261027-230602-978-si-c07-source-coverage-first`: 24 PASS, 11,863 s;
  `20261027-230925-582-si-c07-source-coverage-reader-contract`: 10 PASS, 0,695 s.
  A későbbi guard/dependency mezők miatt indult a végső fogyasztói kör.
- `20261027-225544-848-si-c07-genesis-opening-consumers`: **32 célzott eset és
  root TS PASS, 75,568 s** (runtime 24,73 s). Pontosan genesis-opening,
  minimum-assessment, native-outcomes és minimum-preflight fájlok; helyi valódi
  admin/bootstrap adapter és SQLite/native save-reader, nincs live világ.
  Korábbi fixture-running-clock és implicit-any TS FAIL-ek javítva, részletek a progressben.
- `20261027-224027-847-si-c07-frozen-roster-gate`: **8 célzott eset PASS,
  4,158 s**. Roster pozitív/hiányos/dupla/idegen/malformed és hibás frame/scope;
  dead/offline original tag, más kapu/túlélés/globális PASS kizárása.
- `20261027-224227-372-si-c07-roster-consumers`: **85 eset és root TypeScript
  PASS, 111,563 s** (runtime 67,83 s). Pontosan population-outcomes,
  minimum-assessment és native-outcomes tesztfájlok; meglévő sérült binding/
  lifecycle és diagnostic FAIL-védelmekkel, evaluation facade bekötéssel.
- Preflight/artifact/link/format eredmény a jelen commit progress-bejegyzésében.
  Naplók és gépi eredményfejek `.local/verification/` alatt.
- Teljes regresszió, engine/webclient TS nem futott: readonly root genesis
  adapter/projection és preflight diagnosztika változott. Nincs közös persistence/clock/auth/
  transaction alapváltozás, séma, producer vagy függőségmódosítás.
  Nincs live install/run/baseline/providerhívás vagy történeti backup-read.

## Megmaradó futási korlátok és döntések

- Eredeti minimum 17 rule/8 gate/küszöb változatlan; eredeti policy SHA pinned.
  Nincs küszöblazítás. Hiány unknown; hiteles scoped FAIL megmarad.
- Candidate verified 1.3.0 native-travel, 1+7 sim nap 288:1 mellett névleg
  40 wall perc, execution-terv 50 perc; **ratio még nem M3-validált**.
  Capture-terv 20+20 perc, restore 25 perc külön IO; nincs időígéret.
- Food/travel-only baseline 36 no-burn portion, 32 nominális adag +4 closing
  reserve, 0 headroom. Teljes founder Mining→smelt→repair→reuse baseline és
  minden alapító legal-housing lefedettsége még nincs. Repair 50, virgin tool
  100 kapacitás: a retentiont valós lánccal kell teljesíteni, nem küszöbtuninggal.
- `requiredSourceInventory.selectedSources=null`; nincs konkrét C07 world/pin.
  A meglévő prospektív selectionök nem települtek live. Saját sémák/strict
  dispatch miatt offline init/pin szükséges; nincs történeti backfill vagy
  evidence-törlés. Rollback előtt stop, régi binárissal nincs strict run-folytatás.
- Csak helyi/private LostCity. Nincs live world-indítás/import/enrollment,
  publication, hosszú run vagy providerhívás. Ismert NO-GO-ra ne kérj futási
  jóváhagyást. SI-C08 nem indul. Admin korábbi címe `http://127.0.0.1:7781/admin/`.
- B06 engedély kizárólag a korábbi 0,05 USD próbára: 11 kérés/4235 microUSD.
  Most 0 kérés/0 microUSD engedély; auto-replanning/autonomous execution off.
- SI-A15 technikai PASS; eredeti D1/SI-M1 önfenntartás nem PASS.
  Történeti payload DB-ket ne nyisd meg/ne módosítsd:
  `backups/si-a15-technical-20261022-1648/workspace`,
  `backups/si-a15-technical-result-20261022-1715/workspace`,
  `backups/si-a15-technical-restored-20261022-1726/workspace`.
- Éhség 1 nap, éhhalál 7 nap teljes hiány után; normál adag 1 nap.
  SI-C09 kalibráció nyitott; nem igazítjuk a világot a túléléshez.

`pwsh -NoProfile -File scripts/get-society-work-brief.ps1 -TaskId SI-C07`
