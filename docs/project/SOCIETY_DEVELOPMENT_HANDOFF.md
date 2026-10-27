# Rövid fejlesztési átadás

Frissítve: 2026-10-27. Belépő, nem futási napló.
Checkbox-forrás: [feladatlista](TASKS_SOCIETY_INTEGRATION.md).

## Aktuális állapot és következő kódmunka

- **SI-A technikailag lezárt; SI-B01–B06 és SI-C01–C06 kész;27/45.
  SI-C07 nyitott, preflight NO-GO; SI-M3/MVS nem PASS.**
  Ág: `codex/si-c07-minimum-preflight`. C06 baseline `8b6055894`.
  [Run-tervezet](SI_C07_RUN_PREPARATION.md), [diagnosztika](SI_C07_PREFLIGHT_RESULT.json).
- **Elkészült:** [source-backed gather-loc admission](SI_C07_GATHER_ADMISSION.md).
  Executor előzetesen kiírt és megvárt run/step/operationSequence/args/checksum
  nyugta +aktuális marker; authenticated avatar/active population/control/learned
  verified procedure/clock/lifecycle újraolvasás. Egy repeat új demandId,
  retarget ugyanazon igény. SDK→gateway→belső HTTP/tick→valódi packed Mining
  közös út próbázva. Inventory/XP/transport ACK nem helyettesíti a native proofot.
- **Lezárás:** immutable cancel-tombstone a dispatch előtt, executor finally-seal,
  eredeti abszolút deadline. Abort/disconnect/late open nem hosszabbítja az igényt.
  Admissionkori attempt-cursor: régi suspended akció késői érce nem teljesít új
  kérést. Sikertelen managed gather mindig retryable:false, a cancel nem
  játékcsomag-visszavonás. Source/role elvesztése unknown, nem nulla.
- **Új komponens kész:** [prospektív cohort/window/source-head napló](SI_C07_COHORT_COVERAGE.md).
  Explicit baseline előtti immutable selection; üres queue mellett is minden
  founder megfigyelése, raw/unbound/missing-identity native ingress a korai
  kilépések előtt. Tick/session/roster/clock/prefix gap nem interpolálható.
  C06 selected-source capture/restore és outcome-read bekötve; sérült coverage
  nem rejti el az érvényes intent-naplóval bizonyított scoped FAIL-t.
- **Kész az1. csomag:** [exact executor→SDK→typed native dispatch](SI_C07_NATIVE_DISPATCH.md).
  Immutable demand+ordinal+target sidecar és egyszer fogyasztható saját DB-
  admission; tokenvédett HTTP/tick→valódi packed Mining, konkrét ScriptState
  provenance és canonical outputproof. Új production intent nativeDispatchRequired.
  Másik raw kattintás nem teljesíti; selected cohort raw belépése naplózott
  elutasítás. Abort/deadline a teljes gatherre érvényes; késői SDK-send megáll.
- **Következő konkrét feladat:** [2. munkacsomag, teljes minimum-assessment](SI_C07_REMAINING_WORK.md).
  **Kezdéskor7 csomag volt,1 kész,6 maradt.** Ezek nem garantált chatkörök.
  A17/8 mag/source-map és17 részleges adapter már kész; még teljes történeti
  coverage/nevezők, high-level demand teljesség és maintenance origin
  kell. Az új prospektív producer és natív watermark feltételesen teljes
  executor requested-use coverage-et ad; legacy/kijelöletlen C07-ben továbbra
  false. Üres queue/nincs kérés nem pozitív opportunity vagy nulla idő. C08 nem indul.
- **2. csomag részeredmény:** [17/8 kiértékelőmag és forrástérkép](SI_C07_MINIMUM_ASSESSMENT.md)
  kész. Exact rational lower/upper bound, minden actor/bucket/cycle/boundary
  kötelező cella, zero-opportunity és hiányos boundary schedule védelem.
  SQLite-native outcome→evaluation.minimumAssessment bekötve;3 work/tool
  lower-bound adapter. Default frame unbound; sem config, sem DB-létezés nem
  ad integrity PASS-t, natív teljes PASS továbbra nincs. Scoped tool FAIL megmarad.
