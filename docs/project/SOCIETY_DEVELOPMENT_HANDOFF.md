# Rövid fejlesztési átadás

Frissítve: 2026-10-30. Belépő, nem futási napló.
Checkbox-forrás: [feladatlista](TASKS_SOCIETY_INTEGRATION.md).

## Aktuális állapot

- **SI-A technikailag lezárt; SI-B01–B06 és SI-C01–C06 kész;27/45.
  SI-C07 nyitott, preflight NO-GO; SI-M3/MVS nem PASS.**
  Ág: `codex/si-c07-minimum-preflight`, C06 baseline `8b6055894`.
- A [rögzített hét csomagból](SI_C07_REMAINING_WORK.md) **az1–2. kész,
  a3. folyamatban, a4–7. későbbi fázis. Öt nagy csomag maradt.**
  A korábbi ismételt „6 maradt” a nagy csomagokat keverte a belső haladással;
  a2. csomagot most ténylegesen lezártuk, nem újraszámoztuk a hátralévőket.
- **P2-01–P2-11:11/11 kész.** [Lezárási lista](SI_C07_PACKAGE2_CLOSURE.md),
  [teljes natív összesítő és hibadiagnosztika](SI_C07_NATIVE_AGGREGATE.md).
  Eredeti1+7 ablak, egyazon applied-genesis/world/cohort/clock és193 határ:
  mind17 numeric,8 integrity és16 source family együtt PASS-képes.
  Az állandó globális `qualifiesMinimum:false` zár megszűnt; kizárólag a
  complete/bound eredeti natív assessment adhat true-t. Hiány/fault unknown,
  külön igazolt numeric FAIL megmarad, frozen readonly assessment azonos.
- Ez **komponens-store/producer integrációs fixture**, nem új packed-engine
  gazdasági run, autonóm siker vagy jóváhagyott C07 baseline. A fixture
  négy ágya/készlete/rent-periódusa/sleep-rendje nem lett telepítve világra.
  A korábbi packed food és Mining→smelt→repair→reuse bizonyíték külön megmarad.
- A collector collection-local validated needs/dynamics/food inputokat használ
  újra. Minden DB-, time-, source-, hash- és custody-ellenőrzés megmaradt.
  Az új `iterateNativeIntegrationSources` core/food/housing/tools fázisait a
  normál sync facade végigolvassa, és soha nem ad részleges reportot.
  A két független facade-collection továbbra elutasít mozgó forráshalmazt.

## A felhasználó a következő feladatot is kérte

- **A3. baseline-javaslat és readonly ellenőrző elkészült, a3. csomag még nem kész.**
  [Konkrét tartalom és nyitott feltételek](SI_C07_FOUNDER_BASELINE.md),
  [jelölt](SI_C07_FOUNDER_BASELINE.json), [teljes preflight](SI_C07_PREFLIGHT_RESULT.json).
  `society-experiments/founder-baseline.ts`, `packed-housing-sites.ts`,
  `scripts/prepare-society-founder-baseline.ts`; nincs telepítési ág.
- Ugyanaz a négy founder, eredeti food/GP/harvest változatlan; courier kapna
  Mining/Smithing1 tudást, egy csákányt/hammert. Workshop Business0 treasuryvel,
  valós Property/work-surface/worker-authorization terv, validált genesis-javaslat.
  Belső érc→smelt→bar→repair→reuse; bankmásolat nem anyageredet.
- Native100 kezdeti kapacitásból **51 valódi warmup use** esetén evaluation
  opening49 lehet;49 use→broken→belső repair50→reuse49 fenntarthatja a retentiont.
  Ez stratégiai feltétel, nem durability-átírás, előre kiosztott credit vagy ratio-PASS.
