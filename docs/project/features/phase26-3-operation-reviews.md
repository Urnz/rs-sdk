# 26.3 – Érthető áttekintés a veszélyes műveletek előtt

2026-10-17. A meglévő adminműveletek jóváhagyási és magyarázati felülete;
backend-végrehajtási, gazdasági vagy jogosultsági szabályt nem módosít.

## Felhasználói működés

A veszélyes vagy emberi jóváhagyást kérő módosítások előtt egységes ablak
nyílik. A kitöltött űrlap és a kiválasztott művelet alapján mutatja:

- az érintett szervert/fiókot, célpontot és a beküldendő állapotverziót,
  mentés-, tranzakció-, futás- vagy jóváhagyási azonosítót;
- **Mi változik?** – a konkrét döntés vagy akció hatását;
- **Milyen adatok alapján?** – azokat az adatokat és bizonyítékokat, amelyeket
  a backendnek újra ellenőriznie kell;
- **Mi nem történik meg?** – például a megszakítás nem fordít vissza már
  megtörtént átadást, a publikálás nem ad automatikus végrehajtási engedélyt;
- **Helyreállítás** és **Újrapróbálás hiba esetén** – tényleges lehetőség és
  korlát, automatikus visszavonási ígéret nélkül.

A felső **Mégse** gomb kap kezdőfókuszt, így hosszú tartalomnál is az ablak
eleje látható. Az alsó végrehajtógomb a súlyos műveleteknél konkrét feliratot
kap, például „Emlékek végleges törlése” vagy „Leállítás és mentés”. A Mégse
és az Escape módosító kérés nélkül visszatér az eredeti felületre; a beírt
adatok megmaradnak. Az elindítás előtti megszakítás nem ismeretlen kimenetelű
szerverműveletként jelenik meg.

Mobilon az ablak görgethető, a tartalom egy oszlopba rendeződik; a jóváhagyás
és megszakítás elérhető marad. A párbeszéd natív `dialog`, megnevezett címmel,
fókuszvisszaadással és billentyűzetes megszakítással működik.

## Lefedettség és konkrét különbségek

A capability-mátrix tartalomverziója **1.1.0**, az új `reviewSchemaVersion`
értéke **1**. A 155 bejegyzés és 170 HTTP-művelet változatlan. A 91 módosító
bejegyzés közül:

- **64** műveletspecifikus jóváhagyási szabályt kapott. Egyes változatok
  feltételesek: az azonnali cél jóváhagyást kér, a többi időtáv közvetlenül
  rögzíthető; a tervezési előnézet és a valódi végrehajtás eltérő magyarázatot kap.
- **16** indokoltan közvetlen marad, például be-/kijelentkezés, adatpillanatkép,
  új paraméterprofil vagy még nem aktív ajánlat rögzítése. A közvetlenség nem
  jelent szerveroldali ellenőrzés vagy audit nélküli végrehajtást.
- **11** továbbra sem rendelkezik felületi végrehajtással. Bekötésükkor előbb
  műveleti magyarázat és jóváhagyási szabály szükséges; a jelenlegi kliensből
  nem válnak végrehajthatóvá pusztán a jegyzékbe kerüléstől.

A 31 korábbi natív `confirm()` helyét a beküldés előtti közös áttekintés vette
át, így nincs régi és új megerősítés egymás után. Az indoklást vagy más adatot
bekérő korábbi `prompt()` mezők megmaradtak; ezek további űrlapos egységesítése
nem ennek a feladatnak az eredményállítása.

Kiemelt, külön kezelt esetek:

- **Karantén és emléktörlés:** a bot karanténja csak ellenőrzött helyi kézi
  visszaállítást kínál, admin-visszaállítógomb nélkül. Az elévült, nem hivatkozott
  emlék törlése az adminból nem vonható vissza.
- **Pénzügyek:** ajánlatelfogadás, fedezetfoglalás, teljesítési bizonyíték,
  elszámolás és végleges meghiúsítás külön jelentést kap. Hiba után az eredeti
  szerződést/megbízást kell visszaolvasni; új jutalom létrehozása nem helyreállítás.
- **Ingatlanegyeztetés:** a tényleges mentésbeli terhelés ellenőrzése szükséges.
  A terhelés igazolása vagy a ki nem fizetett foglalás felszabadítása nem von
  le és nem fizet vissza pénzt.
- **Képességpublikálás:** a konkrét draft/verzió, tesztkarakter, paraméterek,
  bizonyító futások, ellenőrzési arány és jóváhagyási azonosító megmarad az
  áttekintésben. A beküldött digestet és `confirmHumanApproval` mezőt a backend
  továbbra is ellenőrzi; jóváhagyás nélkül nem küldjük el a publikálási kérést.
