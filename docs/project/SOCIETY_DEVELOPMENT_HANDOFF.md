# Rövid fejlesztési átadás

Frissítve: 2026-10-29. Belépő, nem futási napló.
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
  **7/11 kész**, 4 nyitott feltétel; nem 4 ígért chatkör. 17/17 részleges
  szabályadapter és 7/8 pozitív natív kapuút. A lineage/final-use útja is kész;
  az összesített source-coverage kapu teljes pozitív natív útja még nyitott.
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
- **Kész P2-06:** [admin/fallback kapu](SI_C07_ADMINISTRATIVE_VALUE_GATE.md).
  Meglévő integrity audit/head és mutable resolution/permit state digest a
  natív policy tickpontokban; reviewed producer build + eredeti teljes ablak.
  Kimaradt privileged variable/spawn utak a meglévő debugproc határon.
  Belső paymenthez valódi treasury reservation és canonical reward szükséges.
  1+7 pozitív gate/sourceCoverage, nyolc producer FAIL, gap/legacy/tail/no-effect,
  frozen readonly reread és C06 integrity-source inclusion/restore ellenőrzött.
  Nincs új journal/tábla vagy írási szemantikaváltás; coverageSnapshot readonly.
- **Kész P2-07:** [external shop/import kapu](SI_C07_EXTERNAL_VALUE_GATE.md).
  Meglévő policy frame opcionális trade/aktív tényleges GE/treasury head/state
  cursor, valós closed-shop mód és reviewed P2-04/P2-06 producer join. Két
  eredeti founder közötti trade/GE belső; treasuryhez exact completed commerce
  backing kell. Friss nyitócsatorna szükséges; régi történet unknown, nem backfill.
  1+7 PASS, import/fallback FAIL, hiány/legacy/head/tail/source-identity,
  disabled GE, frozen readonly és C06 inclusion/restore ellenőrzött. Új journal nincs.
- **Kész P2-08:** [internal lineage/final-use kapu](SI_C07_INTERNAL_LINEAGE_GATE.md).
  Meglévő food/tool/material/escrow stream prefix és állapot a policy tickpontokban;
  eredeti teljes ablak, immutable producer+config és P2-07 join. Tényleges distinct
  consumer étellánc; a számszerű napi/ciklus minimum külön marad. Üres tool-stream
  coverage nem cikluscredit, bootstrap nem internal. Unknown hold/replacement gap.
  1+7/frozen, valódi packed A→B→C és Mining→smelt→repair→reuse evidence, C06 restore.
  Új journal/tábla nincs. SourceCoverage három ancestry-családja PASS-képes.
- **Következő konkrét pont P2-09:** pozitív living/survival alsó korlátok.
  A meglévő eredeti roster, sealed mortality/lifecycle/health és kötelező
  boundary időpontok teljes történetéből képezz boundot; üres death ledger vagy
  új aktuális névsor nem bizonyít túlélést. Konkrét hiány/fogyasztó alapján dolgozz.
- **Megmaradó függőségi sorrend:** P2-09 → P2-10 →
  P2-03 végellenőrzés → P2-11. Rögzített lista: 7/11 kész, 4 nyitott;
  nincs új pont és nincs szükség még nem létező hosszú run-adatra a kódlezáráshoz.
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
- `society-integrity/coverage.ts`, `SocietyIntegrityStore.coverageSnapshot`,
  `society-metrics/administrative-value.ts`: eredeti admin/fallback audit,
  native state seal és exact internal payment backing.
- `external-trade/value-coverage.ts`, `society-metrics/external-value.ts`:
  readonly trade/GE/treasury source snapshot, policy cursor és teljes natív
  external value join; `isInternalTreasuryCommerce` valódi natív receiptet fogyaszt.
- `production-workflow/lineage-coverage.ts`, `society-metrics/lineage-evidence.ts`,
  `society-metrics/internal-lineage.ts`: meglévő producer-táblák read-only sealje,
  domain-validátorok és teljes lineage gate. A native-outcomes a már ellenőrzött
  external függőséget adja át; checkpoint snapshot digest külön marad.
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

- **115 külön aktív célzott eset PASS** a P2-08 kiválasztott scope-jában.
  A végső fixture-phase guard és stale-parent ág is PASS. Nem full regresszió.
- Engine `20261028-232415-592-si-c07-internal-lineage-native`:44 PASS17,283 s,
  három pontos producer/observer fájl. Végleges evidence-guardok négy ága:
  `20261028-234347-962-si-c07-internal-lineage-native-final`,4 PASS4,285 s;
  tényleges packed A→B→C,100-use/smelt/repair/reuse, unknown hold és World cursor.