- **Új population-rész kész:** applied/frozen genesis roster +integrity anchor,
  teljes eredeti founder-kiválasztás, immutable finite-avatar/lifecycle/death
  kötés. Engine-halál a későbbi AgentState-projekció előtt is számít; upper
  living/survival bound, korai terminal diagnostic FAIL. Nincs absence-of-death
  vagy heartbeat-alapú PASS. Részletek a [minimum-dokumentumban](SI_C07_MINIMUM_ASSESSMENT.md).
- **Needs-rész kész:** [éhség/fáradtság történeti replay és4 időfeltétel](SI_C07_NEEDS_EXPOSURE.md).
  Eredeti genesis/lifecycle/admission/policy-kötés; auditált modes, sleep-expiry
  és native meals/watermark. Naponta külön satisfied lower/upper és longest
  critical egész ablakon. Azonos időbélyegnél a needs mode-cursor dönt; hibás
  későbbi állapot nem törli az igazolt prefixet. Benchmark/restore bekötve.
- **Food-rész kész:** [napi food share/final-use és frozen stock/reserve](SI_C07_FOOD_MINIMUM.md).
  Tényleges relief a nevező, nem demand; exact napi bounds, valódi native
  gather/cook/trade/consume és egyszer számolt külön producer→consumer chain.
  Explicit paused checkpoint/needs/clock/agent/health/business/treasury pontok,
  actual HP és finite census; bank/WIP nem biztosan usable inventory. Sparse
  endpoints nem complete, sérült másik pont nem törli a hiteles reserve FAIL-t.
- **Housing-rész kész:** [legal housing access/exposure](SI_C07_HOUSING_ACCESS.md).
  Explicit exact-paused clock/agent/needs/title/housing/payment pontok;
  változatlan verzió/head és legfeljebb1h gap, auditált tenancy és paid native
  bérlet. Nincs dupla férőhelycredit; expiry és death clip, founder/nap bounds.
  Hiányzó köztes pont nem hidalható át, visitor-jog unknown.16/17 részleges
  adapter, nem16 PASS; teljes source-inventory/pin még nincs.
- **Capacity-rész kész:** [fagyasztott tool-service capacity](SI_C07_TOOL_CAPACITY.md).
  Borrowed native lifecycle schema3, teljes audit/current-state replay,
  wear/repair/replacement/transfer és opening revision/physical save kötése.
  Pontos original cohort/health/needs/custody, bank/quarantine/dupla/stale
  példány upper-only. A záró audit/native events a nyitó folytatása;100→50
  capacity egy tool mellett is FAIL.17/17 részleges adapter, nem17 PASS.
- **Executor-demand rész kész:** [prospektív requested-use coverage](SI_C07_EXECUTOR_DEMAND_COVERAGE.md).
  Admission előtt saját append-only request source, finally-seal utáni close,
  natív tick-prefix/descriptor witness, eredeti owner és policy-gap kötés.
  A native admission előtt elakadt kérés is számít; pozitív opportunity esetén
  teljes outstanding időből conservative upper, nulla opportunity nem PASS.
  Átfedő/szomszédos azonos-actor kérések uniója; lower FAIL nem vész el.
- **Sleep-observer rész kész:** [igazolt online alvás](SI_C07_SLEEP_OBSERVATION.md).
  Readonly aktuális witness/paid lease/Property/identity/clock/bed/HP ellenőrzés;
  observed-sleeping frame és offline visszaolvasott native audit/payment kötés.
  Puszta sleep-flag, terminal, offline vagy hibás identity/source továbbra gap.
  A pending request és teljes conservative lifetime upper alvás alatt is megmarad.
- **Maintenance-rész kész:** [natív kopás→repair→reuse és inputfogyasztás](SI_C07_TOOL_MAINTENANCE.md).
  Exact instance/revision, auditált lifecycle/native output/WIP/escrow/purpose
  kötés; frozen offline reread. A korábbi repair-only cyclecredit javítva.
