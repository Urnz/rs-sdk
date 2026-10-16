# Phase 25.2 – fiókok, munkamenetek és tulajdonosi jogosultságok

A külön helyi control plane saját fióktárral működik. E lépés a meglévő helyi
backend `local-default` erőforrását védi. A szerverregisztert és a „Saját
szervereim” kezdőoldalt a [25.3](phase25-3-server-registry.md) vezeti be;
több szerver létrehozása és titoktár-integráció a későbbi feladatok részei.

## Használat

A projekt gyökerében az első tulajdonos létrehozása:

```powershell
pwsh -NoProfile -File scripts/create-admin-account.ps1
# Ha Bun elérhető a PATH-on, azonos belépési pont:
bun run admin:account:create
```

A parancs bekéri a nevet és rejtett bevitellel a jelszót. Nincs alapértelmezett
jelszó, nyílt HTTP-regisztráció vagy jelszó CLI-argumentumban/környezeti
változóban. A bootstrap kizárólag az üres fióktárban működik, konkurens
létrehozásnál is egyszer. A jelszó stdin pipe-on jut a Bun-folyamathoz.

Ezután `bun run admin:start`, majd `http://127.0.0.1:7781/admin/`.
Már futó, régebbi adminverzió esetén egyszer `admin:stop`, majd `admin:start`
szükséges. A bejelentkezés, fiókkezelés és jelszócsere engine/gateway nélkül is
működik. A fiókfelület a „Fiók és jogosultságok” hivatkozással érhető el.

A tulajdonos új fiókot készíthet, és kifejezetten megadhatja/visszavonhatja a
helyi szerver tulajdonjogát. Az új fiók alapból nem tulajdonos. Az utolsó
tulajdonos nem távolítható el. A nem tulajdonos bejelentkezhet, módosíthatja a
saját jelszavát és kijelentkezhet; szerveradatot/jogosultságlistát nem olvashat.
A jogosultság minden kéréskor a tartós tárból kerül ellenőrzésre, ezért a
visszavonás a meglévő munkamenetre is azonnal hat a következő kérésnél.

## Hitelesítési és API-határ

- Felhasználónév: 3–40 ASCII betű/szám/pont/kötőjel/aláhúzás, kisbetűre
  normalizálva; nincs külön e-mail vagy személyes profiladat.
