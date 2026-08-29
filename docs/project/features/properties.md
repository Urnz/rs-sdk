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
azonosítóval biztonságosan folytatható. A játékbeli adapter kizárólag az
inventory 995-ös coin stackjét használja; a bankban lévő pénz nem elkölthető,
amíg a játékos ki nem veszi. Siker után az engine azonnali autosave-ot kér.

## Első engine-integráció

Az `economy.properties` mod a World Adminból hot reloaddal kapcsolható. Kikapcsolva
`read-only`: a katalógus és a tulajdon lekérdezhető, de vásárlás nem indítható.

Az első függőleges szeletben az admin egy online játékost választ. A parancs a
következő engine-ticken fut, kizárólag a játékos inventoryjában lévő coinokat
fogadja el, majd siker után azonnali autosave-ot kér. A PropertyStore tartós
foglalása, az inventory-terhelés, a kompenzáció és a tulajdon commitja egyetlen
sorosított engine-művelet része. A gateway külön auditbejegyzést ír az előtte/utána
coinmennyiséggel, propertyvel, command ID-val és engine tickkel.

A binary player save és a SQLite domainadatbázis nem alkot közös ACID
tranzakciót. Ha egy folyamat pontosan a két tartós írás között szakad meg, a
`pending` vásárlás fail-closed marad: az inventory adapter nem terhel újra vakon,
hanem adminisztrátori egyeztetést kér. Ezt később a közös gazdasági főkönyv váltja
fel teljesen egyadatbázisos atomitással.

A World Admin külön listázza ezeket a félbemaradt tranzakciókat. Az admin a
játékos mentésének ellenőrzése után két auditált döntést hozhat: `commit-debited`
esetén újabb coinlevonás nélkül véglegesíti a tulajdont, `release-unpaid` esetén
coin-visszatérítés nélkül elutasítja a tranzakciót és felszabadítja az ingatlant.
Ez szándékosan nem automatikus, mert crash után önmagában egyik adattárból sem
bizonyítható biztonságosan, hogy a másik tartós írás megtörtént-e.

Az indoklásköteles fejlesztői reset optimista verzióellenőrzéssel törli az aktuális
tulajdonosi állapotot, de nem törli a vásárlási előzményt és nem mozgat coinokat.
`locked` állapotú ingatlan nem resetelhető: előbb a hozzá tartozó pending
tranzakciót kell rendezni.

Az első katalógus három eltérő tesztesetet ad:

- `varrock.east-workshop`: termelési/vállalkozási műhely;
- `falador.south-house`: lakóingatlan és későbbi bérleti alap;
- `karamja.fishing-hut`: halászati raktár és ellátási lánc.

A Varrock keleti bank falához tett első tesztpont csak élő bottal volt ellenőrizve,
normál kliensben a fal eltakarta; ezért nem tekinthető vizuálisan ellenőrzött
helyszínnek. A véglegesített első tesztingatlan a banktól délre álló, használaton
kívüli műhely. A `Property sign` valódi, szabadon álló signpost modellt használ,
és a nyugati utcai bejáratnál,
`(3247, 3411, 0)` mezőn jelenik meg, és három
szerveroldali műveletet ad:

- `Inspect`: ár, elérhetőség vagy tulajdonos;
- `Purchase`: modállapot-, tulajdon- és inventory-egyenleg ellenőrzés, tartós
  vásárlás és azonnali autosave;
- `Enter`: az MVP-ben tulajdonosi jogosultság-visszajelzés. A valódi ajtó vagy
  belső tér megnyitása a helyszín végleges kialakítása után külön lépés.

A `Bank notice board` objektumok `Property register` művelete központi, csak
olvasható ingatlannyilvántartást nyit. A görgethető játékbeli felület minden
katalógusbejegyzés nevét, régióját, típusát, árát és aktuális tulajdonosát mutatja.
Ez nem váltja ki a helyszíni táblát: vásárolni továbbra is csak az adott ingatlannál
lehet. A nyilvántartás kikapcsolt modnál is olvasható, összhangban a `read-only`
lifecycle-szabállyal.

A Falador és Karamja koordináták továbbra is konfigurációs tesztpontok. Valódi
loc/ajtó bekötés előtt vizuálisan ellenőrizni és szükség esetén módosítani kell
őket; globális ajtótípusra nem kötünk ingatlanlogikát.

## Élő ellenőrzés

2026-08-28-án a Varrock bankfalhoz tett első teszttáblán egy 70 coinos játékossal ellenőriztük az
elégtelen egyenleget és a nem tulajdonosi belépés elutasítását. Egy visszaállítható
tesztbot bankból inventoryba kivett 30 000 coinjával a sikeres vásárlás 25 000
coint vont le, a tulajdonosi `Enter` engedélyt adott, az `Inspect` pedig az új
tulajdonost mutatta. Ezután az ingatlant fejlesztői resettel felszabadítottuk, a
bot eredeti mentését backupból visszaállítottuk, és a modot a teszt előtti
kikapcsolt állapotára tettük.

A map build során talált általános `FileStream` cache-hiba is javítva lett: egy
azonos buildben felülírt archive entry most már az új byte-okat adja vissza. A map
packer ezt a fájlt is tool dependencyként figyeli, így az `ondemand.zip` és a lite
botok `LocIndex` cache-e biztosan megkapja az új objektumot.

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

