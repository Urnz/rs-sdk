# Rövid fejlesztési átadás

Frissítve: 2026-10-26. Belépő, nem futási napló.
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
  Először17 eredeti requirement/8 integrity gate source-map, window/cohort/
  nevezők és meglévő readerek összekötése; külön high-level demand teljesség
  és legal housing/needs exposure. A source-bound native ingress nem bizonyítja
  az összes high-level igényt, ezért completeDemandCoverage:false még helyes.
  Üres queue/nincs kérés továbbra sem nulla demand. C08 nem indul.
- **2. csomag részeredmény:** [17/8 kiértékelőmag és forrástérkép](SI_C07_MINIMUM_ASSESSMENT.md)
  kész. Exact rational lower/upper bound, minden actor/bucket/cycle/boundary
  kötelező cella, zero-opportunity és hiányos boundary schedule védelem.
  SQLite-native outcome→evaluation.minimumAssessment bekötve;4 work/tool
  lower-bound adapter. Default frame unbound; sem config, sem DB-létezés nem
  ad integrity PASS-t, natív teljes PASS továbbra nincs. Scoped tool FAIL megmarad.
- **Következő kódhatár a2. csomagon belül:** applied/frozen genesis roster,
  teljes boundary/death inventory és needs történet natív bekötése. A17/8
  source-map minden missing mezője ismert további munka: physiological
  satisfied/critical exposure, napi food relief/lineage, reserve/stock/capacity,
  legal housing history, high-level demand és8 integrity adapter. **6 csomag
  maradt, a2. még nyitott**; nem kezdődött el a3. baseline vagy C08.
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

- `20261026-171721-788-si-c07-minimum-final-restore-artifact`:végső1 kiválasztott
  benchmark/native-report/offline restore +friss NO-GO/sourcehash/digest/link
  PASS5,877 s. Nincs runtime/TS széles kör ismétlés vagy provider/live indítás.
- `20261026-171412-822-si-c07-minimum-scope-binding-final`:15 adapter/native
  SQLite→evaluation próba +root TS PASS53,737 s. Előtte egyetlen célzott negatív
  eset FAIL0,499 s (`20261026-171354-764-si-c07-minimum-foreign-scope-red`):
  az új projekció átvette volna más actor/window/clock scope diagnostic FAIL-jét.
  Pontos normalizált scope-egyezés kell; idegen riport nem adhat evidenciát.
- `20261026-171120-241-si-c07-minimum-benchmark-restore`:1 kiválasztott
  benchmark/native-report/offline restore próba PASS15,459 s, a végső scope-guard
  előtt. Ugyanez a megváltozott output-digest miatt a végső artifact-kör része.
- `20261026-170224-509-si-c07-minimum-roster-consistency`:13 core/adapter
  teszt és root TS PASS37,328 s. Roster3 nem használhat openingCount4-et;
  tényleges3 founder az eredeti minimumon FAIL. Az57 sikeres fogyasztó nem ismétlődött.
- `20261026-165946-415-si-c07-minimum-assessor-consumers`:57 célzott core/
  contract/survival/native outcome/evaluation/preflight teszt és root TS
  PASS70,080 s, runtime9,22 s. Engine/SDK/webclient változatlan, TS nem futott.
- `20261026-165619-663-si-c07-minimum-assessment-core`:23 core/adapter/
  SQLite-native ellenőrzés PASS11,740 s. Körök átfednek, nem összeadandók.
- `20261025-232300-047-si-c07-dispatch-final-artifact`:friss NO-GO,
  sourcehash/digest és5 kapcsolt dokumentum linkje PASS0,808 s;17/8 változatlan.
- **`20261025-231507-910-si-c07-dispatch-consumers-final`:113 célzott/nested
  ellenőrzés, köztük3 selected-source restore, és root+engine+webclient TS
  PASS189,906 s.** A root runtime71 teszt30,93 s, az archive3 eset4,91 s;
  nested wrapper és belső számok átfednek, nem összeadandók. A pontos fájllista
  és teljes command a helyi result.json-ban, részletes log azonos nevű.log-ban.
- `20261025-230418-667-si-c07-dispatch-source-thin`:11 PASS1,745 s.
  `20261025-231025-927-si-c07-dispatch-native-cooldown-and-types`:20 runtime
  ellenőrzés és root TS PASS, kör engine TS miatt FAIL143,339 s. Loc-option
  null-guard és closure-ben rögzített source javította; TS/config nem lazult.
- Korai natív FAIL-ek16,369/17,726/2,654/14,830 s: a régi direkt-script fixture
  FOREVER köve nem szerepelt a World.getLoc nyilvántartásban; egyetlen esetre
  szűkített target-stage diagnosztika után valóban indexed dynamic fixture loc,
  majd a régi f.mine-nal egyező cooldown/tick előkészítés javította. Raw rejection
  előtt az actionId még nem került a scriptbe; ore/wear nulla külön assertion.
  Nincs generic timeout-emelés vagy production target/range check lazítás.
  Pontos ID-k és a sikertelen naplók a [progressben](SOCIETY_INTEGRATION_PROGRESS.md).
- Korábbi cohort:70 ellenőrzés +root/engine TS PASS154,490 s
  (`20261025-224306-585-si-c07-cohort-coverage-consumers`), végső19 ellenőrzés
  +root/engine TS PASS120,674 s (`20261025-224729-890-si-c07-cohort-prefix-restore-final`).
  Történeti bizonyíték, nem helyettesíti az aktuális final checket.
- Full nem futott: új szűk, már meglévő SDK target/observe és internal token
  guard mögötti ág; saját additív dispatch séma; változatlan közös clock,
  migrátor és gazdasági commit. Minden megváltozott natív/source/SDK/archive
  határ célzottan ellenőrzött; dokumentációs utómunkához runtime/TS nem ismételt.
- Hosszú run, providerhívás, új live selection/baseline és történeti DB-read0.

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
