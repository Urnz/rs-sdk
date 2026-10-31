# Rövid fejlesztési átadás

Frissítve: 2026-10-31. Checkbox-forrás: [feladatlista](TASKS_SOCIETY_INTEGRATION.md).

## Aktuális állapot

- **SI-A technikailag lezárt; SI-B01–B06 és SI-C01–C06 kész;27/45.**
  SI-C07 nyitott, preflight NO-GO; SI-M3/MVS nem PASS.
  Ág: `codex/si-c07-minimum-preflight`; C06 baseline `8b6055894`.
- A [rögzített hét csomagból](SI_C07_REMAINING_WORK.md) az1–2. kész,
  a3. közös founder-baseline folyamatban, a4–7. későbbi fázis. Öt nagy csomag maradt.
- **P2-01–P2-11:11/11 kész.** [Lista](SI_C07_PACKAGE2_CLOSURE.md),
  [natív összesítő](SI_C07_NATIVE_AGGREGATE.md). Ugyanazon eredeti1+7 frame-en,
  applied-genesis/world/cohort/clock és193 ponttal17 numeric,8 integrity,
  16 source family együtt PASS-képes. Hiány unknown, külön numeric FAIL megmarad;
  frozen readonly azonos. Komponens-producer fixture, nem élő baseline.

## A3. csomag aktuális konkrét eredménye

- [Baseline-jelölt](SI_C07_FOUNDER_BASELINE.md): ugyanaz a négy founder,
  eredeti food/GP/harvest, courier Mining/Smithing1, pickaxe/hammer és workshop-terv.
  A specifikáció a publikálás után definition-ready; a közös founder-stage még nincs telepítve. Négy packed bed anchor megvan,
  four-slot overlay és mind4 founder valódi housing/sleep útja még kell.
- [Normál prepare/run/review/inspect](SI_C07_PROCEDURE_REVIEW.md) kész;
  exact admission/draft-checksum/run/native effect és world kötés, readonly újranyitás,
  külön emberi publication approval. A három szükséges1.0.0 már jóváhagyott és publikált.
- **[Valódi külön native trial-stage és mért futások](SI_C07_FOUNDER_TRIAL_STAGE.md)**:
  új-only fixture/application, valódi packed furnace/anvil, workshop/worker/property,
  natív tool opening, saját loopback engine/gateway/Lite, normál SDK/SkillExecutor.
  Provider/autonomy/builder off; résznaplók és bounded start/run/stop/review.
- A/B/C/D saját próbavilágok megőrzöttek. Feltárt és javított hibák:
  non-stackable inventory summary; blokkolt rock-center/korai szomszéd-megérkezés;
  p_oploc dispatch elvesztése és late output; ugyanazon tick admission timestamp;
  belső folytatás nem új cohort-ingress. Strict ledger/assertion/clock alap nem lazult.
- E-világban két tényleges, nem seedelt tin run PASS az új60s drafttal:
  `3b80a7c8-48ac-457e-8203-5908dad89a98`, `5486eda6-ea8b-487a-9e11-7ee6474688d6`.
  A második56,801s. A korábbi15s túl rövid keret indoka és korlátai a trial-dokuban;
  normál Mining default15s, eljárás120s maradt. Régi checksumú run nem címkézhető át.
- E-smelt valódi útvonala sikerült3225,3255-ig, de run
  `8cea2245-a38b-4335-9953-4677d4df4a15` FAIL: a gateway population-extra mezőket
  is a hatmezős native ownerrel vetett össze. A gateway execute-határ javítva;
  az E readonly reconciliation szerint paused/progress0/workTicks0 és held escrow megmaradt.
- **F-világ tényleges lánca KÉSZ:**6 normál SDK/Lite run és3 tartós review PASS,
  readonly inspect után azonos native DB SHA. [Rövid publikálási előnézet](SI_C07_FOUNDER_PUBLICATION_REVIEW.md),
  [teljes kötés/definition](SI_C07_FOUNDER_TRIAL_RESULT.json).
  Workspace `backups/si-c07-founder-trials-20261031-f/workspace`, paused/stopped.
  Tin13,254/11,130s, smelt40,159/1,938s, repair55,166/2,918s; teljes kör247,132s.
  Két mined, két smelted, két repaired effect; ugyanazon tool használható durability50/revision7.
  Az1.0.0-kat a felhasználó külön jóváhagyta: „Jóváhagyom mindhárom publikálását”.
  [Publikálási nyugta](SI_C07_FOUNDER_PUBLICATION_RESULT.json):három normál admin201,
  FileSkillStore shared save, published trial/verified gap és azonos közös katalógusbejegyzés.
  Az eredeti előnézet/hat run/forrás és a natív DB SHA változatlan. A háttér poison-timer
  meglévő work-lock guardon történt elutasítása az előnézetben megőrzött.
  A repair trialhoz külön deklarált sérült saját tool kell, nem Mining/warmup-credit.
  Minden trial `qualifiesMinimum:false`; a valódi warmup51+ native use későbbi feltétel.

## Következő konkrét munka

**Közös founder-stage alkalmazója és vékony natív ellenőrzése:** közös genesis,
4-slot overlay, az immár publikált exact verified knowledge, worker grantok,
native tool opening és mind4 housing/sleep. Publication újraengedélyezése nem kell:
a három exact előnézet jóváhagyása és végrehajtása kész. A sikertelen világok és
az E-WIP megmaradnak; nincs source-átírás vagy régi run átminősítés. Az eredeti3. csomag
feltételei; nem új P2-lista. A4. ratio-próba és a hosszú C07 run még nem indul.

