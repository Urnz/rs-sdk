# 26.5 – Rövid útmutatók és helyben olvasható magyarázatok

2026-10-17. A meglévő helyi adminfelületbe épített segítség; nem új
backend-funkció vagy automatikus beállításvarázsló.

## Hol található?

A 13 kezelési nézet címe alatt **Rövid útmutató** nyitható ki. Tartalma
az aktuális nézetet követi, beleértve a mobilválasztót, a közvetlen
hivatkozást és a böngésző Vissza/Előre navigációját. A Saját szervereim,
a Fiók és jogosultságok, valamint a megfigyelői oldal saját útmutatót kapott.
Összesen 16 kontextushoz van helyi leírás.

Az útmutató alapból összecsukott. Ha kinyitod, a következő kezelési nézetben
is nyitva marad, az új nézethez tartozó szöveggel. Újratöltés után ismét
összecsukott. Billentyűzettel a címsorra lépve Enter vagy Szóköz nyitja;
az útmutató kapcsolódó nézetei szabványos hivatkozások.

Minden útmutató azonos rendben mutatja:

- **Mielőtt elkezded:** a valóban szükséges előfeltételek.
- **Próbáld ki lépésről lépésre:** két-három konkrét lépés a meglévő
  képernyők és gombok nevével.
- **Ezt ellenőrizd az eredményben:** miből látható, hogy a lépés sikerült.
- **Ha elakadnál:** mit érdemes ellenőrizni, hiányzó adat vagy hiba esetén.
- **Fogalmak ezen a képernyőn:** az éppen szükséges belső kifejezések
  közérthető jelentése és kapcsolódó kezelési nézetek.

## Ritkább munkafolyamatok

A kísérletek útmutatója különválasztja a profil mentését és alkalmazását,
a résztvevők kiválasztását, a futás követését és az összehasonlítást.
Az azonos seed önmagában nem azonos kezdő világállapot. A mérési pillanatkép
és a visszaállítható szervermentés külön fogalom.

A képességpróbák leírása megkülönbözteti a kézi draftfuttatást, a kijelölt
tesztkarakteren gyűjtött bizonyítékot, annak ellenőrzését és a publikálást.
A publikálás után a tanulás és az automatikus használat engedélye külön
ellenőrizendő. A hozzáférési jogosultság nem jelenti, hogy az agent már
megtanulta a képességet.

A világeseményeknél az előnézet, a tartós sorba állítás és a játékbeli
kézbesítés külön lépés. A leírás megnevezi a két engedélyező beállítást
és a ciklusnaplót. A világszabályoknál a mentett és az aktív konfiguráció,
valamint az újraindítás nélküli aktiválás korlátja is érthetően szerepel.

A szerveroldalon a létrehozás utáni külön indítás, a mentések betöltése és
kiválasztása, a visszaállítás és a verzióváltás utáni leállított állapot
ellenőrzése kap helyet. Az archiválás jelenlegi visszaaktiválási hiánya
szerepel a magyarázatban. A fiókkezelés tisztázza, hogy új fiókot a helyi
alapértelmezett szerver tulajdonosa hozhat létre; a fiók létrehozása nem ad
automatikusan szerverhozzáférést.

## Mezők melletti segítség

20 mező kap helyben olvasható magyarázatot: profilverzió és JSON-szerkezet,
seed és profilválasztás, szerződéses tárgysorok, vállalkozás- és
ingatlanazonosító, UTC-idő, agentlista és szimulációs óraadatok,
eseményütemezés és cikluskulcs, mikro-USD és milliszekundum,
célhierarchia, képességverzió, szerververzió és jelszócsere.

Az óraazonosító és annak ellenőrző lenyomata az **Óraadatok kitöltése**
gombbal kérhető le; a felhasználónak nem kell ezeket kitalálnia. A pénz-
és időegységekhez konkrét átváltási példák tartoznak.

A magyarázat `aria-describedby` kapcsolattal tartozik a mezőhöz, és
megőrzi a már létező leírásokat. A címkén kívül jelenik meg, így a mező
akadálymentes neve nem válik hosszú súgószöveggé. A címke, mezőnév,
érték, validáció és űrlapbeküldési szerződés változatlan.

## Működési határok

A segítség helyi statikus tartalom; nem kér adatot a backenden, nem indít
műveletet, nem tölti ki vagy küldi be helyetted az űrlapot, és nem tárol
böngészős preferenciát. A kapcsolódó nézetre lépés a meglévő navigációt
használja, a kiválasztott szerver kontextusának megőrzésével.

Az útmutató a játékbackend kiesésekor is elérhető. Nem minősíti sikeresnek
a műveletet: az eredményt a Műveletek lista és a tényleges futási adatok
igazolják. Hiányzó kezelési funkcióhoz nem ígér új végrehajtási lehetőséget;
a 31 korábbi capability-hiány a 26.7 paritási auditban marad nyitott.

[Roadmap](../TASKS.md), [ellenőrzési napló](../PHASE26_PROGRESS.md),
[előző: műveletek követése](phase26-4-operation-progress.md).
