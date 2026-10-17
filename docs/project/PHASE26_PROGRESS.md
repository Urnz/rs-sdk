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

## 26.3 – Veszélyes műveletek áttekintése és jóváhagyása (2026-10-17)

Elkészült a közös, beküldés előtti áttekintő a tulajdonosi admin,
szerverlifecycle és fiókműveletekhez. A konkrét szerver/célpont, beküldött
azonosítók és állapotverzió mellett öt kötelező magyarázat jelenik meg:
változás, ellenőrizendő adat/bizonyíték, nem bekövetkező hatás,
helyreállítás és biztonságos újrapróbálás.

A capability-mátrix **1.1.0** verzióra bővült (`reviewSchemaVersion: 1`).
A 91 módosító bejegyzésből **64** jóváhagyási policyt, **16** indokolt közvetlen
kezelést, **11** továbbra is hiányzó UI-végrehajtási határt kapott. Az akció,
döntés vagy payload szerinti változatok pontosítják a hatást: például
előnézet/végrehajtás, megszüntetés/meghiúsítás, fizetett/nem fizetett ingatlan
és a hét szerverlifecycle-akció. Az azonnali cél előre engedélyezett autonóm
munkát is kiválthat, ezért jóváhagyási változatot kapott; más időtávok
közvetlenül rögzíthetők.

**31** korábbi natív `confirm()` helyett egy közös áttekintés működik, dupla
megerősítés nélkül. Az indoklást és paramétert bekérő `prompt()` mezők
megmaradtak. A publikálási összeállítás futás-/ellenőrzési bizonyítékai nem
tűntek el; a közös ablakban láthatók, a backend pedig változatlanul ellenőrzi
az approval digestet és emberi jóváhagyási mezőt.

A Mégse és Escape nem indít módosító kérést; a felső Mégse kezdőfókuszt kap,
a kitöltött űrlap megmarad. A jelszó-/API-kulcsmezők értéke rejtett,
ismert titokmezőnevű publikálási paraméterek maszkoltak. A dinamikus tartalom
szövegként renderelődik. Egy második egyidejű áttekintés, az útmutató hibája,
hiányzó policy vagy a megváltozott oldal/szerver blokkolja a kliens beküldését.
Ez UX-kapu, nem a szerveroldali jogosultságellenőrzés helyettesítése.

[Használat és részletes határok](features/phase26-3-operation-reviews.md).

### Kiválasztott ellenőrzési kör

Érintett modul: `server/gateway/admin/public` és a csak tesztoldali
capability-audit. Megváltozott határ: a három meglévő kliens beküldése és
az új jóváhagyási ablak, illetve a capability-mátrix magyarázati szerződése.
Fogyasztók: a gateway és a control plane statikus felülete, korábbi
szerver-/fiók-/kétlapos beállítási Chrome-workflowk.

A modul teljes érintett admin/control-plane körét, a módosított UI-határok
célzott böngészős/szerződéses tesztjeit, root typechecket és formázást
választottuk. Jogosultsági vagy CSRF-szabály, gazdasági/persistence-alap,
runtime-függőség, engine/webclient és tesztfelderítés nem változott, ezért
teljes `verify:full` és engine/webclient typecheck nem volt indokolt.

### Eredmények és exact naplók

- **Célzott induló szerződés: 7/7 PASS, exit 0, 1,614 s.**
  `.local/verification/20261017-170604-457-phase26-3-contract.log`.
- **Új jóváhagyási és korábbi control-plane Chrome-határok: 7/7 PASS;
  root typecheck PASS, exit 0, 71,520 s.** Parancs:
  `bun test server/gateway/admin/operation-review-browser.test.ts server/control-plane/test/browser.test.ts server/control-plane/test/security-browser.test.ts && bun run typecheck`.
  `.local/verification/20261017-170636-805-phase26-3-browser.log` és
  azonos nevű `.result.json`.
