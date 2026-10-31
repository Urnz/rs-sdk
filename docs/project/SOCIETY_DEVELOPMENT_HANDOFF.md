# Rövid fejlesztési átadás

Frissítve: 2026-10-31. Checkbox-forrás: [feladatlista](TASKS_SOCIETY_INTEGRATION.md).

## Aktuális állapot

- **SI-A technikailag lezárt; SI-B01–B06 és SI-C01–C06 kész;27/45.**
  SI-C07 nyitott, preflight NO-GO; SI-M3/MVS nem PASS.
  Ág: `codex/si-c07-minimum-preflight`; C06 baseline `8b6055894`.
- A [rögzített hét csomagból](SI_C07_REMAINING_WORK.md) **az1–3. kész**.
  Négy nagy csomag maradt,4–7; következő a4. natív időarány-validálás.
- P2 implementáció [11/11 kész](SI_C07_PACKAGE2_CLOSURE.md): ugyanazon eredeti
  1+7 frame-en mind17 numeric,8 integrity és16 source family együtt PASS-képes.
  A [komponens-producer eredmény](SI_C07_NATIVE_AGGREGATE.md) nem élő gazdasági run.

## A3. csomag lezárt eredménye

- [Közös founder-jelölt](SI_C07_FOUNDER_BASELINE.md), normál audited genesis,
  eredeti négy alapító/food/GP/harvest/XP/pozíció/288:1 clock; kilenc learned exact
  verified pin, bronze pickaxe/hammer, üres0 GP workshop, worker/property/grant.
  [Offline stage és readonly seal](SI_C07_COMMON_FOUNDER_STAGE.md) kész.
- [Három utility1.0.0 normál trial/review](SI_C07_FOUNDER_TRIAL_STAGE.md):
  hat valódi SDK/Lite run és három tartós review PASS a külön F-világban.
  A felhasználó mindhárom publikálását külön jóváhagyta; a [normál publication](SI_C07_FOUNDER_PUBLICATION_RESULT.json)
  végrehajtva. Nem kell új publikálási engedély. A deklarált trial tool-damage
  nem Mining/warmup/maintenance-credit a későbbi gazdaságban. E-WIP és A–F trialok megmaradtak.
- [Owner saját free-slot/sleep/observer](SI_C07_OWNER_SLEEP.md) kész: nincs
  self-rent vagy GP-transzfer, aktuális entitlement/lifecycle/title/policy/expiry/
  pozíció ellenőrzés és tartós witness. Paid/owner/legacy kizárás és fogyasztók teszteltek.
- **[Négy founder valódi lakhatási próbája](SI_C07_FOUNDER_HOUSING_TRIAL.md) PASS**:
  három normál500 GP rent/prepaid tenancy és exact published travel, egy owner
  reservation, négy stabil fizikai bed-arrival és natív sleep witness.
  E-live241,609s; clean stopped/paused. [Kétszeri readonly natív eredmény](SI_C07_FOUNDER_HOUSING_RESULT.json)
  PASS1,418s: aktuális négy entitlement, eredeti lifecycle, PlayerTime és save;
  két30 GP ferry sink, actor GP2740. Négy étel, kitchen1000/reserved0 és tool100
  megmaradt,0 food/harvest/tool-use. DB és minden nem üres WAL változatlan;
  SHM és0 bájtos WAL metadata explicit kizárás, frozen source SHA-k egyeznek.

## Következő konkrét munka: a4. natív ratio-validálás

Új kérésre rövid, konkrét terv a288:1 simulation-clock és a változatlan content
Tick/utazás/Mining/harvest/cooking/meal/needs/work-credit ütemek összevetésére.
A baseline-jelöltben leírt51 tényleges warmup tool-use-hoz és a későbbi belső
Mining→smelt→repair→reuse lánchoz mérhető időkeret kell. Ne kezdd rögtön hosszú
C07 gazdasági futással. Használd a meglévő megfelelő saját stage-et szűk
olvasási/diagnosztikai célra; source-bound futáshoz új, aktuális frozen stage kell.
Maxwall/stop/hipotézis és olcsó előfeltétel előzze meg a natív kört. Provider off.
Az eredeti minimum17/8, névsor, tartalékok és opening nem lazítható a ratio miatt.
A végső teljes-source baseline kiválasztása, SI-A14 és konkrét futási jóváhagyás
az5. csomag.6: külön jóváhagyott1+7 run;7: archiválás/restore/értékelés. SI-C08 nem indul.

