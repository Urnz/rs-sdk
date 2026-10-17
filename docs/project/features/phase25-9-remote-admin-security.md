# 25.9 – HTTPS és szerepkörös adminvédelem

## Elérési módok

Az alapértelmezés változatlanul HTTP a `127.0.0.1` címen. A távoli admin
**külön bekapcsolható privát HTTPS**: explicit kanonikus origin, konkrét
loopback/RFC1918/IPv6 ULA bind cím és tanúsítvány szükséges. Wildcard bind,
publikus bind IP, részleges konfiguráció, HTTP origin vagy eltérő port hibát ad.
A gateway/engine backendek továbbra is kizárólag helyi HTTP-címek lehetnek.
Tűzfalszabály, publikus listener, tunnel és DNS-beállítás nem készül automatikusan.

Példa egy már elkészített, a böngésző által megbízhatónak tekintett tanúsítvánnyal:

```powershell
$env:CONTROL_PLANE_PORT = '7781'
$env:CONTROL_PLANE_HTTPS_ORIGIN = 'https://admin.example.invalid:7781'
$env:CONTROL_PLANE_BIND = '192.168.1.20'
$env:CONTROL_PLANE_TLS_CERT = Join-Path (Get-Location) '.local/control-plane/tls/certificate.crt'
pwsh -NoProfile -File scripts/import-admin-tls.ps1 -PrivateKeyPath '.local/control-plane/tls/private.pem'
bun run admin:start
```

A példanév/IP helyére a saját privát hálózat tényleges címe kerül. A tanúsítvány
SAN mezőjének az origin DNS-nevét vagy IP-jét kell fednie. A TLS-kulcs csak az
importáló stdin csatornáján halad, utána a Windows Credential Managerből
olvasható. Nincs kulcsos környezeti változó, HTTP titokolvasás vagy fájlos fallback.
A névtér az identity-adatbázis **szülőkönyvtárának kanonikus útvonala**;
előbb hozd létre az első fiókot a megszokott módon. Egy identity-könyvtár egy
vezérlőpéldányhoz tartozzon. A vault 2560 bájtos értékhatára miatt P-256 ECDSA
PKCS#8 PEM kulcs használható; nagyobb kulcsnál az import elutasít, nem csonkol.
Az import forrásfájljának biztonságos őrzése/törlése az üzemeltető feladata;
a futó adminnak erre már nincs szüksége. Tanúsítványlánc esetén a publikus PEM
fájl tartalmazza a szükséges köztes tanúsítványokat is.

Importkor és induláskor ellenőrzött a név, érvényességi idő és kulcsegyezés.
TLS 1.0/1.1 tiltott; TLS 1.2 és újabb használható. Hibás/hiányzó kulcs vagy
tanúsítvány esetén a listener nem nyílik meg, **HTTP fallback nincs**.
Csere után az admin explicit újraindítása szükséges. A háttérindító HTTPS-ben,
a konfigurált név/Host és tanúsítványellenőrzés megtartásával próbálja a privát
bind címet; nem kapcsolja ki globálisan a certellenőrzést. Egyedi portnál az
`admin:start -- -Port ...` helyett közvetlenül a PowerShell script `-Port`
paraméterét használd a konfigurációval egyező értékkel.

HTTPS-ben csak a pontos konfigurált origin/Host fogadható el. `Forwarded` és
`X-Forwarded-*` nem megbízható identitás/origin/IP-forrás; reverse proxy módot
ez a verzió nem vezet be. A böngésző Secure, HttpOnly, SameSite=Strict,
hosthoz kötött session cookie-t és HSTS-t kap. HTTP loopback módban Secure/HSTS
nincs. Minden válasz no-referrer és frame-beágyazás elleni védelmet kap.
A tulajdonosi felület helyi engine iframe-térképe továbbra is helyi használatú;
ez nem távoli játék-/engine-expozíciós funkció.

## Munkamenetek és kéréskorlátozás

A munkamenet rögzített lejárata 8 óra. Fiókonként legfeljebb 10 aktív session
marad; új bejelentkezés a legrégebbit kiszorítja. Ugyanazon böngésző új
bejelentkezése az előző, azonos fiókhoz tartozó tokent visszavonja. A DB csak
tokenhash-t tárol. A Fiók oldalon listázható és egyenként visszavonható minden
saját session; a nyilvános session-azonosító nem bearer token vagy tokenhash.
Más fiók sessionje nem listázható/vonható vissza. Saját aktuális session
visszavonása kijelentkeztet. Jelszócsere minden saját sessiont megszüntet.

A mutációk azonos origint, `X-Admin-Request` fejlécet és a véletlen sessionből
származtatott, állandó idejű összehasonlítással ellenőrzött CSRF-tokent kérnek.
A bejelentkezés is same-origin/explicit intent kötött. A proxy csak ellenőrzött
session cookie-t és szerverkörnyezetet ad tovább, a gateway újra ellenőriz.