- **Egyszeri széles érintett kör: 432 PASS / 1 FAIL / 0 skip,
  exit 1, 102,406 s.** Parancs:
  `bun test server/gateway/admin server/control-plane/test && bun run typecheck && bun run format:check`.
  A parancslánc a teszthibánál megállt; ebben a láncban typecheck/format
  nem futott. `.local/verification/20261017-171143-289-phase26-3-affected.log`
  és azonos nevű `.result.json`.
- A hiba az új teszt beállításában volt: az alap 800 px böngészőméret mobil
  menüt aktivált, miközben a kibővített kísérlet-megszakítási próba az asztali
  oldalsó hivatkozásra kattintott. Explicit 1440 px kezdőméretet kapott;
  a külön 390 px mobilos ablakpróba megmaradt. Assertion és UI-viselkedés
  nem lett kikapcsolva vagy a teszt kedvéért módosítva.
- **Javítás utáni végső érintett kör: 8/8 PASS, root TypeScript és formázás
  PASS, exit 0, 19,072 s.** Parancs:
  `bun test server/gateway/admin/operation-review-browser.test.ts server/gateway/admin/capability-matrix.test.ts && bun run typecheck && bun run format:check`.
  `.local/verification/20261017-171426-690-phase26-3-final.log` és azonos
  nevű `.result.json`. Az időközben pontosított változatleírások és a második
  egyidejű áttekintés próbája is ebben az állapotban szerepel.

A 433 külön érintett tesztesethez a széles és végső célzott kör együtt ad
sikeres bizonyítékot. A széles parancs eredeti hibás exitje megmarad; ez nem
zöld egybefüggő kapu és nem teljes regressziós PASS. A többi 432 sikeres esetet
nem ismételtük, mert a javítás a frissen bővített teszt kezdőméretét érintette.

Az új Chrome-eset valós control-plane login és szintetikus gateway mellett
ellenőrzi a tényleges karakterindítás beküldés előtti megállását, megszakítását,
a titokmezők rejtését, űrlapmegőrzést és dupla kattintás egyszeri továbbítását.
Lefedi a kísérleti jóváhagyás megszakítását, a szövegként megjelenő ellenséges
HTML-t, a párhuzamos ablak elutasítását, az Escape-et, a kontextusváltást és a
hibás útmutató betöltése utáni újrapróbálást. A backend többi régi
üzleti/jogosultsági assertionje és a publikálási bizonyíték-kapuk megmaradtak.

A forrásaudit az összes módosító bejegyzés besorolását, az öt magyarázat
teljességét és a natív confirmok eltűnését ellenőrzi. Külön szemantikus
regresszió védi az archiválás visszaaktiválási hiányát, titoktár-megőrzést,
publikálás/automatikus engedély szétválasztását, végleges emléktörlést és az
eredeti pénzügyi elszámolás újrapróbálásának határát.

**Vizuális QA:** az új áttekintés 1440 px és 390 px méretben képen átnézve;
`.local/verification/phase26-3-review-desktop.png` és
`phase26-3-review-mobile.png`. A felső címet és megszakítást, szövegtörést,
görgethető tartalmat és látható végrehajtási feliratot ellenőriztük.

**Dokumentáció és stagingelt fájlok:** 47 helyi dokumentációhivatkozás
feloldható. A végső formázó PASS, exit 0, **1,618 s**:
`.local/verification/20261017-171836-539-phase26-3-docs.log` és azonos nevű
`.result.json`. Ehhez a dokumentációs lezáráshoz nem ismételtünk runtime-kört.

### Elfogadási határ

A 26.3 lezárható. A 33 korábbi felületi hiány és a 26.7 teljes paritási
audit változatlanul nyitott. A kísérleti űrlap szükséges catch ága elkészült,
hogy a megszakítás ne kezeletlen promise-hiba legyen; ez nem a 26.4 minden
hosszú műveletre és néma kísérleti indításra vonatkozó elfogadása.
Következő feladat: **26.4**.

## 26.4 – Műveletek követhető indítása és eredménye (2026-10-17)