## Megőrzendő világok és bizonyítékok

- Érintetlen sealed opening: `backups/si-c07-common-founder-20261031/workspace`.
  Genesis `e22500724a65ba428557a2eb3e6ee178df8330cd9f79cb29af32c7292348ed43`,
  seal `5ae0358e746a98beb14d5344444109088f617155a4448fc2f07a84b2b54884fe`,
  tool `d26a50b9-140f-4b6a-8324-ccba5d840d59`.0 paid/sleep/warmup use.
- Sikeres housing: `backups/si-c07-founder-housing-20261031-e/workspace`, paused.
  Source `13ad7cd0d6dec734ea3ac83a4ea6772f52b5825cbc00167126015549317d65f4`,
  seal `57db7a1c75f24332566be5d85f857e23d9b7b3d750c13c33e4bcca2ca6c63e40`,
  setup `5d7a89ee0bf75c83f623c9fe4f97571ab11cec1eac82dae97493e0023940e45e`.
  Result `d017794de20215782eb7c88654604086bcfbdbd11beb27437497104135cc5c29`.
- A–E housing klónok fixture1.4.0/world ID-ja determinisztikusan azonos lehet:
  `srv-0c8d5093-61c9-469f-8751-07152f4ea6d4`. Workspace+source+setup+operation
  együtt azonosít. A/B/C FAIL megőrzött, D külön owner→bed-4 mozgásdiagnosztika.
  E PASS nem relabel. Mind packed-founder-stage-v1, finalBaselineEligible:false;
  fixture alapján is kizártak a végső baseline/result capture-ből.
- A-hiba: parent GATEWAY_URL hiány,0 admission; B: blokkolt nyugati bed-mező;
  C: SDK arrival után maradó mozgás, native save két mezőnyire,3 sleep/FAIL.
  Guard nem lazult. D SDK+native save stabil-stop PASS38,055s. Lite current-tile
  MOVE_GAMECLICK most elküldi a meglévő natív stop útvonalat; OPCLICK gyorsút maradt.
  Részletes mérés/hiba/azonosság a [housing-tervben](SI_C07_FOUNDER_HOUSING_TRIAL.md).

## Aktuális ellenőrzés és korlátok

- `20261031-130838-254`:5 housing-regresszió és root/script TS PASS67,926s.
- `131100-064`:2 socket/cache nélküli Lite packet-eset + webclient TS PASS27,360s.
- `131620-378`:négy founder E-live PASS241,609s; `132028-574`:frozen readonly reader PASS1,418s.
- `132051-115`:3 közvetlen minimum-preflight teszt és végső root/script TS PASS51,734s.
  Összesen10 különböző célzott teszt; ismételt PASS nem új eset. Full nem futott:
  nincs közös transaction/migration/clock/economic alap vagy globális authorization-változás.
- `132355-182`:artifact/policy/link/formázás PASS3,030s:244 aktuális source SHA,
  baseline/preflight egyezés, eredeti policy/P2 és236 helyi link. A régi sealed
  common opening26 natív fájlja és exact derived fixture változatlan.
- Minimum/policy SHA változatlan:
  `596720f42dd059b713ce0d075b08b9655d25413fdf7b31a8db1a86f3afa6754a`.
  Food32 harvest+4 opening, optimista36;32 consumption+4 reserve,0 headroom.
  Burn/elosztás/retention és teljes warmup/use/maintenance/reuse későbbi bizonyíték.
- 288:1 névleg1+7 nap40 wall perc; ratio még nem M3-validált.
  Required source selection/world/baseline pin továbbra null. Nincs történeti backfill.
- Csak helyi/private LostCity. Provider0/0 USD; a B06 korábbi0,05 USD engedélye
  nem öröklődik. Hosszú C07 run nincs jóváhagyva; ismert NO-GO-ra ne kérj jóváhagyást.
- SI-A15 technikai PASS, eredeti D1/SI-M1 önfenntartás nem PASS. Tiltott történeti DB-rootok:
  `backups/si-a15-technical-20261022-1648/workspace`,
  `backups/si-a15-technical-result-20261022-1715/workspace`,
  `backups/si-a15-technical-restored-20261022-1726/workspace`.
- Éhség1nap, éhhalál7nap teljes hiány után; normál adag1nap. SI-C09 kalibráció nyitott.
  Admin korábbi címe `http://127.0.0.1:7781/admin/`.

`pwsh -NoProfile -File scripts/get-society-work-brief.ps1 -TaskId SI-C07`
