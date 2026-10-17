# 26. fázis – megvalósítás és ellenőrzés

## 26.1 – Felhasználói feladatok szerinti adminfelület (2026-10-17)

Elkészült a meglévő admin információs architektúrájának átszervezése.
Négy csoportban 13 nézet, új Áttekintés első lépésekkel és közvetlen
munkafolyamat-belépésekkel. Önálló nézetet kapott a vállalkozás/foglalkoztatás,
az ajánlat/szerződés, a világszabály/ingatlan és a világesemény. A képességhiányok
és próbák a Képességekhez, a döntési események a Célok és önálló működéshez
kerültek. A globális fejléc szerver- és fiókváltásra szolgál, a műveleti gombok
a megfelelő nézetekben vannak.

Mindegyik nézet rövid cél-/előfeltétel-magyarázatot kapott. A HTML-beli
nézetlista közös forrása az oldalsó navigációnak, a mobilválasztónak és a
kezdőlap kártyáinak. A helyi hash-alapú navigáció támogatja a közvetlen linket,
újratöltést és Vissza/Előre működést, és nem írja át a dokumentum szerverét.
Szabványos hivatkozások, `aria-current`, címre helyezett fókusz és tartalomra
ugró billentyűzetes link segíti a használatot.

[Használat, menürend és határok](features/phase26-1-admin-workflows.md).

### Kiválasztott ellenőrzési kör

Érintett modul: `server/gateway/admin/public`, fogyasztója a gateway és az
önálló control plane. Megváltozott határok: HTML/JS nézetkapcsolat,
áthelyezett űrlapok és eseménykezelők, nézethez kötött adatfrissítés, mobil- és
billentyűzetes navigáció. Az admin és control-plane tesztcsomag, az új valódi
Chrome-próba, root TypeScript és módosított sorok formázása volt indokolt.

Az engine és webclient kódja, API-szerződés, hitelesítés/jogosultság,
adatmodell, runtime-függőség és tesztfelderítés nem változott. Emiatt engine/
webclient typecheck és teljes `verify:full` nem volt szükséges. Az új teszt
a meglévő admin tesztkönyvtárban van, amelyet a root typecheck is lefed.

### Eredmények és exact bizonyítékok

- **Érintett modulok: 424/424 PASS, 0 skip, 90 fájl, 87,96 s.** Parancs:
  `bun test server/gateway/admin server/control-plane/test`.
  A közös wrapper ezután root typechecket indított, amely két új tesztbeli
  DOM-iterálást elutasított (`TS2488`); ezért a teljes parancslánc exitje 2
  maradt, a formázási lépés itt nem indult el. Ez nem zöld teljes kapu.
  Wrapperidő **103,671 s**; napló:
  `.local/verification/20261017-162139-212-phase26-1-affected.log` és azonos
  nevű `.result.json`.
- **Javítás utáni végső kör: PASS, exit 0, 18,575 s.** A tesztben
  `Array.from` váltotta a NodeList spreadet a repository DOM-libjével való
  kompatibilitáshoz. Parancs:
  `bun test server/gateway/admin/navigation-browser.test.ts && bun run typecheck && bun run format:check`.
  Az új Chrome-eset **1/1 PASS**, root TypeScript és formázás **PASS**.
  Napló: `.local/verification/20261017-162346-739-phase26-1-final.log` és
  azonos nevű `.result.json`. A 424 sikeres modultesztet nem ismételtük:
  a végső javítás kizárólag az új teszt DOM-iterálását érintette.
- **Szerkezeti ellenőrzés PASS:** a korábbi HTML mind a 213 elem-ID-ja
  megmaradt, a jelenlegi 219 ID mind egyedi.
- **Dokumentáció:** mind a 39 helyi hivatkozás feloldható. A dokumentáció
  utóellenőrzésénél a sandboxos Bun-indítás `CouldntReadCurrentDirectory`
  hibát adott (0,684 s, `20261017-162458-789-phase26-1-docs.log`). A formázó
  ugyanazon PowerShell-scriptjének közvetlen futtatása PASS, exit 0,
  **1,042 s**, `20261017-162505-756-phase26-1-docs.log`.
