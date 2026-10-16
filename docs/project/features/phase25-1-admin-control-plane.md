# Phase 25.1 – önálló helyi adminszolgáltatás

Az admin külön Bun HTTP-folyamatban, alapértelmezetten a
`http://127.0.0.1:7781/admin/` címen működik. Engine és gateway nélkül is
indítható; mindkettő leállása közben kiszolgálja a felületet és a kapcsolatállapotot.
A gateway `7780/admin/` címe kompatibilis közvetlen belépési pont marad.

Ez a Phase 25 első véges pontja. Felhasználói fiókok, szerverregiszter,
több világ elkülönítése, távoli elérés és teljes folyamatfelügyelet a következő
külön fejlesztési pontok. Játékfolyamatot a control plane nem indít automatikusan.

## Használat

A repository gyökeréből, PowerShell 7 és a meglévő Bun-telepítés mellett:

```powershell
bun run admin:start
# Admin: http://127.0.0.1:7781/admin/
# A játékstack ettől függetlenül indítható/leállítható:
bun run local:start
bun run local:stop
# Az admin továbbra is elérhető.
bun run admin:stop
```

A `local:start` botot is indíthat a szokásos profil szerint. Csak a webfelület
megtekintéséhez nem kell futtatni. Az `admin:stop` kizárólag a saját admin PID-jét
állítja le. Előtérben: `bun run admin:serve`; leállítás Ctrl+C-vel.

A háttérindító `Start-Process -WindowStyle Hidden` használatával indul. Saját,
Gitből kizárt `.local/control-plane/runtime.json` és naplók tartoznak hozzá;
ezeket a játékstack `.local/runtime.json` állapotától elkülönítve kezeli.
A rejtett konzol és a szolgáltatás saját naplóírása miatt az indító kimenetét
elfogó hívó is visszatér az admin futása közben; nincs átörökített caller pipe.
A PID és indulási idő azonosítása megelőzi a leállítást. Ugyanazon állapotgyökér
start/stop műveleteit OS-fájllock védi; párhuzamos művelet hibát ad, újrapróbálható.
Foglalt port esetén semmilyen idegen folyamatot nem állít le.

Másik adminport: `pwsh -File scripts/start-admin.ps1 -Port 7782`.
Előtéri konfiguráció a folyamat környezetében:

- `CONTROL_PLANE_PORT`: alapértelmezett 7781, érvényes TCP-port.
- `CONTROL_PLANE_GATEWAY_ORIGIN`: alapértelmezett `http://localhost:7780`.
- `CONTROL_PLANE_ENGINE_ORIGIN`: alapértelmezett `http://localhost:8888`.

Csak credential/path/query/fragment nélküli helyi HTTP-origin engedélyezett:
localhost, 127.0.0.1, ::1. A backend portja nem egyezhet az adminéval. Az admin
listen címe mindig 127.0.0.1. Egyedi engine-origin esetén a gateway
`ENGINE_PUBLIC_URL` világtérkép-beállítását is ugyanahhoz az engine-hez igazítsd.
A konfigurációt folyamatindításkor olvassa; változtatásához az admint kell
újraindítani, a játékstacket nem.

## Kapcsolat és működési határ

`GET /health` az admin saját készenlétét mutatja. Nem függ a háttérszolgáltatásoktól.
`GET /api/control-plane/status` külön HTTP-elérhetőséget mutat a gateway `/status`
és az engine `/engine-status` végpontjára. Egyenként legfeljebb 1 másodpercet
vár; a párhuzamos ellenőrzések közösek, a cache 1 másodperces, monotón idővel.
Nem állít társadalmi egészséget vagy futó botpopulációt egy sikeres HTTP-válaszból.

A felület 5 másodpercenként frissíti a kapcsolatjelzést. A jelzés az admin
adat-bootstrapjától független, így kezdeti kapcsolatkimaradásnál is működik.
A bootstrap és az adatfrissítés automatikusan újrapróbálkozik, egymásra torlódó
frissítési ciklusok nélkül. Gateway nélkül az adatok/műveletek nem érhetők el;
ezt a felület kiírja, nem helyettesíti nullaértékű mérési eredménnyel. A
világtérkép ismert konfiguráció nélkül értelmes üzenetet ad JavaScript-hiba helyett.

A HTML/CSS/JS egy közös statikus modulból érkezik a gateway és a control plane
esetén is. Az új folyamat importjai nem nyitnak AgentState/SimulationClock vagy
gazdasági adatbázist, nem indítanak autonómiát, LLM-et vagy engine loopot.

## API-közvetítés és hitelesítés

