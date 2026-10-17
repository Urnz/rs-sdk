# 25.8 – felügyelet és helyi helyreállítás

## Használat

A **Saját szervereim** kártyákon a Mentés készítése, Mentések betöltése,
Mentés visszaállítása és eltérő forrásverziónál a Verzió frissítése érhető el.
Ezek szabályosan leállítják a világot és leállítva hagyják. A szokásos
Indítás külön művelet; a forrásfrissítés célja az admin aktuális Git-commitja.
A hosszú művelet elfogadási azonosítót, futási állapotot és eredményt kap.

A mentés a világ forrását, konfigurációját, `.local` adatbázisait, SQLite WAL/
SHM állományait, botdefinícióit, játékosmentéseit, cache-ét és kliensét másolja.
A három `node_modules` függőségkapcsolat kimarad, visszaállításkor a helyi
telepítéshez kapcsolódik újra. A manifest a teljes fájllistát, üres könyvtárakat,
fájlonkénti SHA-256-ot, verziót és világkötést tartalmazza. A forrás és másolat
leltára egyaránt ellenőrzött. Félkész mentés `.partial`, nem választható ki.
Visszaállítás előtt a **jelenlegi** állapotról is új mentés készül.

A rendszer által kezelt titkok nem kerülnek mentésbe: a kompatibilis régi plaintext források előbb
ellenőrzötten az OS-titoktárba importálódnak. A mentés ezért ugyanazon gép,
OS-fiók és kanonikus világútvonal helyreállítására szolgál. Nem hordozható
export és nem az OS-titoktár katasztrófa utáni mentése. Korábban felülírt
provider-/botkulcs értékét a világ visszaállítása nem állítja vissza.

## Felügyelet és folyamatok

Az admin 10 másodpercenként hitelesítve ellenőrzi az engine és gateway saját
generációját. Egy sikertelen válasz átmeneti; három egymást követő sikertelen
ellenőrzés tartós, auditált `HEALTH_CHECK_FAILED` hibát eredményez. Közben
sikeres ellenőrzés nullázza a számlálót. A registry-revízió feltételes frissítése
nem írhat felül egy közben indult leállítást. A böngésző lekérései nem növelik
a hibaszámlálót. Nincs automatikus, korlátlan újraindítás vagy mutációismétlés;
az állapot ellenőrzése után a tulajdonos az Újraindítást használja.

Az admin újrainduláskor a befejezett világokhoz a tartós worker-generáció és
OS-token alapján kapcsolódik vissza, új folyamat indítása nélkül. Félbeszakadt
életciklus-műveletét hibával lezárja; a félbeszakadt fájlcserét visszagörgeti.
A HTTP-kiszolgálás a startup-rekonciliáció befejezése után indul.

Windows named-pipe lease kizárja, hogy ugyanazt a registryt két admin
felügyelje. A registry egyedi portfoglalásait az indítás OS-portlease-szel
egészíti ki, amelyet az ellenőrzések/titoktári lépések után, közvetlenül az első
worker indítása előtt teljesen elenged. A Windows Bun gyermekfolyamata örökli
a Node TCP-listenerek handle-jeit; szerepenkénti átadás beragasztaná a második
worker portjait az elsőbe. A két worker és az admin HTTP-portjának újbóli
kötését külön Windows-regresszió ellenőrzi.
Az indító ezért explicit Windows `PROC_THREAD_ATTRIBUTE_HANDLE_LIST`
engedélylistával csak stdin/stdout/stderr handle-t ad át. A rövid életű,
stdin-protokollos launcher a saját natív Process-handle-jét a hitelesített
readiness elfogadásáig tartja; hibánál azt állítja le, sikeres átadás után kilép.
A worker így az admin újraindítása mellett is futhat, annak portját nem tartja
nyitva. A privát környezet stdin-en érkezik, parancssorba vagy naplóba nem kerül.
Az OS kötés az utolsó döntő határ: idegen folyamat közbeékelődésekor az indítás
hibázik, kizárólag a saját gyermekhandle-jeit takarítja el. PID vagy foglalt
port alapján nem öl idegen folyamatot, és nem cserél automatikusan végpontot.

