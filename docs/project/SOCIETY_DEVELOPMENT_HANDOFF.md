# Rövid fejlesztési átadás

Frissítve: 2026-10-30. Checkbox-forrás: [feladatlista](TASKS_SOCIETY_INTEGRATION.md).

## Aktuális állapot

- **SI-A technikailag lezárt; SI-B01–B06 és SI-C01–C06 kész;27/45.**
  SI-C07 nyitott, preflight NO-GO; SI-M3/MVS nem PASS.
  Ág: `codex/si-c07-minimum-preflight`; C06 baseline `8b6055894`.
- A [rögzített hét csomagból](SI_C07_REMAINING_WORK.md) az1–2. kész,
  a3. közös founder-baseline folyamatban, a4–7. későbbi fázis. Öt nagy csomag maradt.
- **P2-01–P2-11:11/11 kész.** [Lista](SI_C07_PACKAGE2_CLOSURE.md),
  [natív összesítő](SI_C07_NATIVE_AGGREGATE.md). Eredeti1+7 ablak,
  egyazon applied-genesis/world/cohort/clock és193 pont:17 numeric,8 integrity,
  16 source family együtt PASS-képes. Hiány unknown, külön numeric FAIL megmarad,
  frozen readonly assessment azonos. Komponens-producer fixture, nem élő baseline.
- Collector: collection-local validated needs/dynamics/food input reuse,
  `iterateNativeIntegrationSources` core/food/housing/tools; normál sync facade
  soha nem ad részleges reportot. Korábbi vékony/frozen és eredeti50s kör PASS.

## Most elkészült a3. csomagon belül

- [Baseline-javaslat](SI_C07_FOUNDER_BASELINE.md), [jelölt](SI_C07_FOUNDER_BASELINE.json),
  [preflight](SI_C07_PREFLIGHT_RESULT.json):ugyanaz a négy founder, eredeti food/GP/harvest,
  courier Mining/Smithing1 +pickaxe/hammer, workshop0 treasury, valós property/work-surface
  és worker terv. A specifikáció readonly; közös stage nincs alkalmazva.
- Native100 kapacitásból legalább51 valódi warmup use után evaluation opening49
  lehet;49 use→broken→belső repair50→reuse49. Nem durability-átírás vagy előzetes credit.
- A régi site2 slotos, de négy tényleges packed `brownbed`419 anchor ellenőrzött:
  2973,3328 /2973,3330 /2973,3332 /2977,3332. Négy-slot fresh overlay még kell.
  Három tenant +owner-free hely; owner legal access önmagában nem rental sleep receipt.
- [Tin natív admission/verifier](SI_C07_MINING_PROCEDURE_VERIFICATION.md) kész;
  **[mindhárom eljárás tartós normál trial/review útja](SI_C07_PROCEDURE_REVIEW.md) is kész.**
  `agent-skills/trial-review.ts` a normál admin verifier/publication közös backendje.
  Exact run/admission/draft-checksum/native source +egész run-tartalom és worldId
  kötődik a meglévő approval digesthez. Átírt run/report/admission/effect, régi gate
  vagy régi natív tool-checksum új reviewt igényel. Inspect readonly, publish külön emberi.
- Két tin run most egy workspace/owner/lifecycle alatt:valódi tin,100→99→98.
  Smelt/repair két-két teljes SkillExecutor+RsSdkSkillRuntime runban tényleges
  population/Business/Property olvasót, escrowt, packed smeltet és repairt használ.
  Kontrollált mozgás/loc és deklarált sérült trial-tool, nem valós útvonal/M3-warmup.
- `society-experiments/founder-procedure-trials.ts` és
  `scripts/society-founder-trials.ts prepare|review|inspect --root TRIAL ...`:
  külön `draft-trial-only` világban idempotens három ready trial/gap. Nem indít,
  nem ad tárgyat/Business/grantet, nem publikál. Aktív population/player control kell.
- A már megfelelt trialon is elérhető a verifier gomb; a saját izolált UI-próba
  módosult reportot elutasít, normál CSRF-védett újraverify után új approvalt kér.
- **Egyik szükséges1.0.0 sem publikált:** `procedure.mining.gather-tin`,
  `procedure.metallurgy.smelt-bronze`, `procedure.tools.repair-bronze-pickaxe`.
  Nincs jóváhagyható élő publikálási csomag; a fixture-reportokra ne kérj jóváhagyást.

## Következő konkrét munka

