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
  **10/11 kész**, 1 nyitott feltétel. 17/17 részleges szabályadapter és
  **8/8 pozitív natív kapuút**. Az eredeti közös1+7 ablak mind16 source
  családja és a coverage gate is natívan PASS; a teljes minimum még nem PASS.
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
- **Kész P2-03, közös natív audit is PASS:**
  [16 családos sourceCoverage és függőségek](SI_C07_SOURCE_COVERAGE.md).
  Kötelező source/head/cohort/warmup/evaluation/boundary időkövetelmények;
  minden17/8 sorhoz mapping, unknown sosem nulla vagy FAIL. Valódi applied
  genesis + native lifecycle/policy/admin/external/lineage/executor és193
  boundary ugyanazon world/cohort/clock alatt:16/16 complete, coverage gate PASS.
  Mind16 omission/warmup és natív publisher-fault unknown; frozen readonly
  újraolvasás azonos. A numeric FAIL és globális zár változatlanul megmarad.
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
- **Kész P2-09:** [living/survival lower bound](SI_C07_POPULATION_BOUNDS.md).
  Teljes PASS finite lifecycle/health + eredeti cohort + azonos checkpoint és
  záró census alapján konzervatív living lower, exact survival eredeti nevezővel.
  Külön population boundary; fizikai food/reserve snapshot coverage nem öröklődik.
  Eredeti 1+7 pozitív/frozen és valódi halál FAIL; gap/foreign/stale unknown.
- **Kész P2-10:** [teljes boundary/access/demand bekötés](SI_C07_BOUNDARY_HISTORY.md).
  Eredeti genesis→end replay és külön evaluation boundary-projekció; physiology,
  physical, housing, executor és custody öt családja bekötve. Custodyhoz full
  sealed flow/integrity is kell; sparse/foreign/missing/extra pont nem complete.
  193 valódi SQLite pont pozitív history, numeric FAIL megmarad; rövid facade
  double-collection/gap/wrong-clock és teljes frozen-file hash ellenőrzés.
- **Következő és egyetlen nyitott pont P2-11:** teljes natív összesítő.
  Ugyanezen eredeti forráskötésen minden17 numerikus szabály és8 kapu közös
  pozitív natív útját igazold, csak utána oldd fel a `qualifiesMinimum:false`
  zárat. Egy sértés FAIL, egy sourcegap unknown, frozen/offline eredmény azonos.
  A joint fixture most szándékosan numeric FAIL; az üres executor/lineage
  coverage nem opportunity vagy cycle/final-use credit. Új lezárási pont nincs.
- **Megmaradó sorrend:** P2-11. Rögzített lista: 10/11 kész, 1 nyitott;
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

- P2-03: **39 külön célzott eset PASS**, nem full regresszió.
  [Natív16/16 audit, előfeltételek és teljes index](SI_C07_SOURCE_COVERAGE.md).
- `20261029-184005-850-si-c07-p203-native-audit`:3 PASS40,634 s; rövid source
  előfeltétel, eredeti1+7 közös16/16 és omission/warmup/frozen/native-fault.
  Setup10084 ms, fő23334 ms, replay4008 ms; aggregate37907/50000 ms.
  Minden eredeti/frozen source fájl hash-e unchanged; nincs193-pontos újraaudit.
- `20261029-184153-460-si-c07-p203-consumers-types`:20 pure/bridge/preflight
  eset PASS, wrapper TS FAIL21,607 s egy nullable fixture-változó miatt.
  Const alias javította, runtime nem változott. Végső root TS PASS20,124 s:
  `20261029-184520-885-si-c07-p203-types-final`.
- `20261029-184303-122-si-c07-p203-existing-fixtures`:5 PASS9,916 s;
  rövid joint és régi world-policy/finite/internal-lineage/default genesis.
  Az első kör13 genesis esete is PASS (`20261029-182251-050`), a wrapper a
  World cwd-importján bukott. Szűk diag után standalone publisher API-kat használ.
- `20261029-185123-259-si-c07-p203-preflight`:PASS0,905 s; várt NO-GO exit2,
  aktuális source/digest és29 dokumentum linkjei. Futási engedélyt nem ad.
- `20261029-185403-997-si-c07-p203-format`:staged changed-line format,
  aktuális source hashek és29 dokumentum linkjei PASS1,430 s; új helper stage-elve.
- A teljes193-pontos pozitív audit és a default13-as genesis fájl nem ismétlődött
  puszta típusnarrowing miatt. A sikeres consumer20 sem futott újra.
- A P2-10 korábbi95 és native boundary bizonyíték a
  [history docban](SI_C07_BOUNDARY_HISTORY.md), commit `98ac42f6a`.
- Nincs engine/termék-producer/schema/shared clock/persistence/auth/dependency
  változás. Root TS érintett, PASS; engine TS és C06 archive nem indokolt.
  Nincs live install/start/provider/baseline/historical backup DB-read.

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
