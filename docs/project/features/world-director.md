# World Director

## Cél és biztonsági határ

A World Director nem szabadon cselekvő „világisten” LLM. Feladata, hogy egy
kísérleti seedből és cikluskulcsból reprodukálható módon kiválasszon egy előre
jóváhagyott, verziózott eseménysablont. A kezdeti implementáció csak döntést és
digestet készít; nem módosítja a játékvilágot.

## Sablonmodell

Egy sablon az alábbi korlátozott mezőket tartalmazza:

- stabil `templateId` és egzakt `version`;
- allowlistelt `kind`;
- rövid cím és összefoglaló;
- legfeljebb 12 régió és 12 tag;
- 1–100 közötti egész választási súly;
- szerveroldali `status` és `source`.

Az LLM csak az első hat csoportot javasolhatja. A szerver minden extra mezőt
elutasít, majd a szabályos javaslatra is kizárólag `draft` és `llm-proposal`
minősítést tesz. Végrehajtási payload szándékosan nincs a sémában.

## Determinisztikus választás

Az approved sablonok `templateId`, majd `version` szerint rendeződnek. A választó
a seed, a cikluskulcs és minden eligible sablon teljes tartalmának SHA-256
lenyomatából képez súlyozott ticketet. Így:

- azonos bemenet byte-for-byte azonos döntést ad;
- a forráslista sorrendje nem számít;
- egy sablon tartalmi vagy verzióváltozása megváltoztatja a digestet;
- draft és retired sablon soha nem választható.

## Admin-előnézet

Az AI beállítások lap World Director szekciója felsorolja a beépített approved
sablonokat. A seed és cikluskulcs megadásával auditált előnézet kérhető. Az
eredmény sablonverziót, ticketet és digestet mutat, de `simulation: true`, ezért
nem publikál eseményt az engine vagy a modok felé.

## Tartós ciklusnapló és outbox

A gateway tartós SQLite ciklusnaplót és outboxot használ. Egy tranzakcióban kerül
be a determinisztikus választás és a belőle képzett inert jel, ezért félbemaradt
írás nem hagy magára árva ciklust vagy eseményt. A `cycleKey` egyedi: az egzakt
ismétlés idempotens, eltérő seeddel vagy sablonhalmazzal történő újrahasználata
fail-closed hibát ad.

Az automatikus scheduler fix UTC epochból és egész perces intervallumból számolja
a cikluskulcsot. Harminc másodpercenként ellenőriz, de ugyanazt az intervallumot
csak egyszer állíthatja sorba. A [world-director.json](../../../config/world-director.json)
alapból `enabled: false`, tehát telepítés vagy gateway-újraindítás önmagában nem
kezd eseményeket termelni.

Az admin AI lapján az előnézet mellett kézzel is sorba állítható az egzakt ciklus.
Ez auditált és tartós művelet, de továbbra sem world-write: csak `pending` outbox
jel keletkezik. A ciklus- és kézbesítési állapot ugyanott visszanézhető.

## Trusted adapter port

Az outboxot kizárólag névvel és allowlistelt eseménytípusokkal rendelkező adapter
igényelheti. A claim rövid életű, egyszer használható lease-t ad; siker esetén a
jel és a ciklus együtt `delivered`, hiba esetén a jel auditálható `failed` állapotba
kerül és új lease-szel retryzható. Lejárt `delivering` lease összeomlás után
visszavehető, ezért nem ragad bent örökre.

Az adapternek az `eventId` alapján idempotensnek kell lennie. Ha a külső művelet
már sikerült, de a gateway a `delivered` visszaírása előtt áll le, ugyanaz a jel
új lease-szel ismét megérkezhet; az adapter ilyenkor nem hajthatja végre még egyszer
a gazdasági vagy világműveletet.

## Első engine-adapter: globális világjelzés

Az első konkrét trusted adapter mind a négy allowlistelt eseménytípust egyetlen,
veszélytelen engine-műveletre képezi: minden online játékos globális
játéküzenetet kap. Az üzenet whitespace-normalizált és legfeljebb 320 karakter;
az adapter nem adhat tárgyat, pénzt vagy XP-t, nem teleportálhat, és nem írhat
tulajdon-, property- vagy más gazdasági állapotot.

Az engine külön world-tick queue-n fogadja a jelet, majd saját SQLite naplójában
az `eventId` alapján at-most-once módon elfogadja. Egzakt retry nem sugároz újra,
eltérő tartalommal újrahasznált azonosító pedig fail-closed hibát ad. Ez a
megjelenítési adapter a biztonságot választja: ha az engine az elfogadás után,
de a broadcast előtt áll le, az üzenet elveszhet, viszont gazdasági hatás vagy
duplikáció nem keletkezik.

A kézbesítéshez két külön kapcsoló szükséges:

1. A World Adminban aktív legyen a `World Director világjelzések`
   (`simulation.world-director-signals`) hot-reload mod.
2. Az AI beállítások World Director részében legyen bekapcsolva az automatikus
   ciklus és engine-kézbesítés.

A második kapcsoló seedje, UTC epochja és 5–10080 perces intervalluma az adminból
szerverenként menthető. Az érték atomi, `.local/admin/world-director.json`
override-ba kerül, és legfeljebb 30 másodpercen belül érvényesül. Az alapérték
továbbra is kikapcsolt, így frissítés vagy újraindítás nem indít automatikusan
világeseményeket.