**Friss külön native procedure-trial stage alkalmazója és tényleges útvonalas
futásai**, a most kész prepare/review/inspect normál út használatával. A három
eljárás emberi publikálása után közös founder-stage:közös genesis,4-slot overlay,
exact verified knowledge, worker-grantok, native tool opening és mind4 founder
housing/sleep útja. Ezek az eredeti3. csomag feltételei, nem új P2-pontok.
A4. ratio-próba még nem indult. Ismert NO-GO-ra hosszú futási jóváhagyást ne kérj.

## Aktuális ellenőrzési bizonyíték

- `200724-111-si-c07-p3-review-and-preparer`:7 PASS2,719s, normál tartós review,
  readonly/stale/tamper, idempotens prep és tényleges CLI.
- `200603-666-si-c07-p3-native-reviews-final`:tin natív eset +wrapper PASS5,174s;
  a parancs FAIL7,899s a másik eset sandbox capability-gap rename EPERM-jén.
- `200628-749-si-c07-p3-tool-review-native-permissions`:4 normál natív tool run,
  review/reopen/tamper PASS10,171s. A felesleges full config/catalog másolás
  elhagyva; korábbi sikeres kör25,911s volt, abból14,5s fixture cleanup.
- `201701-358-si-c07-p3-tool-review-final`:új stale native-checksum negatívval
  1 összetett natív eset +wrapper PASS11,437s.
- `201022-557-si-c07-p3-publication-final`:egy izolált UI/API publikálási
  szerződés PASS2,927s. Korai UI-hibák és diagnosztika a részletes dokumentumban.
- `201825-091-si-c07-p3-review-direct-consumers`:28 PASS8,168s;
  review/preparer/trials/approval/admin-safety/preflight és2 bootstrap-entry eset.
- `202010-097-si-c07-p3-review-artifacts`:217 aktuális source SHA, eredeti policy,
  P2-11/11,175 helyi link, egyező NO-GO artifact és formázás PASS2,620s.
- `201140-481-si-c07-p3-review-types`:root TS PASS; kombinált wrapper
  FAIL174,414s:engine behúzta a bootstrap→régi admin skill-catalog modulgráfot.
  A két változatlan state path külön data-only modulba került; bootstrap reexportálja.
  `201533-479-si-c07-p3-review-engine-types`:engine TS PASS52,179s.
- Nem full regresszió. Komponens:trial review/prep, közvetlen admin/CLI/UI és natív
  határ. Nincs új persistence-séma, clock/economic transaction alap vagy globális
  auth változás. Meglévő JSON-store atomikus rename, strict native assertion és
  külön emberi approval megmaradt. A korábbi PASS körök nem ismétlődtek ok nélkül.

## Megmaradó korlátok

- Minimum17/8 és eredeti policy SHA változatlan:
  `596720f42dd059b713ce0d075b08b9655d25413fdf7b31a8db1a86f3afa6754a`.
- Food/day-survival jelölt32 native harvest +4 opening, optimista no-burn36;
  nominális32 fogyasztás +4 closing reserve,0 headroom. Burn/elosztás/retention
  actual future native proof kell; nem növelünk készletet egy FAIL elrejtéséhez.
- Candidate1.3.0/288:1:1+7 nap névleg40 wall perc, execution-terv50perc;
  ratio nem M3-validált. Capture20+20perc, restore25perc külön IO; nincs időígéret.
- `requiredSourceInventory.selectedSources=null`, nincs konkrét C07 world/pin.
  Offline init/pin kell; nincs historical backfill vagy evidence-törlés.
  Rollback előtt stop, régi binárissal strict run nem folytatható.
- Csak helyi/private LostCity. Nincs live install/start/import/enrollment,
  promotion/publication, hosszú run vagy providerhívás. Ismert NO-GO-ra ne kérj
  hosszú futási jóváhagyást. SI-C08 nem indul. Admin korábbi címe
  `http://127.0.0.1:7781/admin/`.
- B06 engedély kizárólag a korábbi0,05USD próbára szólt:11 kérés/4235microUSD.
  Most0 kérés/0microUSD engedély; auto-replanning/autonomous execution off.
- SI-A15 technikai PASS; eredeti D1/SI-M1 önfenntartás nem PASS.
  Történeti payload DB-ket ne nyisd meg/ne módosítsd:
  `backups/si-a15-technical-20261022-1648/workspace`,
  `backups/si-a15-technical-result-20261022-1715/workspace`,
  `backups/si-a15-technical-restored-20261022-1726/workspace`.
- Éhség1nap, éhhalál7nap teljes hiány után; normál adag1nap.
  SI-C09 kalibráció nyitott; nem igazítjuk a világot a túléléshez.

`pwsh -NoProfile -File scripts/get-society-work-brief.ps1 -TaskId SI-C07`
