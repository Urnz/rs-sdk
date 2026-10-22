# SI-A06 – Fizikai konyhai WIP és Business–avatar custody

Hatókör: a helyi/private LostCity egyetlen, verziózott lobster batch-e:
377 × 1 → 379 × 1 vagy 381 × 1. A konfigurált hőforrásnak valóban léteznie
kell és elérhetőnek kell lennie; az adapter nem spawnol tárgyat vagy berendezést.

## Foglalás és fizikai feldolgozás

A [gateway adapter](../../server/gateway/admin/native-kitchen.ts) a population
igazolt actor/player/lifecycle/clock kötéséből készít intentet. A kliens nem
adhat meg másik dolgozót, itemlistát, feltöltött receiptet vagy custody-digestet.
A [WIP store](../../production-workflow/wip-store.ts) az eredeti Business-stock
foglalását és az exact recipe/run/worker intentet közös SQLite-tranzakcióban
rögzíti. Két konkurens run ugyanazt az anyagot nem foglalhatja le.

A [natív executor](../../server/engine/src/mods/NativeKitchen.ts) a már foglalt
egységet a meglévő PlayerInventoryEscrowStore Businesshez kötött escrowjába
helyezi. A Business WIP-ben látható mennyiség nem elkölthető készlet, hanem
foglalási könyvelés. Fizikailag csak az escrow tartja a kiadott egységet;
a dolgozó szabad inventoryja nem kap újra elkölthető raw tárgyat.
A generikus escrow release/commit/consume végpont nem rendelkezik az ehhez
szükséges belső bindinggel.

A process ugyanazt az SI-A02 packed OPLOCU → cook_item tartalmat futtatja,
mint a normál natív főzés. A raw ideiglenes inventory-projekciója szinkron
checkpoint-tranzakción belüli; natív várakozás előtt visszakerül a zárt
custody állapotba. Sem tickek között, sem hiba után nem marad szabad input.
A tényleges natív output, input-escrow elköltése, output-escrow, receipt,
lineage-tanú és végleges Player-checkpoint közös engine-tranzakcióban commitol.
Várakozásból újraindításkor csak a még el nem költött input folytatható;
a már commitolt action nem adhat még egyszer tárgyat vagy XP-t.

A facility grant, valódi Business employment/role és a clock kötése kiadáskor
és natív commitkor is ellenőrzött. Storage inputhoz storage.withdraw, inventory
inputhoz inventory.issue, az output céljához pedig storage.deposit vagy
inventory.receive kell. Owner a meglévő Business-szabály szerint jogosult.
Lejárt grant, megszűnt employment, halál vagy revoke után nincs új termelés,
de a valóban meglévő input/output biztonságos visszavétele továbbra is lehetséges.

## Visszavétel és véglegesítés

Az engine return az igazolt, ténylegesen held inputot vagy outputot fogyasztja
el az escrowból, és tartós inbound állapotot ír. A readonly
[result source](../../production-workflow/native-kitchen-source.ts) közvetlenül
a kiválasztott világ kanonikus adatbázisának teljes auditját és a kapcsolt
production receiptet ellenőrzi. HTTP-siker vagy folyamatkilépés nem bizonyíték.

- Returned-input: csak a fizikailag el nem költött raw állíthatja vissza az
  eredeti Business-foglalást.
- Returned-output, cooked: az eredeti WIP completeStep/completeRun útja és
  production-evidence auditja egyszer írja jóvá a 379-et a megadott célra.
- Returned-output, burnt: a 381 Business inventoryba kerül; nincs 379-jóváírás.
  A native phase burnt, a run running marad, és nem generic cancellationnel
  téríthető vissza az elköltött raw.

A generic complete/cancel út native-bound runon tiltott. Az eredeti runon
tárolt binding-anchor akkor is védi ezt, ha az új projekciót egészében törlik.
A natív forrás és a Business eltérő adatbázis: nincs distributed ACID állítás.
Return utáni Business-hiba tartós, újraolvasható inbound eredményt hagy;
recovery ugyanazzal az azonosítóval véglegesít, nem teremt raw refundot.

Az [item transformation reader](../../item-transformation/native-food.ts)
megőrzi az exact business/run/escrow bindinget a natív receipt mellett.
Ez mennyiségi custody-tanú; nem kitalált egyedi asset/slot lineage és nem
clean-title felmentés. A korábbi provenance és stolen-history kapuk megmaradnak.

## Migráció és visszaállítás

Additive Business schema v1: business_production_native_schema, operation,
audit és head; az eredeti business_production_run új native_binding_digest
oszlopa a foglalást horgonyozza. A korábbi WIP intent/lot és user_version marad.
Az engine checkpointban additive native_kitchen_schema/operation/audit/head
v1 él. Az escrow audit új nullable business_binding_digest oszlopa és a
player_inventory_escrow_business_binding tábla védi a Business-custodyt.
A régi, binding nélküli escrow sorok korábbi hash-formátuma változatlan.
Újabb, félkész, levágott vagy auditeltérést mutató séma fail-closed.
Az SI-A07 a meglévő native WIP row opcionális, auditált skillInvocation
kötését is használja; ez régi sorokból nem gyárt új skill-trialt.

A business-roles, facility-capability és production-workflow package.json
explicit ESM-jelölést kapott, mert az engine NodeNext importálja meglévő,
import.meta-alapú configloadereiket. A katalogus és konfiguráció hash-kötése
megmarad; nincs új runtime függőség.

Downgrade előtt le kell állítani a világot. A korábbi binary nem ismeri az
új WIP-anchor és escrow-purpose védelmet, ezért outstanding native custody
mellett nem indítható. Előbb minden ilyen run visszavételét/véglegesítését
helyre kell állítani, vagy az összetartozó teljes workspace, Business és
Player-checkpoint adatbázisok + WAL/SHM közös mentését kell visszaállítani.
Táblák/anchor/receipt-lock törlése és az elköltött input generic cancelje
nem rollback-eljárás.

## Ellenőrzött határ

21 izolált natív próba valódi packed contenttel, Player/save/inventoryval és
SQLite authoritykkal; két tényleges konkurens reservation process és négy
issue/return előtti/utáni force-kill/reopen próba. További esetek: cooked/burn,
full inventory, elérhetetlen heat, worker death/expiry/revoke, employment,
ordinary worker storage-jog, generic escrow bypass, projection truncation,
receipt/audit hiba utáni rollback (XP-vel), readonly forward recovery és szűk
tokenes belső API. A négyavatáros élő acceptance az SI-A15 feladata marad.
Ellenőrzési eredmények és a megőrzött negatív futások:
[progress napló](SOCIETY_INTEGRATION_PROGRESS.md).