Az új gateway szabályos leállításkor, saját bot-/skillgyermekei kilépése után
generációhoz kötött lezárási igazolást ír. Ennek hiányában újraindítás/backup/
csere `CHILD_RECOVERY_REQUIRED` hibával zár: a gateway összeomlása után
esetleg árván maradt gyermekeket nem tekinti leálltnak. Ilyenkor a privát
napló és az OS-folyamatok alapján üzemeltetői rendezés kell; ismeretlen PID
automatikus adoptálása vagy kilövése nem támogatott. A korábbi, ilyen
igazolást nem ismerő 25.5–25.7 világok migrációja offline kompatibilitási út.

## Forrásmigráció és rollback

Az izolációs v1-kötéssel rendelkező 25.5–25.7 világok támogatottak, változatlan
runtime-függőségekkel. A 25.4 előtti/nem izolált könyvtárhoz nincs találgatott
adat- vagy tulajdonosmigráció. Függőségváltozásnál külön telepítési migráció
kell; a művelet megőrzi az ellenőrzött mentést és elutasítja a frissítést.

A régi worker leállításához a korábbi futási token kizárólag hitelesített
stopra olvasható; az új futás nem használ plaintext fallbackot. Offline,
ellenőrzött kötés után a régi kulcsok a végleges világútvonal OS-titoktárába
kerülnek. A backup ezután készül, már plaintext titkok nélkül. A régi,
vaultot még nem ismerő forrás visszaállítható adatreferenciának, de indítás
előtt újból aktuális forrásra kell migrálni.

A célforrás Git archive-ból külön `stage-UUID` könyvtárba kerül. A világ
módosítható állománya és kulcspárja megmarad; a kliens az új forrásból, a
meglévő nyilvános login-kulccsal fordul újra. A `.local/instance.json` továbbra
is a végleges workspace-útvonalhoz kötődik, így az OS-vault scope nem változik.

A tartós `maintenance.json` a csere előtt készül el. Ezután az eredeti
workspace `retired-UUID`, az előkészített könyvtár `workspace` lesz, végül a
registry-tranzakció rögzíti a sikert és az új pinnelt verziót. Újrainduláskor
az adott SQL-művelet sikere dönt: siker esetén a cserét megtartja, függő vagy
hibás műveletnél a régi workspace-et és prepared manifestet állítja vissza.
Az elvetett munkakönyvtár és mentések megmaradnak; nincs automatikus törlés.
Sérült napló vagy sikertelen rollback `RECOVERY_REQUIRED`, nem sikerjelzés.

A registry v3 additív `lifecycle_maintenance` táblában őrzi a mentésazonosítót/
célverziót. A meglévő v1/v2 világok, portok, műveletek és audit megmaradnak;
identity v1 és a domain-adatsémák változatlanok. Telepítés előtt állítsd le az
admint és készíts privát, konzisztens identity/registry/WAL mentést. Kódrollback:
állítsd le a világokat és admint, őrizd meg a jelenlegi teljes állapotot, majd
a telepítés előtti registry-mentést az ahhoz tartozó kóddal állítsd vissza.
V3 adatbázist régi adminnal ne nyiss meg, és ne csökkentsd kézzel a verzióját.

## HTTP és jogosultság

`GET /api/control-plane/servers/:id/backups` csak a tulajdonos mentéslistáját
adja, fájlrendszerút és titok nélkül. `POST .../:id/{backup,restore,migrate}`
kötelező session-, Origin-, explicit-admin- és CSRF-védelemmel működik.
Minden kéréshez `requestKey` és `expectedRevision`, restore-hoz `backupId`,
migrációhoz `targetVersion` kell. Exact replay ugyanazt a műveletet adja;
azonos kulccsal eltérő mentés/verzió konfliktus. Egy világ műveletei sorosak.
Másik világ mentése, útvonalátlépés, fájlalias és sérült inventory elutasított.

Ellenőrzési bizonyíték és helyi aktiválás: [Phase 25 progress](../PHASE25_PROGRESS.md).
TLS/távoli RBAC a külön 25.9 feladat marad.