Csak a `/api/admin/*` útvonal kerül a konfigurált helyi gatewayre, az eredeti
módszerrel, queryvel és törzzsel. Nincs tetszőleges proxy-URL, WebSocket-, SDK-
vagy `/api/internal/admin/*` átjárás. A kimenő fejlécszűrő megőrzi a megadott
Authorization/X-Admin-Token és admin-request jelzést; nem ad hozzá szolgáltatási
tokent, cookie-t, engine-admin kulcsot vagy más szerveroldali hitelesítést.
A backend 401/409/stb. státusza és törzse változatlanul visszajut.

Idegen Host/Origin és cross-site kérés elutasításra kerül. Módosító kéréshez
`X-Admin-Request: rs-sdk-admin` szükséges. A bemeneti Origin ellenőrzése után
a proxy a gateway saját originjével továbbítja az Origin fejlécet, hogy a
meglévő helyi mutation-védelem működjön. A gateway tokenvédelmét nem kerüli meg.
Nincs CORS-engedélyezés; a statikus CSP és `nosniff`/`no-store` fejlécek megmaradnak.

Backend redirectet nem követ. A proxy maximum 60 másodpercet vár, a szerver
16 MiB-ra korlátozza a kérés törzsét. Elérhetetlen/timeoutos olvasás 503
`GATEWAY_UNAVAILABLE`. Módosításnál 503 `GATEWAY_OUTCOME_UNKNOWN`: a gateway
végrehajthatta a műveletet válasz nélkül, ezért állapot/audit ellenőrzése kell
újrapróbálás előtt. Nincs automatikus mutáció-újraküldés. A hálózati hiba
részletes belső üzenete, környezeti változó vagy token nem kerül a hibaválaszba.

A helyi hozzáférési modell nem többfelhasználós account/session/role rendszer;
az a következő 25.2 feladat. Távoli/public üzemeltetés nincs engedélyezve.

## Állapot, migráció, visszavonás

A runtime JSON új, külön v1 folyamatregiszter: schemaVersion, PID, indulási idő,
port. Nem gazdasági adatbázis, nincs meglévő domain-séma migrációja. Ismeretlen
verziót a start/stop elutasít; nem próbál belőle idegen folyamatot leállítani.
Nem tartalmaz tokent. A naplók és az operation.lock is helyi, ignorált fájlok.

Visszavonás: `admin:stop`, majd a korábbi gateway admincím használata.
A játékadatokat és a gatewayt nem kell visszaállítani. Sérült regiszternél
előbb a saját PID/indulási idő és port ellenőrzése szükséges; idegen processzt
nem szabad port alapján kilőni. Az ignorált metaadat eltávolítása csak a saját
adminfolyamat rendezett leállítása után indokolt. Teljes crash recovery,
automatikus újraindítás és több szerver felügyelete későbbi Phase 25 scope.

## Technikai ellenőrzés

A célzott suite valódi HTTP-szerverekkel ellenőrzi az engine/gateway tényleges
leállítását, a statikus admin túlélését, POST törzs/Origin/token átvitelét,
timeoutot, ismeretlen mutációs kimenetelt és az elutasításokat. Külön OS-processz
és PowerShell start/stop próba igazolja a loopback kötést, idempotens indítást,
portütközés elutasítását és idegen/backend processzek megőrzését.

Valódi Chrome a teljes adminoldalt háttérszolgáltatások nélkül nyitja meg,
majd lapújratöltés nélkül betölti az adatokat a tesztgateway visszatérésekor.
Az újabb kapcsolatvesztés és a kezdeti offline világtérkép-kattintás sem okoz
kezeletlen script-hibát. A portok és a backendadatok izolált tesztadatok;
valódi játék-, bot-, LLM- vagy társadalmi futás nem része ezeknek a próbáknak.

Hordozható HTTP/böngészős kör: `bun run test:control-plane` (7 eset).
Windows folyamat/launcher kör: `bun run test:control-plane:windows` (2 eset).
A GitHub CI Ubuntu jobja az elsőt a normál root tesztek részeként futtatja,
a Windows job Bun 1.3.14-gyel a másodikat. A Windows OS-parancsokat használó
próbák nem kerülnek az Ubuntu tesztdiscoverybe; Windows CI-ban ténylegesen
lefutnak, nincs platformfüggetlennek álcázott vagy kikapcsolt assertion.

Képek, kizárólag tesztadatokkal: `.local/verification/phase25-1-admin-offline-desktop.png`
és `phase25-1-admin-offline-mobile.png`; 1440 és 390 px, vizuálisan ellenőrizve.
Ellenőrzési napló: [PHASE25_PROGRESS](../PHASE25_PROGRESS.md).
