# SI-A08 – Egy műszak, egy igazolt bér

Az exact Business-műszak a meglévő player-action queue-n keresztül indul és a
meglévő treasury/engine reward útján kap bért. Nincs új pénzegyenleg vagy második
bérledger. A [WorkStore](../../business-work/work.ts) eredeti `wageStatus` mezője
marad a követelés állapota; a binding és annak auditja az összerendelést védi.

## Munkakörök és belépési kapuk

A [szerepkatalógus](../../config/business-role-definitions.json) két további
worker role-t tartalmaz: `business.cook.v1` és `business.delivery.v1`. Mindkettő
közös skillekből áll, employment-required-only skilljoggal, inventory/storage
kezeléssel és treasury-pay jog nélkül. A manager a meglévő delegációs rendben
alkalmazhatja őket. Nincs új cook/courier agentosztály vagy szereplőre másolt skill.

A [műszakpolicy](../../config/business-work-policies.json) a `karamja-kitchen`
Business, `karamja.fishing-hut` Property és exact facility capability kötését
használja. A cook a konfigurált hőforrást, a delivery a secure storage
jogosultságot igényli. A meglévő 1–480 perces műszak és teljesítési időhatár
érvényes: egy túl rövid vagy műszakon kívüli eredmény nem keres bért.

A főzőpolicy `procedure.food.cook-lobster@0.1.0` referenciája továbbra is draft.
A katalógus betölthető, de WorkOrder létrehozásakor és indításakor az exact
skillnek verifiednek és a dolgozó által ismertnek kell lennie. A tesztfixture
explicit, izolált katalógusa ezt nem változtatja meg az élő workspace-ben.
Publikálás után a megfelelő exact policy-/employment-verziót is be kell állítani.

## Egyetlen összerendelés és delegáció

A [gateway](../../server/gateway/admin/agent-state.ts)
`createAdminBusinessWorkRequest` hívása egy már létező WorkOrderhez készít
determinista `shift.<digest>` request ID-t és settlement UUID-t. A Business DB-ben
előbb auditált outbox-binding készül, majd a treasury egyetlen foglalása és az
eredeti AgentState request materializálódik. Foglalás előtt aktív approved
Business-policy, exact employment/role/wage/skill, Property-entitlement és
player-avatar kötés kell. Üres treasury hibát jelez; a binding megmarad és
ugyanazzal az ID-val újrapróbálható. Nem készül második foglalás.

A meglévő admin `POST /api/admin/agents/:id/player-actions` út opcionális
`workOrderId` mezője ezt az adaptert hívja. A kiválasztott worker/skill/wage
egyezését az útvonal is ellenőrzi. A paraméterek a meglévő exact verified skill
paramétervalidálásán mennek át; a backend DB-útvonal, world és receipt nem body-mező.
Önálló fizetett food-cook vagy Lobster-delivery request újonnan csak WorkOrderből
készülhet. A többi régi player-action kompatibilis marad.

Az accept/approve/start továbbra is a meglévő Business-policy delegáció.
Indításkor a WorkStore előbb egyetlen run UUID-hoz kötődik és runningra vált;
csak utána indul a request ugyanazzal a runnal. Másik run nem foglalhatja el a
műszakot. A kötés része az exact request, paraméterek, username, natív cél és
settlement. A cook WIP-run egyedi native-keyje másik műszakhoz sem köthető.

## Earned és paid forrása

A [readonly forrásadapter](../../server/gateway/admin/business-work-runtime.ts)
az exact run teljes terminal journalját újranyitja. Username, skillverzió,
paraméterek, run/step azonosítók és időablak egyezése szükséges; fallback success,
exit code vagy HTTP/SDK ACK nem teljesítés.

- Cook: az SI-A07 natív verifier, az exact SI-A06 WIP-run/batch/Business/worker
  és a `returned-output` cooked receipt együttesen kell. A journal főzési
  receiptje ugyanaz a receipt; burnt, waiting, returned-input és félmunka nem earned.
- Delivery: a backend által kiválasztott engine trade ledger auditját olvassa
  újra. A delegáció előtt mentett sequence/hash prefix, exact worker/recipient,
  egy 379-es cooked lobster, üres ellenoldali offer és a run időablaka kell.
  Hiányzó, eltérő vagy többértelmű átadás nem teljesítés. Egy receipt evidence ID
  csak egy WorkOrderben használható, így két átfedő műszak nem kap érte két bért.

