# Fejlesztői segédek

Minden parancsot a repozitórium gyökeréből futtass PowerShellben. A segédek csak
az általuk létrehozott és PID + indulási idő alapján azonosított folyamatokat
állítják le.

## Helyi stack

- `bun run local:start` – a normál helyi profil: autentikált gateway, engine,
  Thieving eseményfeldolgozó és az egyetlen automatikusan felismerhető helyi bot.
- `pwsh -File scripts/start-local.ps1` – alacsony szintű indító gatewayhez, engine-hez
  és az egyetlen automatikusan felismerhető helyi bothoz; az opcionális komponenseket
  explicit kapcsolókkal kell kérni.
- `pwsh -File scripts/start-local.ps1 -BotNames VRCopper1,VRCopper2,VRIron1` –
  több bot egyetlen kezelt stackben, közös health- és PID-nyilvántartással.
- `pwsh -File scripts/start-local.ps1 -FixturePath config/fixtures/varrock-proto-v1.json` –
  a verziózott fixture manifest `players[].username` listájának teljes indítása. A
  manifest nem tartalmazhat hitelesítő adatot; minden bot a saját ignorált
  `bots/<név>/bot.env` fájlját használja.
- `pwsh -File scripts/start-local.ps1 -NoBot` – csak gateway és engine.
- `pwsh -File scripts/status-local.ps1 -Json` – engine, webclient, gateway és a
  kezelt bot egészségállapota.
- `pwsh -File scripts/stop-local.ps1` – a kezelt folyamatok fordított sorrendű
  leállítása.
- `pwsh -File scripts/smoke-local.ps1` – állapotellenőrzés és egy valódi botművelet.

Önálló admin: `bun run admin:start`, majd `http://127.0.0.1:7781/admin/`.
Leállítás: `bun run admin:stop`; előtérben `bun run admin:serve`.
Az admin a játékstack és a gateway leállítása közben is elérhető, külön
`.local/control-plane` folyamatregiszterrel. Kapcsolatállapot és automatikus
újracsatlakozás: [Phase 25.1](../docs/project/features/phase25-1-admin-control-plane.md).

A futó gateway kompatibilis közvetlen botadminisztrációs és gazdasági felülete:
`http://localhost:7780/admin/`. Innen a mentett és online botok szűrhetők,
részletesen megnyithatók, spawnolhatók/despawnolhatók, és kísérleti snapshot is
készíthető. Minden módosításhoz indoklás szükséges.

Az indítási állapot a `.local/runtime.json`, a naplók pedig a
`.local/logs/<run-id>/` könyvtárba kerülnek. Mindkettő ki van zárva a Gitből.
A runtime v2 állapot a teljes `botNames` listát és a fixture hivatkozását is
rögzíti; a status csak akkor egészséges, ha minden kiválasztott avatar friss és
játékban van. A gateway startup reconciliation rövid türelmi időt kap, hogy a
launcher által indított botokat adoptálja, ne indítson velük párhuzamos példányt.

## Gazdasági függőségi gráf

`bun run economy:dependencies --from 2030-01-01T00:00:00.000Z --to 2030-01-02T00:00:00.000Z --basis wall`
csak olvasó JSON-riportot készít a natív trade és auditált Business WIP
termelés alapján. Szimulációs időhöz `--basis simulation --clock-id <id>
--clock-profile-digest <digest>` szükséges. A hiányzó forrás nem válik üres,
bizonyított gazdasággá, és a parancs nem hoz létre adatbázist.

Források, időablakok és migration/rollback:
[Phase 24.5](../docs/project/features/phase24-5-economic-dependency.md).

A `--risk` kapcsoló ugyanebből a hiteles gráfból termékenkénti koncentrációt,
megfigyelt láncmélységet, egyetlen termelőtől függő termékjelölteket és feltételes
agent/Business/termék-kiesési forgatókönyveket számol. A jelentés nem előrejelzés;
a hiányzó lotkapcsolatokat nem pótolja feltételezésekkel.
[Phase 24.6](../docs/project/features/phase24-6-economic-risk.md).

## Hosszú, kontrollált kísérleti programok

`bun run society:experiment --command prepare --plan .local/long-plan.json`
rögzíti a meglévő natív genesis, founder, attribute-input, policy és Phase 12
avatar/cél baseline digestjeit. A `start --plan ... --run` és a
`step --id ... --run` véges bemelegítési/mérési programot koordinál a meglévő
Phase 12 dispatch fölött. A `report --id ...` csak olvas; a `stop --id ...
--reason ...` új ciklust már nem indít, de a korábban indított skilleket nem öli
meg. A parancsok nem indítják el a helyi stacket vagy botokat.

