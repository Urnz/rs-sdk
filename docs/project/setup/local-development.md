# Helyi fejlesztés Windows alatt

Ez az ellenőrzött alapfolyamat a `C:\Projects\OSRS\rs-sdk` klónhoz készült.
A szerver, a gateway és a webkliens kizárólag a helyi/private világot használja.

## Függőségek

1. A gyökérben: `bun install --frozen-lockfile`.
2. A `server/webclient` könyvtárban: `bun install --frozen-lockfile`.
3. A `server/engine` könyvtárban: `bun install --frozen-lockfile`.
4. Teljes ellenőrzés a gyökérben: `bun run check`.

## Indítás

Három külön terminál szükséges.

1. Gateway a `server/gateway` könyvtárból: `bun run gateway`.
2. Engine a `server/engine` könyvtárból PowerShellben:

   ```powershell
   $env:EASY_STARTUP = 'true'
   $env:WEBSITE_REGISTRATION = 'false'
   bun run src/app.ts
   ```

3. A webclientet csak forrásmódosítás után kell újraépíteni a
   `server/webclient` könyvtárból: `bun run build`.

Elérhetőségek:

- játékos kliens: `http://localhost:8888/vanilla/`
- bot-kiegészítéseket tartalmazó kliens: `http://localhost:8888/`
- gateway: `ws://localhost:7780`
- botállapotok: `http://localhost:8888/status`

A `WEBSITE_REGISTRATION=false` helyi fejlesztői módban engedélyezi, hogy egy
korábban nem létező felhasználónév az első sikeres bejelentkezéskor létrejöjjön.
Ez nem nyilvános szerverre szánt beállítás.

## Személyes játék

A részletes lépések a [manual-play.md](manual-play.md) fájlban találhatók. Saját
játékoshoz külön felhasználónevet használj; ne a bot `bot.env` jelszavával lépj be.

## Leállítás

Az engine-t és a gateway-t a saját termináljukban `Ctrl+C`-vel állítsd le. A
következő fejlesztői feladat egyetlen indító-, állapot- és leállítóparancs készítése.
