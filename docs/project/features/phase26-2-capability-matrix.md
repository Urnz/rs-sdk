# 26.2 – Verziózott adminművelet-jegyzék és paritási szerződés

2026-10-17. A 26.1 navigációjára épülő, csak olvasó műveletjegyzék és a
backend–frontend kapcsolatok ellenőrzése. A helyi/private emulator adminjára
vonatkozik; hivatalos RuneScape szolgáltatáshoz nem kapcsolódik.

Az alábbi verzió- és bizonyítékszámok a 26.2 elfogadáskori, 1.0.0-s
állapotot rögzítik. A 26.3-ban a mátrix 1.1.0-ra bővült a
[műveleti jóváhagyási szabályokkal](phase26-3-operation-reviews.md);
a műveletek és ismert felületi hiányok száma változatlan.

## Használat

A szerver fejlécében válaszd a **Műveletek keresése** hivatkozást. A korlátozott
megfigyelési nézetből is elérhető, ugyanahhoz a szerverhez kötve. Az oldal
`/admin/capabilities.html?serverId=…` címen nyitható meg.

- Kereshetsz feladatnévre, például „karakter indítása”, „mentés” vagy „öröklés”.
  Az ékezet nélküli keresés is működik.
- Szűrhetsz kezelési terület és felületi elérhetőség szerint.
- A kártya elmondja az előfeltételeket. A részletekben a szükséges hozzáférés,
  állapotkövetés, eredmény és hibamegjelenítés szerepel.
- A **Megnyitás** az adott kezelési területre vezet, a kiválasztott szervert
  megőrizve. Nem hajt végre módosítást és nem vált ki megerősítő párbeszédet.
- A **Felületi kezelés hiányzik** jelzés tényleges hiányt jelent. Ilyen
  kártyán nincs végrehajtási hivatkozás. A kártya nem helyettesíti az űrlapot.
- Üres találatnál teendőt adó üzenet, sikertelen betöltésnél újrapróbálási
  gomb jelenik meg. A keresés, szűrés és részletnyitás billentyűzettel is működik.

A technikai azonosítók külön, összecsukott részben vannak. A műveletjegyzék
ismerete nem követelmény a rendes kezelőfelületek használatához.

## Verziózott adat és lefedettség

A forrás: `server/gateway/admin/public/capability-matrix.v1.json`,
`schemaVersion: 1`, tartalomverzió **1.0.0**, felülvizsgálat **2026-10-17**.
Jelenlegi terjedelem: **155 bejegyzés, 170 konkrét HTTP-módszer/útvonal pár**.
Egy bejegyzés egy módszert tartalmaz; például az olvasás és a mentés külön
sorban van. A véges akcióváltozatok az `operations` mezőben szerepelnek.

Minden bejegyzéshez tartozik stabil azonosító, feladatnév és kezelési terület,
backend- és frontend-forráshivatkozás, HTTP-módszer és útvonalváltozatok,
jogosultság/előfeltétel, állapot, eredmény, hibamegjelenítés és lefedettségi
állapot. A meglévő felülethez oldal, nézet, valós elem-ID és felirat tartozik.
A szerepkörök géppel ellenőrizhetően is szerepelnek; a szerverlifecycle
akciónként külön tulajdonos/üzemeltető szabályt rögzít.

A jelenlegi állapot:

- **121 bejegyzés:** létező felületi kapcsolat és belépési hely.
- **33 bejegyzés:** nincs közvetlen felületi kapcsolata; explicit ismert hiány.
- **1 bejegyzés:** automatikusan betöltött admin-kapcsolati konfiguráció,
  önálló felhasználói művelet nélkül.

A 33 hiány nem lett elrejtve vagy késznek jelölve. Ide tartozik többek között
a népesség-utánpótlás, öröklés/tudásátadás, világkezdet, hosszú társadalmi
futások és gazdasági függőségek egyes külön riportjai, admin audit és teljes
agent-idővonal. Olyan külön API is ide kerülhet, amelynek adatai más,
összetett UI-kérésből már részben láthatók; ez nem az önálló endpoint
felületi bekötésének bizonyítéka. Az explicit `followup: 26.7` a meglévő
paritási audit és hiányzárás feladatához köti őket.

