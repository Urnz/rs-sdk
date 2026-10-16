# Phase 25 – több-szerveres admin vezérlőközpont

## 25.3 – szerverregiszter és Saját szervereim (2026-10-16)

Elkészült a saját kezdőoldal és a külön v1 `servers.sqlite` metaadattár.
Induláskor a már konfigurált helyi backend exact, idempotens `local-default`
regisztrációt kap; eltérő binding ugyanazon ID alatt konfliktus. A regisztráció
és audit atomikus, restart után a rekord/timestamp változatlan. A regiszter
önmagában nem ad jogosultságot és nem talál ki szervereket ownership sorokból.

A lista és részlet csak a bejelentkezett fiók meglévő ownership rekordjaihoz
tartozó szervereket adja vissza. Idegen és hiányzó rekord egyforma 404;
belső endpoint/fájlútvonal nem kerül a DTO-ba. Üres/idegen lista nem indít
backendlekérdezést. Csak a konfigurációhoz pontosan kötött default backend
kapja a meglévő cache-elt health próbát és a megnyitható admin URL-t;
egyéb regisztrált metadata nem válik önkényes proxy-/probe-céllá.

Login után a „Saját szervereim” minden fióknak kezdőoldal. Van betöltés,
üres lista, olvasható hiba, Frissítés/újrapróbálás, mobil tördelés, fióknavigáció
és a korábbi helyi admin megnyitása. Nem-default ID nem nyithatja meg
véletlenül ugyanazt a régi admint. A régi domain API tulajdonosi kapuja megmarad.
Új világ létrehozása/indítása/archiválása és teljes több-szerveres elkülönítés
a következő külön pontok. A következő fejlesztési feladat a 25.4.

Használat, invariánsok, konfiguráció és backup/rollback:
[25.3 szerverregiszter](features/phase25-3-server-registry.md).

Ellenőrzés és körválasztás:

- Első célzott kör: **22 pass / 1 fail / 0 skip**, **21,325 s**.
  Egy új teszt tévesen 403-at várt jogosulatlan HTML-megnyitásra; a már
  meglévő biztonságos viselkedés loginra irányító 303. A javított teszt a
  státuszt és a pontos login Location fejlécet ellenőrzi; az API 403/404
  ellenőrzései megmaradtak. Nincs assertion-eltávolítás vagy termékkapu-lazítás.
  `.local/verification/20261016-201101-569-phase25-3-registry-focused.log`.
- Végső érintett kör: **36 pass / 0 fail / 0 skip**, root TypeScript,
  PowerShell syntax/helper és format PASS, összesen **49,091 s**:
  `.local/verification/20261016-201244-721-phase25-3-affected-quality.log`.
  Kör: `server/control-plane/test`, Windows process/launcher és gateway
  `admin-safety.test.ts`. Store restart/idempotencia/konfliktus/audit-rollback,
  idegen/saját/üres lista, azonnali revokáció, kötött endpointok, login/account
  regresszió és Chrome lista-hiba → újrapróbálás → régi admin lánc PASS.
- Chrome 1440 px és 390 px képek vizuálisan ellenőrizve:
  `.local/verification/phase25-3-servers-desktop.png`,
  `phase25-3-servers-mobile.png`. Nincs vízszintes mobil kilógás.
- Teljes regresszió nem futott: új, izolált metadata-séma és célzott lista/
  navigáció változott, identity v1/account/session/domain kapu, engine,
  gazdasági persistence és webclient build nem. A root tsconfig kizárólag
  az új registry-tesztet veszi fel ellenőrzésre; compiler-opció és runtime
  tesztfelderítés nem változott. A végleges érintett kör az alkalmazott kapu.
- A saját regisztrált admin újraindítása, a loginhoz kötött homepage/API
  readiness, végső format és publikálási privacy ellenőrzés **PASS, exit 0,
  3,416 s**; személyes adat/titok vizsgálatában 0 blokkoló találat:
  `.local/verification/20261016-201517-625-phase25-3-local-ready-privacy.log`.
  A helyi szolgáltatás már az új registryvel fut. A `.local` adatfájlok és
  képek nem kerülnek a commitba.

Valódi felhasználói fiók vagy új játékvilág nem készült. A további registry/
ownership rekordok izolált fixture-ök; nem több világ működésének bizonyítékai.
Bot, játékstack, éles LLM vagy hosszú társadalmi kísérlet nem indult.

