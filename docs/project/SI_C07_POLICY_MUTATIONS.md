# SI-C07 – Archive environment inventory és mod/director változtatási történet

2026-10-27, a2. munkacsomag részeredménye. SI-C07 továbbra NO-GO,27/45;
[6 munkacsomag maradt](SI_C07_REMAINING_WORK.md). Az eredeti17 követelmény,
8 integrity gate és a minimum küszöbei változatlanok. Előzmény:
[lifecycle route/build pin és policy observer](SI_C07_LIFECYCLE_POLICY.md).

## C06 fájlleltár és rögzített producerek

A `policy-environment.ts` a meglévő offline archívumleltárból készít pinelt
source/config/packed jegyzéket, bytehosszal és SHA-256-tal. Nincs újabb teljes
fájlrendszer-bejárás. A registry az engine/gateway bemeneteinek deklarált neveit,
Bun-verziót és platformot tartalmaz; környezeti értékeket, kulcsot vagy jelszót
nem exportál. A producerkódokat és packed tartalmat kötelezően tartalmazza.
A rendezés determinisztikus, nem a gép locale-jától függ.

Az5 megfigyelt entrypoint:

- gateway mod configure: sikeres backup után, az active-state rename előtt/után;
- gateway mod restore: safety backup után, a visszaállítás előtt/után;
- natív mod hot reload: tényleges snapshot-aktiválás előtt/után;
- gateway director configure: a konfigurációs fájl cseréje előtt/után;
- natív director event accept: az új event, idempotens replay és konfliktus eredménye.

A director-esemény normál jelzés lehet, nem konfigurációváltoztatás és nem
automatikus értékimport. Az elfogadás önmagában nem world-policy FAIL. Az
azonos byteokat újramentő director configure, illetve változatlan hot reload
no-op marad. A mod configure/restore meglévő revíziója és safety backupja megmarad.

## Független prospektív journal

A `.local/society-metrics/policy-mutations.sqlite` saját schema1 selection/event/
head/fault táblái csak explicit előkészítéssel jönnek létre. A selection az
eredeti world/clock/ablak, a pontos native-policy selection digestje és a C06
environment inventory mellé kötött. Nincs közös user_version vagy checkpoint/
clock/AgentState séma változás. Nincs implicit install, legacy backfill vagy
hiányból előállított nulla-módosítási igazolás.

Az observer durable begin-t ír a változtatás előtt, resultot utána. A párok
auditáltak és immutable-ek, a fault counter monoton. A napló kizárólag digestet,
producerazonosságot, eredményt és readonly clock contextet tartalmaz. Nincs
konfiguráció-, message-, event-title-, summary- vagy exception-payload.
Backend/fixture port létezik; a HTTP/model/packet felület nem választhat DB-t,
óraforrást vagy megfigyelési capabilityt.

A gateway és az engine ugyanazt az explicit journal-slotot használja; a
production adapter az adott instance workspace-éből dolgozik. Egyedi fixture-
konfigurációs útvonal nem kapcsolódik implicit módon a production journalhoz.
Az observer nem lépteti az órát. Hiányzó/stale clock context ismeretlen marad.

Az aktív konfiguráció rename-ja és a journal külön commit. Írási hiba vagy
félbemaradt pár ezért gap, nem bizonyított sikertelenség vagy változatlanság.
Az observer hiba nem módosítja a meglévő mentés/reload/backup/accept eredményét.
Teljes DB-hibából sincs teljességi állítás. A100000 sor/256 MiB readerlimitet
és a konkrét run sor-/byte-budgetjét továbbra figyelembe kell venni.

## Natív kurzorhoz kötött offline értékelés

A native policy sample opcionális `mutationCursor` mezője az új journal
selection/head/fault prefixét rögzíti. Ez visszafelé kompatibilis schema1
payload-bővítés; a régi hiányzó mező nem válik kitalált cursor-nullává.
A valódi World observer és a független journal közös natív próbával kötött.

A backend explicit `policyMutationsPath` capabilityvel választhatja a readonly
forrást. A `sources.policyMutations` az applied eredeti founder/lifecycle/clock,
native-policy pin, producer-source hash és hiteles mortality-pozíciók mellett
ellenőrzi a ledger teljes auditját. A megfigyelt native cursorok közé eső,
lezárt és scope-olt konfigurációváltozás önálló
`unchanged-clock-and-world-policy` FAIL lehet, akkor is, ha a későbbi mintákban
már újra az eredeti konfiguráció látszik.

A záró cursor utáni módosítás nem kerül vissza a mérési ablakba. Pending/null/
foreign/stale context, rossz prefix, megfigyelési hiba vagy hiányzó frame gap.
Egy korábban két hiteles cursor között már igazolt pozitív sértés a teljes
záró frame hiánya vagy más journal-fault mellett is megmarad. Idegen query nem
vehet át ilyen bizonyítékot. Az eredeti policy-snapshot FAIL külön forrás marad.

`completeRecordedMutationWindow` csak a deklarált producerek naplójának
megfigyelt ablakáról szól. A ténylegesen betöltött teljes dependency/input
closure és a nem regisztrált külső fájl-/adatbázis-írók enforcementje még nincs
tanúsítva. `completeWorldPolicyEnforcement:false`; az environment registry és
az üres journal önmagában nem teljes integrity PASS.

## Bevezetés, rollback és ellenőrzés

Baseline előtt az új journal explicit initje és a backend source-slot kijelölése
kell. C06-ban külön `policy-mutations` store-role és requiredTables tartozik
hozzá; a checkpoint native-policy selection is kötelező. A prepare ellenőrzi
a policy-kötést és a teljes observed environment inventory egyezését. Izolált
restore után a független journal visszaolvasható; sérült head vagy eltérő packed
állomány új baseline-t tilt. A pin Bun/platform azonosságot is rögzít.
Rollback előtt stop és új pin kell; evidence-t nem törlünk és nem hamisítunk.

Valódi gateway mod configure/restore/director save és natív mod-aktiválás/
director accept határok próbázottak. Native testportok izolált snapshotot
használnak; nincs production mod reload vagy live-store inicializálás. A normál
idempotencia, konfliktus, backup és eredeti állapotmegőrzés változatlan.
Írási hiba után is végbemegy a szokásos művelet, a bizonyíték viszont gap.
Root SQLite: round-trip drift, signal/no-op, post-window exclusion, unknown/
foreign/stale/pending/cursor/fault, részleges prefix FAIL és frozen readonly reread.
Saját schema/reopen/rollback/immutable audit/user_version42 és külön C06 restore.
Pontos scope/ID/idő, beleértve a hibákat: [átadás](SOCIETY_DEVELOPMENT_HANDOFF.md).

Full regresszió nem indokolt saját additive observer/journal és közvetlen
mutátor/metrics/minimum/C06 fogyasztók esetén. Shared clock setter, auth,
gazdasági transaction vagy migrációs alap nem változott. Nincs live install,
új baseline, hosszú run, providerköltség vagy történeti backup-read.

Következő a betöltött runtime build/input tényleges tanúsítása és a nem
regisztrált value/config írók source/enforcement leltárának lezárása. A teljes
boundary/custody/access history és8 integrity adapter még kell. A2. csomag
nyitott,6 maradt, SI-C07 NO-GO; a3. founder baseline és C08 nem indul.