A completed státusz a futási protokoll teljesülése; nem önellátási minősítés.
Az attribute-inputok engine-oldali alkalmazása és a teljes engine RNG seedelése
nem igazolt a Phase 12 adapterrel. Tervminta, használat, bizonyítékhatárok és
migration/rollback: [Phase 24.7](../docs/project/features/phase24-7-long-experiments.md).

## Minőségi kapuk

- `bun test <érintett-pathok>` – célzott ellenőrzés a lenti wrapperrel.
- `bun run test` – széles alapcsomag. A korábbi, ezzel azonos `test:quick`
  alias megszűnt; a modulok saját `test:<modul>` parancsai megmaradtak.
- `bun run test:integration` – futó helyi komponensek HTTP- és MIME-ellenőrzése.
- `bun run test:smoke` – a teljes stack és egy botakció ellenőrzése.
- `bun run check` – formázási ellenőrzés, három typecheck és a teljes tesztcsomag,
  beleértve az offline player-save adminolvasó tesztjeit.
- `bun run test:powershell` – minden PowerShell segéd szintaktikai ellenőrzése.

### Kompakt, blokkoló ellenőrzés

Az agent hosszú parancsot a `scripts/invoke-verification.ps1` wrapperen keresztül
futtat. A wrapper a folyamat végéig blokkol, a teljes kimenetet a Gitből kizárt
`.local/verification/` könyvtárba írja, és siker esetén csak rövid összegzést ad.
Nincs szükség ismételt státuszlekérdezésre.

```powershell
# A legkisebb releváns teszt vagy több kapcsolódó teszt egy Bun futásban
pwsh -NoProfile -File scripts/invoke-verification.ps1 `
  -Name targeted `
  -CommandText 'bun test crime-cases/test/player-witness-proof.test.ts sdk/test/crime-report-client.test.ts'

# Formázás és mindhárom typecheck, ha mindhárom projekt érintett
bun run verify:quality

# Teljes regresszió egyszer, konkrét közös alapot érintő változásnál / kiadáskor
bun run verify:full
```

Implementáció közben targeted tesztet, mérföldkőnél érintett modul/integrációs
suite-ot használj. Sikeres teljes regressziót csak releváns új kódváltozás,
korábbi hiba vagy konkrét nyitott ellenőrzési kockázat után ismételj meg. Ha egy
teszt JUnitot készít, add át a fájlt `-JUnitPath`-tal; egyébként a wrapper a
szokásos tömör tesztösszesítést olvassa ki a naplóból. Minden futás mellé
`.result.json` készül időtartammal, exit/outcome értékkel, tesztszámokkal
(ismeretlen esetben null) és naplómérettel. Ez helyi mérés, nem tokenbecslés.
Ismételt ellenőrzést ne indíts pusztán az időmérés kedvéért.

A feladatlezárás alapértelmezett kapuja és a teljes regresszió indokai:
[ellenőrzési rend](../docs/project/VERIFICATION_POLICY.md).

## Proto-society fixture

- `bun run fixture:proto preview` – csak olvasó preflight és exact változáslista.
- `bun run fixture:proto apply` – idempotens apply; minden engine save módosítás előtt
  backupot kér, a három SQLite adatbázisról pedig snapshotot készít.
- `bun run fixture:proto export --output <új-fájl>` – kanonikus manifest export; meglévő
  fájlt szándékosan nem ír felül.
- `bun run fixture:proto status` – alkalmazási journal és erőforrás-szintű provenance.
- `bun run fixture:proto restore-engine` – a rollback első fázisa futó engine mellett,
  kizárólag offline player save-okra.
- A teljes stack leállítása után `bun run fixture:proto restore-databases --stack-stopped`
  állítja vissza az AgentState, Business és treasury SQLite snapshotokat. A kétfázisú
  visszaállítás újraindítható; részleges apply/rollback explicit journalállapotban marad.

