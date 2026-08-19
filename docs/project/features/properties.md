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

## Kötelező szerveroldali szabályok

- A kliens által küldött ár és tulajdonos soha nem hiteles.
- A vásárlás előtt újra kell olvasni az aktuális egyenleget és tulajdonjogot.
- Pénzlevonás és tulajdonosváltás egyetlen tranzakció.
- Az ismételt vagy párhuzamos kérés idempotensen/konfliktussal zárul.
- Minden adminisztratív módosítás auditálva legyen.

## Nem része az első MVP-nek

Eladás, bérbeadás, adó, társtulajdon, aukció, berendezés és fejlesztési szintek.

