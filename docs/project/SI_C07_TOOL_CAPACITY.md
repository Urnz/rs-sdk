# SI-C07 – Fagyasztott natív eszközkapacitás

2026-10-26, a2. munkacsomag részlete. **17/17 feltételhez részleges adapter;
ez nem17 PASS és nem a2. csomag lezárása.** SI-C07 nyitott,27/45, preflight
NO-GO; SI-M3/MVS nem PASS. A [rögzített6 hátralévő csomag](SI_C07_REMAINING_WORK.md)
és az eredeti17 követelmény/8 integrity gate/küszöb változatlan.

## Mit mér az adapter?

A backend explicit `toolBoundaries` opciója fagyasztott clock/needs/agent/
health/checkpoint/business/treasury DB-ket választ. Pontos paused clock és
closed native tick, feldolgozott meal-projekció, teljes eredeti cohort és
ellenőrzött fizikai custody kell; ugyanaz a meglévő boundary-reader szolgálja
a food és tool pillanatképeket. Az alkalmas username-eket a már ellenőrzött
finite health/birth/lifecycle/needs és actual HP adja. Ez additív readonly
riportadat, nem új perzisztencia vagy teljes mortality-enforcement bizonyíték.

A native borrowed-DB lifecycle schema saját verziója3; a közös DB
`user_version` értékét nem használjuk lifecycle-verziónak. A reader nem
konstruál írható domaint és nem migrál. A teljes audit hash-lánc, operation
bijection és current state újraépül creation/use/repair/replacement/transfer
műveletekből. Tartósságot nem lehet current-row átírással visszaállítani;
transzfer megőrzi, replacement pedig nyugdíjazza az előd kapacitását.

A native binding oszlopai/digestje/policyja, a regisztrált explicit opening
teljes lifecycle-revisionje és a fizikai checkpoint egyezése ellenőrzött.
A kötéshez tartozó raw-save digest nem cserélhető fel a wealth-reader
kanonikus asset digestjével: mindkettőt a saját hash-szabálya szerint kötjük.
Dupla stack/példány, stale hash, quarantine vagy bizonytalan hely nem ad lower
creditet. A támogatott natív Mining-példány egyetlen bronzcsákány; új
típushoz nem állítunk automatikusan működő engine-enforcementet.

## Alsó és felső korlát

Egy required tool type mechanikai outputkapacitása:

`floor(remaining durability / wear per successful action) × output quantity per action`.

Nem GP, darabszám, maximális tartósság vagy quality-szorzó. Réz és ón két
lehetséges output, nem kétszer számolható ugyanaz a megmaradt használat.

- Lower: eredeti, használatra alkalmas founderhez kötött, egyértelmű fizikai
  inventory/equipment példány megmaradt kapacitása.
- Upper: minden nem retired auditált példány megmaradt kapacitása, az ismeretlen
  helyű és quarantined példányokat is beleértve. A nem biztosan azonosított
  fizikai készlet további virgin maximumként számít. Ez szándékosan túlbecsülhet,
  viszont a hiányzó azonosság nem lesz automatikus kapacitásvesztés.
- Az azonosított fizikai példányt nem számoljuk újra virgin eszközként.
  A bank biztos azonosítás mellett is csak upper; access bizonyítéka külön kell.

A nyitó és pontos záró boundary ugyanahhoz a world/clock/profile/contract/
eredeti cohorthoz tartozik. A záró lifecycle-audit a nyitó prefix folytatása,
és minden nyitó native event változatlanul jelen van. Másik világ, hiányzó
zárópont, sérült vagy csonkolt prefix nem ad összehasonlítható arányt.

Required típusonként lower=closing lower/opening upper, upper=closing upper/
opening lower; exact BigInt-racionális számítás. Az eredeti100% megtartás
feltételénél a leggyengébb required típus dönt, nincs típusok közötti
kompenzáció. Igazolt pozitív opening capacity nélkül nincs PASS. Egy
bizonyítottan elégtelen típus FAIL-je más hiányos típus mellett is megmarad.

## Ellenőrzés és megmaradó munka

A vékony SQLite-integráció valódi NativeToolStore, ItemRepairService és
fagyasztott fizikai források útját olvassa vissza az eredeti founder minimumába.
Az egy darab csákány100 nyitó, majd kopás és szabályos javítás után50 záró
kapacitása FAIL. Ez mechanikai fixture; nem új packed Mining-vagy hosszú
C07 gazdasági próba, és nem állít belső eredetű teljes maintenance ciklust.
Audit-transzfer, replacement, schema/future/current-state sérülés, unknown
identity, bank/duplicate/stale save és külön offline másolat célzottan próbázott.

A konkrét capture-inventory, világ/source universe, schema/state/archive pin
és a tool-origin/maintenance teljes bizonyítása továbbra kell. A fizikai
kapacitásrész nem helyettesíti a belső input/successor és use→repair→reuse
bizonyítékát. Következő kódhatár a high-level demand és source coverage
teljességének bekötése, majd a megmaradó8 integrity adapter és történeti
mortality/enforcement. Nincs új séma, migration/backfill, közös clock/auth/
transaction változás, live világ/run/providerköltség vagy történeti backup-read.
Ellenőrzési ID-k/idők: [rövid átadás](SOCIETY_DEVELOPMENT_HANDOFF.md).
