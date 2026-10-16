# 25.4 – kezelt helyi szerverek életciklusa

A „Saját szervereim” oldalról bejelentkezett fiókkal új helyi LostCity-világ
hozható létre, indítható, leállítható, újraindítható és archiválható.
A létrehozás előkészít, de nem indít automatikusan játékfolyamatot.
Az admin külön folyamat marad, leállított világok mellett is működik.

## Verzió és világsablon

A katalógus a control plane indulásakor elérhető helyi Git HEAD teljes
commitazonosítóját kínálja. Ez valódi, rögzített forrásverzió; tetszőleges ref,
URL, parancs vagy fájlútvonal nem küldhető a létrehozó végpontra.
Az előkészítés `git archive` alapján történik, ezért a munkafában lévő
nem commitolt forrásmódosítás és a nem verziózott személyes állomány nem része
az új szerver forrásának. A két upstream dokumentációs symlinket a Windows
kibontás kihagyja; egyéb kibontási hiba továbbra is megszakítja a műveletet.

Két ténylegesen alkalmazott sablon van:

- `classic`: `legacy` bolti gazdaság, 25-ös XP-szorzó.
- `closed-economy`: `closed-society` bolti gazdaság, 1-es XP-szorzó.

Mindkettő üres játékosállapottal indul a helyi, már előállított játéktartalommal.
Ezek nem genesis-alapítókat vagy kész társadalmat telepítő profilok.
Bot, autonóm végrehajtás, skill builder és LLM-hívás nem indul a létrehozáskor.
Új katalógusverzió megjelenése nem írja felül a korábbi világok munkakönyvtárát.

## Állapot és jogosultság

A `servers.sqlite` sémája additívan v1-ről v2-re lép: a szervermetaadat és
korábbi registry-audit megmarad, mellé lifecycle-, művelet- és portfoglalási
táblák kerülnek. Az identity-tár sémája változatlanul v1.

A fiók saját `srv-UUID` erőforrásához kap tulajdonjogot. A korábbi
`local-default` tulajdonjog nem ad hozzáférést másik fiók új világához.
Lista, részlet, művelet és a közvetlen gateway-admin is az adott szerverhez
tartozó ownership alapján enged hozzáférést. Idegen művelet/szerver 404-et ad.
A módosító HTTP-kérésekhez session, azonos origin, explicit admin fejléc és
sessionhöz kötött CSRF-token szükséges.

A kérés először tartós intentet és auditot rögzít, majd 202-vel műveletazonosítót
ad vissza. A felület külön lekérdezi a futó/sikeres/hibás eredményt.
Az actorhoz kötött request key pontos ismétlése ugyanazt a műveletet adja;
eltérő kérés azonos kulccsal konfliktus. A revízió és a szerverenként egyetlen
aktív művelet kizárja az elavult állapotból küldött, párhuzamos módosítást.
Az állapot és a végeredmény tranzakcióban, audittal együtt kerül a registrybe.

Az ownership külön adatbázisban van: összeomlás esetén a tartós create intent
alapján csak az eredeti létrehozó kötése állítható helyre, konfliktus esetén
zárt hibával. A futás közbeni műveletek nem állítják vissza a visszavont jogot.
Adminújraindításkor a félbemaradt művelethez tartozó saját folyamatot a rendszer
azonosítva leállítja és a műveletet megszakadt hibával lezárja. Ismeretlen
kimenetelű indítást nem ismétel automatikusan. Sikertelen leállításkor a hiba
és az adatok megmaradnak.

## Folyamatok és adatok

A privát control-plane-adatkönyvtár `instances/srv-UUID/` alkönyvtárában van
a verzióhoz kötött workspace, az előkészítési manifest, a folyamatgeneráció
vezérlési adata és a külön engine/gateway napló. Hat külön port tartozik
minden szerverhez: gateway, engine HTTP, management HTTP, játék TCP és
két hitelesített vezérlési HTTP-port. A kezelt listenerek csak loopbackre kötnek.

A registry a portokat tranzakciósan foglalja; induláskor a tényleges OS-portok
szabad állapotát is ellenőrzi. Foglalt vagy nem hitelesíthető folyamatot nem öl meg.
A vezérlés véletlen tokennel, szerverazonosítóval, szereppel és friss
generációazonosítóval ellenőrzi a folyamatot. Új runtime-objektum a privát
folyamatregiszterből vissza tud kapcsolódni a már futó saját példányhoz.

A forrás, a helyi packed cache és a lefordított webclient az új workspace-be
kerül. A cache manifestje rögzíti a fő adatállomány SHA-256 hashét; ez nem a
teljes assetkészlet reprodukálhatósági garanciája. A már telepített
`node_modules` könyvtárakhoz junction vezet: a függőségek telepítése közös,
változtatásuk külön üzemeltetési művelet. A gyermekfolyamat szűk környezeti
engedélylistát kap, nem örökli a szülő provider-kulcsait vagy botjelszavait.

A leállítás az engine saját reboot/save útját kéri. Az archiválás előbb
leállít, majd véglegesen archivált állapotot rögzít; a workspace, mentések,
naplók, audit és portfoglalás megmarad. Nincs automatikus törlés vagy
portújrahasznosítás. Részleges előkészítést nem ír felül: a hibás szerver
archiválható, új példány külön azonosítóval készíthető.

## Határ és helyreállítás

A teljes izoláció felülvizsgálata külön 25.5 feladat. A régi domain-admin
kötelező szerverkontextusa 25.6: a kezelt világok kártyáján ezért jelenleg
az életciklus-műveletek érhetők el. A 25.7 titoktár és a 25.8 kiterjesztett
folyamatfelügyelet/backup szintén nyitott. Ez a lépés nem teszi késznek a
teljes több-szerveres admin fázist.

Migráció előtt a leállított control plane identity- és registry-táráról,
valamint a privát instances könyvtárról kell helyi backupot tartani.
WAL-adatbázisnál konzisztens SQLite-backup vagy minden kapcsolódó folyamat
lezárása szükséges. Futó mentés másolata nem tekinthető kész backupnak.
A v2 registryt a régi 25.3 bináris elutasítja: visszalépéshez a migráció
előtti privát backup kell. Új világok létrehozása után az új registryt és
ownership adatokat is meg kell őrizni; puszta kód-visszalépés nem rollback.
A folyamatvezérlési tokenek és adatbázisok nem kerülhetnek Gitbe.

Ellenőrzési eredmények: [Phase 25 progress](../PHASE25_PROGRESS.md).
