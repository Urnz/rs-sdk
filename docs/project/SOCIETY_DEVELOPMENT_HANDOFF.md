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
  **6/11 kész**, 5 nyitott feltétel; nem 5 ígért chatkör. 17/17 részleges
  szabályadapter és 6/8 pozitív natív kapuút. A lifecycle/admin/external útja kész,
  a további két kapunak még nincs teljes pozitív natív útja.
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
- **Következő konkrét pont P2-08:** `verified-internal-lineage-and-final-use`.
  A meglévő production/material/maintenance/food és elkülönült fogyasztói
  receipt láncokat kösd az eredeti cohorthoz és teljes ablakhoz. Inventory gain,
  rövid üres lista vagy külső import hiánya önmagában nem belső lineage.
  Konkrét hiány/fogyasztó alapján dolgozz; új általános naplósort ne nyiss.
- **Megmaradó függőségi sorrend:** P2-08 → P2-09 → P2-10 →
  P2-03 végellenőrzés → P2-11. Rögzített lista: 6/11 kész, 5 nyitott;
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

- **106 külön aktív célzott eset PASS**, nem teljes regresszió. Bun fájlok mindig
  explicit `./` útvonallal; IO-heavy fixture/archive körök egymás után.
- Engine `20261028-225702-481-si-c07-external-value-native`: **23 PASS18,972 s**.
  Teljes érintett NativeLifecycleAttempts (16) és ShopEconomyPolicy (6), egy
  valódi bilateral native sale/treasury/completed-commerce backing eset.
- `20261028-225915-034-si-c07-external-value-readers-final`: **22 PASS60,596 s**.
  19 external value eset és három közvetlen admin/world-policy/lifecycle pozitív
  join. A193 tickpontos1+7 fixture11,693 s; build4519/export8321/total11200 ms,
  változatlan15 s limit. PASS/failure/gap, foreign binding és frozen readonly.
- `20261028-230026-231-si-c07-external-value-consumers`: **33 PASS7,148 s**.
  Öt pontos metrics/minimum/sourceCoverage/preflight fájl, köztük16 családos
  coverage contract és natív output-fogyasztók. Nem teljes csomag/folder.
- `20261028-225732-488-si-c07-external-value-archive`: **5 archive eset PASS**,
  összesített wrapper FAIL30,598 s, mert a következő benchmarkhoz téves,
  nem létező benchmark-controller.test.ts fájlútvonalat adtam meg. Nem tesztbukás;
  a javított ./society-experiments/test/controller.test.ts egyetlen esete külön:
  `20261028-225847-842-si-c07-external-value-benchmark`, **1 PASS10,507 s**.
  Az új C06 source inclusion/restore eset8,956 s, helyi10 s kerettel.
- Korai `20261028-225148-451-si-c07-external-value-readers`:17 PASS/1 timeout
  49,807 s. Az1+7 teszt három redundáns teljes readert futtatott; ezek helyett
  az export és a külön frozen reader azonos eredményét ellenőrzi. Limit nem nőtt.
  Külön `20261028-225341-420-si-c07-external-value-full-frame`:1 PASS12,562 s;
  a végleges22-es kör már a scope-kötés javításával is PASS.
- Engine `20261028-230530-309-si-c07-external-value-market-boundary`: **29 PASS
  2,539 s**, ebből22 további GE/checkpoint eset és7 már számolt shop/commerce.
  MarketStore/Environment/WorldConfig öt alias-importja ugyanazon relatív
  modulra mutat, hogy a root fixture is típusellenőrizze a valódi GE-kódot.
- `20261028-230545-977-si-c07-external-value-final-boundaries`: **2 source-pin
  integráció és végső root TS PASS31,728 s** az importjavítás után. Engine TS:
  `20261028-230457-464-si-c07-external-value-engine-types-final`, **PASS17,879 s**.
  A tiszta commerce-classifier az external-trade modulban van, az engine nem
  importálja miatta a teljes metrics kiértékelőt. Webclient változatlan.
- `20261028-230632-076-si-c07-external-value-preflight`: **PASS1,118 s**;
  várt NO-GO exit2, canonical hashek/digest és26 dokumentum linkjei.
  `20261028-230726-751-si-c07-external-value-format-final`: changed/staged-line
  format **PASS1,729 s**; új fájlok is stage-elve voltak.
- Teljes log/result JSON a root/engine `.local/verification/` alatt. A korábbi
  P2-06 és kezdeti type-kör történeti adat; nem adódik hozzá a106 aktív esethez.
  Korai type FAIL-ok: root engine-alias feloldás, majd az engine test teljes
  metrics importjának NodeNext/CJS és régi reader típusütközése. Importhatár
  javítva, compiler-szabály vagy minimumfeltétel nem lett lazítva.
- Full nem futott: readonly adapter és opcionális meglévő policy cursor, pontos
  közvetlen fogyasztók. Shared clock setter, gazdasági commit, általános auth/
  dependency nem változott. Nincs live install/start/provider vagy baseline.

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