- `20261028-233842-663-si-c07-internal-lineage-final-readers`:31 PASS/1 admin
  timeout88,071 s. Minden új internal/external ág PASS; az admin frozen teszt
  redundáns újraolvasása megszűnt, külön PASS alább. Együtt33 reader eset, a stale-parent próbával.
  Internal193tick setup2511/export5788/total6150 ms; external3960/6857/8927 ms.
- `20261028-234209-061-si-c07-internal-lineage-close-boundaries`:3 PASS23,397 s:
  admin1+7/frozen6,087 s, új C06 lineage inventory/restore9,67 s összesen
  (capture3807/restore4726 ms), benchmark offline restore6,558 s. Nem3 új eset.
- `20261028-234057-650-si-c07-internal-lineage-final-archive`:a két régi C06
  manifest/external eset PASS; wrapper FAIL38,616 s az új lineage még összetett
  13,849 s/10 s timeoutja miatt. Új eset külön fázisokra bontva PASS a fenti körben.
  Együtt4 C06/benchmark eset, eredeti assertionök és source pin megmaradtak.
- `20261028-234356-292-si-c07-internal-lineage-consumers-types`:34 teszt PASS,
  öt pontos metrics/minimum/sourceCoverage/preflight fájl. Wrapper TS FAIL a
  pinned bun-types1.2.15 hook-aláírása miatt; nincs hibás runtime teszt.
- `20261028-234904-241-si-c07-internal-lineage-types-closed`:végső root+engine
  TypeScript PASS124,591 s. Nincs dependency/tsconfig/type suppression vagy
  globális test discovery/timeout változás. Webclient változatlan.
- `20261029-000059-674-si-c07-internal-lineage-parent-final`:3 PASS és a végső
  parent-binding változás root TS PASS104,837 s. Internal1+7 teljes9207 ms,
  setup2072 ms; stale-parent is unknown, korábbi checkpoint eredménye nem PASS.
  C06 external setup4755/restore7921 ms. Engine code utána nem változott.
  `20261028-235457-996-si-c07-internal-lineage-hook-runtime-final`:external1+7
  és két C06 eset PASS; utolsó setup11690 ms miatt wrapper FAIL. Csak az utolsó
  eset új, mért15 s setup-budgetje kellett a fenti végső PASS-hoz.
- Fixture-optimalizálás: readonly SQLite data_version alapú cache csak a
  tesztben; statikus repo policy-inputok fixture-nként egyszer olvasva.
  Az éles reader és végső/frozen validáció továbbra teljes tényleges forrást olvas.
- Mérési korrekció: internal1+7 setup5 s+assessment10 s=eredeti15 s; kis új
  esetek setup5 s+test5 s. External1+7 két15 s fázis, összesen30 s (előtte15);
  három érintett C06 eset setup15 s+restore10 s, összesen25 s (előtte10). Mért leglassabb
  external setup11,451+assessment10,8 s, C06 setup11,690+restore7,921 s.
  Ezek helyi aggregált tesztkeretek, run/bootstrap-limit és minimum nem változott.
  Az explicit szinkron fixturePhase a hook-API verziójától függetlenül is FAIL-t
  ad a setup-budget túllépésére; assertionök nem kerültek kikapcsolásra.
  A Bun runtime timeout argumentumát helyi typed bridge továbbítja, mert a
  pinned típusdefiníció nem tartalmazza. A bridge nélkül a runtime hook5 s-ra
  esett vissza (`20261028-235229-732`); végül a runtime és a wall guard is bounded.
- Korai típushibák: nullable bootstrap proof, duplikált tesztimportok és hook
  második argumentum eltérő típusdefiníciója. Korai IO timeoutok/fázisnaplók a
  progressben; régi FAIL eredmények megmaradtak. Csak a bukott/érintett esetek
  ismétlődtek; a sikeres teljes44-es natív és34-es consumer kör nem futott újra.
- Full nem futott: read-only join és opcionális meglévő cursor, pontos közvetlen
  fogyasztókkal. Shared gazdasági/clock/auth/dependency alap nem változott.
  Nincs live install/start/provider vagy baseline; historical backup DB nem nyílt.
- `20261029-000730-667-si-c07-internal-lineage-preflight-final`:PASS0,877 s;
  várt NO-GO exit2, canonical source/digest és27 dokumentum linkjei. Eredeti
  minimum SHA596720f42dd059b713ce0d075b08b9655d25413fdf7b31a8db1a86f3afa6754a.
- `20261029-001028-809-si-c07-internal-lineage-format-final`:27 dokumentum
  linkjei/source hashek és changed/staged-line format PASS2,103 s; új fájlok stage-elve.

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