- **Material-origin rész kész:** [prospektív érc→smelt→bar→repair](SI_C07_MATERIAL_ORIGIN.md).
  Saját append-only lot/event/head, fizikai object identity, egyszeri hold és
  natív output/escrow/WIP kötés. Original founder/genesis/scope mellett a teljes
  lánc cycle lower boundot adhat. Másolt/kevert ismeretlen anyag és nem holdolt
  reload unproven; a durable WIP ancestry megmarad. Replacement még unproven.
- **Forrásjegyzék/mortality-pass rész kész:** [16 forráscsalád és prospektív native tick](SI_C07_MORTALITY_COVERAGE.md).
 17 requirement/8 gate explicit forrás- és időbeli kötelezettsége; konkrét
  selectedSources továbbra null. Sikeres native mortality passzhoz kapcsolt
  saját selection/event/head, offline original founderrel, health/death/binding
  prefixszel; hiányzó birth/tick/session/roster/write/policy gap. Frozen readonly
  és C06 restore próbázott. Ez nem continuous HP vagy login/respawn enforcement,
  ezért completeLifecycleEnforcement=false, mind8 integrity továbbra unknown.
- **Lifecycle-attempt rész kész:** [natív parser/login/entry/respawn journal](SI_C07_LIFECYCLE_ATTEMPTS.md).
  Saját immutable selection és begin/result/head/fault, mortality-selectionhöz
  kötve. Parser siker nem admission; actual natív halál utáni belépés/respawn
  scoped finite-lifecycle-no-respawn FAIL lehet. Missing/stale/foreign context
  unproven, observerhiba nem módosítja a guardot. Teljes enforcement még false.
- **Lifecycle-watermark rész kész:** [páros tickpont és actual World-slot census](SI_C07_LIFECYCLE_WATERMARKS.md).
  Guard után és tick végén eredeti actor/HP/finite/terminal, mortality prefix
  és attempt head/fault. Missing stage/tick/session/context/source/fault/pending
  gap; hiteles post-guard terminal/zero-HP/non-finite/duplicate scoped FAIL.
  A teljes megfigyelési ablak sem teljes enforcement, intratick HP vagy PASS.
- **Lifecycle policy/build rész kész:** [declared route/source pin és tényleges clock/policy observer](SI_C07_LIFECYCLE_POLICY.md).
  Saját explicit selection/event/head/fault, importkori forrásidentity és aktuális
  cached age/mortality/binding/survival/mod policy, clock state/revision/anchors.
  Hiteles drift scoped unchanged-clock-and-world-policy FAIL lehet, census-gap
  nem rejti el. Teljes world-policy enforcement még false. C06 az actual
  source/config pin egyezését és az archive inventoryba kerülést is ellenőrzi.
- **Environment/mutation rész kész:** [C06 fájlleltár és5 mod/director producer journal](SI_C07_POLICY_MUTATIONS.md).
  Source/config/packed byte/hash pin, Bun/platform és deklarált inputnevek;
  külön explicit selection/event/head/fault journal a gateway és engine számára.
  Natív policy-cursor közé kötött round-trip változás scoped FAIL, normál
  signal/no-op nem konfigurációs sértés. Incomplete window nem törli a hiteles
  korábbi prefix FAIL-jét. Full loaded dependency/input/writer enforcement false.
- **Következő kódhatár a2. csomagon belül:** tényleges loaded runtime/input
  tanúsítás és nem regisztrált value/config írók source/enforcement leltára. Teljes concrete source/boundary/access history
  és8 integrity adapter kell. **6 csomag maradt, a2. még nyitott**; nincs3.
  baseline vagy C08. C07 továbbra NO-GO, nincs pozitív minimum/enforcement PASS.
- Korábbi modulok: [attempt-napló](SI_C07_NATIVE_TOOL_DEMAND.md),
  [tartós natív igény/időmérés](SI_C07_STANDING_TOOL_DEMAND.md).
  Lower-bound longest unusable-time, nem más actorok/kérések összege; restart,
  offline vagy state/tick gap nem interpolálható. Bizonyított >1 óra scoped
  sértés evaluation FAIL; rövid/hiányos bizonyíték inconclusive, sosem PASS.
  Controlled fixture FAIL nem egy hosszú C07 gazdaság eredménye.
