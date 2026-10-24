# Rövid fejlesztési átadás

Frissítve: 2026-10-24. Belépő, nem futási napló.
A checkboxok forrása: [feladatlista](TASKS_SOCIETY_INTEGRATION.md).

## Aktuális állapot és következő lépés

- **SI-A technikailag lezárva; SI-B01–SI-B06 és SI-C01 kész. SI-M2 v2 PASS.
  Következő: SI-C02, összesen22/45 kész. Új kérés nélkül ne kezdd el.**
- [SI-C01 pontos határ, migráció és teljes ellenőrzési index](SI_C01_NATIVE_ATTRIBUTE_XP.md),
  [páros natív eredmény és forráshashek](SI_C01_PAIRED_RESULT.json).
  Ág: `codex/si-c01-native-attribute-xp`, kiinduló commit `cef67876d`.
- Az új genesis/population membership seedelt immutable attribute/potential
  bindinget is kap ugyanabban a tranzakcióban. Exact budget/allocation/potential/
  cap policy version/digest. AgentState továbbra is v29; saját additív binding
  tábla. Training nem módosítja a profilt; régi member replay nem backfill.
- Régi profilhiány: explicit `AgentStateStore.bindCharacterAttributes` vagy
  `bun character-attributes/bind-cli.ts --agents-db PATH --agent-id ID --input creation.json`.
  A teljes validált profile/policy és creation evidence kötelező, nincs átlag-
  default vagy automatikus live import. E körben élő profilimport nem történt.
- Fishing/Cooking/Mining/Smithing actual `Player.addXp`: experiment calibration
  → diminishing → potential → global XP rate → személyes hard cap/engine limit.
  `allowMulti=false` is betartja a potential/capet. Más skill és a nem population
  avatar vanilla. Soft cap az award előtti szintből számol; facility nem írja át
  a személyes skillt. Level-1/99 és már magasabb személyes szint külön tesztelt.
- Saját receipt tábla a kanonikus Player-checkpoint DB-ben; actual before/after,
  négy számítási lépcső, activity, clock/world/lifecycle és teljes binding/policy.
  Save-byte/XP egyezés ellenőrzése és receipt insert egy checkpoint tranzakció.
  Failure/retry/reopen/nested rollback, offline pending logout és gather/kitchen
  stat+pending-evidence rollback megőrzött. Nincs új általános tranzakcióalap.
- Páros disposable actual Player workload: azonos80-ból skillenként60/100 XP,
  négy skill, nyolc natív receipt, actual Player-load és checkpoint digestei.
  Ez mechanikai kapu, nem többnapos életpálya, SI-M3/MVS vagy önfenntartás.
- Fő fájlok: `character-attributes/binding-store.ts`, `bind-cli.ts`,
  `agent-state/store.ts`/`context.ts`, engine `NativeAttributeXp.ts`,
  `PopulationDeathRuntime.ts`, `Player.ts`, `World.ts`; native gather/kitchen
  rollback fogyasztók. Natív próba: gateway `native-attribute-xp.test.ts`.
- Nincs providerhívás/költség, új world indítás, enrollment vagy publication.
  A korábbi admincím `http://127.0.0.1:7781/admin/`; az API-kulcs a **Helyi
  szerver / local-default**, aktív repo Windows titoktárában. Új runtime-indítás
  előtt aktuális állapotellenőrzés kell.
- SI-B06 korábbi kerete csak a0,05 USD-s próbára szólt;11 kérés /4235 microUSD
  =0,004235 USD, uncertain0. Normál config per-call0, auto-replanning és
  autonomousExecution kikapcsolva; B04/B05 default grant üres. Nincs általános
  költési engedély. [B06 forrás/baseline, FAIL és v2 PASS](SI_B06_STRATEGIC_ACCEPTANCE.md).

## Legfrissebb ellenőrzés

- **Teljes regresszió nem futott.** Komponenssaját profil/XP-táblák és konkrét
  award/checkpoint adapter; célzott policy/rollback/reopen/logout és packed
  fogyasztók fedik. A változatlan PASS teszteket nem ismételtük taskzárás miatt.
- `20261024-123802-533-si-c01-final-gate`: **46 PASS /0 FAIL**, benne13 natív
  eset; root/engine TS és changed-line format PASS, **37,001 s**.
- `20261024-123223-155-si-c01-consumer-repair`:53 runtime PASS, benne20 korábbi
  packed food/SDK/business consumer; a kör TS-visszatérési típus/import miatt
  még FAIL volt,50,809 s. A végső kapu ezeket javítva igazolja.
- `20261024-123017-349-si-c01-component-boundaries`: régi attribute képletek,
  framework, WorldMods/ExperimentXp/DiminishingXp PASS; teljes kör FAIL két
  régi fixture miatt,19,231 s. A v21/v24 fixture a későbbi táblákat is eltávolítja,
  a shift egy rögzített Date.now()-ból számol; assertions/termékvalidáció megmaradt.
- A korábbi bootstrap/fixture és CJS/ESM FAIL diagnosztikák megmaradtak, pontos
  index a C01 dokumentumban. A körök átfednek; PASS-ok/idők nem összeadandók.
  Full log/result: `.local/verification/`. Dokumentációs zárás nem indít runtime tesztet.

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
