# SI-C07 – Natív jogszerű lakhatási hozzáférés

2026-10-26, a2. munkacsomag részlete. **16/17 feltételhez részleges adapter;
ez nem16 PASS.** SI-C07 nyitott,27/45, preflight NO-GO; SI-M3/MVS nem PASS.
Az eredeti95% founder/nap minimum,17 követelmény és8 integrity gate változatlan.
[Hátralévő6 munkacsomag](SI_C07_REMAINING_WORK.md).

## Forrás és időbeli bizonyíték

A backend explicit `housingBoundaries` opciója pontonként fagyasztott clock,
agent, needs, property, housing és native checkpoint DB-t választ ki.
Nincs HTTP-n feltölthető observation, automatikus live snapshot vagy történeti
visszatöltés. Minden ponton pontosan az adott időre paused clock, megfelelő
profile és a teljes kiválasztott roster kell. A needs első revisionjából
származik az eredeti admission; az értékelő az applied genesishez és az
eredeti founder/lifecycle/policy/username azonossághoz köti.

A readonly reader store-onként256 MiB/100000 sor korlátot, fizikai path-guardot
és olvasás előtti/utáni SQLite snapshot-digestet használ. A facade kétszer
olvassa a source-okat, és a változó forrást elutasítja. Ez nem bizonyít
cross-store atomicitást vagy teljes futásbeli source integrityt.

Két szomszédos érvényes pont között csak akkor mérhető időszakasz, ha:

- ugyanaz a world/clock/profile/contract és eredeti cohort-context;
- az eltérés legfeljebb az eredeti1 simulation órás trace-gap;
- változatlan a property tulajdonosi állapota és verziója, a natív bérleti
  és fizetési journal headje, valamint a tenancy állapota és audit-headje.

A tulajdonosi műveletek verziót emelnek; a bérleti változások append-only
naplóba kerülnek. Ezek alapján csak változatlan authority-epoch hidalható át
a pinned natív writer/policy mellett. Váltás, hiányzó/sérült pont vagy hosszú
gap ismeretlen időt eredményez. A sérült köztes pont nem dobható ki azért,
hogy a két távolabbi jó pont összeköthető legyen. A tenancy teljes auditja
újraépíti a current projectiont; egy önkényesen átírt current sor nem bizonyíték.

## Jogosultság, férőhely és napi nevező

Csak a natívan regisztrált fizikai ágyakkal rendelkező, legalább a minimum
tierbe tartozó unit ad biztos alsókorlátot. Egy bérlőhöz native committed
bilateral escrow, binding, fizetési receipt és prepaid tenancy-entitlement
kell. A domain szerződés, pending fizetés vagy sleep receipt önmagában nem
teljes hozzáférési bizonyíték. A későbbi fizetés nem jogosít visszamenőleg.

Az ágyfoglalások a native order és a megfelelő tenancy azonosítójával
deduplikálódnak. Két külön igény ugyanarra az ágyra nem kaphat egyszerre
lower creditet. A tulajdonos csak szabad regisztrált férőhely és megfelelő
belépési jog mellett kap alsókorlátot. Nem támogatott unit vagy nem teljesen
modellezett visitor/employee/public jog ismeretlen lehetőséget jelent.
Ezért a jelenlegi ház látogatói jogai mellett a nem bérlő alapítók nem
minősíthetők automatikusan lakhatás nélkülinek.

A bérlet kezdete, fizetése és lejárata pontosan elvágja az intervallumot.
Az időszakaszok uniója számít, több jog nem többszörözi a személyidőt.
Alapítónként és naponként:

- lower: igazolt jogszerű idő / teljes aznapi founder-exposure;
- upper: (teljes exposure − igazolt hozzáférés nélküli idő) / teljes exposure.

Az igazolt natív halál elvágja a nevezőt; nem cseréljük le az alapítót és
nem számoljuk az utána következő napokat sikeres nulla nevezőként. Ismeretlen
idő egyik irányban sem válik biztos adattá. A legalább95% lower PASS-t, az
annál kisebb upper FAIL-t bizonyíthat; a részleges pozitív megfigyelés
inconclusive marad. Korai, már bizonyított FAIL a teljes futás és más
források hiánya mellett is megjelenik a diagnosticViolations mezőben.

## Ellenőrzés és korlát

Kontrollált intervallumpróbák: napi owner/tenant idő, expiry, közös ágy,
hiányzó köztes pont, epoch/cohort/clock/contract eltérés, unknown visitor,
bizonyított hiány, eredeti admission és halál miatti exposure-vágás.
A vékony natív SQLite-integráció valódi PropertyStore, NativeRentCoordinator,
committed escrow és auditált prepaid tenancy adatokat olvas vissza, fagyasztott
pontokon és külön offline másolatból. Ez mechanikai fixture, nem élő C07
gazdasági próba vagy új packed sleep-teszt. A benchmark offline restore
közvetlen fogyasztóként külön ellenőrzött.

A konkrét C07 point-inventory, archive source-lista és pin még az5. csomag
része. A teljes mortality/enforcement, high-level demand és8 integrity gate
továbbra hiányos. A [tool-service capacity adapter](SI_C07_TOOL_CAPACITY.md)
azóta elkészült; következő a teljes high-level demand/source coverage.
Nincs új séma/migráció/backfill, közös clock/auth/transaction vagy gameplay
változás, live világ/hosszú run, providerköltség vagy történeti backup DB-read.
Ellenőrzési ID-k és idők a [rövid átadásban](SOCIETY_DEVELOPMENT_HANDOFF.md).
