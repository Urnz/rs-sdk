# SI-C07 – Natív karbantartási ciklus és anyagfelhasználás

2026-10-27, a2. munkacsomag részeredménye. SI-C07 nyitott,27/45, preflight
NO-GO; [6 munkacsomag maradt](SI_C07_REMAINING_WORK.md). Az eredeti17 feltétel,
8 integrity gate és minden küszöb változatlan.

## Javított minimumkiértékelés

A korábbi adapter minden pozitív javítási receiptet teljes karbantartási
ciklusként számolt. Ez túl erős állítás volt: önmagában nem igazolta az előzetes
natív kopást, az új használatot vagy a felhasznált anyag belső eredetét.
Ez a cikluscredit megszűnt. A javítás továbbra igazolt fizikai munkavégzés és
labor-stage lehet; a teljes karbantartási minimumhoz több bizonyíték kell.

## Új readonly bizonyíték

A `society-metrics/tool-maintenance.ts` az outcome-report külön
`sources.toolMaintenance` csatornája. A teljes, auditált lifecycle historyt
olvassa vissza: az operation, audit, aktuális állapot és minden revision
egyezése szükséges. A capacity-export korábbi tömör boundary alakja változatlan.

Egy javítás mechanikai ciklusa csak akkor teljes, ha ugyanahhoz az instance-hoz,
owner/world/clock/lifecycle-hoz és pontos revisionhöz csatlakozik:

- a tényleges packed Mining kimenetével igazolt, nullára koptató használat;
- a policy szerinti befejezett javítás, a committed natív hatás és az50 durability;
- az újabb packed Mining output, amely a javított revisionből valóban fogyaszt.

Mindhárom az evaluation ablakban kell legyen. A repair WIP, a kézi breakage,
a hiányzó új használat, másik instance vagy idegen lifecycle nem zárja a láncot.
A self-consistent JSON-hash sem elég: a native source digest a külön lifecycle
use receiptjéhez kötődik. Azonos időbélyegek mellett a revision dönt.

A javítóanyaghoz a meglévő escrow teljes auditlánca, a WIP intenthez kötött
purpose, az egyetlen consume, a committed időpont, a pontos bronzmennyiség,
a material receipt és a repair authorization digestje is ellenőrzött.
Ez **igazolt elfogyasztás**, nem belső eredet. A replacement ág jelenleg
`unproven`; általános lifecycle replace vagy shop-bought successor nem lesz
automatikusan natív, belső eredetű pótlás.

## A még hiányzó eredetigazolás

A jelenlegi natív tool-work nem tart fenn prospektív, mennyiséget és custodyt
követő ore→smelt→bar→repair input-láncot. Az, hogy korábban ugyanannál az
actornál keletkezett érc vagy bronz, nem bizonyítja, hogy éppen azt fogyasztotta
el a javítás. Keveredés, bank, trade vagy más bevitel miatt a puszta mennyiség
és időbeli közelség nem elég.

Ezért még az igazolt mechanikai ciklus is `inputOrigin:unproven`,
`qualifiesMinimum:false`; nem kap maintenance minimumcreditet. Hiányból nem
lesz nulla-ciklus FAIL sem. A17 részleges adapter nem17 mért PASS.

Következő konkrét kódhatár a prospektív material-lot/custody forrás, a natív
smelt és repair fogyasztási kötése, mennyiségi megmaradással és idegen/kevert
anyag negatív próbáival. Ezt követően köthető a belső eredet a minimumhoz;
a teljes source universe/enforcement és8 integrity gate továbbra külön feladat.

## Ellenőrzés és kompatibilitás

A meglévő valódi100-use→törés→packed smelt→repair→reuse próba most ezt az
olvasót is meghívja. Külön frozen readonly SQLite-fájlban ugyanaz az eredmény,
a forrás bytejai változatlanok. A valódi belső termelés jelenléte mellett sem
talál ki input-ancestryt. WIP, kézi kopás, ablakon kívüli kopás/új használat,
idegen lifecycle, újrahashelt hamis native source és sérült escrow-purpose
negatív próbák is vannak. A minimum adapter javításból nem ad cycle PASS-t.

Nincs új tábla, séma vagy migráció; közös user_version, gazdasági transaction,
clock és gameplay változatlan. A report új csatornája additív; rollback a
korábbi túl megengedő repair-count állítást visszahozná, ezért azzal nem
igazolható változatlan minimumkiértékelés. Evidence-t nem írunk át.

Pontos check-ID-k és idők: [átadás](SOCIETY_DEVELOPMENT_HANDOFF.md).
Full regresszió nem szükséges ehhez a readonly metrics/join és adapterjavításhoz;
az érintett tesztfájlok és root/engine TS ellenőrzendő. Nincs live világ/run,
providerhívás, új baseline vagy történeti backup-read. C08 nem indul.
