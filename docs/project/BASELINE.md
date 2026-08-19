# Helyi baseline – 2026-08-19

## Verziók

- Upstream: `MaxBittker/rs-sdk`
- Kiinduló commit: `9cd3d7019ad3a8654ee31d22af3272d91fe1881e`
- Fejlesztői ág: `codex/dev-tooling`
- Git: `2.52.0.windows.1`
- Bun: `1.3.14` (`0d9b296af`)
- Node.js: `22.16.0` (a projekt futtatása Bun alatt történik)

## Ellenőrzött állapot

- Gyökér-, webclient- és engine-függőségek telepítve a lockfile-ok alapján.
- Webclient standard, bot és item-viewer build sikeres.
- Gateway: `localhost:7780`.
- Engine/webclient: `localhost:8888`.
- Game/login/logger/friend szolgáltatások elindultak EASY_STARTUP módban.
- Mind a hat SQLite-migráció sikeresen lefutott.
- Egyparancsos stack-kezelés, komponensenkénti naplók és egészségellenőrzések
  elérhetők a `scripts/` könyvtárban.
- Teljes ellenőrzés: 261 teszt sikeres, 0 sikertelen.

## Smoke teszt

- Tesztbot: `32WTGxrvt`.
- Headless lite clienttel belépett a helyi világba.
- A tutorial átugrása sikerült.
- Fát talált és kivágta.
- Megfigyelt eredmény: `Woodcutting +625 XP`.
- Külön manuális játékosfiókkal a bot ugyanabban a világban látható volt.

## Mentés–visszaállítási próba

- Próba mentés: `backups/phase4-drill-20260819` (helyi, Git által figyelmen kívül hagyva).
- Mentett állományok: SQLite adatbázis és WAL/SHM, valamint két játékosmentés;
  összesen 5 fájl.
- A visszaállítás előtt automatikus védőmentés készült.
- A visszaállítás utáni SHA-256 ellenőrzés sikeres volt.
- Újraindítás után az engine, webclient és gateway egészséges, a tesztbot aktív
  és játékban van.

## Windows-megjegyzések

- A generált `sdk/API.md` LF sorvéget igényel, mert a teszt byte-pontosan hasonlít.
- A lite cache útvonalához `homedir()` használata szükséges, mert Windows alatt a
  `HOME` környezeti változó hiányozhat.
- A Bun telepítés utáni már futó alkalmazások nem feltétlenül látják az új PATH
  értéket; új terminálban a `bun --version` paranccsal ellenőrizhető.