## 25.2 – fiókok és tulajdonosi jogosultságok (2026-10-16)

Megvalósult a külön v1 identity SQLite-tár, helyi egyszeri tulajdonos-bootstrap,
normalizált felhasználónév, aszinkron Argon2id jelszótárolás, 8 órás lejáró
HttpOnly/SameSite session, login/logout és minden sessiont érvénytelenítő
jelszócsere. A fiók- és jogosultsági felület backendek nélkül is működik.
Új fiók csak tulajdonostól jöhet létre, alapból szerverjogosultság nélkül.
Megadás/visszavonás atomikus audittal; az utolsó tulajdonos nem távolítható el.

A jelenlegi helyi backend a `local-default` erőforrás; nincs új szerverregiszter
vagy több világ létrehozása. A control plane és a gateway HTTP-határa ugyanazt
a sessiont és tartós tulajdonjogot ellenőrzi. Hiányzó/hibás identity DB-nél a
gateway zárva marad; nincs visszaesés a korábbi helyi bypassra. A proxy csak a
validált session cookie-ját továbbítja, egyéb cookie-t nem; a meglévő backend
ADMIN_TOKEN kapu megmarad. CSRF, pontos origin/intent, 8 KiB JSON, tartós
login-kísérlet-korlát és KDF-konkurenciakorlát védi a fiókműveleteket.

A root gateway HTTP dispatcher a külön `admin/entry.ts` modult használja.
Ez a domainhandler előtt végzi a jogosultságvizsgálatot; a régi domain unit
tesztek izolált kontextusukkal futnak, valódi helyi fiókot nem olvasnak.
Külön integráció igazolja a termelési HTTP-belépési pont korábban publikus
config/statikus útvonalait és a control-plane → gateway session/CSRF átvitelt.

Részletek, használat, migráció/backup/rollback:
[25.2 fiókkezelés](features/phase25-2-accounts.md).
Valódi felhasználót/jelszót nem hoztunk létre, csak izolált tesztfiókokat.
A runtime fióktár, screenshot és napló nem publikálandó. `.canvas.tsx`, bot,
LLM-hívás vagy hosszú társadalmi paraméterkísérlet nem készült/indult.

Ellenőrzési kör és indok:

- Kezdeti control-plane/store/HTTP/Chrome/admin-safety: **27 pass / 0 fail /
  0 skip**, **26,312 s**:
  `.local/verification/20261016-194512-917-phase25-2-focused.log`.
- Kibővített Chrome account/grant/revoke/nem-tulajdonos folyamat, gateway
  entry, CLI és Windows indítás: **20 pass / 0 fail / 0 skip**, PowerShell
  syntax/helper PASS, összesen **32,362 s**:
  `.local/verification/20261016-194641-651-phase25-2-boundaries.log`.
- A teljes kapu első indítása **FAIL, exit 2, 24,623 s**, még a root
  TypeScriptnél, regressziós tesztek előtt. A telepített Bun SQLite típusai
  `immediate()` eredményét voidnak jelölik; explicit, commit utáni eredmény-
  átvétel javítja ezt. Assertion vagy teszt-timeout nem változott.
  `.local/verification/20261016-194945-385-phase25-2-full-local-cache.log`.
- A javított teljes kapu **1871 pass / 0 fail / 0 skip**, exit 0,
  format + root/engine/webclient TypeScript PASS, **6 perc 7,982 s** belső
  parancsidő (külső cache-wrapperrel **6 perc 8,929 s**):
  `.local/verification/20261016-195123-069-full.log`, wrapper:
  `20261016-195122-286-phase25-2-full-repaired.log`.
  Indoka a két HTTP-szolgáltatás közös hitelesítési/jogosultsági határának
  módosítása; nem a fázisváltás miatt futott teljes regresszió.
- A teljes kapu után a névvalidáció kizárja a sorvégi karaktereket is, és a
  gateway az admin HTTP-kaput már a WebSocket upgrade előtt lefuttatja.
  Ezek szűk szigorításait célzottan ellenőriztük: **12 pass / 0 fail / 0 skip**,
  root TypeScript, format és privacy PASS, összesen **21,121 s**:
  `.local/verification/20261016-195829-024-phase25-2-final-input-boundary.log`.
  A teljes nagy csomag nem futott újra ezért vagy dokumentációs utómunkáért;
  a teljes és a végső célzott eredmény külön bizonyíték.