Közös műveleti lista készült a meglévő admin-, szerver- és fiókkezelő
klienshez. Megkülönbözteti a még nem beküldött jóváhagyást, az elküldött
kérést, a visszaigazolt háttérfutást, a lezárt eredményt, a részleges
végrehajtást, a konkrét hibát és a bizonytalan kimenetelt. Nézetváltáskor
megmarad, összecsukható, a lezárt elemek elrejthetők; a modális űrlapban is
látható az állapot. Műveletspecifikus név és érintett kör, időpont,
futásazonosító, részletekre mutató hivatkozás és olvasási ellenőrzőgomb
segíti a használatot. Szöveges státuszok, natív gombok, képernyőolvasós
jelzés és az admin meglévő színváltozói támogatják az elérést.

A Kísérletek a jóváhagyás után rögtön jelzik a beküldést. Az elfogadott
futás a POST-válaszból azonnal megjelenik; egy későbbi listafrissítési hiba
nem teszi sikertelenné az indítást. A konkrét rekordon követett kiosztás,
skillfutás, siker, részleges eredmény és futtatóhiba minden esetben látható
eredményt vagy teendőt ad. Újratöltéskor a szerverről olvasott futó
kísérletek követése felépül. A régi lista pillanatképe nem írhatja vissza
futóra a már lezárt műveleti bejegyzést.

A szerver-karbantartás tartós műveletazonosítója, a skill-run jelentések
és a karakter kért állapotának visszaolvasása külön követett. Karakter
újraindításakor az eredeti online állapot nem elég: a visszaigazolt új
folyamat és annak friss játékállapota szükséges a befejezéshez. Aktiválási,
elszámolási vagy epizódmentési mellékhiba részleges eredmény, az
újraindítást igénylő konfiguráció pedig külön teendő.

Az olvasási követés két másodpercenként fut, három perc után kézi
ellenőrzésre vált. HTTP-kérés: 30 s; műveleti útmutató betöltése: 10 s.
Időtúllépés, elveszett válasz vagy hibás JSON nem jelent igazolatlan
sikert. Automatikus módosító újrapróbálás nincs; azonos függő kérés
lenyomat alapján blokkolt, a kísérleti submit dupla beküldése is védett.
Titokérték és teljes kérésbody nem tárolt a műveleti bejegyzésekben.

A mátrix **1.2.0**, 155 bejegyzés / 170 művelet. Az új karakter- és
kísérletállapot-ellenőrző UI-kötés után **123 elérhető / 31 hiányzó /
1 infrastruktúra** marad. A `reader` hívások konkrét útvonalait az önálló
AST-audit is számon kéri; a két dinamikus továbbító indokolt transport.
A 31 fennmaradó hiány a 26.7 paritási auditban nyitott.

[Használat és működési határok](features/phase26-4-operation-progress.md).

### Ellenőrzési kör és eredmények

Az admin/public kliens, capability-forrásaudit és a control-plane böngészős
határ érintett. Az admin és control-plane modulcsomag, a valódi helyi
Chrome-tesztek, root TypeScript és módosított sorok formázása indokolt.
Backend-API, szerveroldali hitelesítés/jogosultság, gazdasági elszámolás,
tartós adattárolási modell, engine és runtime-függőség nem változott;
teljes `verify:full`, engine- és webclient-typecheck nem volt indokolt.

- **Széles érintett kör: 435/435 PASS, root TypeScript és format PASS,
  exit 0, 203,799 s.** Parancs:
  `bun test server/gateway/admin server/control-plane/test && bun run typecheck && bun run format:check`.
  `.local/verification/20261017-205006-231-phase26-4-affected.log`
  és azonos nevű `.result.json`.
- A széles kör után pontosabb műveletnév/érintett kör és az újraindítás
  eredeti folyamatát kizáró ellenőrzés készült. **Végső célzott kör:
  15/15 PASS, root TypeScript és format PASS, exit 0, 83,371 s.** Ez a kör
  a módosítások próbáit, a közös jóváhagyást és a valós szerver/fiók
  böngészős határokat futtatja:
  `bun test server/gateway/admin/operation-progress-browser.test.ts server/gateway/admin/operation-review-browser.test.ts server/gateway/admin/capability-matrix.test.ts server/control-plane/test/browser.test.ts && bun run typecheck && bun run format:check`.
  `.local/verification/20261017-205345-265-phase26-4-final.log`
  és azonos nevű `.result.json`.

