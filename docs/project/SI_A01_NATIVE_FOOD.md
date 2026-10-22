# SI-A01 – Natív, tartós homárfogyasztási bizonylat

2026-10-18. Hatókör: kizárólag a helyi/private LostCity emulator.
Fejlesztési ág: `codex/si-a01-native-consume`.

## Működés és források

A támogatott étel a főtt homár, item **379** (DEC-01). A normál
`OpHeldHandler` láthatóság-, component-, inventory-, slot- és itemellenőrzése
után a population membershippel rendelkező avatár étkezése az
`executeNativeFoodAction` belső motorhívásra kerül. A többi étel és a population
nyilvántartásán kívüli karakter meglévő contentútja változatlan; ezekre ez a
verzió nem állít társadalmi fogyasztási bizonyítékot. A membership nem botfajta:
a kötött karakterhez emberi vezérlő is tartozhat.

Az engine saját `populationFoodContext` adaptere a meglévő aktív
membershipet, lifecycle-t, world profile/policy-kötést és SimulationClockot
olvassa. Kezelt világban a saját workspace és server ID kötelező; a lokális
azonosító a forrásgyökér digestjéhez kötött. A lifecycle digest az actor,
keletkezés, genesis, world profile, lifecycle policy és clock kötéséből áll.
Az executor a mutáció előtt ismét ellenőrzi az authorityt; idegen actor,
világ, lifecycle, óraprofil, halott karakter vagy álló óra nem hajthat végre
fogyasztást. A meglévő shared-escrow migration preflight is megmarad.

Az étkezés a valódi `[opheld1,_category_58]` → `player_consume_item` →
`consume_effect_stat` scriptláncot futtatja. A duel/no-food és eat-delay
contentellenőrzések nem kerülhetők meg. A `ScriptState` ideiglenes witnessét
csak a megfelelő consume labelben, a megfelelő avatár/inventory/slot/item
tényleges `INV_DELSLOT` művelete növeli. Más `inv_del`, drop, animáció vagy
HP-változás nem fogyasztási bizonyíték. Script-abort és suspend hibának számít;
ehhez az egy szinkron élelmiszerhez nem indul háttérben második script.

**A jelenlegi content teljes HP-nál is elfogyasztja a homárt.** Ekkor a receipt
itemváltozása −1, a HP-változása 0. Az eat-delay vagy hiányzó item `no-use`
eredmény, receipt nélkül. Ez a patch nem vezet be hunger-reliefet vagy
needs-perzisztenciát; azok SI-A03/SI-A04 feladatai.

## ID, tartósság és újraindítás

A `FoodAction` exact szerződése: UUID action ID, world, actor, username,
lifecycle digest, item 379, quantity 1, slot, food-policy digest, clock ID és
clock-profile digest. A motor packetenként az admit előtt generál UUID-t.
Belső typed hívó ugyanazzal az actionnel tud státuszt olvasni/folytatni;
ugyanazon ID más tartalommal tiltott. Új, külön klienskattintás új művelet.
A böngésző/SDK protokoll ebben a taskban nem kapott új action-ID mezőt;
egy elveszett hálózati válasz után új kattintás nem tekinthető ugyanazon ID
biztonságos retryának. A magasabb szintű verified hívó bekötése SI-A07 része.

A kanonikus `MarketStore` Player-checkpoint adatbázis két additív táblával
bővül: `native_food_schema` (verzió **1**) és `native_food_actions`.
Az intent és request digest a content előtt tartós. Ezt követően egyazon
SQLite `BEGIN IMMEDIATE` tranzakció tartalmazza a valódi inventorymódosításból
származó Player-save-et, a `World.checkpointPlayers` közös recovery boundaryját
és az eredményt/receiptet. A tároló nem vezet második inventory-egyenleget.
Más checkpoint connection használata a production útban tiltott.

Receiptmezők: az exact action, schema 1, `content:consume_effect_stat` cause,
natív item before/after, HP before/after, a meglévő SimulationClock observation
(wall/simulation time, engine tick, revision és profile digest), `food:<actionId>`
checkpoint ID, checkpoint-save digest és request digest. Az immutable művelet
és eredmény digestje az exact lookupnál ellenőrzött. A későbbi autosave
felülírhatja a legfrissebb Player-checkpointot; ez nem írja át a korábbi receiptet.

Commit előtti írási vagy scripthibánál az adatbázis-tranzakció és a live
inventory/HP/consume-var állapot visszaáll. A tartós intent megmarad.
Újraindítás után az eredeti ID olvasandó: a committed eredmény visszaadása
nem futtat új contentet; pendingnél a kanonikus Player-checkpointból lehet
folytatni. Ismeretlen vagy hibás forrásra nincs kitalált receipt.

