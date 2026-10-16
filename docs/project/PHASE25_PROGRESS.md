# Phase 25 – több-szerveres admin vezérlőközpont

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
