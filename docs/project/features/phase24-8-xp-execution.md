# Phase 24.8 – az első natív XP-számítás kötése

Dátum: 2026-10-15. Elkészült a baseline és a cohort-tag első natív
XP-számítása közti állapotellenőrzés. Az attestáció az engine XP-hookjára
vonatkozik; a későbbi Player-stat mentésére és az élő benchmarkra nem.

## A natív pont

A `Player.addXp(..., allowMulti=true)` az `applyWorldModXpAward` függvényt
hívja a játékos statjának módosítása előtt. Ehhez kapcsolódik az új
`XpExecutionStore`. A következőket rögzíti minden armed player első hívásánál:

- A saját, tényleges diminishing-XP előállapotot közvetlenül a számítás előtt.
- Az engine-ben aktív diminishing és XP-calibration mod engedélyezettségét,
  verzióját, sémáját és teljes konfigurációját kötő policy digestet.
- A skillt, script/target/régió kontextust, bemeneti XP-t és wall megfigyelést.
- A számítás utáni natív counter-pillanatképet és kimeneti XP-t.

A kiinduló cohort-snapshot a Phase 12 experiment UUID-jához és definition
digestjéhez kötött. Armkor a natív engine újraellenőrzi az expected cohort és
policy digestet. Minden playernél a saját előállapotát hasonlítja ehhez;
egy másik cohort-tag korábbi, szabályos XP-je nem okoz téves drift-hibát.

Az ellenőrzés és a számítás egy szinkron engine-hívásban történik, aszinkron
rés nélkül. Az `armed → pending → observed` eseményeket tartós napló őrzi.
A pending bejegyzés a számítás előtt commitol. A resolved outcome csak a
számítás és az utólagos snapshot sikeres ellenőrzése után kerül be.

## Szigorú kísérleti hibakezelés

- Baseline- vagy policy-drift esetén a számítás el sem indul: a hívás 0 XP-t
  ad vissza, a member `rejected`. Egy későbbi hívás nem helyettesítheti az elsőt.
- Pending-írási hiba esetén nincs XP-számítás. Ha a rejection is írhatatlan,
  nem keletkezik sikeres bizonyíték.
- Számítási/XP-hook hiba vagy outcome-mentési hiba után `pending` marad. A
  visszaadott XP 0; újraindítás után sem fut újra „elsőként” a következő hívás.
  A diminishing-counter már előreléphetett, ezért a pending nem tiszta baseline.
- Csak az armed, még nem megfigyelt első hívás kap szigorú policy-error kaput.
  Egészséges napló mellett az unarmed és a már megfigyelt playerek a normál
  XP-hookot használják, annak meglévő fail-open szabályaival.
- A nem létező journal normál játék közben nem jön létre. Meglévő, sérült vagy
  olvashatatlan journal esetén a runtime nem feltételezi, hogy egy player
  unarmed: ha nem tudja eldönteni a tagságot, 0 XP-s karanténnal jelez hibát.
  Helyreállítás teljes, ellenőrzött mentésből történik.

Az XP 0 eredménye a Player stat módosítása előtt visszatér. A journalban lévő
sikeres számítás önmagában még nem bizonyítja a későbbi stat-változást: az
XP-rate szorzó, cap, `allowMulti=false` útvonal és save-commit ezen kívül van.
Az `inputXp`/`outputXp` a hook natív engine-egysége; nem közvetlenül a
kijelzett XP-nyereség és nem GP-ben értékelt eredmény.

## Phase 12 és hosszú program

Az új gateway a natív snapshot után XP-execution portot is használ. A Phase 12
előbb létrehozza a saját, tartós experiment rekordját, majd annak UUID-jával
armolja a cohortot. Csak sikeres, friss, még nem használt arm-válasz után ad
feladatot a replan coordinatornak. Konfliktusos, régebbi vagy már fogyasztott
arm nem indíthat új dispatch-t. A cohortok natív átfedését egyedi ownership
rekordok tiltják; hibás arm tranzakciója visszagördül.

A terminal skill-reconciliation lezárja (`seal`) a natív ablakot, majd a
Phase 12 lezárt rekordjába menti a riportot. A közvetlen, azonnal lezáruló
dispatch-ág ugyanezt teszi. Egy ismeretlen/kiesett seal-port nem pótolhat
bizonyítékot: a kísérlet hibával zárul. Rejected vagy pending member sikeres
skill-journalok mellett is `failed` experimentet eredményez. XP-t nem végző
member `unobserved` marad; a futás lezárható, a bizonyíték nem complete.

Az arm és az első számítások időpontja az experiment mérési ablakához kötött.
A seal később is történhet, mert a terminális visszaigazolás után fut; ez nem
változtatja meg a számítások eredeti megfigyelési idejét.

A hosszú program riportja és összehasonlítója a Phase 12 receipt mellett a
tényleges natív XP-journalt is újraolvassa. Hiányzó forrás, eltérő digest,
sérült lánc/tail, módosított snapshot vagy ellenőrző port hiánya hibát ad.
A natív források batch-olvasása egy readonly kapcsolatot használ; nincs
riportkérésből migráció, órateremtés vagy új dispatch.

A korábbi `xpRepetitionState` mező megmarad. Az új `xpCalculationState`:

- `matching-empty-first-native-calculations`: mindkét oldalon egyező üres
  baseline, teljes natív first-call bizonyíték és ellenőrzött source backing.
  Ekkor `attestsExactFirstCalculationState=true`.
