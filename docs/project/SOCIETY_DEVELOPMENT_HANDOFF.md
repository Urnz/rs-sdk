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
- **Következő konkrét feladat:** teljes founder-cohort/source coverage-watermark.
  Kösd a kiválasztott roster/clock/window és authoritative headeket; a közvetlen
  legacy interact-loc/unbound/missing-identity/kimaradt observer utakat gapként
  kezeld. A hiányzó kérés vagy üres queue nem bizonyítja az igény hiányát.
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
- CLI: `bun scripts/prepare-society-minimum-run.ts`; NO-GO JSON +exit2,
  liveStartAuthorized/readyForRunApproval=false. Nincs selectedWorld/baseline.
  Forráshash, sikeres skill vagy helyes restore nem társadalmi PASS.

## Ellenőrzési bizonyíték

- `20261025-115804-236-si-c07-mining-admission-final-artifact`:végső source-
  hash/digest és dokumentációlink ellenőrzés PASS3,873 s, NO-GO exit2 tudatos
  kapuval; nincs runtime- vagy providerindítás.
- `20261025-114922-832-si-c07-mining-timeout-no-retry`:14 célzott runtime/
  natív ellenőrzés +root/engine TS PASS244,154 s, runtime33,87 s. A cancel
  után is sikertelen gather nem ismétel már elküldött csomagot. A változatlan
  webclient és a sikeres169 fogyasztói eset nem futott újra.
- `20261025-114216-650-si-c07-mining-admission-preflight-copy`:3 preparer
  próba +friss NO-GO artifact/sourcehash/link PASS1,709 s. A megelőző2 PASS/1
  FAIL1,959 s körben a másolt negatív fixture csak catalogot másolt; a filter
  most az új agent-skills kódfájlokat is megtartja.9500→9400 továbbra blocked.
- `20261025-111228-254-si-c07-mining-source-runtime`:11 source/runtime
  repeat/retarget/abort/disconnect/marker/admission eset PASS2,056 s.
- `20261025-111659-251-si-c07-mining-admission-native`:6 tényleges natív lánc/
  hibahatár +1 wrapper PASS4,031 s, explicit fixture source-porttal.
- `20261025-112122-525-si-c07-mining-admission-consumers`:16 célzott fájl,
 169 PASS/1 FAIL,99,071 s. Egy C06 compound result/restore eset a generikus5 s
  timerbe futott6,876 s-nál; más assertion nem bukott. Nem full regresszió.
- Változatlan limitű izolált reprodukció PASS2,615 s (`112343-749`), részfázisos
  mérés PASS2,668 s (`112453-151`), case-body2,128 s. Ez az egy3 capture/több
  restore/2 SQLite világ teszt explicit15 s I/O-budgetet és részfázisnaplót
  kapott; assertion/runtime/clock/run-limit nem lazult. A javított eset PASS
 2,062 s body (`112620-636`), ugyanazon kör root TS tesztadat-hibája még FAIL.
- `20261025-113401-579-si-c07-mining-shared-fixture-and-types`:18 érintett
  ellenőrzés és **root+engine+webclient TS PASS183,099 s**, runtime5,69 s.
  Root/NodeNext közös fixture import.meta helyett JSON-importot használ.
  A sikeres169 fogyasztót nem ismételtük; csak a változott fixture és hibás határ.
- Korai type/fixture FAIL-ek és javítások a [részletes progressben](SOCIETY_INTEGRATION_PROGRESS.md)
  és `.local/verification/*si-c07-mining-*.log/.result.json` alatt megmaradnak.
  A körök nested/átfedő számai és idői nem összeadandók.
- Full nem futott: új szűk ág a meglévő socket target/observe és engine token
  guard mögött; ezek, a közös clock/migrátor/asset commit invariánsai változatlanok.
  A közös BotAction típus miatt mindhárom TS-projekt érintett volt. A rootba
  motort behúzó type-importot tiszta SDK-típusra cseréltük; nem globális configot.

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