Az első célzott kapuk nem voltak zöldek: az átvezetett közös wrapper régi
forrásszerződését és böngészős várakozásait, majd a root TS DOM-iterálási
hibáját javítottuk. Az érdemi assertionök és a termék jóváhagyási kapui
megmaradtak. A korai hibás naplók megőrzöttek:
`20261017-175312-327-phase26-4-targeted.log`,
`20261017-204637-733-phase26-4-debug.log`,
`20261017-204737-738-phase26-4-targeted-fixed.log`.
Az utóbbi tesztkörben 8/8 PASS után a typecheck állt meg; ez önmagában
nem zöld kapu.

Az új valódi Chrome-próbák késleltetett beküldést, dupla submitot,
megszakított jóváhagyást, nézetváltást, elfogadás utáni listahibát,
hibás státuszolvasás utáni helyreállást, részleges és elutasított
kísérletet, újratöltött futó rekordot, skill-run hibát, régi online
folyamatot és tényleges fetch-időtúllépést fednek le. A bizonytalan
művelet ismételt küldése nem éri el a végrehajtót. Ellenséges HTML
szövegként jelenik meg. A valódi karbantartási böngészőteszt a mentés,
visszaállítás és migráció mindhárom befejezett műveleti kártyáját ellenőrzi.

**Vizuális QA:** 1440 px és 390 px képek átnézve; olvasható állapotok,
szövegtörés, működő belső görgetés és vízszintes túllógás nélküli mobilos
lista. Képek: `.local/verification/phase26-4-progress-desktop.png`,
`phase26-4-progress-mobile.png`.

**Dokumentáció és stagingelt fájlok:** 54 helyi dokumentációhivatkozás
feloldható, formázás PASS, exit 0, 1,583 s.
`.local/verification/20261017-205540-873-phase26-4-docs.log`
és azonos nevű `.result.json`. A dokumentációs lezárás nem igényelt
új runtime-kört.

A követő dokumentumélettartamú, nem új tartós napló. A kísérletek futó
rekordjai újraolvashatók, a többi művelet szerveroldali eredménye az eredeti
kezelési nézetben marad. Az azonosító nélküli HTTP 202 nem kész háttérmunka,
hanem külön állapotellenőrzési teendő. Következő feladat: **26.5**.

## 26.5 – Beépített útmutatók és mezőmagyarázatok (2026-10-17)

A 13 kezelési nézet és a szerver-, fiók-, megfigyelői oldal összesen
16 kontextusához helyi, összecsukható Rövid útmutató készült. Azonos
szerkezetben mutatja az előfeltételeket, a két-három kipróbálási lépést,
a várt eredményt, az elakadások ellenőrzését, az adott nézet fogalmait és
a kapcsolódó nézeteket. Külön magyarázatot kapott a kísérleti profil
mentés/alkalmazás, a draftfuttatás/tesztpróba/publikálás, az esemény
előnézet/sorba állítás/kézbesítés és a mentés-visszaállítás folyamata.

20 mező mellett közvetlen leírás segít az azonosítók, paraméterek,
verziók, UTC-időpontok, pénz- és időegységek, célok, képességek és
hozzáférések megértésében. A szimulációs óra azonosítóihoz konkrét
adatkitöltő gombot nevez meg. A helyi alapértelmezett szerver tulajdonosi
joga és a másik szerver szerepkörkezelése külön szerepel. A mezőleírás
`aria-describedby` kapcsolattal működik, megőrzi a korábbi leírásokat,
és nem hosszabbítja meg a mező akadálymentes címkéjét.