Az igazolt befejezés és az earned állapot egy Business IMMEDIATE tranzakcióban
kerül a meglévő WorkOrderbe és az auditba. Ezután a request az előre rögzített
settlementtel settling állapotba kerül. Bizonytalan natív eredmény előtt a
request running marad reconciliation megjegyzéssel. Lejárt, még unearned műszak
nem fizethető ki; a fel nem használt, settlement nélküli foglalás felszabadítható.

Paid kizárólag a meglévő engine `player_action_reward` tábla újranyitása után
következik: exact settlement/username/amount, committed állapot és helyes
coins-before/after különbség kell. A source ugyanahhoz a backend által
kiválasztott helyi világhoz tartozik; a meglévő world/path/junction kapu érvényes.
Először a treasury commit, utána a WorkStore paid és a request completed
projekció készül. Ugyanaz a settlement ismételten olvasható és lezárható,
új kifizetési azonosító nem keletkezik.

## Helyreállítás és bizonytalanság

A meglévő bounded settlement recovery a binding outboxot és a futó, settling,
illetve félbehagyott completed/earned állapotokat is egyezteti. A legfeljebb
100-as batch előtt kiszűri a már lezárt történetet; a régi paid/cancelled sorok
nem szorítják ki az új egyeztetést. A törlés után megszakadt hold-cleanup
továbbra is aktív recovery-munka. A hibatartományok
között nincs elosztott ACID állítás:

- binding/foglalás után hiányzó request: ugyanaz a request és foglalás folytatódik;
- earned után hiányzó request-transition: az earned követelés megmarad;
- engine receipt után elveszett ACK: recovery újranyitja a receiptet, nem ad újra GP-t;
- treasury commit után hibás paid-projekció: ugyanaz a settlement javul előre;
- pending vagy eltérő engine receipt: reconciliation, foglalás megtartása;
- már paid/treasury-committed műszaknál elveszett receipt: nincs új dispatch;
- megváltozott intézményi Business-kötés: nincs másik treasury-re átirányítás;
- lejárt, el sem indított shift: failed/cancelled, nincs bér;
- elutasított vagy indítás előtt törölt request: ugyanaz a shift is cancelled.

A [közös treasury](../../server/gateway/admin/institution-treasury.ts) a WorkStore
által birtokolt `shift.` namespace settlementhez kötött reserved összegét nem
engedi általános `release` hívással felszabadítani. A szerződéses funding már
elfogadáskor settlement ID-t kap, és saját funded/settling cancellation kapuja
van: ennek igazolt, teljesítés előtti felszabadítása kompatibilis marad.
A settlement nélküli reservation release továbbra is idempotens.

## Migráció és rollback

A BusinessWorkStore additív, idempotens migrációja nem változtatja meg a Business
DB közös `user_version` értékét. Új nullable `business_work_order.binding_digest`
anchor és négy v1 tábla keletkezik: `business_work_binding_schema`,
`business_work_binding`, `business_work_binding_audit`, `business_work_binding_head`.
A régi WorkOrderek anchorja NULL, régi bér- és treasury-adatok változatlanok.
A már bound order teljes állapota és bindingje hash-lánccal/head-del ellenőrzött;
row/projekció/tail eltérés és törölt binding fail-closed. A migráció/hiba utáni
kapcsolatzárás az OwnedDatabase tulajdonosi rendjét követi.

Frissítés előtt állítsd meg a dispatch/recovery írókat és készíts konzisztens
mentést a Business, AgentState, treasury és engine reward DB-kről, valamint a
run/food-operation journalokról. Rollbackkor állítsd meg ugyanezeket az írókat;
futó és earned/settling shiftet előbb ugyanazzal a settlementtel egyeztess.
Bizonytalan kifizetést ne oldj fel és ne töröld az engine receiptjét. Az additív
táblákat és anchort tartsd meg. Olyan régi bináris ne kapjon bound WorkOrdert,
amely nem ismeri ezt a védelmet. Teljes backup-restore csak minden érintett
authority és fizikai világ konzisztens közös visszaállításával biztonságos.

## Ellenőrzési határ

A célzott tesztek két delivery workert, reopened store-okat, valódi engine reward
receiptet, részleges/hibás/lejárt munkát, audit-tampert és hibatartományonkénti
SQLite fault-injection utáni recoveryt vizsgálnak. A packed native harness a
valódi főzés/custody/SDK adapter után ellenőrzi az earned/paid állapotot és a
burnt negatív esetet. A delivery teszt a valódi engine trade store producerét
használja; nem állít élő avatárok közötti kereskedési próbát.

Élő cook/delivery bér, publikált food skill és automatikus population-indítás
nem történt. A többavatáros élő elfogadás továbbra is SI-A15 feladata.
