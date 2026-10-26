# SI-C07/2 – Natív éhség és fáradtság időbeli kiértékelése

2026-10-26. A [2. munkacsomag](SI_C07_REMAINING_WORK.md) része;6 csomag
maradt,27/45, SI-C07 nyitott, preflight NO-GO. Nem hosszú run vagy M3-eredmény.
Az eredeti17 feltétel/8 gate és a95%/6 óra küszöb változatlan.

## Forrás és eredeti founder-kötés

`society-metrics/needs-exposure.ts` a meglévő readonly integration collector
auditált needs_event, player-time és natív physiological application forrásait
használja. Nem nyit új store-t, nem inicializál állapotot, nem mozgat clockot.
Az integration riport `needsExposure` mezője ellenőrizhető időszakaszokat ad;
a minimum adapter ebből képez külön founder/nap és founder/teljes ablak cellákat.

A minimumhoz az applied eredeti roster, AgentState lifecycle ID, player username,
world/lifecycle-policy és clock/profile egyezés is kell. Csak az eredeti genesis
azonosítójával/digestjével, annak alkalmazási idején inicializált physiological
admission adhat bizonyítékot az alapítóhoz. Másik lifecycle, késői újrainicializálás,
idegen scope/policy vagy egy másik riport nem veheti át az eredeti nevezőt.
A cellák evidenciája a physiology projection mellett a genesis és AgentState
source digestjét is tartalmazza. A backend nem fogad feltöltött observationt.

Az expanded benchmark az archivált, backend által kijelölt needs/clock/checkpoint
forrásokat is beköti. A többi gazdasági forrás hiánya ettől továbbra inconclusive;
nem keletkezik alapértelmezett live source vagy hálózati hozzáférés.
A kereskedési forrás az integration és outcome oldalon is ugyanaz a selected
archive path; egyedi fájlnévnél sem vált vissza implicit környezeti beállításra.

## Újrajátszás és időszámítás

Minden egymás utáni needs revisionnél a meglévő `advanceNeedsFromClock` szabály
adja az ellenőrző állapotot: online/offline, awake/sleeping, sleep recovery és
sleep-access lejárat szerint. Az eredménynek ki kell adnia a naplózott következő
állapotot, módot, kurzort és változatlan admission/binding metaadatot.

Azonos timestampű módváltás az állapotmentés után is történhetett. A következő
needs snapshot **playerTimeRevision** kurzora szabja meg, melyik módváltás
alkalmazható; a későbbi azonos idejű eseményt nem szabad előrehozni. Egy korábbi
időpontú kihagyott módváltás viszont hiányos történet, nem elfogadható sorrend.
A módnapló és étkezési index egy menetben járható, nem minden needs revision
után keres végig újra minden módváltást/étkezést.

Az éhséghez a natív food delivery watermarknak a lekérdezés végéig kell érnie,
matching clock/profile és nulla pending application mellett. Az étkezésnek a
konkrét needs before/after revisiont és receipt markert is igazolnia kell.
Hiányzó/pending étkezési bizonyíték mellett nincs éhség-exposure; a külön
újrajátszható fáradtsági bizonyíték megmarad. A teljes forrás-hash és audit
ellenőrzése a meglévő source collector feladata.

A kritikus állapot `value >= criticalThreshold`, az elégedett állapot ennek
komplementere. A küszöbátlépés a natív egész érték és előjeles fixed-point
maradék szabályait követi, integer simulation-ms pontossággal. Negatív rátánál
a küszöbbel egyenlő érték az első tényleges egész decrementig még kritikus.
A segmentek `[from,to)` intervallumok; a nap végén elfogyasztott étel nem
javíthatja visszamenőleg az előző nap időarányát.

## Korlátok és hiányzó idő

- Naponta külön alsó korlát: ismert elégedett ms / teljes eredeti nap.
  Felső korlát: (teljes nap − ismert kritikus ms) / teljes nap.
  Az osztás BigInt-racionális cellába kerül; nincs előzetes százalékkerekítés.
- A longest critical a teljes ablakon át tartó, szomszédos igazolt kritikus
  szakaszok maximuma. Nem nullázódik éjfélkor, és nem külön napok összege.
- Ismeretlen idő nem számít elégedettnek és nem köthet össze kritikus szakaszt.
  Hiányos ablaknál a longest felső korlátja konzervatívan a teljes ablak;
  teljes igazolt ablaknál a minimum és maximum ugyanaz a mért idő.
- Sérült/nem újrajátszható revision után az adott need további ideje unknown;
  a már ellenőrzött prefix bizonyítéka megmarad. Másik need/actor hiánya nem
  rejtheti el az igazolt scoped sértést.
- Az eredeti kezdőpontú részablakban is megmarad a már bizonyított diagnostic
  FAIL, miközben nincs teljes7 napos assessment. Egy részleges alsó/felső korlát
  legfeljebb az adott feltételt döntheti el, a teljes forráslefedettség gate-jét nem.

Mind a8 integrity gate külön marad. Történeti mortality/enforcement/boundaries,
napi food lineage/reserve/stock, legal housing, tool capacity és teljes high-level
demand továbbra kell a2. csomaghoz. Natív időarány-kalibráció és teljes baseline
későbbi csomag; nincs világ- vagy minimumtuning. Nincs migration/backfill,
live world, providerhívás vagy történeti backup DB-olvasás.

Ellenőrzés: milliszekundumos/signed-remainder crossing, saturation, napváltás,
valódi natív étkezés, sleep-expiry/azonos timestamp cursor, hiányzó watermark,
truncated mode history, applied-genesis→SQLite→evaluation és offline restore.
Azonosítók, sikertelen diagnosztikák és végső idők az
[átadásban](SOCIETY_DEVELOPMENT_HANDOFF.md) és a [progressben](SOCIETY_INTEGRATION_PROGRESS.md).
