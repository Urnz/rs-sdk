# Rövid fejlesztési átadás

Frissítve: 2026-10-24. Belépő, nem futási napló.
A checkboxok forrása: [feladatlista](TASKS_SOCIETY_INTEGRATION.md).

## Aktuális állapot és következő lépés

- **SI-A technikailag lezárt; SI-B01–B06 és SI-C01–C06 kész; SI-M2 v2 PASS.
  27/45 lezárt feladat. Következő SI-C07, csak új felhasználói kérésre.**
  Ág: `codex/si-c06-expanded-baseline`, baseline `d57966d2f`.
  [C06 coverage/pin/CLI/korlátok](SI_C06_EXPANDED_BASELINE.md),
  [source-bound eredmény](SI_C06_NATIVE_RESULT.json).
- C07 első lépés: teljes native source/enforcement/minimum-denominátor preflight
  és konkrét hosszú run-plan maxwall/költség/stopfeltételekkel. A valódi hosszú
  futás külön, elkészült tervre adott jóváhagyást kér. A korábbi B06 költségkeret
  nem általános engedély. Ne indíts automatikusan új világot vagy hosszú soakt.
- C06 új root coverage: canonical `player-checkpoints.sqlite` +WAL/SHM/journal
  és `.local/society-metrics` megfigyelések. Régi v1 archive olvasható. Additív
  expanded pin/evidence és opcionális staging callback; nincs új authoritative
  store, domain migráció vagy shared SQLite/clock/auth/economic-commit változás.
- Pin: explicit world/clock/profile/run/declared seed/provider/model/effort/
  reportverzió; source/config/packed digest és kiválasztott store/table/schema/
  state. Config, engine data/config, LLM/world-director/world-mod override
  pinned. Missing source/table vagy unsupported séma hiba; a run minden
  szükséges authoritative source-át a tervbe fel kell venni. Selected coverage
  nem automatikus teljes-világ-lefedettség. Migráció csak normál domain workflow
  szerint, a pin készítése előtt; report/restore nem migrál.
- Result exact baseline-manifesthez és teljes pin/planhez kötött. Restore új
  könyvtárba, native state/schema/report ellenőrzés még stagingben, publish előtt.
  Archive payload DB-t ne nyiss meg, külön előzetes teljes verify nem kell.
  CLI: `society-benchmark.ts prepare-expanded/capture/restore/compare-expanded`;
  source paths/selection operátori/backend authority, nem feltöltött observations.
- A v2 benchmark report C05 outcomes-ot olvas a saját restored workspace-ból,
  exact controller run/clock/genesis seeddel és valódi execution wall-windowval.
  Observer-export off; hiányzó csatorna partial/inconclusive. V1 default ág és
  minimumképletek változatlanok. Seed nem RNG-stream/scheduler/LLM replay;
  nincs bitazonos rerun vagy új támogatott oksági treatment-axis állítás.
- Két külön kontrollált proof:6 store/schema +finance observation +WAL-only42
  row +treasury42 GP result replay; külön actual engine repair WIP200000 ms
  archive/reopen, eredeti később600000 ms completed, másolat working200000/
  result null. A native transport meta-fixture és a pin fixture nem egy élő
  közös gazdaság. Intent/material digest és Player checkpoint megmaradt.
- [C05 outcomes](SI_C05_NATIVE_OUTCOME_METRICS.md), [C04 finance](SI_C04_NATIVE_FINANCE_HISTORY.md),
  [C03 repair](SI_C03_NATIVE_TOOL_REPAIR.md), [C02 custody](SI_C02_NATIVE_MINING_TOOL.md),
  [C01 XP](SI_C01_NATIVE_ATTRIBUTE_XP.md) korlátai megmaradtak. Available/willing
  exposure és teljes stratégiai sikerráta nincs; trade nem trust, skill nem
  strategy-success. SI-C07/SI-M3/MVS/önfenntartás továbbra nyitott.

## Legfrissebb ellenőrzés

- **Full nem futott.** Offline archive saját coverage/pin/validator, readonly
  report és lokális CLI/probe; nincs shared writer/migration/auth/clock alapváltozás.
- `20261024-231836-132-si-c06-final-archive-root`:11 expanded PASS,
  root TS/format PASS,29,271 s.
- `20261024-231835-076-si-c06-final-native-engine`: actual native WIP
  child+wrapper2 PASS, engine TS,16,816 s.
- `20261024-232038-466-si-c06-final-runtime-policy-pins`: engine-config és
  director-override2 PASS, root TS,18,106 s. Összes jelenlegi expanded eset13,
  a korábbi11 kimeneteit e két új filter nem változtatja.
- `20261024-231426-889-si-c06-archive-consumers`:24 PASS,21,428 s,
  legacy archive/CLI/path/link/secret/corruption és offline probe is fedett.
- `20261024-231608-591-si-c06-expanded-controller-boundary`: native controller/
  Phase12/clock/XP +v2 report restore-case PASS; utána expanded5 PASS/1 összesített
  5 s timeout. A6 negatív mód külön név/idő szerinti test.each sor lett,
  időlimit/assertion emelése nélkül; a végső expanded kapu zöld.
- Korai fixture pause-argument/population clock/attribute admission és CLI
  literal type FAIL-ok megmaradtak, szűken javítva. Átfedő/nested/párhuzamos
  számok/idők nem összeadandók. Részletes index a C06 doc/eredményben;
  teljes log/result: `.local/verification/<id>.log/.result.json`.

## Megőrzendő döntések és mentések

- Csak helyi/private emulator. Nincs live world indítás, actor/tool import,
  enrollment vagy új publication. Korábbi admincím `http://127.0.0.1:7781/admin/`;
  kulcs a Helyi szerver/local-default titoktárában. Új indítás előtt állapotellenőrzés.
- B06 engedély kizárólag0,05 USD-s próbára szólt:11 kérés /4235 microUSD
  =0,004235 USD. Nincs általános költési engedély; normál per-call0,
  auto-replanning/autonomousExecution off, B04/B05 default grant üres.
  [B06 eredmények](SI_B06_STRATEGIC_ACCEPTANCE.md). C01–C06 providerköltség0.
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
