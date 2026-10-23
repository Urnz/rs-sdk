# Rövid fejlesztési átadás

Frissítve: 2026-10-23. Belépő, nem futási napló.
A checkboxok forrása: [feladatlista](TASKS_SOCIETY_INTEGRATION.md).

## Aktuális állapot és következő lépés

- **SI-A technikailag lezárva; SI-B01–SI-B05 kész. Következő: SI-B06.**
- SI-B06: stratégiai autonómia/SI-M2 kapu. Ugyanazon baseline kontrollja,
  bevételvesztés/raw-hiány/új együttműködés opportunity setje, rögzített
  provider/model/prompt/config és pénz/idő/híváskeret kell. Előbb a technikai
  scripted próba, külön a valódi provideres eredmény. Mock nem valós-LLM PASS;
  provider/budget hiánya `not-tested`. Új kérés nélkül ne kezdd el SI-B06-ot.
- [SI-B05 szerződés, támogatott kör, migráció/rollback és bizonyíték](SI_B05_ECONOMIC_COOPERATION.md).
  `economic-cooperation-runtime/policy/evidence`, `agent-state/economic-action`,
  contract/settlement és B03 option/terminal adapter a fő belépők.
  Exact player/Business grantból typed offer/work-proposal, külön recipient
  acceptance/rejection; partner saját tartós kapcsolatból, privát trusttal.
  **Default `config/economic-cooperation.json` grantlista üres.**
- AgentState **v29** saját economic-action receipt; contract DB saját v1
  immutable offer-origin, binding mindkét identity/role/subject/avatarhoz.
  Stable action/offer/contract/escrow ID; uncertain inference nem ismétlődik,
  applying outbox új supervisor-eventtel eredeti döntésből folytatódik.
  Service kizárólag `one-native-invocation` + exact gather/cook/consume Skill[]
  verzió és natív receipt lehet. B03-hoz existing approved state objective kell;
  nincs új goal-authority, employment vagy hitel/adó/forced-consent jogkör.
- [SI-B04 szerződés, grant és migráció/rollback](SI_B04_INSTITUTION_ADMISSION.md).
  `institution-strategy-runtime/policy`, `agent-state/institution-strategy`,
  Business agent-port és `business-stock-policy/selection` a fő belépők.
  Exact avatarless Business ugyanazon supervisor/inbox/queue/ledger útján
  választ policy/stock/ár/work opció-ID-t; nincs avatártool vagy Faction AI.
  **Default `config/institution-strategy.json` grantlista üres.** Explicit
  exact agent/Business/enrollment grant kell, max. 12 előre jóváhagyott opcióval.
- B04-ben bevezetett saját intézményi receipt; Business saját v1 selection és
  append-only application audit. Bizonytalan inference nem ismétlődik; applying
  outboxot új supervisor-event eredeti ID-val folytatja. Stock/price selection
  a natív commerce-be jut, work csak typed player-request és kanonikus reward.
  Cooknál exact már előkészített native target kell; custody nem szintetizálható.
- [SI-B03 szerződés, preflight-lefedettség, migráció és bizonyíték](SI_B03_PLAYER_STRATEGY.md).
  Modell explicit observer-opciók közül választ. Nem actor-specifikus fallback.
  B03 saját stratégia-receipt (v27-ben bevezetve); trigger/context/policy/choice/
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

- Ág: `codex/si-b05-economic-cooperation`. Élő világ/provider nem indult, csak
  eldobható fixture-ök migrálódtak. **Teljes regresszió nem futott.**
- `20261023-211954-118-si-b05-consumers-native-types`: **20 saját PASS / 1 új
  gateway fixture FAIL**, 9,632 s; hiányzó inGame/combat állapot javítva.
  Az összes sikeres saját eset nem ismétlődött újra. Korábbi hibák a B05 docban.
- `20261023-212201-424-si-b05-final-consumers`: **125 PASS + root/engine TS +
  format**, 159,810 s. 3 érintett saját eset, 121 közvetlen fogyasztó 13 fájlban,
  egy új SDK/packed SI-B05 case (19 korábbi native eset nem ismétlődött).
  Külön model-consent, fake-journal tiltás, natív raw-gained receipt és egyszeri
  5 GP díj, treasury 25→20. Ez szolgáltatás; nem Businessbe szállított input.
- `20261023-212655-312-si-b05-origin-audit`: **PASS**, 0,689 s; saját v1
  contract-origin upgrade/reopen/replay/collision/immutable audit/rollback/future.
- `20261023-212951-881-si-b05-docs-final`: **PASS**, 2,602 s; roadmap 20 kész /
  következő SI-B06, helyi linkek, native case/wrapper-leltár, staged utak/format.
- A körök átfednek; nincs full-suite vagy élő LLM trajectory PASS állítás.
- Korábbi SI-B04 GitHub commit: `c4c8618c4`; SI-B03: `cfc8b3e36`; SI-B02: `15d60cac1`;
  SI-A/SI-B01/runner: `98ffcad27`.
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