A bootstrap ledger additív, külön `.local/admin/fixture-bootstrap.sqlite` adatmodell;
nem módosít meglévő domain sémát. A v1 application/provenance táblapárt a v2
induláskor additív `fixture_application_history` tábla egészíti ki. Így egy teljesen
visszaállított próbálkozás után ugyanaz a stabil fixture újra alkalmazható, miközben
a korábbi rollback journal változatlan snapshotként megmarad. A v2 kód rollbackje
előtt fejezd be az aktív apply/rollback műveletet; a history tábla elhagyható, de
annak törlése elveszíti a korábbi próbálkozások auditnyomát.
Visszaállításkor az engine-backupok után, leállított
stackkel a pre-apply SQLite snapshotok kerülnek vissza; a bootstrap előtt még nem
létező adatbázisokat a rollback eltávolítja. A ledger megmarad auditnyomként
`rolled-back` állapotban.

## Phase 15 live soak

A persistent, legalább hat player agentes fixture valódi 60–90 perces acceptance
ablakát az alábbi futtató percenként naplózza a `.local/phase15-soak/` alatt. A
futás közepén pontosan egy tervezett managed-stack restartot hajt végre:

```powershell
.\scripts\phase15-live-soak.ps1 -DurationMinutes 60 -RestartAfterMinutes 30
```

A `completed` sessionből content-addressed acceptance bundle exportálható. A
diagnosztikai bundle sikertelen kritériumok mellett is elkészül, ilyenkor az
exporter 2-es kilépési kódot ad:

```powershell
bun scripts/export-phase15-live-soak.ts .local/phase15-soak/<session>/session.json --output .local/phase15-soak/<session>/acceptance.json
```

## Hosszú társadalmi futások összehasonlítása

A hosszú társadalmi futások csak olvasó összehasonlítása:

```powershell
bun run society:experiment --command capabilities
bun run society:experiment --command compare --control xp-control --treatment xp-treatment --axis diminishing-xp
```

Natív lezárt programokat olvas, és megőrzi a hullámok receipt/clock/skill
hivatkozásait. Hiányzó forrás: `unavailable`; egyenlőtlen mintaszám:
`inconclusive`; hiányzó kezelésattesztáció: `unsupported`. Nem indít futást.
Részletek: [Phase 24.8](../docs/project/features/phase24-8-controlled-comparisons.md).

A natív XP-előzmény külön, admin hitelesítéssel olvasható és offline,
aktív society run nélküli cohorton auditáltan resetelhető/restorálható:
`/api/admin/society/xp-baseline`. A pontos kérés, migráció és rollback:
[XP-baseline](../docs/project/features/phase24-8-xp-baseline.md).

Az új Phase 12 kísérletek első natív XP-hívásának auditja és explicit seal
helyreállítása: `/api/admin/society/xp-execution/<experiment UUID>`.
Szerződés, bizonyítékhatár és rollback:
[XP execution](../docs/project/features/phase24-8-xp-execution.md).

## Többcélú társadalmi értékelés

`bun run society:evaluation --contract` a tíz társadalmi dimenzió képleteit,
mértékegységeit és értékelési irányát adja vissza. Az időablakot, actorokat és
clock-kötést megadó `society:evaluation` csak olvasó natív diagnosztikai riport.
Nem indít benchmarkot; az adathiány látható, nincs súlyozott összpontszám.
Elérés, forrásbeállítások és a jelenlegi natív lefedettség korlátai:
[Phase 24.9](../docs/project/features/phase24-9-society-evaluation.md).

Az admin **Társadalom** füle a mutatóktól a natív termelési/trade bizonylatig
vezet, agent-, Business-, termék-, régióállapot- és időszűréssel. A csak olvasó
API: `/api/admin/society/dashboard`, illetve `/events/<evidence-id>` a kapott
snapshot digesttel. A forrás változása 409-et ad; történeti régió hiányában a
helyszín ismeretlen. Használat, korlátok és technikai ellenőrzés:
[Phase 24.10](../docs/project/features/phase24-10-society-dashboard.md).

## Mentés

- `bun run society:benchmark` – offline társadalmi baseline/eredménycsomag,
  fájlhash-ellenőrzés, kizárólag új könyvtárba történő restore és natív riport.
  Aktuális forrás/config/cache, társadalmi állapot és clock pause/resume:
  [Phase 24.11 protokoll](../docs/project/features/phase24-11-society-benchmark.md).
- `pwsh -File scripts/backup-local.ps1 -Name <név>` – leállított engine állapotának
  mentése SHA-256 manifesttel.
- `pwsh -File scripts/restore-local.ps1 -BackupPath <útvonal> -Force` – visszaállítás;
  előtte automatikusan új biztonsági mentést készít.

A részletek a [backup-restore.md](../docs/project/setup/backup-restore.md) fájlban
találhatók.
