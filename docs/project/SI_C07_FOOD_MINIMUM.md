# SI-C07/2 – Napi étellánc és fagyasztott készletkorlátok

2026-10-26. A [2. munkacsomag](SI_C07_REMAINING_WORK.md) részeredménye.
**SI-C07 nyitott,27/45,6 csomag maradt, preflight NO-GO.**15/17 feltételhez
van részleges adapter; ez nem15 mért PASS. Az eredeti minimum és8 gate változatlan.

## Napi belső ellátás és végfelhasználás

`society-metrics/food-minimum.ts` az auditált natív physiological application,
food lineage és production receipt olvasókat kapcsolja össze. Az eredeti
[definíció](features/phase24-1-society-minimum.md) szerint a napi arány:

`igazolt belső tényleges hunger relief / minden tényleges hunger relief`.

Ez külön mérőszám a korábbi SI-A12 relief/demand riporttól; azt nem írtuk át.
A clampnél elvesző nominális relief nem része a nevezőnek. Az eseményablak
`(napkezdés,napvége]`, így az éjféli fogyasztás az előző naphoz tartozik.
Zero/no-use vagy nulla összes effektív relief nem ad sikeres arányt.

A pontos napi nevezőhöz az összes alkalmazás feldolgozása és a native closed-tick
watermark napvégéig tartó lefedettsége kell. Unknown/mixed ancestry nem lesz
belső credit: a lower bound az igazolt belső relief, az upper az összes relief
mínusz az igazolt bootstrap/import relief. Egzakt racionális összehasonlítás,
nem előre kerekített százalék. Egy igazolt pozitív bootstrap/import relief már
önmagában sérti a100%-os követelményt; más pending alkalmazás nem mossa el.

Belsőnek csak a teljes, actual native gather és cook receipt ancestry számít,
matching world/clock/profile, eredeti founder username/lifecycle és genesis
utáni production idővel. A warmupban termelt belső étel felhasználható.
Seedelt/unknown étel kereskedéstől vagy újracsomagolástól nem lesz belső.
Egy valódi consumption action legfeljebb egy inter-actor final-use chain,
akkor is, ha több stage/producer szerepel az ancestryban. A producernek külön
foundernek kell lennie a consumertől. Áthelyezés, trade, WIP vagy self-consume
önmagában nem ad inter-actor creditet. Nulla effective relief mellett a tényleges
quantity1 consumption továbbra fizikai final use lehet, de food-share PASS nem.

## Fagyasztott készletpont és használhatóság

A backend opcionális `NativeIntegrationOptions.foodBoundaries` listája minden
időponthoz explicit `NativeFoodBoundaryPaths` készletet ad: checkpoint, needs,
clock, business, treasury, AgentState és engine health adatbázis. HTTP/LLM nem
választhatja meg ezeket. Nem hozunk létre snapshotot aktuális állapotból, és a
jelenlegi készletet nem dátumozzuk vissza. A `readWealthBoundary` meglévő exact
paused-clock/needs/native-food/custody ellenőrzései változatlanul szükségesek.

`food-boundaries.ts` csak az eredeti zárt cohortot fogadja el. Ellenőrzi a native
finite-avatar és death auditot, tagságot, admissiont és lifecycle-kötést. Az
alsó készletkorlátba csak aktív, nem terminal, ismert születésű, természetes
halálra még nem esedékes, pozitív **aktuális HP-jú** owner személyes inventoryja
kerül. Day-survival fatal hunger mellett nincs lower credit. A hiányzó ilyen
bizonyíték ismeretlen használhatóságot jelent, nem új gameplay-korlátozást.

Az admin save-olvasó alapértelmezett kimenete és base-level számítása változatlan.
A frozen reader külön opt-in paraméterrel kapja meg a current HP-t; XP-ből
számolt Hitpoints base level nem helyettesíti az aktuális életerőt.

Bank, business/storage, escrow és egyéb bizonytalan hozzáférésű cooked stock
csak upper bound. A meglévő custody-reader nem számolja új készletnek a natív
issue utáni WIP-tükröt, és pending transfer-projekció mellett nem ad closed
boundaryt. Raw/burnt vagy más lánc készlete nem cooked relief capacity.
A mennyiség lánconként a pinned nominális reliefkapacitásra váltódik át.

## Forecast és retention

A jelenlegi zárt cohort létszámát és a pinned hunger dynamics módjait használó
konzervatív forecastból készülnek az időkorlátok:

- Reserve lower: biztosan használható cooked relief ×3 600 000 /
  (teljes eredeti cohort × legnagyobb pozitív hunger-ráta).
- Reserve upper: minden potenciális cooked relief ×3 600 000 /
  (igazoltan használatra képes tagok × legkisebb pozitív hunger-ráta).
- Nulla igazolt living/demand opportunity nem sikeres reserve-arány.
- Stock retention lower: closing usable lower / opening usable upper.
  Upper: closing usable upper / opening usable lower. Minden required chain
  külön számít; a leggyengébb korlát dönt, nincs láncok közötti kompenzáció.
  Bizonyított pozitív opening stock nélkül nincs sikeres retention arány.

Egy sérült boundary nem tünteti el egy másik, hiteles pont reserve FAIL-jét.
Két endpoint nem bizonyít mindenhatári tartalékot: az újonnan látott pontok
bekerülnek a minimum frame-be, de nem kapnak automatikus complete jelzést.
A teljes observation inventory és custody/access coverage még kell.

## Ellenőrzés és további munka

Natív SQLite gather→cook→trade→consume, clamp/midnight/zero/mixed/pending,
eredeti genesis→evaluation food-share, actual frozen census/health/custody,
inventory vs bank/raw/burnt, retention/reserve FAIL, sérült másik pont melletti
FAIL és offline snapshot-újraolvasás ellenőrzött. Az általános benchmark restore
az új riportmezőket is megőrzi. A konkrét C07 expanded source-listába a frozen
pontonkénti adatbázisok és időpontok előzetes pinje még az5. csomag feladata;
az új backend-opció nem automatikus live/default snapshot.

Nincs új séma, migration/backfill, közös transaction/clock/auth vagy gameplay
változás. A tesztkészletek mechanikai fixture-ök, nem új C07 világ/endowment.
Nem indult live világ/hosszú run, providerhívás vagy történeti backup DB-read.
Legal housing, tool-service capacity, teljes high-level demand, mortality/
boundary history és8 native integrity gate továbbra kell a2. csomag lezárásához.
Azóta a [legal housing access/exposure](SI_C07_HOUSING_ACCESS.md) is bekötött;
azóta a [tool-service capacity](SI_C07_TOOL_CAPACITY.md) is bekötött.
Következő a teljes high-level demand/source coverage. Az aktuális eredmény és
ellenőrzési azonosítók a [rövid átadásban](SOCIETY_DEVELOPMENT_HANDOFF.md),
a diagnosztikák a [progressben](SOCIETY_INTEGRATION_PROGRESS.md) találhatók.
