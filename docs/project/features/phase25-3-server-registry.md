# Phase 25.3 – szerverregiszter és Saját szervereim

A control plane bejelentkezés utáni kezdőoldala a **Saját szervereim**.
A lista a meglévő tartós tulajdonosi rekordok alapján szűr; tulajdonjog nélkül
üres állapot jelenik meg. Innen külön megnyitható a fiókfelület, illetve a
bekötött helyi szerver korábbi bot/world/gazdasági adminja.

## Regiszter és hatókör

Új, önálló v1 SQLite metaadattár: `.local/control-plane/servers.sqlite`.
A `servers` rekord: stabil ID, név, helyi gateway/engine origin és regisztrációs
idő. A `registry_audit` a regisztrációt követi. Nincs jelszó, token, mentés,
domainadat vagy saját tulajdonosi másolat ebben a tárban. Az identitásadatbázis
v1 sémája és tulajdonosi/session szabályai változatlanok.

Induláskor a már konfigurált helyi backend a `local-default` / „Helyi szerver”
rekordot kapja. A regisztráció nem ad senkinek jogosultságot: a 25.2-ben már
meglévő `ownership` rekord az egyetlen jogosultsági forrás. Exact újrajátszás
idempotens, a timestamp és az audit nem duplázódik. Eltérő név/cím ugyanazon ID
alatt konfliktus, nem csendes átirányítás egy másik backendhez. A metadata és az
audit egy SQLite tranzakcióban készül; audit-hiba mindkettőt visszagörgeti.

A tároló több szerverrekordot kezel; a `register()` megbízható belső
provisioning művelet a következő fejlesztési pont számára. Ebben a lépésben
nincs HTTP-regisztráció, új világ létrehozása, folyamatindítás/leállítás vagy
port-/adatbázis-kiosztás. A tesztekben szereplő további szerverek és meglévő
ownership-hozzárendelések izolált fixture-ök; nem élő, létrehozott világok.

## Lista és navigáció

- `GET /api/control-plane/servers`: érvényes munkamenet mellett kizárólag a
  felhasználó tulajdonában álló regisztrált szerverek. `schemaVersion: 1`.
- `GET /api/control-plane/servers/:id`: csak saját rekord; az idegen és a
  hiányzó ID azonos 404 választ kap. Bejelentkezés nélkül 401.
- DTO: ID, név, regisztrációs idő, támogatott admin URL és kapcsolatállapot.
  Belső endpointok, tulajdonosi fióklista és fájlútvonalak nincsenek benne.
- Csak a `local-default`, pontosan az aktív konfigurációhoz kötött rekord
  kaphat kapcsolatpróbát és megnyitható admin URL-t. Más regisztrált rekord
  „még nincs csatlakoztatva” állapotú; nincs tetszőleges URL-probe/proxy.
- A kapcsolat a meglévő rövid, cache-elt gateway/engine health eredménye;
  elérhetetlenségből nem következtetünk arra, hogy a folyamat biztosan leállt.
  Más felhasználó szerverét és üres listát nem követ backendlekérdezés.
- A megnyitási link `/admin/index.html?serverId=local-default`. Más szerver-ID
  nem nyithatja meg véletlenül ugyanezt az adminfelületet. A teljes régi admin
  kötelező több-szerveres API-kontextusa továbbra is külön, 25.6-os feladat.

Az `/admin/`, `/admin/servers.html` és a kezdőoldal saját JS/CSS-e minden
bejelentkezett fióknak hozzáférhető. A régi adminoldal és a domain API továbbra
is a helyi szerver tulajdonjogát igényli. A fiókoldalról minden felhasználó
visszatérhet a szerverlistához. Login után a nem tulajdonos is ide érkezik.

A lista mobilon is tördelődik. Látható betöltés, üres lista, hiba és Frissítés
gomb tartozik hozzá; hiba esetén a régi kártyák eltűnnek. Tíz másodperces olvasó
frissítés és a böngésző előzményeiből visszatérés is újraellenőrzi a listát.
Lejárt session a bejelentkezésre irányít. A nevek szövegként kerülnek a DOM-ba.

## Migráció, backup, rollback

A regiszter a már választott identity fájl könyvtárában jön létre.
`CONTROL_PLANE_REGISTRY_PATH` külön abszolút útvonallal felülírhatja ezt;
identity és registry nem lehet ugyanaz a fájl. Egyedi admin StateDirectory
esetén az identity útvonalának korábbi feloldása miatt a regiszter is oda kerül.
POSIX könyvtár/fájl védelem 0700/0600; Windows alatt megfelelő NTFS-jogok.

Nincs identity-, gazdasági vagy world-sémamigráció. Üres regiszterben a v1
séma tranzakcióban készül; ismeretlen verzió elutasítás. A regiszter hiányát
az API 503-ként jelzi, nem látszólag érvényes üres listaként.

A konfigurált default backend címének módosítása megőrzött, eltérő registry
binding mellett indulási konfliktust ad. Állítsd vissza az eredeti konfigurációt;
a 25.3 nem biztosít online újrakötési vagy átnevezési felületet. Több szerver
regisztrálását és életciklusát a következő pont vezeti be.

Mentéshez állítsd le a control plane-t és őrizd meg a registry SQLite/WAL/SHM
konzisztens állapotát privát backupban, az identity backupjával együtt.
Visszaállítás után indítsd újra az admint. Hiányzó egyéb metadatarekordot nem
találunk ki ownership rekordokból. Az identity DB-t nem kell átírni vagy
visszaverziózni a 25.3 visszavonásához: a korábbi kód a külön regisztert nem
használja. Rollback előtt a regiszter maradjon meg privát mentésben.

A regiszter, képek és futásnaplók `.local` alatt ignoráltak, Gitbe nem kerülnek.
Pontos tesztkörök és eredmények: [Phase 25 progress](../PHASE25_PROGRESS.md).
