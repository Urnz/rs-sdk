# Rövid fejlesztési átadás

Frissítve: 2026-10-25. Belépő, nem futási napló.
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
- **Következő konkrét feladat:** az executor operation-instance végigkötése a
  tényleges SDK/transport/native packet belépéshez, a teljes belépési kör
  enforcementje. A `compatible-request` csak egyező aktív igény: a mostani
  kattintás protokollból nem bizonyítható az executor eredet, ezért a watermark
  completeDemandCoverage:false marad. Üres queue/nincs kérés nem nulla demand.
  Utána17 eredeti requirement/8 integrity gate teljes assessment bridge.
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
- Saját attempt/intent sémák1, user_version változatlan. Additív request-index,
  új immutable executor/invocation/cancel/seal sidecarok; régi adatokhoz nincs
  visszatöltés. Opcionális attemptSequenceAtAdmission nélküli legacy rekordból
  nincs új fulfillment. Baseline előtt schema/index init/pin szükséges.
  C06 selected intent chain/head/clockot, interval-reader outputproofot ellenőriz.
 100000 row/256 MiB readerlimit; explicit run source-row/byte budget még kell.
- Az új coverage séma saját schemaVersion1 selection/event/head táblákkal,
  baseline előtti explicit installal működik; live workspace-be nem települt.
  Nincs történeti backfill vagy automatikus selection/default. A teljes
  transport ingress még hiányzik, így az observer ablakának hiánytalansága
  önmagában nem teljes demand-coverage vagy minimum PASS.
- CLI: `bun scripts/prepare-society-minimum-run.ts`; NO-GO JSON +exit2,
  liveStartAuthorized/readyForRunApproval=false. Nincs selectedWorld/baseline.
  Forráshash, sikeres skill vagy helyes restore nem társadalmi PASS.

## Ellenőrzési bizonyíték

- `20261025-225050-867-si-c07-cohort-final-artifact`:friss NO-GO artifact,
  sourcehash/digest és dokumentációlink PASS0,852 s; változatlan17/8, provider0.
- `20261025-224729-890-si-c07-cohort-prefix-restore-final`:19 célzott/nested
  ellenőrzés +root/engine TS PASS120,674 s. Pre-window offline founder gap,
  valódi admitted native ingress prefix-read és2 selected-source capture/restore
  eset. A már sikeres többi fogyasztó nem ismétlődött.
- `20261025-224306-585-si-c07-cohort-coverage-consumers`:70 célzott/nested
  ellenőrzés +root/engine TS PASS154,490 s, runtime21,37 s. Saját séma/reader,
  native Mining/intent/admission, outcome/evaluation FAIL-megőrzés és preparer.
  A két kör átfed, számaik/idejük nem összeadandók.
- `20261025-223914-850-si-c07-cohort-coverage-thin`:korai16 PASS/9 FAIL,
  16,799 s; root assertionök a raw SQLite-fixture strict close-ján buktak
  (cache-ből kiesett statementek),1 natív eset dobott kivételt várt a motor
  ABORTED visszatérési állapota helyett. Meglévő OwnedDatabase fixture és
  explicit native execution-assertion javította; termék-assertion nem lazult.
- `20261025-224034-286-si-c07-cohort-coverage-owned-db`:13 ellenőrzés PASS,
  a kör root TS miatt FAIL83,183 s (a Bun által futáskor elfogadott Bufferes
  reopen nem része a típusdeklarációnak). A fixture valódi ideiglenes fájlt és
  readonly újranyitást kapott; type/config nem lazult. A két végső TS kör PASS.
- Korábbi source-backed admission:18 ellenőrzés +root/engine/webclient TS
  PASS183,099 s (`20261025-113401-579-si-c07-mining-shared-fixture-and-types`),
  majd a sikertelen gather no-retry javítása14 ellenőrzés +root/engine TS
  PASS244,154 s (`20261025-114922-832-si-c07-mining-timeout-no-retry`).
  A korábbi compound restore timerdiagnosztika és a részfázisok a
  [gather-admission dokumentumban](SI_C07_GATHER_ADMISSION.md) megmaradnak.
- Full nem futott: saját additív megfigyelési séma és reader, változatlan közös
  clock/auth/migrátor/gazdasági commit; a közvetlen source/archive/native
  fogyasztók célzottan ellenőrizve. A webclient nem változott, TS sem ismétlődött.
  Hosszú run, providerhívás, új live selection/baseline és történeti DB-read0.
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
