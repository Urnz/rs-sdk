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
- `owner`: opcionális `EconomicActorRef`; játékos, vállalkozás vagy faction lehet.
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

A Property mod nem vállalkozásmanager. A műhely, bolt vagy bánya fizikai és jogi
eszköz; a benne működő vállalkozás külön modulban él és stabil `propertyId`
hivatkozással használja vagy bérli. Ugyanígy a királyság, város vagy uradalom
külön governance domain, amely birtokolhat ingatlant és adót állapíthat meg, de az
adólogika nem kerül az ingatlanmodba. A részletes határokat az
`architecture/ECONOMIC_DOMAINS.md` rögzíti.

## Tartós vásárlási állapot

Az első `PropertyStore` külön SQLite-adatbázisban tárolja a tulajdonállapotot és a
vásárlási tranzakciókat. `BEGIN IMMEDIATE` tranzakció foglalja le az ingatlant,
ezért egy versenyben csak egy vevő nyerhet. A `transactionId` idempotenciakulcs:
ugyanaz a kérés nem vonhat le kétszer pénzt, más kérés pedig nem használhatja újra.

A pénztárca adapter `debit` és `refund` művelete szintén idempotens kell legyen.
A store először tartós `pending` foglalást ír, majd terhel, végül commitolja a
tulajdont. Terhelési hibánál feloldja a foglalást; commit-hibánál visszatérítést és
kompenzációt kísérel meg. Egy megszakadt `pending` tranzakció ugyanazzal az
azonosítóval biztonságosan folytatható. A játékbeli coin inventory adapter még a
következő integrációs lépés része, ezért az atomi vásárlási TASK addig nem kész.

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

## Későbbi gazdasági és lifecycle-kérdések

- **Eladás:** ki árazhat, mennyi a tranzakciós illeték, és hová kerül a vételár.
- **Bérlet:** időtartam, kaució, fizetési ütem, hozzáférés és nemfizetés kezelése.
- **Adó és vám:** a governance mod számítja joghatóság alapján; a Property csak
  az adóztatható eseményt és értéket közli.
- **Fejlesztés:** verziózott fejlesztési szint, költség, kapacitás és termelési hatás.
- **Közös tulajdon:** tulajdoni hányadok, szavazás, bevétel- és költségmegosztás.
- **Inaktív tulajdonos:** türelmi idő, vagyonkezelés, öröklés vagy szabályozott aukció;
  automatikus, nyom nélküli elkobzás nem megengedett.
- **Belépődíj és alkalmazottak:** a Property jogosultságot ellenőriz, a Business
  adja az alkalmazotti kapcsolatot, a főkönyv pedig végrehajtja a díjfizetést.
- **Árképzés és készlet:** a vállalkozásmod felelőssége, még akkor is, ha fizikailag
  egy bolt vagy raktár Propertyben működik.

## Lifecycle

Az ingatlanmod kikapcsolási policyje legalább `read-only`: ilyenkor új vásárlás
és módosítás nem történhet, de a meglévő tulajdon és az adminisztratív lekérdezés
megmarad. Amíg ezt a runtime-viselkedést és a state-migrációt nem valósítottuk meg,
a mod nem aktiválható éles domainadattal.

