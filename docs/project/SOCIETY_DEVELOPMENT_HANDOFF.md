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
- **Következő kódhatár a2. csomagon belül:** natív login/load/respawn kísérletek
  és terminal elutasítások prospektív naplója. Ezután teljes konkrét producer/
  source/boundary/access history és8 integrity adapter kell. **6 csomag maradt,
  a2. még nyitott**; nincs3. baseline vagy C08. C07 továbbra NO-GO.
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

- **`20261027-172757-651-si-c07-mortality-final-boundaries`:68 PASS,1 régi
  fixture FAIL;64,156 s (test63,55 s).** Population/outcomes/minimum, death,
  expanded baseline és preflight6 pontos fájlja. A v22 migration fixture
  v26–v29 táblákat hagyott bent; csak a disposable tesztadat alakja javult,
  produkciós migráció nem változott. Typecheck ekkor nem indult el.
- `20261027-173043-086-si-c07-mortality-death-types`:2 célzott death/migrációs
  próba PASS;41,649 s után root TS FAIL. Az új World-observer runtime value
  MarketStore-importja root alias-határt lépett át, és a forrásjegyzék inferred
  unionje never[] lett. Engine-only bekötés külön modulba került, explicit
  inventory adattípus javította a szűkítést. Nincs új compiler alias/config.
- **`20261027-173313-243-si-c07-mortality-source-types`:8 célzott death/
  mortality/preflight próba és root/engine TS PASS98,608 s.** A passing
  minimum/outcomes/expanded egész fájlkört nem ismételtük. Teljes scope a
  `.local/verification/*.result.json` fájlokban; a korábbi failure log megmaradt.
- `20261027-172924-157-si-c07-mortality-selected-restore`:az új explicit
  mortality-selection C06 archive/izolált restore próba PASS1,939 s;
  corrupted head új baseline-t tilt. A még nem betöltött új eset külön futott.
- **`20261027-173413-018-si-c07-mortality-native-import`:6 packed native
  observer eset +wrapper PASS2,433 s.** Az új World/engine-only importhatár
  meglévő native cohort/identity/sleep/ingress próbái. Nem teljes live World-run.
- `20261027-172516-705-si-c07-mortality-thin`:2 új SQLite/native pass próba
  korán PASS2,830 s. A végső3 mortality próba már ismert birth-et is megkövetel;
  unknown birth, hiányzó tick/session/roster/write és foreign lifecycle gap.
- Négy offline founder, natív passz és byteazonos frozen readonly reread;
  valós esedékes offline natural death terminal-frame/native head kötése;
  user_version42, journal rollback, immutable history/head és eredeti founder
  FAIL-megőrzés.16 forráscsalád lefedi a17/8 hivatkozást, selectedSources=null,
  qualifiesCoverage=false. Mind8 integrity kapu unknown marad.
- Full/webclient TS nem futott: saját observer/journal, readonly health-head
  metódus, egy World megfigyelési hívás és közvetlen metrics/restore fogyasztók
  érintettek. Meglévő mortality/admission/HP/login guard, clock, gazdasági
  transaction/persistence/global auth és compiler/runtime dependency változatlan.
- `20261027-173828-826-si-c07-mortality-artifact`:friss NO-GO,16 család/17/8,
  sourcehash/digest és15 dokumentumlink PASS0,861 s. A lezáráskor
  staged format ellenőrzés történik. Korábbi bizonyíték a komponensdokumentumokban/progressben.
  Nincs hosszú run, providerhívás, új live install/selection/baseline vagy historical DB-read.
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
