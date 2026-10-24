# Rövid fejlesztési átadás

Frissítve: 2026-10-24. Belépő, nem futási napló.
A checkboxok forrása: [feladatlista](TASKS_SOCIETY_INTEGRATION.md).

## Aktuális állapot és következő lépés

- **SI-A technikailag lezárt; SI-B01–B06 és SI-C01–C06 kész; SI-M2 v2 PASS.
  27/45 lezárt feladat. SI-C07 nyitott: előkészítés elkészült, preflight NO-GO.**
  Ág: `codex/si-c07-minimum-preflight`, baseline `8b6055894`.
  [C07 run-tervezet és akadályok](SI_C07_RUN_PREPARATION.md),
  [forráskötött diagnosztika](SI_C07_PREFLIGHT_RESULT.json).
- **Következő konkrét kódmunka:** natív tool-unusable-demand history és a
 17 eredeti minimum requirement/8 integrity gate teljes source-backed
  assessment bridge-e. A minimum/evaluation report ma még inconclusive; a
  régi committed Mining/work event nem teljes requested/failed demand history.
  Ne következtess demandra offline/idle állapotból. Nincs új minimumképlet.
- Utána: teljes founder tool/food/housing baseline, valódi clock-ratio próba,
  minden authoritative source C06 pinje, SI-A14 regresszió és konkrét jóváhagyható
  run/model/budget/maxwall/stop terv. Hosszú runhoz külön engedély kell; a mostani
  ismert NO-GO-ra nem kértünk jóváhagyást. C08-at ne kezdd el, C07 nincs kész.
- Javított konkrét hiba: a day-survival staging `day-survival-needs/dynamics`
  azonosítói mellett a minimum legacy referencia-feloldása hibás volt. Most
  kizárólag validált immutable survival profile alapján effektív referencia-
  binding készül, declared/effective policy és requirements digesttel.
 17 requirement, ablak/küszöb/integrity gate és eredeti policy-file byteok
  változatlanok; legacy világ ág változatlan. Nem írtunk át needs/clock/DB-t.
- Az új readonly preparer az eredeti minimum forráshashét is megköveteli;
 9500→9400 lazítás blocked. CLI: `bun scripts/prepare-society-minimum-run.ts`,
  NO-GO JSON és **exit2**, liveStartAuthorized=false, readyForRunApproval=false.
  Nem nevezhető zöld runtime/M3 kapunak. Nincs selectedWorld vagy baseline.
- Candidate: verified1.3.0 native-travel fixture,1+7 sim nap288:1 mellett
  névleg40 wall perc, execution-terv50 perc,5 s observer. Maximum1h sim trace
  gap itt12,5 s wall; observer önmagában nem native coverage. A288:1 ratio még
  nem M3-validált. Capture-terv20+20 perc, result restore25 perc külön IO-limit.
 1:1-nél8 valós nap, live24:1-nél8 óra névleges idő.
- Finite food-envelope36 no-burn adag,32 nominális napadag +4 closing reserve:
 0 headroom. Ez nem mért demand vagy önálló FAIL. Jelenlegi fixture food/travel-
  only, nincs founder Mining→smelt→repair→reuse baseline;2 tenant slot/current
  rent/sleep sem teljes95% housingaccess-exposure. Nem emeltünk készletet vagy
  csökkentettünk minimumot a siker érdekében.
- A contractDigest a repository definíciójáé, nem még nem létező staged world
  effektív pinje. A forráshash/archívum vagy skill-success nem társadalmi PASS.
  C07/M3/MVS/önfenntartás nyitott. Provider authorization0 kérés/0 microUSD;
  B06 engedély továbbra kizárólag a korábbi próbára vonatkozott.
- [C06 baseline/restore](SI_C06_EXPANDED_BASELINE.md), [C05 outcomes](SI_C05_NATIVE_OUTCOME_METRICS.md),
  [C04 finance](SI_C04_NATIVE_FINANCE_HISTORY.md), [C03 repair](SI_C03_NATIVE_TOOL_REPAIR.md)
  mechanikai eredményei és korlátai megmaradtak. C06 selected coverage nem teljes
  világ; payload DB-t ne nyisd meg, szükség esetén új könyvtáras restore kell.

## Legfrissebb ellenőrzés

- `20261024-234953-838-si-c07-preparation-contract-gate`:66 célzott
  contract/survival/preparer/evaluation/integration/dashboard teszt PASS,
  root +preparer CLI TS PASS,103,911 s. Runtime27,52 s; wrapperben a két TS is.
- `20261024-235512-434-si-c07-policy-drift-and-candidate`:3 preparer teszt,
  CLI/transitive TS és új NO-GO artifact PASS,4,556 s. Ez tartalmazza a policy-
  relaxációs negatív esetet; korábbi fogyasztók bemenete nem változott.
- `20261024-234809-582-si-c07-thin-preparation`:3 korai mechanikai teszt
  PASS1,209 s. Artifact-generálás korábbi `si-c07-candidate-no-go` PASS0,828 s,
  a NO-GO exit2 tudatos ellenőrzésével, nem starttal.
- **Full nem futott:** readonly referencia-binding és saját preparer, nincs
  shared clock/dynamics/transaction/migration/auth változás. A célzott PASS
  nem teljes suite vagy M3 PASS. SI-A14/live/soak nem indult ismert NO-GO mellett.
  A körök átfednek, számok/idők nem összeadandók. Teljes log/result:
  `.local/verification/<id>.log/.result.json`.

## Megőrzendő döntések és mentések

- Csak helyi/private emulator. Nincs live world indítás, actor/tool import,
  enrollment vagy új publication. Korábbi admincím `http://127.0.0.1:7781/admin/`;
  kulcs a Helyi szerver/local-default titoktárában. Új indítás előtt állapotellenőrzés.
- B06 engedély kizárólag0,05 USD-s próbára szólt:11 kérés /4235 microUSD
  =0,004235 USD. Nincs általános költési engedély; normál per-call0,
  auto-replanning/autonomousExecution off, B04/B05 default grant üres.
  [B06 eredmények](SI_B06_STRATEGIC_ACCEPTANCE.md). C01–C07 előkészítés providerköltség0.
- SI-A15 technikai PASS; eredeti D1/SI-M1 önfenntartás nem PASS, teljes gazdasági
  minősítés inconclusive. [Technikai eredmény](SI_A15_TECHNICAL_RESULT.md),
  [archívum/restore](SI_A15_RESULT_ARCHIVE.md).
- Történeti backup payload DB-ket ne nyisd meg és ne módosítsd:
  `backups/si-a15-technical-20261022-1648/workspace`,
  `backups/si-a15-technical-result-20261022-1715/workspace`,
  `backups/si-a15-technical-restored-20261022-1726/workspace`.
- Éhség egy nap után, éhhalál hét nap teljes hiány után; normál adag egy nap.
  Live nap/óra, teszt nap/öt perc. SI-C09 kalibráció nyitott, a világot nem
  igazítottuk a karakterek túléléséhez.

`pwsh -NoProfile -File scripts/get-society-work-brief.ps1`

A folytonosságot e fájlok és a repo-local society skill adják, nem a chatmemória.