Egyperces korlátok: socket IP-nként 1200 kérés, 60 mutáció és 10 login-kérés;
hitelesített fiókonként 60 mutáció, IP-váltástól függetlenül. A korábbi tartós
globális loginbudget 30 kísérlet/perc marad. A közvetlen helyi gateway külön
2400 admin kérés/perc összesített kaput kap. A HTTP-válasz `429` és
`Retry-After: 60`; nincs automatikus mutációismétlés. A memóriabeli kapu 4096
bejegyzésre korlátozott és újraindításkor ürül; a DB-s loginbudget tartós.
Ez egy helyi, egyetlen íróval futó vezérlő támogatott védelme, nem elosztott
internetpublikációs/DoS-védelmi infrastruktúra.

## Szerverenkénti szerepkörök

A Saját szervereim kártyán látszik a szerepkör; a tulajdonos a **Hozzáférések
kezelése** linken adhat/vonhat vissza jogot egy meglévő fióknak. Ez szerverhez
kötött, más világra nem öröklődik. Az utolsó tulajdonos nem törölhető és nem
fokozható le. A jogosultság és audit egy tranzakció; a régi ownership API
visszavonása az alacsonyabb szerepkört is törli. Új fiókot továbbra is a
`local-default` tulajdonosa hoz létre, hozzáférés nélkül. A szerepkörválasztó
csak azonosítót/felhasználónevet/szerepkört lát, jelszót vagy sessiont nem.

- **Néző:** hozzáfér a sajátként megosztott szerver metaadataihoz, állapotához,
  műveletállapotához és külön megfigyelőoldalához. A domain allowlist: economy,
  population-demographics, simulation-clock, economy dependencies/dependency-risk,
  society dashboard/evaluation/evaluation contract, kizárólag GET/HEAD.
- **Üzemeltető:** ugyanez, továbbá a kezelt világ start/stop/restart művelete.
  Botmódosítás, világmentés/restore/migráció/archive és szerepkörkezelés nem jár vele.
- **Tulajdonos:** az adott szerver összes meglévő adminművelete és jogkezelése.

Nem minden GET veszélytelen: például a spectate hitelesítő adatot állíthat elő,
ezért owner-only. Új API-k alapértelmezetten owner-only. A jogosultság minden
kérésnél újraolvasott, így a visszavonás meglévő sessionnél is azonnali. Ugyanaz
a domain engedélylista védi a központi proxyt és a közvetlen gatewayt. A gombok
elrejtése csak UX; a szerveroldali ellenőrzés ettől független.
Minden bejelentkezett fiók továbbra is létrehozhat külön, saját tulajdonú világot;
egy megosztott világ nézői szerepe ezt a korábbi fiókképességet nem vonja vissza.

## Identity v2 migráció és visszaállítás

Az identity v1→v2 tranzakció megőrzi a fiókokat, jelszóhash-eket, tulajdonosi
kötéseket, loginbudgetet és auditot. Hozzáadja az alacsonyabb szerverjogokat és
a session nyilvános azonosítóját/kiadási idejét. A korábbi sessionök egyszeri,
auditált visszavonása miatt **frissítés után újra be kell jelentkezni**.
Nincs kitalált történeti kiadási idő vagy automatikus új szerepkör. Audit-hiba
esetén a migráció teljesen visszagörget. Újabb ismeretlen séma fail-closed.
Registry v3 és minden domain séma változatlan.

Az identity-kapcsolat lezárása minden általa kiadott prepared statementet
explicit finalizál, a sémaérvénytelenítés előtti példányokat is. A szigorú
SQLite-close így nem hagyatkozik GC-re a Windows WAL-handle felszabadításánál.
Ez a v2 olvasó/író kapcsolatok célzott regressziójában is ellenőrzött.

Frissítés előtt állítsd le a kezelt világokat és az admint, majd készíts privát,
konzisztens identity/registry/WAL mentést. A régebbi pinnelt világ forrását az
új adminból migrálni kell: szerepkörös gateway-képesség nélkül az indítás
`VERSION_UPGRADE_REQUIRED` hibával megáll, mielőtt vaultot/új workert használna.
Régi readonly gateway friss identity v2 megnyitásakor zártan elutasít.
A régi verziójú mentés visszaállítása után ugyanez az explicit migrációs út kell.

Rollback: minden érintett folyamat leállítása után a frissítés előtti identity
**teljes** mentését és a hozzá tartozó régi forrást/registryt együtt állítsd
vissza; futó v2 adatbázison nincs destruktív SQL downgrade. Így a frissítés óta
kiadott sessionök és szerepkörváltozások elvesznek. Az OS-vault nem DB-mentés,
a kulcsbejegyzés saját névtere ugyanazon gép/fiók/útvonal mellett marad használható.

Az ellenőrzések és időtartamok a [Phase 25 progress](../PHASE25_PROGRESS.md)
25.9 pontjában szerepelnek. Hangolási/társadalmi kísérlet nem tartozik ide.