- `legacy-unattested`: régi futásoknál nincs ilyen natív bizonyíték.
- `incomplete`: legalább az egyik oldalon hiányzik a teljes, megfelelő kötés.

`attestsExactDispatchState=false`, `attestsPlayerStatCommit=false`,
`causalEffectEstablished=false`, `engineRandomStreamSeeded=false` marad.
A natív pont az első **arm utáni** XP-hook; önmagában nem igazolja, hogy az
eseményt egy adott skill-run okozta. A kontextus és az időablak ellenőrizhető,
de a kísérleti skill-journal és az engine XP-esemény közös műveletazonosítója
ebben a részfeladatban nem készült el. Nincs teljes gazdasági lefedettség vagy
önfenntartási állítás, a hat élő kezeléspár továbbra is nyitott.

## Admin protokoll és helyreállítás

Engine, saját admin token mögött:

```text
GET /api/internal/admin/xp-execution?id=<experiment UUID>
POST /api/internal/admin/xp-execution
```

Az `arm` törzse `{action:"arm",request:{experimentId,definitionDigest,cohort,
expectedCohortDigest,expectedPolicyDigest}}`. A `seal` törzse
`{action:"seal",experimentId}`. Csak a fenti pontos mezők engedélyezettek;
snapshot, outcome vagy forrásútvonal nem tölthető fel. A gateway belső portja
csak a helyi HTTP engine-t éri el, kötelező tokennel, redirect nélkül.

Gateway, admin hitelesítés mögött:

```text
GET /api/admin/society/xp-execution/<experiment UUID>
POST /api/admin/society/xp-execution/<experiment UUID>
```

A POST kizárólag explicit helyreállító seal: `{action:"seal",reason:"..."}`.
Nem armol és nem tesz megfigyeltté hiányzó vagy pending eseményt. A natív seal
idempotens; a korábbi riportot adja vissza, új head vagy időbélyeg nélkül.
A gateway auditálja a manuális lezárást.

Hálózati hiba esetén az arm válasza lehet bizonytalan. A Phase 12 nem küld új
identitással pótkísérletet, a hibás indítást failedként őrzi. A natív ownership
megmaradhat; automatikus TTL nem engedi szabadjára a cohortot. Operátor a
riport ellenőrzése és a kísérlet leállítása után seal-lel oldhatja fel. Ezután
új kísérlethez új preflight kell; a régi receiptet nem használjuk újra elsőként.

## Adatmodell, migráció és rollback

Új `.local/admin/xp-execution.sqlite`, séma 1, WAL/FULL:

- `xp_execution_run`: immutable binding, külön sequence/head és sealed marker.
- `xp_execution_event`: hash-láncos arm/pending/observed/rejected/sealed események.
- `xp_execution_player`: aktív cohort-ownership, egy player egy ablakban.

Első explicit armkor jön létre. A readonly olvasó hiányzó fájlt nullként kezel,
ismeretlen sémát elutasít. A Phase 12 két additív, nullable oszlopa:
`xp_execution_armed` és `xp_execution_json`. Null/hiányzó mezőnél a régi JSON
shape és digest változatlan; történeti bizonyítékot nem generálunk.

A diminishing counterfájl sémája változatlanul v1/v2-kompatibilis. A mod
registry verziója `1.2.0`, data schema 2. A kód aktiválásához tervezett engine-
és gateway-restart kell; a registry hot reloadja nem tölti be az új hookot.

Frissítés/rollback előtt állítsd le az írókat, mentsd együtt az XP-countert,
XP-journalt, Phase 12-t, hosszú naplót, clockot és összetartozó világforrásokat.
Rollback előtt az aktív ablakokat szabályosan sealeld, a hozzájuk tartozó
kísérleteket állítsd le/kezeld hibásként. A régi kód nem érvényesíti az új
ownership kaput: aktív ablak nem adható át neki benchmark-folytatásként.

Az új oszlopok és lezárt journal megmaradhatnak. Az új receipt ellenőrzéséhez
őrizd meg a friss olvasót; a mezők/tail törlése megváltoztatná a bizonyítékot.
Sérült vagy pending forrás nem javítható observed állapotra átírással. Teljes
visszaállítás összetartozó mentésből történik; journal-only restore nem ad
reprodukálható benchmark-kezdőállapotot.

## Ellenőrzés

A natív tesztek XP ki/be állapotot, per-player első inputot, normál útvonalat,
driftet, hibás pending/outcome írást, callback-hibát, restartot, arm replayt,
cohort-konfliktus rollbackjét, seal replayt és sérült forrás elutasítását fedik.
A két egynapos fixture 48 időablakon, 192 terminal skill-rekordon és a valódi
XP-store/journal adaptereken át ellenőrzi a comparisonig tartó láncot.
Külön teszt fut a production terminal-reconcile útvonalra és a hiányzó source
backingre. Ezek tesztórás integrációk, nem élő engine-benchmarkok.

Végleges teljes `bun run verify:full` / `bun run check`:
**1804 pass / 0 fail / 0 skip**, exit 0, root/engine/webclient TypeScript és
format PASS (`.local/verification/20261015-232255-675-full.log`). A két egynapos,
natív XP-journalt is ellenőrző fixture 13,50 másodperc alatt futott le.

Élő stack, bot, benchmark vagy migráció nem indult; `.canvas.tsx` nincs.
