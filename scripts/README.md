# Fejlesztői segédek

Minden parancsot a repozitórium gyökeréből futtass PowerShellben. A segédek csak
az általuk létrehozott és PID + indulási idő alapján azonosított folyamatokat
állítják le.

## Helyi stack

- `pwsh -File scripts/start-local.ps1` – gateway, engine és az egyetlen automatikusan
  felismerhető helyi bot indítása.
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

A futó gateway helyi botadminisztrációs és gazdasági felülete:
`http://localhost:7780/admin/`. Innen a mentett és online botok szűrhetők,
részletesen megnyithatók, spawnolhatók/despawnolhatók, és kísérleti snapshot is
készíthető. Minden módosításhoz indoklás szükséges.

Az indítási állapot a `.local/runtime.json`, a naplók pedig a
`.local/logs/<run-id>/` könyvtárba kerülnek. Mindkettő ki van zárva a Gitből.
A runtime v2 állapot a teljes `botNames` listát és a fixture hivatkozását is
rögzíti; a status csak akkor egészséges, ha minden kiválasztott avatar friss és
játékban van. A gateway startup reconciliation rövid türelmi időt kap, hogy a
launcher által indított botokat adoptálja, ne indítson velük párhuzamos példányt.

## Minőségi kapuk

- `bun run test:quick` – gyors unit/regressziós tesztek.
- `bun run test:integration` – futó helyi komponensek HTTP- és MIME-ellenőrzése.
- `bun run test:smoke` – a teljes stack és egy botakció ellenőrzése.
- `bun run check` – formázási ellenőrzés, két typecheck és a teljes tesztcsomag,
  beleértve az offline player-save adminolvasó tesztjeit.
- `bun run test:powershell` – minden PowerShell segéd szintaktikai ellenőrzése.

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

## Mentés

- `pwsh -File scripts/backup-local.ps1 -Name <név>` – leállított engine állapotának
  mentése SHA-256 manifesttel.
- `pwsh -File scripts/restore-local.ps1 -BackupPath <útvonal> -Force` – visszaállítás;
  előtte automatikusan új biztonsági mentést készít.

A részletek a [backup-restore.md](../docs/project/setup/backup-restore.md) fájlban
találhatók.