A segítség nem hív API-t, nem küld űrlapot, nem indít műveletet és nem
tárol preferenciát. Nézetváltáskor megtartja a kinyitott állapotot,
a tartalmat az új nézetre cseréli; újratöltéskor összecsukott. A kapcsolódó
hivatkozások a meglévő navigációval, ugyanahhoz a szerverhez vezetnek.
A játékbackend kiesésekor a helyi útmutatók és mezőmagyarázatok olvashatók.

[Használat és működési határok](features/phase26-5-contextual-guides.md).

### Kiválasztott ellenőrzési kör

Változás: statikus admin HTML/CSS, helyi segítségmodul, navigációs
böngészőpróba és új útmutató-/mezőkötési szerződéspróbák. Érintett határ:
mezőcímke és leírás, űrlap DOM, nézetváltás, szerverkontextus, szerver/fiók
és megfigyelői oldalak, valamint a meglévő jóváhagyási és indítási felület.

A közös segítség nem ad új végrehajtási képességet és nem változtat API-t,
szerveroldali auth/jogosultságot, gazdasági vagy tartós modellt, engine-t
vagy runtime-függőséget. Célzott UI-/szerződéses ellenőrzés és root
TypeScript indokolt; teljes `verify:full`, teljes domain-regresszió,
engine- és webclient-typecheck nem volt szükséges.

### Eredmények és naplók

- **Induló útmutató-/navigáció-/capability-kör: 10/10 PASS, root TypeScript
  és format PASS, exit 0, 36,598 s.**
  `bun test server/gateway/admin/workflow-help.test.ts server/gateway/admin/navigation-browser.test.ts server/gateway/admin/capability-matrix.test.ts && bun run typecheck && bun run format:check`.
  `.local/verification/20261017-210057-110-phase26-5-guides.log`
  és azonos nevű `.result.json`.
- **Végső érintett határok: 19/19 PASS, root TypeScript és format PASS,
  exit 0, 54,106 s.**
  `bun test server/gateway/admin/workflow-help.test.ts server/gateway/admin/navigation-browser.test.ts server/gateway/admin/operation-review-browser.test.ts server/gateway/admin/operation-progress-browser.test.ts server/gateway/admin/capability-matrix.test.ts server/control-plane/test/browser.test.ts server/control-plane/test/security-browser.test.ts && bun run typecheck && bun run format:check`.
  `.local/verification/20261017-210232-814-phase26-5-boundaries.log`
  és azonos nevű `.result.json`.
- **Vizuális finomítás után célzott navigációs Chrome és format PASS,
  1/1 teszt, exit 0, 4,496 s.** A mezőmagyarázat betűmérete nőtt,
  a mezők igazítása egységes lett; a képkivágások pontosításával az
  útmutató és a mobilos mezők külön is láthatók.
  `bun test server/gateway/admin/navigation-browser.test.ts && bun run format:check`.
  `.local/verification/20261017-210354-213-phase26-5-visual-final.log`
  és azonos nevű `.result.json`. TypeScriptet és változatlan runtime-kört
  a CSS-finomságok után nem ismételtünk.

A böngészőpróba minden nézetben tényleges súgót és célpontot ellenőriz,
billentyűzetes nyitást, mezőleírásokat, űrlapérték-megőrzést, útmutatóból
indított nézetváltást, Vissza/Előre működést, újratöltést és mobilválasztót.
Leállt játékbackend mellett a szerver-, fiók- és megfigyelői útmutató
is elérhető; valódi, nézői fiókkal a megfigyelői súgó jelenik meg,
kezelési űrlap nélkül. A segédlet bejárása nem küld módosító gateway-kérést.
Az összes meglévő jóváhagyási, időtúllépési, dupla indítási és szerver-/fiók-
regressziós assertion megmaradt.

**Vizuális QA:** 1440 px asztali és 390 px mobilos útmutató, külön mobilos
mezőleírás átnézve. Nincs vízszintes túllógás; a natív összecsukás,
szövegtörés, egységes mezőmagasság és jól olvasható magyarázat ellenőrzött.
Képek: `.local/verification/phase26-5-help-desktop.png`,
`phase26-5-help-mobile.png`, `phase26-5-fields-mobile.png`.

