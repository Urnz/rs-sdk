# Fejlesztői segédek

Minden parancsot a repozitórium gyökeréből futtass PowerShellben. A segédek csak
az általuk létrehozott és PID + indulási idő alapján azonosított folyamatokat
állítják le.

## Helyi stack

- `pwsh -File scripts/start-local.ps1` – gateway, engine és az egyetlen helyi bot
  indítása; ha több bot van, használd a `-BotName <név>` kapcsolót.
- `pwsh -File scripts/start-local.ps1 -NoBot` – csak gateway és engine.
- `pwsh -File scripts/status-local.ps1 -Json` – engine, webclient, gateway és a
  kezelt bot egészségállapota.
- `pwsh -File scripts/stop-local.ps1` – a kezelt folyamatok fordított sorrendű
  leállítása.
- `pwsh -File scripts/smoke-local.ps1` – állapotellenőrzés és egy valódi botművelet.

Az indítási állapot a `.local/runtime.json`, a naplók pedig a
`.local/logs/<run-id>/` könyvtárba kerülnek. Mindkettő ki van zárva a Gitből.

## Minőségi kapuk

- `bun run test:quick` – gyors unit/regressziós tesztek.
- `bun run test:integration` – futó helyi komponensek HTTP- és MIME-ellenőrzése.
- `bun run test:smoke` – a teljes stack és egy botakció ellenőrzése.
- `bun run check` – formázási ellenőrzés, két typecheck és a teljes tesztcsomag.
- `bun run test:powershell` – minden PowerShell segéd szintaktikai ellenőrzése.

## Mentés

- `pwsh -File scripts/backup-local.ps1 -Name <név>` – leállított engine állapotának
  mentése SHA-256 manifesttel.
- `pwsh -File scripts/restore-local.ps1 -BackupPath <útvonal> -Force` – visszaállítás;
  előtte automatikusan új biztonsági mentést készít.

A részletek a [backup-restore.md](../docs/project/setup/backup-restore.md) fájlban
találhatók.
