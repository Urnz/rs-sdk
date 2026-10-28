# Rövid fejlesztési átadás

Frissítve: 2026-10-28. Belépő, nem futási napló.
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
  **4/11 kész**, 7 nyitott feltétel; nem 7 ígért chatkör. 17/17 részleges
  szabályadapter és 4/8 pozitív natív kapuút. A lifecycle pozitív útja is kész,
  a további négy kapunak még nincs teljes pozitív natív útja.
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
- **Kész P2-04:** [óra/world-policy natív kapu](SI_C07_WORLD_POLICY_GATE.md).
  Explicit immutable-input contract, valódi engine/gateway startup rekord és
  processz/session kötés, meglévő policy/mutation/native clock prefixek együtt.
  World.reload packed producer is bekötött; korábban betöltött identityből
  számol, round-trip nem tűnik el. A 193 tickpontos 1+7 fixture pozitív natív
  integrity/sourceCoverage ága és C06 restore próbázott. Nem gazdasági run.
  Legacy nem kap backfillt vagy automatikus contractot; teljes host/dependency
  attestáció nincs. Saját opcionális runtime táblák a meglévő mutation journalban.
- **Kész P2-05:** [finite lifecycle/no-respawn kapu](SI_C07_FINITE_LIFECYCLE_GATE.md).
  Meglévő native mortality/attempt/paired census/health és reviewzott P2-04
  runtime join; teljes warmup/evaluation, online auditált damage route és
  végleges latch. Negatív STAT_ADD HP audit-bypass javítva. Eredeti 1+7
  pozitív gate/sourceCoverage online halállal/offline alapítókkal, stale prefix,
  missing/fault/tail, prefix-FAIL és frozen readonly reread ellenőrzött.
  Szabályos finite halál mellett survival továbbra FAIL; lower bound P2-09.
- **Következő konkrét pont P2-06:** `no-post-genesis-admin-or-fallback-value`.
  A meglévő integrity bootstrap/value mutation forrásokból a genesis utáni
  teljes ablak admin/fallback értékmozgásainak natív pozitív/failure/gap
  kiértékelése és sourceCoverage. Ne nyiss általános új naplózási ágat;
  a konkrét producer-hiányt és fogyasztóját mutasd meg. Hosszú run nem kell.
- **Megmaradó függőségi sorrend:** P2-06 → P2-07 → P2-08 →
  P2-09 → P2-10 → P2-03 végellenőrzés → P2-11. A lista számozása nem volt
  fejlesztési függőségi sorrend; nincs új pont. P2-05 lezárásával 4/11 kész, 7 nyitott.
  A P2-03 alatt ne nyiss új belső feladatsort; a hiányok a meglévő pontoké.
- A 2. csomag implementációs képessége különválik a 3–7. csomag tényleges
  baseline/source-kijelölésétől és a hosszú run adataitól. Nem kell még nem létező
  teljes run-eredményt elvárni a kiértékelő kódjának lezárásához. A végső C07
  elfogadás változatlanul a tényleges hosszú próba összes eredeti kapujának PASS-a.

## Releváns kód és meglévő bizonyítékcsatornák

- `society-minimum/assessment.ts`: exact 17/8 mag, actor/bucket/cycle/boundary
  scope, lower/upper bounds, positive opportunity, teljes mátrix és all-PASS út.
- `population-lifecycle/world-policy-runtime.ts`, `policy-process.ts`,
  `society-metrics/world-policy.ts`: explicit contract/startup record, közös
  processzazonosság, packed reload és a teljes natív world-policy kapu.
- `society-metrics/lifecycle-enforcement.ts`, `PlayerHealthDamage.ts`,
  `NativeLifecycleAttempts.ts`, `NetworkPlayer.ts`, `PlayerOps.ts`: teljes
  finite lifecycle join, tényleges auditált HP-route jelző és negatív STAT_ADD.
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

- `20261028-180244-368-si-c07-finite-lifecycle-final-readers`: **53 célzott
  eset PASS, 66,491 s**. Teljes 1+7, online lethal death/offline founders,
  frozen readonly reread; finite lifecycle/world-policy/mutation/policy ágak.
- `20261028-180245-113-si-c07-finite-lifecycle-final-consumers`: **31 PASS,
  7,164 s**. Pontosan metrics sourceCoverage/minimum/native-outcomes,
  minimum sourceCoverage és preflight tesztfájlok.
- `server/engine/.local/verification/20261028-180334-563-si-c07-finite-lifecycle-final-native`:
  **14 PASS, 10,671 s**. Tényleges World census/NetworkPlayer és PlayerOps
  opcode, HP/hitmark rollback, lethal closure/login/packed respawn.
  Engine cwd, --no-env-file; nincs production kulcs- vagy login guard-módosítás.
- `20261028-180336-110-si-c07-finite-lifecycle-final-archive`: **4 PASS,
  15,964 s**. C06 runtime/lifecycle source inventory capture/restore,
  hibás head/source és archive-ból kizárt fájl negatív határa.
- `20261028-175811-197-si-c07-finite-lifecycle-types-final`: **root + engine TS
  PASS, 78,778 s**. Utána csak source-lista/string és fixture/doc változás;
  webclient változatlan. A végső NO-GO artifact/format eredmény a progressben.
- A korábbi 38-es célzott mortality/attempt/census kör is PASS (47,866 s);
  az engine health writer/rollback 5 esete külön PASS. A végső felsorolt
  négy tesztkör 102 külön eset; ez nem teljes regresszió.
- Részletes korai FAIL-ok a progressben: 15 s fixture timeout (build 11760 ms),
  lehetetlen post-death write tesztelvárás, két nullable-tick TS-jelölés.
  Javítva; végső teljes frame build 3910 ms, total 8723 ms, eredeti 15 s limit.
- Teljes regresszió nem futott: lifecycle/HP komponens és közvetlen
  metrics/minimum/preflight/C06 fogyasztók. Shared clock setter, általános
  authorization és gazdasági transaction nem változott. Nincs live install/
  run/providerhívás vagy történeti backup-read. Teljes log/result JSON a root
  és engine `.local/verification/` könyvtárában.

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
