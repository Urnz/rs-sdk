# Rövid fejlesztési átadás

Frissítve: 2026-10-22. Ez a következő munkamenet belépője, nem futási napló.
A checkboxok forrása: [feladatlista](TASKS_SOCIETY_INTEGRATION.md).

## Aktuális állapot és következő lépés

- **SI-A technikai fejezet lezárva. SI-B01 kész; következő SI-B02.**
- [SI-B01 scope, migráció, rollback és korlátok](SI_B01_OBSERVER_CONTEXT.md).
  SI-B02–SI-B06 nyitott; új kérés nélkül ne kezdd el őket.
- Következő fejlesztési kérésre SI-B02: natív evidence-alapú állapotpredikátumok
  és korlátos tervelfogadás. Először az `agent-state/` goal/store/planner,
  `llm-runtime/` validator és replan/authorization határt olvasd.
- SI-B01 fő fájlok: `agent-state/economic-context.ts`,
  `server/gateway/admin/economic-observer-source.ts`, `replan-inbox.ts`,
  `domain-event-recovery.ts`, `agent-state.ts`, `admin-decision-context.ts`.
  Inbox schema v4: cursor/admission/latch/cooldown közös tranzakció; új
  pénzügyi authority nincs. A source/observer adat nem átadásbizonyíték.
- **SI-A13 wrapper javítva, mind a tíz natív próba célzottan PASS.**
  [Időmérések, résznapló és a külön kapuzott próbák](SI_A13_RUNNER_DIAGNOSTICS.md).
  A korábbi 120 s-os timeout pontos belső helye nem visszaállítható; az akkori
  wrapper a kimenetet a child-exitig visszatartotta. Most folyamatos résznapló,
  változatlan belső limitek és esetenként külön watchdog/cleanup van.
- **Ne indíts automatikusan teljes regressziót a következő SI-task végén.**
  Az [ellenőrzési policy](VERIFICATION_POLICY.md) és `AGENTS.override.md`
  pontosítva: saját additív tábla/közös DB-fájl/user_version önmagában nem full-trigger.
  Konkrét közös invariáns és a célzott kör elégtelenségének indoka kell.
  Megszakadt full független maradékát se futtasd végig automatikusan.
- DEV-I01 nyitott: változatlan runtime-csomag és elkülönített világállapot;
  mérési/kompatibilitási feltételei a munkarendben. Nem SI-B01 előfeltétel.

## Megőrzendő döntések

- SI-A15 v2 technikai elfogadás kész; eredeti D1/SI-M1 önfenntartási PASS nincs.
  A teljes időablak gazdasági minősítése `inconclusive`.
- A mechanikák kontrollált natív próbái és az autonóm trajectory külön
  bizonyítékok. Az autonóm világ nem lett önfenntartó; a döntési/együttműködési
  hiányt nem szabad automatikusan paraméterhibának minősíteni.
- Egy nap után éhség/önálló ételkeresés, hét nap teljes hiány után éhhalál;
  egy normál adag egy napot pótol. Éles világ: nap/óra; teszt: nap/öt perc.
- SI-C09 későbbi, nyitott kalibráció: a részleges szimuláció valósághűsége
  a cél, nem a világ hozzáigazítása a jelenlegi karakterek túléléséhez.
- Csak helyi/private emulator. A korábbi publication-engedélyek konkrét
  food/travel verziókra szóltak, nem tetszőleges új publikálásra vagy költésre.

## Bizonyítékok és futtatási állapot

- Legújabb ág: `codex/si-a13-native-test-diagnostics`; korábbi munkafa megőrizve.
  Ebben a javításban **nem futott teljes regresszió** és gazdasági runtime nem változott.
- SI-A13 eredeti 120 s-os kapu, már streaming időméréssel:
  `20261022-234138-335-si-a13-streaming-original-budget`, **13 PASS**, 41,505 s.
- Végső tíz elkülönített case + runner-hibapróbák + másik native adapter:
  `20261022-234648-617-si-a13-isolated-cases-and-runner`, **34 PASS**, 99,950 s;
  tíz natív body, változatlan 90 assertion. Egy leaf 1 ms-os watchdogjának
  szándékos hibája a runner unit-próba elvárt eredménye, nem natív acceptance.
