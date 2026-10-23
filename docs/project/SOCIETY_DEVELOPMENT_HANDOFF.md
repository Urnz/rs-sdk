# Rövid fejlesztési átadás

Frissítve: 2026-10-23. Belépő, nem futási napló.
A checkboxok forrása: [feladatlista](TASKS_SOCIETY_INTEGRATION.md).

## Aktuális állapot és következő lépés

- **SI-A technikailag lezárva; SI-B01–SI-B04 kész. Következő: SI-B05.**
- SI-B05: együttműködés kezdeményezése typed gazdasági akciókkal. Olvasd a
  roadmap pontos consent/partner/fedezet/határidő követelményeit, majd az
  economic-contracts/settlement, Business-port és role-specific action határt.
  SI-B05–SI-B06 nyitott; új kérés nélkül ne kezdd el őket.
- [SI-B04 szerződés, grant és migráció/rollback](SI_B04_INSTITUTION_ADMISSION.md).
  `institution-strategy-runtime/policy`, `agent-state/institution-strategy`,
  Business agent-port és `business-stock-policy/selection` a fő belépők.
  Exact avatarless Business ugyanazon supervisor/inbox/queue/ledger útján
  választ policy/stock/ár/work opció-ID-t; nincs avatártool vagy Faction AI.
  **Default `config/institution-strategy.json` grantlista üres.** Explicit
  exact agent/Business/enrollment grant kell, max. 12 előre jóváhagyott opcióval.
- AgentState **v28** saját intézményi receipt; Business saját v1 selection és
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

- Ág: `codex/si-b04-institution-admission`. Élő világ/provider nem indult, csak
  eldobható fixture-ök migrálódtak. **Teljes regresszió nem futott.**
- `20261023-152525-120-si-b04-direct-consumers`: **107 fogyasztó PASS** 14 fájlban,
  majd 14 saját PASS / 2 timeout FAIL; 92,861 s. A két összesített negatív
  eset tíz külön mért esetre bontva, változatlan leaf limitekkel/assertionökkel.
  A 107 sikeres fogyasztó nem ismétlődött újra. Új selection/audit atomic PASS.
- `20261023-152749-061-si-b04-final-boundaries`: **37 PASS + root TS + engine
  TS + format**, 112,902 s. Tíz külön negatív eset, egy megszakításból helyreálló
  Business→modell→request→trade/reward eset, 24 belső natív commerce és két
  külső wrapper/backend eset. Az új ár valódi packed cserét befolyásol.
- A teljes Business-work fájl az első körben PASS; később csak az SI-B04 eset
  ismétlődött. Előző körök és javítások a B04 taskdokumentumban. A számsorok
  átfednek; nincs full-suite vagy élő LLM trajectory PASS állítás.
- `20261023-153152-327-si-b04-docs-final`: **PASS**, 1,547 s; roadmap 19 kész /
  következő SI-B05, helyi linkek, native case-leltár, staged utak/formázás.
- Korábbi SI-B03 GitHub commit: `cfc8b3e36`; SI-B02: `15d60cac1`;
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
