# Helyi állapot mentése és visszaállítása

A mentés a játékos-save fájlokat, az SQLite adatbázist és – ha létezik – a helyi
`world.json` konfigurációt tartalmazza. A `bot.env` jelszavak szándékosan nem
részei a mentésnek.

## Mentés

1. Állítsd le a stacket: `pwsh -File scripts/stop-local.ps1`.
2. Készíts mentést:

   ```powershell
   pwsh -File scripts/backup-local.ps1 -Name before-feature
   ```

3. A mentés a Gitből kizárt `backups/before-feature/` könyvtárba kerül. A
   `manifest.json` minden fájl méretét és SHA-256 ellenőrzőösszegét tartalmazza.

Az engine futása közben a segéd megtagadja a másolást, hogy az SQLite főfájl és
WAL ne kerüljön egymással inkonzisztens állapotba.

## Visszaállítás

```powershell
pwsh -File scripts/restore-local.ps1 `
  -BackupPath C:\Projects\OSRS\rs-sdk\backups\before-feature `
  -Force
```

A visszaállító csak a projekt `backups/` könyvtárán belüli mentést fogad el,
leállított engine-t követel, és felülírás előtt automatikusan készít egy
`pre-restore-*` biztonsági mentést. A végén újraszámolja az összes SHA-256 hash-t.

## Ellenőrzési próba

A 4. fázis lezárásakor végrehajtandó próba:

1. stack leállítása;
2. névvel ellátott mentés;
3. ugyanazon mentés tényleges visszaállítása;
4. manifest-hash ellenőrzés;
5. stack újraindítása;
6. játékos-save és botkapcsolat ellenőrzése.

A legutóbbi próba eredményét a `docs/project/BASELINE.md` rögzíti.