- Root TS sikeres a `20261022-234847-465-si-a13-affected-types-format` körben;
  az új mérőwrapper engine típusannotációját javítani kellett. Ezután csak a
  hibás engine TS + format ismétlődött:
  `20261022-235222-734-si-a13-engine-types-final`, **PASS**, 41,116 s.
  Részletek és időmérési index: [runner-jegyzőkönyv](SI_A13_RUNNER_DIAGNOSTICS.md).
- SI-B01 feature ág: `codex/si-b01-observer-context`; korábbi munkafa megőrizve.
  Élő világ/LLM-provider nem indult; a próbák eldobható fixture-ökön futottak.
- Érintett modulok/kapcsolódások: `20261022-225140-936-si-b01-final-module-boundaries-types`,
  **200 PASS + root TS + format**, 149,984 s.
- Szerződésátmenet: `20261022-225837-334-si-b01-contract-boundary-final`,
  **19 PASS + root TS**, 18,760 s.
- Végső stale/future pénzügyi kontextus és hiányos snapshot guard:
  `20261022-231023-979-si-b01-context-final-confirmation`,
  **18 PASS + root TS + format**, 53,465 s. A korábbi 197 tesztes körből 196
  sikeres volt; az egy hibás snapshot-határ és az asset időfixture javítva.
- Teljes regresszió a közös inbox migrációja miatt egyszer:
  `20261022-223247-306-full`, **1636 PASS / 2 FAIL**, 1041,829 s.
  A standing purchase próba a 200 tesztes célzott körben PASS. A korabeli
  SI-A13 wrapper-timeoutot a fent linkelt későbbi javítás váltja fel; full nem ismétlődött.
- Natív prefix + eredeti regresszió első maradéka:
  `20261022-225948-406-si-b01-native-prefix-and-remaining`, **197 PASS / 1 FAIL**,
  123,628 s; native genesis/replay PASS, viteldíj-metrika 5 s timeout.
  Külön viteldíjpróba és minden további eredeti modul:
  `20261022-230230-391-si-b01-fare-diagnostic-and-remaining`, **520 PASS**, 215,125 s.
  Ez nem írja át a teljes kör FAIL-jét; a körök tesztszámai átfednek.
- A logok/result JSON-ok `.local/verification/` alatt vannak. Korai sandboxos
  fájljogosultsági/Bun-indítási hibák és javított tesztfixture-hibák megmaradtak;
  részletek: [progress](SOCIETY_INTEGRATION_PROGRESS.md). Időlimitet/assertiont
  nem gyengítettünk. Közös sémán a teljes kör után nem változtattunk; a későbbi
  context- és guard-pontosításokat célzottan ellenőriztük.
- [SI-A15 végső eredmény](SI_A15_TECHNICAL_RESULT.md) és
  [archívum/restore](SI_A15_RESULT_ARCHIVE.md): ezekből keresd a részleteket.
- Legutóbbi SI-A15 teljes regresszió: `20261022-120530-305-si-a15-native-fare-and-profile-archives-full-retry`,
  PASS, 960,314 s. Későbbi pontos SDK-megérkezés: 17 célzott PASS, root TS,
  formázás, 55,597 s. Az új fejlesztéshez a relevanciájukat újra értékelni kell.
- Végső autonóm világ: `backups/si-a15-technical-20261022-1648/workspace`.
  Result: `backups/si-a15-technical-result-20261022-1715/workspace`.
  Restore: `backups/si-a15-technical-restored-20261022-1726/workspace`.
- A lezáráskor minden érintett runtime leállt; újraindítás előtt aktuális
  állapotellenőrzés kell. Az immutable result payload adatbázisait ne nyisd meg.
- Korábbi tooling-ellenőrzés: `20261022-213118-694-society-workflow-final-check`,
  PASS, 2,757 s: helper próbák, skill-validator, roadmap/link/formázás.
  [Részletek és megőrzött sikertelen próbák](SOCIETY_INTEGRATION_PROGRESS.md).
  Nem új SI-A15 runtime-regresszió; a gépi fejléc a lenti paranccsal kérhető le.

```powershell
pwsh -NoProfile -File scripts/get-society-work-brief.ps1
```

Munkarend: [rövid szabályok és tooling-hátralék](SOCIETY_DEVELOPMENT_WORKFLOW.md).
Új beszélgetésben a repository utasításai erre a fájlra és a repo-local skillre
irányítanak; a folytonosság fájlokból áll helyre, nem beszélgetési emlékezetből.
