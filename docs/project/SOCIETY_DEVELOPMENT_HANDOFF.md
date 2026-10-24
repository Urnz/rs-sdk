# Rövid fejlesztési átadás

Frissítve: 2026-10-24. Belépő, nem futási napló.
A checkboxok forrása: [feladatlista](TASKS_SOCIETY_INTEGRATION.md).

## Aktuális állapot és következő lépés

- **SI-A technikailag lezárva; SI-B01–SI-B06 kész. SI-M2 v2 PASS.
  Következő: SI-C01, összesen 21/45 kész.** Új kérés nélkül ne kezdd el.
- [SI-B06 terv, javítások és pontos ellenőrzési index](SI_B06_STRATEGIC_ACCEPTANCE.md),
  [első valódi FAIL](SI_B06_LUNA_ATTEMPT_1.json), [külön v2 PASS](SI_B06_LUNA_ATTEMPT_2.json).
  Valódi OpenAI `gpt-6-luna`, medium: control5 GP / income-loss után másik
  contract-source4 GP / raw-scarcity native raw+1 és5 GP / önálló ajánlat,
  külön Business-consent, B03-adoption, native gather és5 GP settlement.
  A mechanika mindkét munkánál ugyanaz a Skill[], a munkaforrás tényleg változott.
- V2 source digest `34e2c8afb56fd929fcff693df588c334e9ad89595f1b086f86edb9df108d8acf`;
  run `df8b68de-ccaa-4972-b511-748a2000152a`;
  `.local/experiments/si-b06/2026-10-23T20-53-39-749Z-openai-627ef277/`.
  Az első source/baseline eltérő, az akkori FAIL nem lett átminősítve.
- Három már fedezett, stabil ID-s 5/4/3 GP-s work-source azonos baseline-ból;
  income-loss megszünteti a régi jövedelmet és kapcsolt szerződést.
  Native service = **egy natív invocation**, nem Businessbe szállított input.
  Ágonként a Player + két Business teljes GP-je70, külön readonly egyeztetve.
  A nyers outputtól a cooked-food reserve helyesen nem lesz completed.
- Javítva: csak ismert gather/cook procedure-rel rendelkező Player saját
  friss raw377 hiánya ébreszt; B05 context külön saját fundingot és limitet
  mutat; legfeljebb négy új offerhez kötött tárgyalási forduló az eredeti
  60 s cooldownnal. Scripted fixture-óra gyorsítható, a valódi ág valós időt várna.
  Request/response/negative output/audit/DB/native receipt mind megmarad;
  429 vagy bizonytalan inference után nincs automatikus újraküldés.
- Modulok: `society-experiments/strategic-acceptance.ts`,
  `scripts/run-strategic-acceptance.ts --provider scripted|openai`,
  `StrategicAcceptance.test.ts`, `native-food-skill-fixture.ts`, gateway
  `native-strategic-acceptance.test.ts`. Az utóbbi automatizáltan scripted-only.
  Manifest source/dirty diff/packed digesthez és fix config/prompthoz kötött.
- Az admin AI-form settings-loadig inert/menthetetlen; más dashboardhiba és
  bootstrap-retry nem üríti/írja felül a szerkesztést. A kulcs a **Helyi szerver /
  local-default**, az aktív repo Windows titoktárában van. Régi `test` instance
  változatlan. A teszthez indított gateway leállt; a független admin megmaradt
  `http://127.0.0.1:7781/admin/` alatt, standard start/stop metaadatokkal.
- A felhasználó 10 USD feltöltést jelzett, Luna/medium indulást és ár/érték
  döntést kért. E feladatra vállalt keret0,05 USD; ténylegesen **11 kérés /
  4235 microUSD = 0,004235 USD**, uncertain0. Cache-írási díjjal korrigált, felfelé kerekített usage-költség; ez nem általános költési engedély.
  A normál mentett config per-call kerete0, auto-replanning/autonomousExecution
  kikapcsolva; a microtrial külön fix configból, a meglévő `lostcity-local`
  budgetledgerrel futott. Kulcs nem került fájlba/logba/Gitbe vagy fixture-be.
- AgentState továbbra is **v29**; nincs új migráció. B04/B05 default grantok
  üresek, nincs live enrollment/rollout vagy új skillpublication. A kapu
  eldobható native fixture-ben végrehajtott valódi modell-elfogadás;
  nem többnapos gazdasági/MVS/önfenntartási vagy realizmuskalibrációs PASS.

## Legfrissebb ellenőrzés

- Ág: `codex/si-b06-strategic-acceptance`. **Teljes regresszió nem futott.**
- `20261023-221503-295-si-b06-final-technical`: 47 PASS + root/engine TS/format,
  94,838 s, benne a kiemelt fixture mind a húsz korábbi natív esete.
- `20261023-222122-500-si-b06-luna-real-attempt-1`: stratégiai FAIL,
  38,822 s /5 kérés /1795 microUSD, változatlanul megőrizve.
- `20261023-223105-024-si-b06-counteroffer-cooldown`: 5 native PASS, 4,521 s;
  21 B05 consumer PASS az előző funding-körben, külön form-load browser PASS.
- `20261023-225110-953-si-b06-v2-source-boundaries`: **7 PASS + root/engine
  TS/format**, 91,003 s; aktuális v2 scripted baseline és negatív source gate.
- `20261023-225338-609-si-b06-luna-real-attempt-2-v2`: **négy valódi stratégiai
  PASS**, 39,225 s /6 kérés /2046 microUSD.
- `20261023-225715-049-si-b06-v2-native-money-audit`: readonly run/contract/
  native reward és négy 70 GP-s pénzegyenlet PASS, 0,551 s.
- `20261023-230242-672-si-b06-docs-final`: dokumentáció/JSON/link/roadmap,
  staged utak és formázás PASS, 1,710 s; 21/45 kész, következő SI-C01.
- `20261024-120041-850-si-b06-cache-pricing-boundary`: cache-aware usage,
  30 közvetlen PASS + root/engine TS, 156,574 s; nincs új modellhívás.
  A 11 mentett válasz offline díja4235 microUSD; a régi3841 mellé auditált,
  idempotens394 microUSD könyvelési korrekció került a budgetledgerbe.
  A két bizonyíték `billingReconciliation` része tartalmazza; a régi source/
  verdict/report megmaradt. Egy plusz accounting admission nem API-kérés.
- A körök átfednek; teljes log/result `.local/verification/`, részletes index
  a B06 dokumentumban. A dokumentációs lezárás nem indokol új runtime tesztet.
- Korábbi B05 GitHub commit `f11021fe8`; B04 `c4c8618c4`, B03 `cfc8b3e36`,
  B02 `15d60cac1`, SI-A/B01/runner `98ffcad27`.
## Megőrzendő döntések és mentések

- SI-A15 v2 technikai elfogadás kész; eredeti D1/SI-M1 önfenntartási PASS nincs,
  teljes gazdasági minősítés `inconclusive`. SI-M2 korlátos stratégiai kapu most PASS, nem önfenntartási minősítés.
  Kontrollált mechanikai és autonóm trajectory bizonyíték nem azonos.
- Éhség/önálló ételkeresés egy nap után, éhhalál hét nap teljes hiány után;
  normál adag egy napot pótol. Live nap/óra, teszt nap/öt perc. SI-C09 nyitott
  realizmuskalibráció; a világot nem igazítottuk a karakterek túléléséhez.
- Csak helyi/private emulator. Korábbi publication-engedély csak a konkrét
  food/travel verziókra szólt, nem új publikálásra. Az SI-B06 jelenlegi, szűk providerkerete fent külön szerepel.
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