- Ezután teljes founder tool/food/housing baseline, tényleges ratio-próba,
  authoritative source-lista/C06 pin, SI-A14 és konkrét jóváhagyható hosszú terv.
  Hosszú futáshoz külön engedély szükséges. Ismert NO-GO-ra ne kérj jóváhagyást;
  C08-at ne kezdd el, C07 nincs kész.

## Megmaradó preflight-korlátok

- Eredeti minimum17 rule/8 gate/küszöb változatlan, policy forráshash pinned;
 9500→9400 relaxáció blocked. Day-survival effektív needs/dynamics referenciák
  kizárólag validált immutable survival selectionből kötődnek, eredeti file
  byteok változatlanok. ContractDigest a repository definíciójáé, nem élő pin.
- Candidate verified1.3.0 native-travel fixture,1+7 sim nap288:1 mellett névleg
 40 wall perc, execution-terv50 perc, observer5 s. Trace-gap maximum12,5 s wall;
  ratio még nem M3-validált. Capture-terv20+20 perc, restore25 perc külön IO.
 1:1 nyolc valódi nap, live24:1 nyolc óra; ez nem kapacitás- vagy runígéret.
- Food/travel-only baseline:36 no-burn portion,32 nominális adag +4 closing
  reserve,0 headroom; ez nem mért demand vagy önálló FAIL. Nincs a founderhez
  kötött teljes Mining→smelt→repair→reuse baseline, illetve teljes95% legal
  housing exposure. Nem tuningoltunk világot vagy csökkentettünk minimumot.
- Natív repair50 kapacitást állít vissza, virgin tool100; ez önmagában nem
  teljesíti a closing>=opening retentiont. A legitim baseline/ciklus/utánpótlás
  a3. csomag része; küszöb- vagy kezdeti állapot tuninggal nem lehet megoldani.
- Saját attempt/intent sémák1, user_version változatlan. Additív request-index,
  új immutable executor/invocation/cancel/seal sidecarok; régi adatokhoz nincs
  visszatöltés. Opcionális attemptSequenceAtAdmission nélküli legacy rekordból
  nincs új fulfillment. Baseline előtt schema/index init/pin szükséges.
  C06 selected intent chain/head/clockot, interval-reader outputproofot ellenőriz.
 100000 row/256 MiB readerlimit; explicit run source-row/byte budget még kell.
- Az új coverage séma saját schemaVersion1 selection/event/head táblákkal,
  baseline előtti explicit installal működik; live workspace-be nem települt.
  Nincs történeti backfill vagy automatikus selection/default. A teljes
  high-level request nevezők még hiányosak, így az observer ablakának
  hiánytalansága önmagában nem teljes demand-coverage vagy minimum PASS.
- Saját dispatch séma1, immutable consumed admission és sidecar source;
  user_version változatlan, nincs backfill. Új tool-opening baseline előtt
  initel; régi kötött világ csak explicit offline előkészítés/új pin után.
  Rollback előtt stop: régi bináris nem enforce-olja az új strict intent flaget,
  így nincs régi binárissal folytatható strict baseline. Nincs evidence-törlés.
- CLI: `bun scripts/prepare-society-minimum-run.ts`; NO-GO JSON +exit2,
  liveStartAuthorized/readyForRunApproval=false. Nincs selectedWorld/baseline.
  Forráshash, sikeres skill vagy helyes restore nem társadalmi PASS.

## Ellenőrzési bizonyíték

- `20261027-221114-035-si-c07-mutations-thin-gateway`:4 valós gateway configure/
  restore/director/no-op +journal fault/rollback/inventory eset PASS0,777 s.
- `20261027-221403-078-si-c07-mutations-thin-native`:2 actual native hot-reload/
  director-accept +wrapper PASS0,780 s. Izolált backend ports; nincs production
  mod reload/lazy store vagy World.cycle. Duplicate/conflicting accept és
  journalhiba mellett az eredeti eseménytár változatlanul működik.
- `20261027-221720-698-si-c07-mutations-thin-readers`:12 FAIL7,154 s. Az új
  cross-store adapter a saját insertion-order digestet canonical report-digesttel
  vetette össze. A reference-összehasonlítás javult; egy régi hash sem változott.