A gateway `readNativeFoodSource` belső, kizárólag readonly, exact-ID olvasó.
Az egész lookup egy read snapshotban történik. Eredménye `unavailable`,
`missing`, `pending` vagy `completed`; utóbbi `consumed` **vagy** `no-use`.
A hiányzó fájl/séma nem hoz létre adatbázist. Kezelt világban más server ID,
adatkönyvtár vagy azon kívülre feloldódó útvonal tiltott. Nincs receipt-upload
vagy új nyilvános HTTP write endpoint.

## Migráció, backup és rollback

- Az első writer a kanonikus checkpoint DB-n belül atomikusan hozza létre a
  két új táblát. Az `accounts`, az escrow és a meglévő globális schema-version
  nem módosul. Régi fogyasztásokhoz nincs visszamenőleges adatgenerálás.
  Ismeretlen jövőbeli evidence-verzió hibával megáll, a migráció visszagörget.
- A kezelt példányok meglévő `server/engine/data` snapshotfája tartalmazza az
  új evidence-t is, mert az ugyanabban a DB-ben van, mint a Player-checkpoint.
  Az `InstanceMaintenance` teljes snapshot/hash ellenőrzése továbbra is érvényes.
  Új, külön asset custody vagy estate-elosztási tartomány nem jön létre.
- Backup előtt minden világírót le kell állítani; DB/WAL/SHM és az összetartozó
  világ/domain állapot együtt mentendő. Az inventory mentése és a receipt DB
  külön visszaállítása nem támogatott. A tesztek force-kill és reopen mellett
  is ellenőrzik a közös DB konzisztenciáját.
- Kódrollbackhez előbb íróstop, pending műveletek exact-ID egyeztetése és
  együtt mentett világállapot szükséges. Az additív táblák maradjanak meg:
  korábbi kód ignorálhatja őket, de az azután végzett étkezések nem minősülnek
  SI-A01-bizonyítottnak. Commitolt gazdasági történet egyoldalú rewindja,
  receipt törlése vagy kitalált itemjóváírás nem támogatott; szükség esetén
  külön auditált kompenzáció kell.

## Ellenőrzés és elfogadási scope

Az izolált natív próba saját temp Player/checkpoint/login DB-t és generált
tesztkulcsot használ; az emulator packed cache-ének másolatát/readonly
konfigforrásait olvassa. Nincs módosítás valódi karakterhez, szolgáltatáshoz,
mentéshez, és nincs külső vagy LLM/providerhívás. Az identity/clock authorityt
a fixture szolgáltatja; a Player, script interpreter, content, inventory,
save serializer, SQLite checkpoint és readonly reader valódi. Külön próba
a tényleges `World.checkpointPlayers` production callbacket is összeköti.

A két crash-próba gyermekfolyamatot kényszerítetten leállít a nyitott
tranzakcióban, illetve a sikeres commit után. A szülő újranyitja a DB-t,
visszatölti a Player-save-et, és ugyanazon action ID folytatásánál ellenőrzi
az egyetlen fogyasztást. Az egyavatáros bounded local consume-smoke a valódi
packed contentút és eredeti inventory összevetése; külön hálózati
SDK/böngésző/élő szerver session ebben a taskban nem indult.

Packed források SHA-256 értékei:

- `server/script.dat`: `2e9b2a8a91ae64abee01afba9ed28c8700045eed413afdfcaa521515468f09b3`
- `server/obj.dat`: `f86e2e07d8801cce6bf3751342f279b31f60190049aec77407ae9262069f9818`
- `server/dbrow.dat`: `5a4f274c247217875f8b3b71006100a86030b51a5d4165f6cd91dd910cce8286`

A food-policy digest `sha256(JSON.stringify("native-lobster-consume-v1"))`:
`4c78c6562d0edae455caf90815ace1b15f4c9adc23e625cc572679ad754f47bd`.
A fixture action ID `11111111-1111-4111-8111-111111111111`; tesztenként és
crash-esetenként külön temp DB-ben. Az intervenció a dokumentált fixture
indulókészlet, a disk-failure trigger és a két szándékos process kill.
A későbbi közös SI-A14/SI-A15 elfogadás ettől még nyitott.

A végső parancsok, naplóazonosítók, időtartamok és eredmények a
[society integration progress](SOCIETY_INTEGRATION_PROGRESS.md) fájlban vannak.
