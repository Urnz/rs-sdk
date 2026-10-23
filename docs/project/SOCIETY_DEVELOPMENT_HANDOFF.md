# Rövid fejlesztési átadás

Frissítve: 2026-10-23. Belépő, nem futási napló.
A checkboxok forrása: [feladatlista](TASKS_SOCIETY_INTEGRATION.md).

## Aktuális állapot és következő lépés

- **SI-A technikailag lezárva; SI-B01–SI-B03 kész. Következő: SI-B04.**
- SI-B04: institution-agent stratégiai admission az existing enrollment/inbox/
  queue/budget lifecycle-ben. Első scope exact Business stock/work/árpolicy;
  fizikai művelet továbbra is player-request. Faction-politikai AI nem része.
  Előbb a roadmap SI-B04 követelményeit, `autonomy-supervisor`, `replan-runtime`,
  `agent-state/control`, Business agent-port és role-specific LLM tool határt olvasd.
  SI-B04–SI-B06 nyitott; új kérés nélkül ne kezdd el őket.
- [SI-B03 szerződés, preflight-lefedettség, migráció és bizonyíték](SI_B03_PLAYER_STRATEGY.md).
  Modell explicit observer-opciók közül választ. Nem actor-specifikus fallback.
  AgentState **v27**: saját stratégia-receipt; trigger/context/policy/choice/
  parent/proposal/goal/run összekötve. Replay nem küld új inference-t.
  Bizonytalan providerterminalnál foglalás és uncertainty megmarad, nincs vak retry.
- B03 fő fájlok: `agent-state/player-strategy.ts`, `store.ts`; gateway
  `player-strategy-options.ts`, `player-strategy-runtime.ts`, `replan-runtime.ts`;
  LLM planning/types/orchestrator/provider. Próba: `player-strategy.test.ts`,
  `NativeFoodSkill.test.ts` SI-B03 névfilter. A native shop-opció preflight
  fixture, a gathering/főzés következménye valódi packed engine/SDK bizonyíték.
- B03 explicit korlát: csak megfigyelt/preflightolható skill kerül executable
  opcióként a modell elé. Új kitchen-custody, order vagy ismeretlen trade/bank/
  travel capability nem szintetizálható. A fix society-livelihood policy és
  publikus grant nem bővült. Az inputhiány nem automatikusan Skill Builder gap.
- [SI-B02](SI_B02_STATE_GOALS.md): achieve/maintain állapotcél, bounded immediate
  adoption/replacement. Explicit admin/server objective kell; legacy run-goal
  nem minősül át. A sikeres skillfutás önmagában nem állapot-teljesülés.
- [SI-B01](SI_B01_OBSERVER_CONTEXT.md): observer-scoped natív gazdasági context,
  inbox v4 cursor/admission/hysteresis/cooldown. Observation nem transfer receipt.
- **Ne indíts automatikusan teljes regressziót.** Saját additív tábla, közös
  DB/user_version, taskzárás és push önmagában nem full-trigger. A konkrét
  közös invariáns, érintett fogyasztók és célzott kör elégtelenségének indoka kell.
  [Ellenőrzési policy](VERIFICATION_POLICY.md); `AGENTS.override.md` is ezt írja.
  Sikeres változatlan próbát ne ismételj; megszakadt full független maradékát se.
- DEV-I01 továbbra is nyitott: változatlan runtime-csomag és elkülönített világ;
  [mérési/kompatibilitási feltételek](SOCIETY_DEVELOPMENT_WORKFLOW.md).

## Legfrissebb ellenőrzés

- Ág: `codex/si-b03-player-strategy`. Élő világ/provider nem indult, csak
  eldobható fixture-ök migrálódtak. **Teljes regresszió nem futott.**
- `20261023-143925-685-si-b03-consumers-and-native`: 106 PASS / 1 új gateway
  assertion FAIL, 13,443 s. A sikeres független fogyasztók nem ismétlődtek mind.
- `20261023-144305-800-si-b03-final-runtime-types`: **32 PASS + root TS + engine
  TS + format**, 37,017 s; javított gateway, input repair, typed work,
  provider schema és native SI-B02/B03.
- `20261023-144529-990-si-b03-lease-state-final`: **29 PASS + root TS + engine
  TS + format**, 36,875 s; inference közbeni lease-owner váltás és halál,
  közvetlen goal/adoption-fogyasztó, native SI-B03. A körök számai átfednek.
- `20261023-145314-568-si-b03-docs-final-retry`: **PASS**, 1,105 s;
  roadmap (18 kész, következő SI-B04), helyi linkek, native case-leltár/formázás.
- Korábbi SI-B02 GitHub commit: `15d60cac1`; SI-A/SI-B01/runner: `98ffcad27`.
  A történeti PASS/FAIL-eket a fenti taskdokumentumok és a
  [progress](SOCIETY_INTEGRATION_PROGRESS.md) őrzik; teljes log/result:
  `.local/verification/`. A régi full FAIL-ek nem lettek utólag átminősítve.
- SI-A13 wrapper külön tíz natív esetre bontva, streaming résznaplóval,
  változatlan leaf limitekkel. [Runner-jegyzőkönyv](SI_A13_RUNNER_DIAGNOSTICS.md).

## Megőrzendő döntések és mentések

- SI-A15 v2 technikai elfogadás kész; eredeti D1/SI-M1 önfenntartási PASS nincs,
  teljes gazdasági minősítés `inconclusive`. SI-M2 valódi LLM-autonóm PASS sincs.
  Kontrollált mechanikai és autonóm trajectory bizonyíték nem azonos.
- Éhség/önálló ételkeresés egy nap után, éhhalál hét nap teljes hiány után;
  normál adag egy napot pótol. Live nap/óra, teszt nap/öt perc. SI-C09 nyitott
  realizmuskalibráció; a világot nem igazítottuk a karakterek túléléséhez.
- Csak helyi/private emulator. Korábbi publication-engedély csak a konkrét
  food/travel verziókra szólt, nem új publikálásra vagy providerköltésre.
- [SI-A15 technikai eredmény](SI_A15_TECHNICAL_RESULT.md),
  [archívum/restore](SI_A15_RESULT_ARCHIVE.md).
  World: `backups/si-a15-technical-20261022-1648/workspace`;
  result: `backups/si-a15-technical-result-20261022-1715/workspace`;
  restore: `backups/si-a15-technical-restored-20261022-1726/workspace`.
  A korábbi záráskor a runtime-ok leálltak. Új indítás előtt aktuális
  állapotellenőrzés kell; immutable result payload DB-it ne nyisd meg.

```powershell
pwsh -NoProfile -File scripts/get-society-work-brief.ps1
```

A folytonosságot ezek a fájlok és a repo-local society skill adják, nem a chatmemória.
