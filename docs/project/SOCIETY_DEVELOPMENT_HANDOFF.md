# Rövid fejlesztési átadás

Frissítve: 2026-10-24. Belépő, nem futási napló.
A checkboxok forrása: [feladatlista](TASKS_SOCIETY_INTEGRATION.md).

## Aktuális állapot és következő lépés

- **SI-A technikailag lezárt; SI-B01–B06 és SI-C01–C03 kész; SI-M2 v2 PASS.
  24/45 lezárt feladat. Következő SI-C04, csak új kérésre.**
  Natív vagyon-/ár-/Business-idősor, saját SI-B06/SI-A12 függőségekkel.
  SI-C03 mechanikai kapu, nem autonóm SI-C07, SI-M3/MVS vagy önfenntartás.
- [C03 működés/migráció/ellenőrzések](SI_C03_NATIVE_TOOL_REPAIR.md),
  [source/packed manifest és actual eredmény](SI_C03_NATIVE_RESULT.json).
  Ág: `codex/si-c03-native-tool-repair`, baseline `a885bf644`.
- 100 actual Mining→broken0; belső copper+tin→packed bronze bar; meglévő
  repair policy1 bronzrúd/600 sim-s/Smithing1/work-surface→50 durability;
  ugyanazzal a provenance/instance-szal új Mining→49. Nincs új tool/pótlás.
- Native tool-WIP saját additive schema1 a canonical Player DB-ben, meglévő
  escrow/lifecycle/repair/facility adapterekkel. Input és checkpoint atomikus;
  a repair input indításkor elfogy, nincs ingyenes cancel/refund. WIP/history
  nem törölhető, egy actor/tool egy aktív munkát foglalhat.
- Csak egymást követő érvényes munkatickek simulation-ideje számít. Offline,
  restart, pause, source/clock-drift, permission revocation és process stall
  nem ad utólagos creditet. Pending repair nem adható át; más protected
  munka tiltott, a Player-load visszahozza a foglalást. Rollback a pontos
  inventory object reference-et ÉS countot, XP-t, capacityt/auditot/save-et őrzi.
- SDK exact tool műveletek: stabil run/step UUID, backend `wx` admission;
  completion csak readonly újranyitott canonical WIP+native effect proofból.
  Bizonytalan eredmény nem indít új-ID-s retryt; új permission kellőképpen
  elkülönített tool-ágon, a régi food/auth/clock/transaction alap változatlan.
- Két új0.1.0 draft, publikálás és automatikus learning nélkül. Normál munka
  külön megtanult verified1.0.0 verziót kér. Bootstrap kizárólag a meglévő,
  külön jóváhagyott draft-trial útján: exact backend intent, friss aktív
  CLI-marker trial-grant és run-journal admission, actor/run/step/params/checksum
  kötéssel. A draft nem állít verified learned procedure-t. A Business/facility
  actual Property tulajdont és aktív owner/worker-role jogot is külön ellenőrzi.
- [C02 instance/custody](SI_C02_NATIVE_MINING_TOOL.md), [C01 attribute/XP](SI_C01_NATIVE_ATTRIBUTE_XP.md)
  megmaradt. Exact egyetlen fizikai unnoted1265; unknown/dupla/lost/note tool
  quarantine és explicit reconciliation, soha új durability. Külön trade ledger
  nem distributed ACID: sikertelen checkpoint után sourcegap/quarantine.
  AgentState29, lifecycle borrowed saját marker3; közös user_version/PRAGMA,
  save-format, MarketStore transaction API és borrowed close-ownership változatlan.

## Legfrissebb ellenőrzés

- **Full nem futott.** Saját additive séma és szűk tool adapter; célzott
  migration/reopen/rollback, actor/clock/material/facility/proof és közvetlen
  régi fogyasztók fedve. Taskzárás/push nem indít új runtime regressziót.
- `20261024-175145-022-si-c03-protected-loop-final`:48 PASS /0 FAIL, C03 native12,
  food20, XP13 +wrapperek; engine TS/format PASS,48,641 s. Végső működésbeli guard:
  a protected actor foglalása minden opcode előtt ellenőrzött, később felvett
  második actornál is. `20261024-174532-951-si-c03-draft-bootstrap`:33 PASS /0,
  root/engine TS és format PASS,88,831 s; a későbbi engine-only guard nem érintette
  a root modult, annak sikeres ellenőrzése nem ismétlődött.
- `20261024-175403-585-si-c03-staged-native-format`:27 PASS /0, C03/Mining
  natív és staged format,10,269 s. Csak egy extra fixture EOF üres sor javult;
  innen a végső source-bound natív adat. Runtime policy változatlan.
- `20261024-173423-142-si-c03-mining-admin-types`:13 Mining és14 escrow,
  C03 runtime és root TS PASS; az akkori engine JSON-import/test-typing FAIL
  később javítva. `20261024-173240-392-si-c03-consumer-types`: food20, XP13
  és skill/framework/builder/authorization/repair/facility fájlok PASS,
  Mining fixture cleanup FAIL külön javítva és ismételve PASS. A teljes régi
  köröket nem állítjuk PASS-nak; pontos index a C03 dokumentumban.
- Korábbi hibák megmaradtak a logokban; rollback-count, fixture-hivatkozás,
  JSON-import/test-typing javítva, assertion vagy policy gyengítése nélkül.
  A körök átfednek, számok/idők nem összeadandók. Teljes log/result:
  `.local/verification/<azonosító>.log` és `.result.json`.

## Megőrzendő döntések és mentések

- Csak helyi/private emulator. Nincs live world indítás, actor/tool import,
  enrollment vagy új publication. Korábbi admincím `http://127.0.0.1:7781/admin/`;
  kulcs a Helyi szerver/local-default titoktárában. Új indítás előtt állapotellenőrzés.
- B06 engedély kizárólag0,05 USD-s próbára szólt:11 kérés /4235 microUSD
  =0,004235 USD. Nincs általános költési engedély; normál per-call0,
  auto-replanning/autonomousExecution off, B04/B05 default grant üres.
  [B06 eredmények](SI_B06_STRATEGIC_ACCEPTANCE.md). C01–C03 providerköltség0.
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