**Dokumentáció:** 60 helyi hivatkozás feloldható, stagingelt formázás PASS,
exit 0, 1,661 s. Napló:
`.local/verification/20261017-210453-054-phase26-5-docs.log`
és azonos nevű `.result.json`. A dokumentációs lezárás nem indokolt
újabb runtime-kört.

A 26.5 lezárható. A 31 korábbi capability-hiány változatlanul a 26.7
paritási auditban nyitott; a következő feladat a **26.6 kritikus
admin-workflowk böngészős és API/UI szerződéses lefedése**.

## 26.6 – Kritikus workflowk API/UI szerződése (2026-10-17)

Hat új Chrome-eset készült a tényleges control-plane és gateway API-kezelők
között. A profil űrlapjától a valódi tárolóig, az AI-konfiguráció számaitól
a mentett felülbírálásig, a világszabály jóváhagyásától a részleges
aktiválásig és a revízióütközésig, az esemény-előnézettől az idempotens
sorba állításig, a publikálási lenyomattól a verified fájlig, valamint
az ajánlati/vállalkozási űrlaptól a tartós rekordig járják végig a folyamatot.

Az üres és betöltési állapotot késleltetett profilválasz ellenőrzi;
helytelen JSON nem küld írást. A siker valódi, újratöltés után is látható
eredmény. A részleges állapotnál a konfiguráció elmentődik, az aktiválás
sikertelen, az ok és teendő megmarad. A hibák közé tartozik a nem érvényes
modell, változtathatatlan profilverzió, elavult revízió és közben megváltozott
publikálási bizonyíték. A sikertelen ellenőrzésű próbához nincs publikálógomb.

Minden eset külön Bun gyermekfolyamatot és saját `rs-admin-contract-*`
temp gyökeret kap. A tesztútvonalak és a memóriabeli titoktár adaptere
csak a gyermekben él; más teszt modulregiszterére nincs hatása. A statikus
UI a checkoutból olvasott, a konfigurációk ismert másolatai, az adatbázisok,
az audit és a publikált tesztképesség kizárólag a temp gyökérbe írhatók.
A böngésző/gyermek leállítása és a gyökérrel ellenőrzött rekurzív cleanup
kezelt. A hiányzó játékkomponensek üres adapterek; bot, AI-provider,
valódi titoktár és gazdasági kifizetés nem indul.

**Megtartott határ:** a publikálás előkészített, szintetikus verifier-
jelentést használ; az élő bizonyítékképzés nem ebben a böngészőtesztben fut.
A kézbesítési hiba/siker a valódi outbox lease API-jával léptetett,
nem tényleges engine-workerrel. A pénzmozgások atomi domain-szabályainak
meglévő tesztjei változatlanok.

### Javított hibák

A világszabály Mentés gombjában a jóváhagyási összefoglaló a nem definiált
`mod` változót használta. A gomb így a kérés előtt `mod is not defined`
hibával megállt. Most a kijelölt azonosítóhoz tartozó aktuális szabályt
oldja fel, hiány esetén érthető frissítési teendőt ad. A böngészőteszt
ellenőrzi a konkrét beállításnevet/értéket, a PUT-ot, a mentett revíziót,
a megmaradó aktiválási hibát és az újabb konfiguráció védelmét.

A széles körben egy korábbi navigációs teszt a hashváltás közben lecserélt
súgó DOM-elemére kattintott. A teszt most az új nézet konkrét súgóját várja,
és frissen feloldott, stabil elemet kereső locatorral kattint. Termék-
viselkedés, assertion és időlimit nem lett a hiba elfedésére módosítva.

[Részletes lefedettség, korábbi kritikus tesztek és korlátok](features/phase26-6-workflow-contracts.md).

### Kiválasztott kör és végső eredmények