- **Vizuális ellenőrzés:** az új kezdőlap 1440 px és 390 px szélességen
  képen átnézve. A böngészős teszt mind a 13 nézetben ellenőrzi, hogy nincs
  vízszintes dokumentumtúlcsordulás. Képek:
  `.local/verification/phase26-1-desktop.png`, `phase26-1-mobile.png`.

A Chrome-eset tényleges login és control-plane HTTP mellett, szintetikus,
memóriabeli fiók/regiszter és izolált gateway-válaszok használatával fut.
Elfogadott láncok: szerverlista → Áttekintés → területi nézet → megfelelő
űrlap; karakterindítás/pillanatkép/világkezelés ablakának megnyitása;
billentyűzetes nézetváltás és tartalomra ugrás; mobilválasztó és kártyalink;
Vissza/Előre, közvetlen link és reload; backendhiba melletti navigáció;
ismeretlen hash visszavezetése. A teszt végig ellenőrzi a szerverfejlécet és
azt, hogy navigációból nem keletkezik módosító backendkérés.

Az első sandboxos Chrome-indítás `Code 34` hibával leállt (1,089 s,
`20261017-161909-325-phase26-1-navigation.log`); ezt nem számítottuk PASS-nak.
A sandboxon kívüli első próba egy tesztfixture-hibát jelzett: a csak hashben
eltérő URL nem töltötte újra a dokumentumot az offline ellenőrzéshez.
Explicit reload után a külön navigációs kör PASS lett (3,051 s,
`20261017-162048-353-phase26-1-navigation.log`). A végső, billentyűzetes
esettel bővített változatot a fenti érintett és végső kör igazolja.

### Elfogadási határ

A 26.1 lezárható. Ez célzott modul-/UI-elfogadás, nem teljes regressziós PASS,
nem minden backendművelet paritási igazolása és nem élő társadalmi futás.
A 26.2 capability-mátrix, a további műveleti visszajelzések, részletes
kontextusos súgók és a végső teljes UX/hozzáférhetőségi audit nyitva maradnak.
Következő feladat: **26.2**.

## 26.2 – Verziózott képességmátrix és kereshető műveletjegyzék (2026-10-17)

Elkészült az **1.0.0** verziójú géppel olvasható mátrix és az abból megjelenő
**Műveletek keresése** oldal, a tulajdonosi és megfigyelési fejlécből elérhetően.
155 bejegyzés 170 konkrét HTTP-módszer/útvonal párt fed le. A lista feladatnévre,
területre és lefedettségre szűrhető; az ékezet nélküli keresés is működik.
Minden bejegyzés előfeltételt, jogosultságot, jelenlegi állapot-/eredmény- és
hibamegjelenítést, létező UI esetén valós oldalt/nézetet/elem-ID-t rögzít.
A hivatkozások a kiválasztott szervert megőrizve területet nyitnak, módosítás
nem indul a jegyzékből.

A mátrix jelenlegi állapota **121 meglévő UI-kötés, 33 felületi hiány és 1
automatikus háttérbetöltés**. A hiányok explicit állapotot és követési mezőt
kaptak a már meglévő 26.7 paritási audit alá. Nincs fiktív belépés, rejtett
kivétel vagy a hiányzó űrlapot pótló általános JSON-végrehajtó. A 26.2 a
lefedettség ellenőrizhető leltára; a 33 hiány lezárása nem része ennek az
eredményállításnak.

[Használat, adatszerződés és karbantartás](features/phase26-2-capability-matrix.md).

### Forráshatár és ellenőrzési kör

Érintett: `server/gateway/admin` statikus kiszolgálója, új jegyzékadata és
felülete, valamint a meglévő tulajdonosi/megfigyelési fejléc. Fogyasztó:
gateway és control plane. A TypeScript AST-alapú audit csak tesztoldali
forrásbeolvasást végez; nem importál routingtartományt vagy domain-adatbázist.

A discovery 139 backend-útvonaldeklarációt, 152 módszerkaput és 137 frontend-
hívásalakot vet össze a verziózott bizonyítékokkal. A hét közös kliens-/helyi
adatbetöltő továbbítás külön, pontos forrásazonosítóval és indoklással szerepel.
Az ismert hiánylistát a teszt külön visszaadja; a regisztrálatlan vagy rosszul
összekötött képességek hibát okoznak. A frontend URL/módszer páros a megadott
backend-műveletváltozatokkal egyezik. Minden gateway-bejegyzés szerepköreit
a valódi `requireDomainAccess` kapuval is ellenőrizzük.

