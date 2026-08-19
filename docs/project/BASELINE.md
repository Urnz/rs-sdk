# Helyi baseline – 2026-08-19

## Verziók

- Upstream: `MaxBittker/rs-sdk`
- Kiinduló commit: `9cd3d7019ad3a8654ee31d22af3272d91fe1881e`
- Fejlesztői ág: `codex/baseline-local-setup`
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
- Teljes ellenőrzés: 259 teszt sikeres, 0 sikertelen.

## Smoke teszt

- Tesztbot: `32WTGxrvt`.
- Headless lite clienttel belépett a helyi világba.
- A tutorial átugrása sikerült.
- Fát talált és kivágta.
- Megfigyelt eredmény: `Woodcutting +625 XP`.

## Windows-megjegyzések

- A generált `sdk/API.md` LF sorvéget igényel, mert a teszt byte-pontosan hasonlít.
- A lite cache útvonalához `homedir()` használata szükséges, mert Windows alatt a
  `HOME` környezeti változó hiányozhat.
- A Bun telepítés utáni már futó alkalmazások nem feltétlenül látják az új PATH
  értéket; új terminálban a `bun --version` paranccsal ellenőrizhető.