## Aktuális ellenőrzési bizonyíték

A teljes történet és korábbi FAIL-ek a trial-dokuban; logok `.local/verification/`.

- `20261030-205953-322-si-c07-p3-native-summary-contract`:12 PASS2,751s,
  actual save/reload és generic genesis consumer. Bootstrapok utána PASS.
- `211858-970-si-c07-p3-mining-native-boundaries`:17 natív eset +3 wrapper PASS18,322s.
- `212054-771-si-c07-p3-mining-neighbour-final`:26 PASS2,686s.
- `212614-620-si-c07-p3-mining-same-tick-fixed`:13 PASS6,516s,
  valós command→player sorrend és változatlan strict demand ledger.
- `213031-305-si-c07-p3-tin-bounded-cadence`:17 PASS7,375s, exact60s trial és review.
- `20261031-011705-097-si-c07-p3-tool-owner-boundary`:15 PASS13,575s,
  valódi population-extra mezőkkel négy smelt/repair run, review/reopen/tamper,
  és a közvetlen natív gateway/work fogyasztók.
- `20261031-011802-959-si-c07-p3-continuation-coverage-repro`:szűk FAIL6,189s,
  egy ingress helyett9; belső p_oploc folytatás megfigyelőhibája. Javítás után
  `011821-011-si-c07-p3-continuation-consumers-final`:32 PASS17,939s.
- Root TS a runnerrel `20261030-212000-028` PASS84,734s; engine `212141-572`
  PASS66,199s. Végső root TS a runnerrel `20261031-012509-794` PASS20,632s;
  végső engine `012641-707` PASS17,783s. A runner kimerült-budget cleanup
  őrfeltételének apró változtatása után csak a root ismétlődött:
  `013054-895-si-c07-p3-runner-budget-types` PASS18,135s. Ekkor már létrehozott
  gyermekfolyamat sem maradhat a kimerült keret mögött.
- F native stage `011944-843` PASS16,489s; tényleges lánc `012020-892`
  PASS247,132s; readonly review/export `012454-521` PASS0,990s,
  runtime-diagnosztikás export `012618-466` PASS0,977s.
- `012728-719-si-c07-p3-founder-final-artifacts`:10 PASS5,486s,
  aktuális source SHA, baseline/preflight egyezés, policy/P2/link/formázás.
- `013242-366` source/preflight frissítés PASS1,260s; `013425-904`
  végső staged review PASS1,504s:három exact proposal/report, hat változatlan run,
  aktuális native DB SHA, előnézet-digest és minden helyi link/formázás egyezik.
- Jóváhagyás utáni offline/exact review `20261031-013919-506` PASS2,901s;
  normál publikálás `013953-522` PASS1,235s:három admin201 és azonos catalog-export,
  native DB változatlan,0 világindítás/0 provider. Nem ismételtük a6 élő futást.
- `014110-017-si-c07-p3-published-procedure-consumers`:11 közvetlen teszt és root TS
  PASS23,960s. Hiányzó publikált verziókkal a draft negatív próbája megmaradt;
  definition-ready nem install/run authority. Engine-kód nem változott, nem ismétlődött.
- `014358-451` publication artifact/hash/link/formázás PASS2,105s;
  `014519-440` tényleges readback PASS0,773s:három exact FileSkillStore/catalog
  definition, published trial/verified gap, egy-egy publish audit, érvényes lánc,
  unchanged native DB SHA és paused clock. A nyugta audit-entry/head hasheket is őriz.
- Nem full regresszió: owned trial/bootstrap/SDK/native Mining és tool gateway
  fogyasztók. Nincs új közös persistence/transaction/clock/economic alap vagy
  globális authorization-változás. Full csak a verification policy konkrét okaival.

## Megmaradó korlátok

- Minimum17/8 és eredeti policy SHA változatlan:
  `596720f42dd059b713ce0d075b08b9655d25413fdf7b31a8db1a86f3afa6754a`.
- Food:32 harvest +4 opening, optimista36;32 fogyasztás +4 reserve,0 headroom.
  Burn/elosztás/retention valódi jövőbeli proof kell. Nincs készletnövelés FAIL elrejtésére.
- Candidate1.3.0/288:1:1+7 nap névleg40 wall perc, terv50perc; ratio nem M3-validált.
  Capture20+20perc, restore25perc külön IO; nincs időígéret.
- `requiredSourceInventory.selectedSources=null`, nincs C07 world/pin; offline init kell.
  Nincs historical backfill/evidence-törlés. Régi binárissal strict run nem folytatható.
- Csak helyi/private LostCity. A saját eldobható trial start/install engedélyezett;
  a három konkrét1.0.0 publication jóváhagyva/végrehajtva; nincs valódi közös
  baseline alkalmazva, hosszú run vagy providerhívás jóváhagyva.
  Ismert NO-GO-ra ne kérj hosszú futási jóváhagyást. SI-C08 nem indul.
  Admin korábbi címe `http://127.0.0.1:7781/admin/`.
- B06 korábbi0,05USD engedélye nem öröklődik; most0 API-kérés/0 költség.
- SI-A15 technikai PASS; eredeti D1/SI-M1 önfenntartás nem PASS. Tiltott historical DB-k:
  `backups/si-a15-technical-20261022-1648/workspace`,
  `backups/si-a15-technical-result-20261022-1715/workspace`,
  `backups/si-a15-technical-restored-20261022-1726/workspace`.
- Éhség1nap, éhhalál7nap teljes hiány után; normál adag1nap. SI-C09 kalibráció nyitott.

`pwsh -NoProfile -File scripts/get-society-work-brief.ps1 -TaskId SI-C07`