- A régi site config2 slotos. A tényleges packed `brownbed`419 négy existing
  ground-floor anchorja2973,3328 /2973,3330 /2973,3332 /2977,3332; source SHA,
  ZIP CRC, loc/land/bridge decode ellenőrzött. Nincs új spawn vagy kitalált ágy.
  A friss stage-ben4 slot kell3 tenant +1 owner-free kapacitásra. Az anchor nem
  útvonal-, title-, sleep- vagy live entitlement bizonyíték; config nem alkalmazott.
- **Három exact required1.0.0 még nem verified:** `procedure.mining.gather-tin`,
  `procedure.metallurgy.smelt-bronze`, `procedure.tools.repair-bronze-pickaxe`.
  Tin0.1.0 bounded draft létrejött; smelt/repair0.1.0 korábbi draft. Nincs promotion.
  A kanonikus registry külön ellenőrzi a6 rendelkezésre álló reviewed eljárást;
  célverziót, checksumot és draft operational digestet rögzít, hiányt nem fed el.
- **Most elkészült:** [az exact tin draft acknowledged trial és canonical verifier útja](SI_C07_MINING_PROCEDURE_VERIFICATION.md).
  Két független Mining1 packed hatás, valódi tin és100→99 kopás; admission,
  dispatch, intent és lifecycle audit összekötve. ACK/XP/posted success nem elég.
  Admin és CLI verifier bekötött, publikálás előtt forrás-recheck és régi report
  elutasítása. Kontrollált mozgás/loc fixture, nem live trial vagy publication.
- **Következő konkrét munka:** a három eljárás tartós normál source-bound natív
  hitelesítése/review útja, majd fresh saját stage alkalmazó/ellenőrző útja:
  közös genesis,4 slotos existing-site overlay, exact verified knowledge és
  worker-grantok, native tool opening és mind4 founder normál housing/sleep útja.
  Az owner legal-access nem önmagában rental sleep receipt. Ezek az eredeti3.
  csomag feltételei, nem új P2-lezárási pontok. A4. ratio-próba még nem indult.

## Ellenőrzési bizonyíték

- P2 lezárási és korábbi baseline/packed-site eredmények:
  [natív összesítő](SI_C07_NATIVE_AGGREGATE.md),
  [baseline-javaslat](SI_C07_FOUNDER_BASELINE.md). P2-11 továbbra11/11.
- Aktuális P3: [natív Mining trial/verifier eredmény és korai hibák](SI_C07_MINING_PROCEDURE_VERIFICATION.md).
  `154130-497-si-c07-p3-mining-consumers`:89 PASS4,634s.
  `154058-296-si-c07-p3-tin-audit-final`:két külön Mining1→tin effect,
  negatív/readonly natív eset +wrapper PASS5,807s.
  A korábbi11 natív admission/cancel/replay eset változatlanul PASS12,791s
  a `153829-592` parancson belül; a parancs összesen FAIL az azóta javított
  új negatív teszt miatt. A11 eset nem ismétlődött szükségtelenül.
- Root TS a `154144-274` parancs első fázisában PASS; az engine TS egy JSON
  import attribute hibán FAIL, kizárólag az engine projekt ismétlődik javítás után.
- Nincs full regresszió: scoped Mining trial/verifier, közvetlen skill/admin
  fogyasztók és packed natív határ. Nincs shared persistence/clock/economic
  transaction alapváltozás. A globális szerepkör/engedélyezési modell változatlan.

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

## Végső ellenőrzés

- `154346-541-si-c07-p3-engine-types`:engine TS PASS50,717s; root TS az
  előző kombinált parancsban már PASS, nem ismétlődött a JSON-import javítása miatt.
- `154542-304-si-c07-p3-artifacts-and-admin`:209 aktuális source SHA és
  változatlan eredeti policy/NO-GO artifact, további14 admin/preflight teszt PASS.
  A wrapper egy dokumentum EOF-formázási hibáján FAIL; az javítva.
- `154639-824-si-c07-p3-final-artifacts-format`:artifact/link/format
  PASS1,368s. Runtime a dokumentációs javítás miatt nem ismétlődött.