- Publikálható források privacy vizsgálata **PASS, exit 0, 14,246 s**:
  `.local/verification/20261016-195405-892-phase25-2-privacy.log`.
- A saját regisztrált helyi admin újraindítása és olvasó readiness-próba
  **PASS, exit 0, 2,447 s**: health/login elérhető, adminroot 303 loginra,
  session/backendstatus/adminconfig bejelentkezés nélkül 401.
  `.local/verification/20261016-195941-589-phase25-2-local-admin-ready.log`.
  Játékstack vagy bot nem indult. A következő fejlesztési pont a 25.3,
  szerverregiszter és „Saját szervereim” kezdőoldal.

Chrome képek izolált adatokkal, vizuálisan ellenőrizve:
`.local/verification/phase25-2-login-mobile.png` (390 px),
`phase25-2-owner-accounts.png` (1024 px). A mobil login nem lóg ki oldalra;
a fióklista és a megadás/visszavonás műveletei olvashatók.

## 25.1 – önálló helyi adminszolgáltatás (2026-10-16)

Elkészült a külön Bun HTTP-folyamat a `127.0.0.1:7781/admin/` címen.
Saját start/stop és ignorált folyamatregiszter/napló tartozik hozzá; a játékstack
leállítása nem állítja le. A statikus admin a gatewayjel közös modulból érkezik.
A control plane nem nyit domain-adatbázist, nem indít botot, LLM-et vagy
SimulationClock/autonómia loopot. Kizárólag a helyi emulátorhoz kapcsolódik.

Külön `/health` és backendállapot-végpont, 1 s-os probe/monotón cache,
független UI-kapcsolatjelzés és újrapróbálkozó bootstrap működik. A teljes
adminoldal gateway és engine nélkül is betöltődik; a gateway visszatérésekor
oldalújratöltés nélkül befejezi az adatbetöltést. Kezdeti offline világtérkép-
kattintás nem okoz kezeletlen script-hibát.

Csak `/api/admin/*` API-közvetítés van, rögzített helyi originre. Módszer,
query, törzs és a felhasználó által megadott hitelesítés megmarad; nincs
tokeninjektálás, cookie-továbbítás vagy tetszőleges proxycél. Idegen origin,
cross-site kérés és intent nélküli mutáció elutasításra kerül. Redirectet
nem követ; GET-hiba 503, mutációnál ismeretlen kimenetelt jelző 503 és
állapot/audit ellenőrzését kérő üzenet. Nincs automatikus mutációismétlés.

V1 admin runtime JSON került külön `.local/control-plane` gyökérbe, gazdasági
séma nem változott. PID/indulási idő és OS-fájllock védi a saját indítást/
leállítást. Foglalt portot nem szabadít fel idegen folyamat kilövésével.
Ismeretlen regiszterverzió elutasít. A végleges Windows indító rejtett shell
indítással saját konzolt használ, a szolgáltatás maga írja privát naplóját:
így nem tartja nyitva a kimenetet elfogó hívó pipe-jait.

Használat, konfiguráció, biztonsági határ, állapot/migráció/rollback:
[Phase 25.1](features/phase25-1-admin-control-plane.md).
Fiókok/jogosultságok, szerverregiszter és több világ elkülönítése nincs
beleértve. A következő TASKS pont a felhasználói bejelentkezés és tulajdonosi
jogosultságok. `.canvas.tsx` és hosszú társadalmi/paraméterhangolási futás nincs.

Ellenőrzés:

- Kezdeti javított teljes control-plane suite: **9 pass / 0 fail / 0 skip**,
  root TypeScript és PowerShell syntax/helper PASS:
  `.local/verification/20261016-162424-907-phase25-1-control-plane-repaired.log`.
- Érintett control-plane/admin-safety/engine-supervisor/society-dashboard kör:
  **26 pass / 0 fail / 0 skip**, format és root/engine/webclient TypeScript PASS:
  `.local/verification/20261016-162721-624-phase25-1-affected-quality.log`.