- **AI és engedélyek:** a kapcsolók, modell, keretek és a megadott automatikus
  képességek korlátai áttekinthetők. A már elköltött modellköltség és a
  megtörtént játékbeli lépések nem válnak visszavonhatóvá a kapcsoló leállításától.
- **Szerverlifecycle:** az indítás/leállítás, archiválás, teljes offline mentés,
  visszaállítás és forrásmigráció eltérő magyarázatot kap. Az archivált világhoz
  nincs visszaaktiválási gomb. Mentés, restore és migráció után a világ leállítva
  marad; a restore a titoktárat nem cseréli le.

## Bizonyítékok, titkok és hibák

Az ablak a **beküldendő** adatokat mutatja, nem állítja, hogy a szerver már
elfogadta őket. A szerver minden revíziót, jogosultságot, fedezetet és
bizonyítékkötést a korábbi kapukon újra ellenőriz. Az itt látható indoklás
nem helyettesít valódi futási vagy pénzterhelési bizonylatot.

A külön jelszó- és API-kulcsmezők értéke nem kerül az összefoglalóba. Az ablak
csak megjegyzés/csere/törlés tényét jelzi; a botjelszó megjegyzése a Windows
titoktárra hivatkozik. A publikálási paraméterek ismert titokmezőnevei maszkoltak.
Minden dinamikus felirat `textContent` útján kerül a DOM-ba, nem végrehajtható
HTML-ként.

Az offline mentés új pénz-/XP-/tárgyértékei külön lenyithatók. A világszabály
szerkesztésekor a valódi beállításfeliratok és a beküldendő értékek is megmaradnak.
Ezek nem kerülnek új háttérkérésbe: az áttekintési kontextust az API-kliens
leválasztja a HTTP-opciókról.

Útmutatóbetöltési, hiányzó policy- vagy kontextusváltási hiba esetén a módosító
kérés nem indul el. Az útmutató betöltése újrapróbálható. Egyidejű második
áttekintés elutasítást kap; az első ablak megmarad. A natív Mégse, Escape és a
dupla jóváhagyás viselkedését külön böngészős eset ellenőrzi.

## Implementáció és ellenőrzési határ

A közös `operation-review.js` az admin `api`, a szerverlista `lifecycleApi`
és a fiók `accountApi` kliensének módosító küldése elé került. A be-/kijelentkezés
nem igényli a hitelesített jegyzék előzetes betöltését. A kiválasztott szerver
kontextusát az admin a jóváhagyás előtt és után is ellenőrzi.

A verziózott `review` mező tartalmazza az öt kötelező magyarázatot, az akció- vagy
payloadváltozatokat és a jóváhagyási feliratot. A forrásaudit ezek teljességét,
a közvetlen kivételek indokát és a továbbra is hiányzó UI-k határát vizsgálja.
Az új, csak olvasó jegyzékbetöltés a nyolcadik konkrét frontend-továbbítás;
a forrásleltár így 138 frontend-hívásalakot tartalmaz. Backendútvonal és
jogosultsági kapu nem változott.

A meglévő böngészős workflowtesztek kifejezetten végigkattintják az új
áttekintést; az eredeti üzleti, jogosultsági és állapotassertionök megmaradtak.
Az új Chrome-próba valódi control-plane HTTP-t és szintetikus gateway-t használ,
és a beküldött módosító kéréseket számlálja. A kísérleti űrlap szükséges
hiba-/megszakítási catch ága is elkészült, hogy az új jóváhagyás megszakítása
ne legyen kezeletlen promise-hiba. Ez nem a 26.4 teljes futáskövetési elfogadása.

Nincs adatmodell- vagy migrációváltozás; a régi API-kérésprotokoll, backend-
audit, CSRF és szerepkörszabály érvényben marad. Az ellenőrzés érintett admin/
control-plane körből, root typecheckből és formázásból áll. Engine/webclient
és teljes regresszió nem indokolt e kizárólagos felületi változás miatt.

Exact eredmények, időtartamok és a köztes teszthiba:
[26. fázis naplója](../PHASE26_PROGRESS.md).

A működő admin az oldal újratöltésekor veszi át a friss statikus fájlokat;
játékszerver- vagy adminfolyamat-újraindítást nem végeztünk. Kód-visszaállításnál
a felületi fájlokat és a hozzájuk tartozó mátrixverziót együtt kell visszaállítani,
majd az oldalt újratölteni. Felhasználói adat migrációja nem szükséges.
