# Vásárolható ingatlanok – tervezési vázlat

## MVP

Egy játékos megvizsgálhat és megvásárolhat egy előre definiált ingatlant. A szerver
ellenőrzi az árat és a tulajdonjogot, atomi módon levonja a pénzt, majd tartósan
elmenti a tulajdonost. Más játékos ugyanazt az ingatlant nem vásárolhatja meg.

## Minimális adatmodell

- `propertyId`: stabil, migrációbiztos azonosító.
- `displayName`: játékosnak megjelenő név.
- `location` és belépési pontok.
- `purchasePrice`.
- `ownerPlayerId`: opcionális tulajdonos.
- `status`: elérhető, foglalt, zárolt vagy letiltott.
- `version`: későbbi migrációkhoz.

## Katalógus és domainállapot szétválasztása

A verziókezelt `config/properties.json` csak a világban létező ingatlanok stabil
definícióját tartalmazza: hely, ár, típus, belépési pontok, bevételi és
karbantartási szabályok, valamint szerepalapú jogosultságok. A konfiguráció
induláskor fail-closed validációt kap; hibás vagy ismétlődő azonosítóval nem
indulhat el ingatlanmod.

A tulajdonos, a vásárlás időpontja, az aktuális állapot és a revízió külön
`PropertyState` domainállapot. Ez később tranzakciósan és migrálhatóan
perzisztálódik. A katalógus cseréje vagy a mod felfüggesztése nem törölhet és nem
írhat felül tulajdonjogot.

Az első katalógus három eltérő tesztesetet ad:

- `varrock.east-workshop`: termelési/vállalkozási műhely;
- `falador.south-house`: lakóingatlan és későbbi bérleti alap;
- `karamja.fishing-hut`: halászati raktár és ellátási lánc.

A koordináták jelenleg konfigurációs tesztpontok. Játékbeli loc/ajtó bekötés előtt
mindegyiket vizuálisan ellenőrizni kell, és szükség esetén a katalógusban módosítani.

## Kötelező szerveroldali szabályok

- A kliens által küldött ár és tulajdonos soha nem hiteles.
- A vásárlás előtt újra kell olvasni az aktuális egyenleget és tulajdonjogot.
- Pénzlevonás és tulajdonosváltás egyetlen tranzakció.
- Az ismételt vagy párhuzamos kérés idempotensen/konfliktussal zárul.
- Minden adminisztratív módosítás auditálva legyen.

## Nem része az első MVP-nek

Eladás, bérbeadás, adó, társtulajdon, aukció, berendezés és fejlesztési szintek.

## Lifecycle

Az ingatlanmod kikapcsolási policyje legalább `read-only`: ilyenkor új vásárlás
és módosítás nem történhet, de a meglévő tulajdon és az adminisztratív lekérdezés
megmarad. Amíg ezt a runtime-viselkedést és a state-migrációt nem valósítottuk meg,
a mod nem aktiválható éles domainadattal.

