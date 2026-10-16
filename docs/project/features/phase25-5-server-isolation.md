# 25.5 – kezelt világok elkülönítése

A 25.4 életciklus-kezelésére épülő lépés a támogatott, kezelt LostCity-világok
összes módosítható játékállapotát és gyermekfolyamatát a saját példányhoz köti.
A fiókok és a szerverregiszter továbbra is a közös, független control plane-ben
vannak; a domainadatok a világ workspace-ében maradnak.

## Példánykötés

A privát `instances/srv-UUID/workspace/.local/instance.json` rögzíti a
szerverazonosítót, forráscommitot, sablont, hat portot és workspace-et.
Az előkészítési manifest `isolationVersion: 1` mezőt és a világ nyilvános
login-kulcsának SHA-256 hashét is tartalmazza. Ezek a kötés ellenőrzésére
szolgálnak, nem a teljes mentés vagy forrás archiválási hashének helyettesítői.

Indítás előtt az előkészítő ellenőrzi a kötést és az appállapot könyvtárait:
`.local`, `bots`, `config`, `server/engine/data`, `server/webclient/out`.
Symlink/junction és több linkkel rendelkező fájl nem kötheti őket egy másik
világhoz vagy a host állapotához. Az ellenőrzés nem követ ilyen hivatkozást.
Az engine/gateway worker munkakönyvtára és az admin domainmoduljainak tényleges
forrásgyökere is az instance workspace-éhez kell tartozzon.

A portokat és engine/gateway-folyamatokat a 25.4 registry/nonce-generáció
ellenőrzése kezeli. A gateway összes domain-adatútvonala ugyanazon workspace
alá esik: agent-, gazdasági, társadalmi, populációs és clock-adatbázisok,
játékosmentések, botdefiníciók, modállapot és backup, LLM-konfiguráció,
helyi titokállomány, audit és működési naplók. Azonos botnév két világban
két külön rekordot, mentést és folyamatot jelent.

## Kapcsolatok és gyermekfolyamatok

A kezelt bot/skill kötelezően a saját engine HTTP-címét és gateway WebSocket
címét kapja. Másik SERVER/GATEWAY_URL vagy eltérő botidentitás a megadott/
tárolt botkonfigurációban elutasítást eredményez. Hiányzó instance binding
nem aktiválja a régi `8888`/`7780` alapértékeket.

A böngésző engine `/gateway` proxyja is a példány saját gatewayére mutat.
A Lite kliens cache-e `workspace/.local/lite-cache`; a supervisor által
indított folyamat nem a közös felhasználói cache-t használja.

A bot/skill engedélylistás környezetet kap: saját hitelesítő adat,
nyilvános instance-végpontok és login-paraméterek, cache és szükséges OS-változók.
Nem örököl provider-kulcsot, engine-/worker-admin tokent vagy a control-plane
identity-adatbázis elérési útját. A tárolt bot.env tetszőleges kulcsai nem
írhatják felül ezt a kötést. A kezelt folyamatok és kliensfordítás
`--no-env-file` kapcsolóval indulnak, így Bun nem tölti vissza automatikusan
a környezetből kizárt helyi `.env` beállításokat.

A kezelt skill markere önmagában nem bizonyít folyamat-tulajdonjogot.
Csak a supervisor saját gyermekhandle-jéhez illeszkedő PID/run ID kezelhető;
idegen vagy korábbi gatewaytől maradt marker alapján nem adoptál és nem öl
meg folyamatot. A jelöletlen folyamat felderítése/helyreállítása külön 25.8
üzemeltetési feladat; a bizonytalan marker megmarad, nem indítunk rá új skillt.

Leállításkor először a gateway zárja ki az új bot-/skillindítást, aktiválja az
LLM-vészleállítást és megszünteti a saját bot-/skillgyermekeit. Utána az engine
a saját reboot/save útján áll le. A régi, fix helyi portokat kezelő engine-
restart segéd kezelt gatewayből nem indítható; a control-plane életciklus-
művelete használható. A nem kezelt helyi kompatibilitási mód változatlan.

## Titkok és kliens

Minden új világ saját, véletlen RSA-login kulcspárt kap. A 274 protokoll
hosszmezőihez illeszkedő 1024 bites kulcshoz a már meglévő bundler külön
böngészőklienst fordít az instance workspace-ében; a Lite folyamat a saját
nyilvános n/e paramétereit kapja. A privát kulcs nem jut a kliensbe.
Újraindításkor a kulcspár és a manifest kötése ellenőrzött, megmarad;
a vezérlési token ettől külön, futásgenerációnként változik.

A provider-titkok jelenleg saját `workspace/.local/admin/secrets/` állományban
vannak, az admin csak konfiguráltságot ad vissza. Az operációs rendszer/
szolgáltatói titoktár a következő külön 25.7 pont. Az audit a titok állapotát
rögzíti, a nyers kulcsértéket nem. Az archiválás megőrzi a mentést, saját
konfigurációt, titkot, modbackupot és auditot, Gitbe egyik sem kerül.

## Migráció, rollback és határ

Új SQL-séma vagy domainmigráció nincs; a registry v2 és identity v1 változatlan.
Az izolációs profil új, privát előkészítési formátum. Korábbi 25.4-es
`prepared.json` esetén az indítás `ISOLATION_UPGRADE_REQUIRED` hibával áll meg:
nem írunk új forrást a régi commithoz kötött workspace-re, nem találunk ki
utólag izolációs bizonyítékot. Az adatok megmaradnak, a régi folyamat
azonosítva leállítható/archiválható. Újraindításhoz kifejezett, offline,
ellenőrzött verziómigráció szükséges; ennek általános toolingja 25.8 scope.

Frissítés előtt állítsd le a régi kezelt világokat és mentsd a teljes privát
instance könyvtárat, a registryt és identity-t konzisztensen. Visszaállításkor
a vezérlő kódja, a verzióhoz kötött workspace, prepared/instance manifest,
login-kulcs, hozzá fordított kliens és domainadatok együtt állítandók vissza.
A régi vezérlő az új worker kötelező környezetét nem feltétlenül állítja elő;
puszta Git-checkout nem adat- vagy futásrollback. Nincs automatikus kulcsrotáció
vagy régi mentések törlése.

Ez az alkalmazás által kezelt állapot és folyamatok logikai elkülönítése
egy megbízható helyi OS-fiók alatt. A telepített `node_modules` kód továbbra
is közös junctionon olvasható; nem közös játéktár. Ez nem konténer vagy
ellenséges, azonos OS-fiókkal futó tetszőleges kód elleni fájlrendszer-sandbox.
A hagyományos `local-default` külön kompatibilitási backend marad.
A kötelező szerverkontextusú régi adminnézetek 25.6, a távoli/TLS/role
határok 25.9 feladatok. Hivatalos RuneScape-szolgáltatás nem kapcsolódik be.

Eredmények és naplók: [Phase 25 progress](../PHASE25_PROGRESS.md).