Választott záró kör: teljes érintett admin- és control-plane tesztcsomag,
root TypeScript és módosított sorok formázása. Engine/webclient kód, adatmodell,
migráció, runtime-függőség, gazdasági alap és jogosultsági szabály nem változott;
ezért engine/webclient typecheck és teljes `verify:full` nem volt indokolt.
Az új JSON továbbra is a meglévő hitelesített statikus kiszolgáláson érhető el.

### Elfogadás és exact bizonyítékok

- **Végső érintett kör: 430/430 PASS, 0 fail, 0 skip; root TypeScript és
  formázás PASS, exit 0, 106,205 s.** Parancs:
  `bun test server/gateway/admin server/control-plane/test && bun run typecheck && bun run format:check`.
  Napló: `.local/verification/20261017-164403-976-phase26-2-affected.log`
  és azonos nevű `.result.json`.
- **Célzott végső szerződésellenőrzés: 5/5 PASS, 1,635 s.**
  `.local/verification/20261017-164351-290-phase26-2-final-contract.log`.
  Az új/eltűnt backend-/frontend-deklaráció, módszerváltás, árva kötés,
  hamis UI-állítás, rossz cél-URL és indoklás nélküli hiány negatív esetei
  hibával jeleznek; a normál szerződés és az összes szerepkör-összevetés zöld.
- **Böngészős és szerződéses köztes kör: 6/6 PASS + root typecheck PASS,
  18,553 s.** `.local/verification/20261017-164207-478-phase26-2-guide.log`.
  Az új valódi Chrome-próba belépésen és hitelesített control-plane HTTP-n át
  ellenőrzi a keresést, szűrést, üres állapotot, részletnyitást, mobilos
  szélességet, billentyűzetet, MIME-típust, szerverkontextust és betöltési
  hibából újrapróbálást. A JSON bejelentkezés nélkül 401; a jegyzék használata
  nem küld módosító kérést.
- A meglévő tulajdonosi navigáció és viewer-jogosultsági Chrome-eset is
  sikeres a köztes és a záró érintett körben.
- **Vizuális ellenőrzés:** 1440 px és 390 px képek átnézve;
  `.local/verification/phase26-2-guide-desktop.png` és
  `phase26-2-guide-mobile.png`. A fejlesztői útvonalak külön összecsukott
  részben maradnak. A ritka workflowk részletes súgója a 26.5 feladata.
- **Végleges feliratok utóellenőrzése: 6/6 PASS + stagingelt formázás PASS,
  exit 0, 3,998 s.** A felhasználói kártyákból kikerültek a fejlesztési
  feladatszámok és a fölösleges HTTP/JSON-részletek; a technikai azonosítók
  megmaradtak az összecsukott részben. A frissített képeket újra átnéztük.
  `.local/verification/20261017-164714-946-phase26-2-copy-final.log` és azonos
  nevű `.result.json`. Mind a 42 helyi dokumentációhivatkozás feloldható.

Az első szerződésteszt 5/5 PASS volt, de a sandboxos Bun typecheck-indítása
`CouldntReadCurrentDirectory` hibával állt le; a teljes láncot nem számítottuk
PASS-nak (1,655 s, `20261017-164109-646-phase26-2-contract.log`). A sandboxon
kívüli UI-kör két régi esete sikeres volt, az új eset valódi kattintási hibát
talált: a keresőmező blur/change eseménye újrarajzolta a részletet a kattintás
alatt. A kereső `input` és a választók `change` kezelésének különválasztása
javította. A hibás kör 2 PASS / 1 FAIL marad (6,578 s,
`20261017-164137-102-phase26-2-ui-quality.log`), a javítást a későbbi zöld
célzott és záró kör igazolja.

### Elfogadási határ

A 26.2 mátrix-/árvafelismerési feladata lezárható. Ez nem teljes
backend–frontend paritás: 33 dokumentált hiány nyitott a 26.7 alatt, és az
összes workflow teljes futásidejű elfogadását sem helyettesíti a forrásaudit.
A 26.3 veszélyes műveletek magyarázata és a 26.4 hosszú műveleti visszajelzések
nem készültek el ebben a körben. Következő feladat: **26.3**.