- Végleges natív HTTP POST-átvitel, timeout és ismeretlen mutációs kimenetel:
  **6 pass / 0 fail / 0 skip**:
  `.local/verification/20261016-163026-070-phase25-1-native-proxy-final.log`.
- Teljes `verify:full` / `check`: **1861 pass / 0 fail / 0 skip**, 31 tesztkör,
  exit 0, format és mindhárom TypeScript PASS, a meglévő csak olvasó packed-cache
  segéddel. A régi 24.8 XP-teszt és változatlan időlimitje ebben a körben PASS:
  `.local/verification/20261016-162909-846-full.log`, wrapper:
  `.local/verification/20261016-162909-024-phase25-1-full-local-cache.log`.
- A teljes kör után a default háttérindítás próbáján kiderült, hogy Windows
  átörökített kimenetkezelők miatt a verification hívó az admin leállításáig
  várhat. Ezt a rejtett saját konzol/saját log indítás javítja. Szigorított
  processzteszt már az indító stdout/stderr EOF-ját is megköveteli a szolgáltatás
  futása közben: **2 pass / 0 fail / 0 skip**:
  `.local/verification/20261016-163742-533-phase25-1-detached-launcher.log`.
  A teljes nagy regressziót e szűk launcher/log pontosításért nem ismételtük meg.
- A végleges default indítás **PASS**, a hívó 2 s alatt visszatér, az admin
  tovább fut: `.local/verification/20261016-163824-787-phase25-1-admin-ready.log`.
- A launcher/log pontosítás után root TypeScript, PowerShell syntax/helper,
  format és adatvédelmi vizsgálat **PASS**:
  `.local/verification/20261016-164002-005-phase25-1-final-quality-privacy.log`.

A publikálás előtti CI-rendezés a két Windows folyamatpróbát külön
`server/control-plane/windows-test` suite-ba tette, a normál root tesztekben
a 7 hordozható HTTP/böngészős eset marad. A Windows GitHub job kifejezetten
futtatja a két OS/launcher esetet, Bun 1.3.14 telepítése után. A fenti teljes
1861-es kör még az egy könyvtárban lévő 9 esetet tartalmazta; a rendezés
útvonalváltozás, nem assertion-kivétel vagy elnémított platformhiba.
A végleges CI-útvonalról futó Windows suite **2/2 PASS**, root TypeScript,
PowerShell helper/syntax, format és privacy audit PASS:
`.local/verification/20261016-164147-151-phase25-1-ci-routing-final.log`.

Valódi Chrome teljes oldalképek kizárólag izolált tesztadatokkal:
`.local/verification/phase25-1-admin-offline-desktop.png` (1440 px),
`phase25-1-admin-offline-mobile.png` (390 px). Vizuálisan ellenőrizve;
kapcsolatjelzés és mobil tördelés olvasható. Az éles helyi adminon csak readiness/
elérhetőség olvasás történt: saját admin készen áll, engine és gateway nem futott.

## GitHub-feltöltés és adatvédelem

A korábbi felgyűlt munkát a `codex/phase22-24-reviewed` ágra, `280da190c`
commitként feltöltöttük. A publikált snapshot szülője az origin/main; a korábbi
helyi commitágak megmaradtak, személyes profilútvonalat tartalmazó régi helyi
commitok nem kerültek az új publikált előzményláncba. A commit identitása
nem személyes contributor-alias.

A GitHubhoz képest új/módosult 664 forrásfájl átvizsgálásakor három személyes
profilútvonalat cseréltünk hordozható feloldásra. Mentések, adatbázisok, helyi
naplók, botkörnyezet és titokfájlok nem kerültek a commitba. A találatként jelzett
skill-verziós fájlnevek és dinamikus adatbázis-URL összerakás kézzel ellenőrzött
téves pozitívok; nem éles hitelesítő adatok. A már origin/main-on lévő upstream
emulátor-tesztkulcs változatlan, új kulcsot nem publikáltunk.

Ellenőrzött commit audit: blokkoló találat **0**, személyes kimenő commit-metaadat
**0**: `.local/verification/20261016-161421-913-github-reviewed-commit-audit.log`.
Az új control-plane kódra is lefutott a vizsgálat: **0 blokkoló találat**,
`.local/verification/20261016-163303-650-phase25-1-privacy-review.log`.
Az új elutasítási tesztben szereplő kitalált user/password URL nem valódi titok.
