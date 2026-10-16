# Helyi fejlesztés Windows alatt

Ez az ellenőrzött folyamat a `C:\Projects\OSRS\rs-sdk` klónhoz készült. A szerver,
a gateway és a webkliens kizárólag a helyi/private világot használja.

## Első telepítés

1. A gyökérben: `bun install --frozen-lockfile`.
2. A `server/webclient` könyvtárban: `bun install --frozen-lockfile`.
3. A `server/engine` könyvtárban: `bun install --frozen-lockfile`.
4. Teljes ellenőrzés a gyökérben: `bun run check`.

## Egyparancsos használat

Az önálló admin külön indítható, a játékstacktől függetlenül:

```powershell
bun run admin:start
# http://127.0.0.1:7781/admin/
# Külön leállítás: bun run admin:stop
```

A gateway/engine leállása nem zárja be az admint. A felület jelzi a hiányzó
kapcsolatot és automatikusan újratölti az adatokat a gateway helyreállása után.
Portok, biztonsági határ és háttérfolyamat-kezelés:
[Phase 25.1](../features/phase25-1-admin-control-plane.md).

A játékstack szokásos parancsai:

```powershell
pwsh -File scripts/start-local.ps1
pwsh -File scripts/status-local.ps1 -Json
pwsh -File scripts/stop-local.ps1
```

Ha pontosan egy helyi botkönyvtár van, az indító automatikusan elindítja. Több bot
esetén használd a `-BotName <név>` kapcsolót, bot nélkül pedig a `-NoBot` kapcsolót.
Az engine `EASY_STARTUP=true` és `WEBSITE_REGISTRATION=false` helyi beállítással
indul, ezért az első játékos-belépés automatikusan létrehozhatja a helyi fiókot.

Elérhetőségek:

- játékos kliens: `http://localhost:8888/vanilla`
- bot-kiegészítéseket tartalmazó kliens: `http://localhost:8888/`
- engine health: `http://localhost:8888/engine-status`
- webclient modul: `http://localhost:8888/client/client.js`
- gateway: `ws://localhost:7780`, HTTP health: `http://localhost:7780/status`
- botállapotok: `http://localhost:8888/status`

## Naplók és szintek

Minden indítás külön `.local/logs/<run-id>/` könyvtárat kap. Komponensenként külön
`*.out.log` és `*.err.log` készül. A naplókban használt szintek:

- `DEBUG`: részletes engine- és diagnosztikai esemény;
- `INFO`: normál indulás, leállás és fontos állapotváltozás;
- `WARN`: helyreállítható rendellenesség;
- `ERROR`: sikertelen művelet vagy komponenshiba.

A gateway és bot saját `[Gateway]`, `[lite-runner]`, `[BotSDK]` előtagja megmarad.
Jelszó, `bot.env` tartalom vagy más titok nem kerülhet naplóba.

## Tesztszintek

1. Célzott: `bun test <érintett tesztfájl vagy könyvtár>` a verification wrapperrel;
   az érintett modul és módosított integrációs határ ellenőrzése. A korábbi
   `test:quick` alias megszűnt: azonos volt a széles `test` alapcsomaggal.
2. Integrációs: `bun run test:integration` – a futó engine, webclient és gateway
   végpontjainak ellenőrzése.
3. Smoke: `bun run test:smoke` – a futó bot csatlakozása és egy valódi játékakció.
4. Teljes kapu: `bun run verify:full` – formázás, három typecheck és minden
   `check`-be kötött tesztcsomag; külön indokolt összesített ellenőrzés.

Kiválasztás, futási előfeltételek és időmérés:
[ellenőrzési rend](../VERIFICATION_POLICY.md). Az élő integráció/smoke csak
az adott változás szükséges bizonyítékaként fut, nem minden feladat végén.

## Személyes játék és állapotmentés

- [Személyes játékos és botmegfigyelés](manual-play.md)
- [Mentés és visszaállítás](backup-restore.md)

Kézi hibakeresésnél továbbra is indíthatók külön terminálok, de a dokumentált és
tesztelt alapfolyamat a `scripts/start-local.ps1` használata.