- Jelszó: legalább 12 karakter, legfeljebb 1024 UTF-8 bájt. Sózott Argon2id,
  64 MiB memória, 3 iteráció, aszinkron hash/verify; folyamatonként legfeljebb
  két párhuzamos KDF. [Bun password API](https://bun.sh/docs/runtime/hashing).
- Bejelentkezésenként friss, véletlen 256 bites session token, a DB-ben csak
  SHA-256 lenyomat. A cookie host-only, HttpOnly, SameSite=Strict, Path=/,
  fix 8 órás lejárattal. Ez továbbra is kizárólag loopback HTTP: távoli/TLS
  üzemeltetés és annak Secure-cookie konfigurációja nincs beleértve.
- Kijelentkezéskor a munkamenet törlődik. Jelszócseréhez a jelenlegi jelszó
  szükséges; a csere minden korábbi munkamenetet visszavon. Restart nem törli
  az érvényes sessiont és a tulajdonjogot.
- A login-kísérletekre DB-ben tartós, összesített 30/perc korlát vonatkozik.
  Hibás és ismeretlen név ugyanazt a 401 hibát kapja. A jelszóhiba nem írja
  felül a fiókot. A fiókkérések törzse legfeljebb 8 KiB JSON.
- Módosítás: pontos Origin + `X-Admin-Request: rs-sdk-admin` + sessionhöz
  kötött `X-Control-CSRF`. A login még cookie nélkül pontos Origin/intent/JSON
  kérést igényel. Nincs idegen originhez CORS vagy cookie Domain megadás.

Fiók API-k: `POST /api/control-plane/login`, `GET /session`, `POST /logout`,
`POST /password`, tulajdonosnak `GET/POST /accounts`, valamint
`PUT /accounts/:id/ownership` (`granted` kötelező boolean), mind azonos
`/api/control-plane` prefixszel. A session válasz csak a publikus fiókazonosítót,
nevet, lejáratot, CSRF-értéket és a helyi tulajdonosi státuszt tartalmazza.

A `/health` és a login/fiók statikus shell publikus; adatot ezek nem adnak.
A védett adminoldal bejelentkezésre irányít, az API hiányzó/lejárt sessionre
401, nem tulajdonosnak 403. A backendállapot olvasása is tulajdonosi művelet.

A gateway valódi HTTP-belépési pontja (`admin/entry.ts`) a domainhandler előtt
ugyanazt a sessiont és tulajdonjogot ellenőrzi. Hiányzó/ismeretlen/hibás fióktár
503, soha nem visszaállás a régi helyi, bejelentkezés nélküli módra. A domain
handler unit tesztjei saját izolált kontextusukat használják; a HTTP-határnak
külön integrációs tesztje van. A játék/MCP/SDK nem-admin útvonalai nem változtak.

A control plane csak a már ellenőrzött session cookie-ját és CSRF-fejlécét
továbbítja a rögzített helyi gatewayhez, egyéb cookie-t nem. A meglévő
`ADMIN_TOKEN` külön backend-kaput nem kerüli meg: ha be van állítva, az admin
továbbra is bekéri. Nincs automatikus mutációismétlés vagy service-token
injektálás. A felület támogatott belépési pontja a független control plane.

## Állapot, migráció, backup és rollback

Új, külön SQLite v1: `.local/control-plane/identity.sqlite` (WAL).
Táblák: accounts, ownership, sessions, login_budget, identity_audit.
A fiók/tulajdonjog/session változása és a hozzá tartozó auditbejegyzés atomikus.
Audit: művelettípus, belső actor/subject/resource ID és idő; nincs jelszó,
token vagy kérésbody. A könyvtár/fájl POSIX-on 0700/0600 létrehozással/védelemmel
működik; Windows alatt a helyi felhasználó megfelelő NTFS-jogosultságai szükségesek.
Az OS-titoktár és több gépes üzemeltetés külön későbbi feladat.

`CONTROL_PLANE_IDENTITY_PATH` mindkét szolgáltatásnál azonos abszolút útvonalra
állítható; különben a repository fenti helyi útvonala az alapértelmezés.
Egyedi `admin:start -StateDirectory` az admin fióktárát is oda helyezi, ha nincs
explicit identity path; ekkor a gatewaynek és a bootstrap parancsnak is add meg
ugyanazt az identity path-ot. A folyamat stopja csak a runtime-regisztert törli,
fiókot/sessiont nem.

Nincs domain/adatbázis-migráció vagy történeti felhasználó/tulajdonos kitalálása.
Üres tárnál a v1 séma tranzakcióban készül; ismeretlen verziót elutasítunk.
Backup előtt állítsd le az admint és a gatewayt, mentsd a teljes identity
SQLite/WAL/SHM állapotot privát helyre, vagy használj SQLite-konzekvens backupot.
Restore után mindkét szolgáltatást indítsd újra. Régi backup sessiont is
visszaállíthat; helyreállításkor töröld a sessions táblát, és jelentkezz be újra.

Rollbackhez állítsd le a szolgáltatásokat, őrizd meg a v1 tárat privát backupban,
állítsd vissza az előző kódot és indítsd újra. A régi kód nem biztosítja az új
fiók-/tulajdonosi védelmet; kizárólag helyi, megbízható környezetben használható.
A fióktár, mentései, naplói és valódi hitelesítő adatai nem kerülhetnek Gitbe.

## Elfogadási bizonyíték

Store/HTTP/session/CSRF/owner/restart/CLI/gateway-határ és Chrome fiókfolyamat:
`server/control-plane/test`; Windows saját folyamat/indítás:
`server/control-plane/windows-test`. Pontos futások és eredmények:
[Phase 25 progress](../PHASE25_PROGRESS.md).