Érintett modul: admin felület világszabály-mentése, Chrome-szerződéscsomag
és a navigációs teszt. Határok: valódi űrlap/HTTP/tároló szerződés,
jóváhagyás, állapotmegjelenítés, izolált konfiguráció/titokadapter,
control-plane proxy és szerverkontextus. Indokolt az admin/control-plane
modulcsomag és a root TypeScript. Szerveroldali API, auth/jogosultsági kapu,
tartós adatmodell, gazdasági alap, engine vagy runtime-függőség nem
változott; teljes `verify:full`, engine-/webclient-typecheck nem indokolt.

- **Öt valódi API/UI folyamat és root TypeScript/format: 5/5 PASS,
  exit 0, 52,681 s.**
  `bun test server/gateway/admin/admin-workflow-contract-browser.test.ts && bun run typecheck && bun run format:check`.
  `.local/verification/20261017-211421-767-phase26-6-contracts-final.log`
  és azonos nevű `.result.json`.
- **Kereskedelmi kiegészítés: 1/1 PASS, exit 0, 3,698 s.**
  `bun test server/gateway/admin/admin-workflow-contract-browser.test.ts -t "commercial forms"`.
  `.local/verification/20261017-211841-500-phase26-6-commerce-pass.log`
  és azonos nevű `.result.json`.
- **Széles érintett kör: 442 PASS / 1 FAIL / 0 skip, exit 1,
  157,264 s.** A hat új szerződéses eset mind sikeres. A hiba a fent leírt
  navigációs DOM-időzítés volt. A lánc itt megállt, a typecheck és format
  ebben a láncban nem futott.
  `bun test server/gateway/admin server/control-plane/test && bun run typecheck && bun run format:check`.
  `.local/verification/20261017-211924-222-phase26-6-affected.log`
  és azonos nevű `.result.json`.
- **Navigáció javítás után három külön futásban 3/3 PASS; root TypeScript
  és format PASS, exit 0, 52,710 s.**
  `foreach ($attempt in 1..3) { bun test server/gateway/admin/navigation-browser.test.ts; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }; bun run typecheck && bun run format:check`.
  `.local/verification/20261017-212314-956-phase26-6-navigation-final.log`
  és azonos nevű `.result.json`. A három futás ugyanannak az egy
  navigációs esetnek az ismétlése, nem három új külön teszt.

A 443 külön teszthez a széles és a végső javított kör együtt ad sikeres
bizonyítékot. A széles parancs hibás exitjét nem írjuk át zöldnek, és ez
nem teljes regressziós PASS. A másik 442 sikeres esetet a kizárólagos
navigációs tesztjavítás után nem ismételtük.

### Korai diagnosztika megőrzése

A kezdeti API/UI kör két hibás újratöltési tesztfeltétele az azonos URL
hash-navigációjából adódott; a segéd most valódi újratöltést kér.
A következő kör a tényleges világszabály-mentési hibánál állt meg, és a
globális tesztidőtúllépés után másodlagos Chrome-profil cleanup EBUSY is
naplózott. A rövidített, diagnosztikus várakozás megmutatta a `mod`
hibát; a termékhiba javítása után az öt eset és a typecheck sikerült.
Naplók: `20261017-211057-734-phase26-6-contracts-first.log`,
`20261017-211236-829-phase26-6-contracts-fixed.log`,
`20261017-211349-025-phase26-6-world-debug.log`.

A kereskedelmi fixture felépítésekor hiányzó játékosnév, üres botfelügyeleti
lista, üres beépített katalóguskönyvtár és statikus hagyatéki policy pótlása
volt szükséges. Az ajánlat/vállalkozás létrehozása a meglévő policy szerint
közvetlen; az elutasítás kér külön áttekintést. A teszt ezt követi, és a
közvetlen lépésnél a váratlan jóváhagyási ablak hiányát is ellenőrzi.
A hibás korai `phase26-6-commerce*` naplók megmaradtak; a végső egyedi és
széles körben ez a folyamat is sikeres. Assertion nem lett kihagyva.

A 26.6 lezárható. Következő: **26.7 használhatósági, hozzáférhetőségi,
reszponzív és capability-paritási audit**, a 31 ismert felületi hiánnyal.