A bejegyzésben leírt jelenlegi visszajelzés nem minden esetben teljes
futáskövetés. Különösen a Kísérletek néma indításának javítása változatlanul
a 26.4 feladata. A jegyzék ezt nem állítja elkészültnek.

## Forrásalapú ellenőrzés

A `capability-audit.ts` a TypeScript szintaxisfáján járja be a gateway
`routes.ts`, a control-plane `service.ts` és `auth.ts` fájlját, valamint az
admin `public` könyvtár összes JavaScript-fájlját. Nem importál handlert,
nem nyit domain-adatbázist és nem indít játékfolyamatot.

A verziózott bizonyítékok **139 backend-útvonaldeklarációt**, **152
HTTP-módszerkaput** és **137 frontend-hívásalakot** rögzítenek. Az azonos
forrásazonosítók a fájl, típus és normalizált kód SHA-256 lenyomatából
származnak. Hét pontosan azonosított kliens-/adatbetöltő továbbítás külön
indoklással szerepel, nem felhasználói képességként.

A teszt hibát ad új vagy eltűnt deklarációra/hívásra, megváltozott
módszerkapura, regisztrálatlan backend-/frontend-kapcsolatra, hibás hivatkozásra,
indoklás nélküli hiányra és olyan kész UI-állításra, amely mögött nincs
belépési hely vagy tényleges hívás. A frontend-hívás URL-szerkezete és
HTTP-módszere a hozzá rendelt műveletváltozattal is egyezik. Az oldal/nézet/
elem-ID valós létezését külön ellenőrzés igazolja. A gateway szerepköreit a
teszt minden bejegyzésre összeveti a valódi jogosultsági kapuval.

Negatív tesztek mesterségesen eltávolítanak egy backend-/frontend-kötést,
új útvonalat és klienshívást vezetnek be, meglévő módszert változtatnak meg,
rossz backendcélt rendelnek a klienshez és elhagyják a hiány indoklását.
Ezeknek konkrét hibával kell megbukniuk. A 33 ismert hiány listázása a
paritási eredmény része, nem tesztkihagyás.

## Karbantartási rend és korlátok

Új vagy módosult műveletnél először a forráskötési hibát kell megvizsgálni,
majd felülvizsgálni a kézzel karbantartott műveletleírást, módszert,
jogosultságot, előfeltételt és UI-kötést. Az evidence-lista automatikus
elfogadása nem bizonyít helyes képességleírást. A tartalomverziót és a
felülvizsgálati dátumot a szerződés módosításakor frissíteni kell.

Gyors szerződésellenőrzés:
`bun test server/gateway/admin/capability-matrix.test.ts`.
Böngészős elfogadás:
`bun test server/gateway/admin/capability-browser.test.ts`.
A repositoryban ezeket a `scripts/invoke-verification.ps1` wrapperrel futtatjuk.

A forrásellenőrzés deklaráció-/hívásszerkezetet és ismert frontend-átjárókat
vizsgál, nem HTTP-sémagenerátor vagy minden kérésparaméter futásidejű
bizonyítása. Új kliensátjáró bevezetésekor a discoveryt és negatív tesztjét is
bővíteni kell. A meglévő műveleti integrációs tesztek továbbra is szükségesek.
A látható belépési hely önmagában nem bizonyít teljes üzleti workflowt,
hozzáférhetőséget vagy backend–frontend paritást.

Az új oldal és JSON a meglévő hitelesített statikus kiszolgálást használja,
JSON MIME-típussal és `no-store` fejléccel. Jogosultsági szabály, munkamenet,
adatmodell, titoktár vagy runtime-függőség nem változott. Migráció nem kell;
visszaállítás a felületi fájlok előző verziójára történhet. A működő admin
újratöltés után a repository aktuális statikus fájljait szolgálja ki. A
JSON MIME-típus új szerveroldali bejegyzése az adminfolyamat következő
indításától él; a jegyzék JSON-betöltése a régebbi statikus kiszolgálással
is működik. A működő helyi szolgáltatásokat ebben a fejlesztési körben nem
indítottuk újra.

Eredmények és exact naplók: [26. fázis ellenőrzése](../PHASE26_PROGRESS.md).