- `20261027-221812-782-si-c07-mutations-reader-binding`:11 PASS1 timeout13,010 s.
  A C06 valódi IO-fázisok: fixture1141, prepare281, capture2210, restore1590 ms;
  együtt5302 ms az5 s default alatt. Ennél az egy próbakörnél mért összeg alapján
  helyi10 s keret lett, folyamatos phase loggal; nincs globális limitemelés.
- **`20261027-222203-064-si-c07-mutations-final-readers`:13 célzott mutation/
  C06 eset PASS13,969 s.** Archive positive5737 ms: fixture1134, prepare451,
  capture2130, restore1940 ms; negatív packed/head1849 ms. Native-cursor round-trip,
  signal/no-op, after-close exclusion, pending/foreign/stale/null/fault/prefix,
  hiányos zárás mellett megmaradó korábbi FAIL és frozen readonly reread.
- **`20261027-222232-520-si-c07-mutations-final-boundaries`:58 jelentett eset
  PASS, root TS fixture literal FAIL58,584 s (root test14,82 s).**4 mutation-
  module, pontos gateway world-mods/world-director-runtime, native-outcomes,
  minimum-assessment, native-lifecycle és preflight fájlok. A fixture
  schemaVersion number helyett1-es literal lett; runtime kód nem lazult.
- `20261027-222438-955-si-c07-mutations-types`:root TS PASS, engine TS új helper
  import.meta/CommonJS határ FAIL75,989 s. A root helper workspace-jét az
  engine/gateway ismert adaptere adja át; nincs compiler/package/alias váltás.
- **`20261027-222919-035-si-c07-mutations-module-boundaries`:50 jelentett eset
  és root/engine TS PASS88,966 s.** Csak a módosított adapterhatárok, mutation
  module és8 diagnosztika-case: native sampleSequence numerikus maradt, új
  mutation attemptId külön mező. A Native World sampler journal cursor0→2
  kötése is ténylegesen próbázott. A nagy teljes metrics fájlkör nem ismétlődött.
- **`20261027-223150-309-si-c07-mutations-artifact`:friss NO-GO sourcehash/
  digest és19 dokumentumlink PASS0,936 s.**16 forráscsalád/17 requirement/8 gate;
  selectedSources=null, qualifiesCoverage=false. Backend policyMutationsPath
  explicit, legacy hiányzó mutationCursor nem kerül backfillre vagy NULL=0-ra.
- Full/webclient TS nem futott: saját külön journal, passzív producer-observer,
  read-only clock context, explicit source pin és közvetlen minimum/C06 olvasók.
  Shared clock setter, auth, gazdasági transaction/migráció alap változatlan.
  Nincs live install/run/baseline/providerköltség vagy történeti backup-read.

## Megőrzendő döntések

- Csak helyi/private LostCity. Nincs live world-indítás, import, enrollment,
  publication, hosszú run vagy providerhívás. Admin korábbi címe
  `http://127.0.0.1:7781/admin/`; kulcs local-default titoktárában, nem chatben.
- B06 engedély kizárólag korábbi0,05 USD-s próbára:11 kérés/4235 microUSD.
  Most0 kérés/0 microUSD engedély; normál per-call0, auto-replanning és autonomous
  execution off. Nincs általános költési engedély. [B06](SI_B06_STRATEGIC_ACCEPTANCE.md).
- SI-A15 technikai PASS, eredeti D1/SI-M1 önfenntartás nem PASS.
  [Eredmény](SI_A15_TECHNICAL_RESULT.md), [archívum](SI_A15_RESULT_ARCHIVE.md).
  Történeti payload DB-ket ne nyisd meg/ne módosítsd:
  `backups/si-a15-technical-20261022-1648/workspace`,
  `backups/si-a15-technical-result-20261022-1715/workspace`,
  `backups/si-a15-technical-restored-20261022-1726/workspace`.
- Éhség1 nap, éhhalál7 nap teljes hiány után; normál adag1 nap. SI-C09 kalibráció
  nyitott; a világot nem igazítottuk a karakterek túléléséhez.

`pwsh -NoProfile -File scripts/get-society-work-brief.ps1 -TaskId SI-C07`
