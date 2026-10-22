# SI-A05 – Több szereplős natív élelmiszer-eredet

Hatókör: a helyi/private LostCity lobster lánca (377 → 379 vagy 381).
A gyűjtő, a szakács és a fogyasztó külön actor lehet; a korábbi egyéni
food closure nincs a három résztvevőre lemásolva. A fiziológiai authority
továbbra is az SI-A04 egyszeri application/receipt-lock és a NeedsStore.

## Kanonikus forrás és tranzakciók

A [NativeFoodLineageStore](../../server/engine/src/mods/NativeFoodLineageStore.ts)
append-only, sorrendezett, hash-láncolt tanúkat tart a kanonikus Player-checkpoint
adatbázisában. Source UUID, külön head, egyedi source-key és head/row darabszám
ellenőrzi a replayt és a levágott történetet. A forráshivatkozás a meglévő
production action-ID, consumption action-ID vagy engine trade event-ID.

- A native gathering/cooking receipt és a lineage-tanú ugyanabban a tranzakcióban
  commitol, mint a quota, input/output és Player-checkpoint.
- A consumption eredménye, delivery és lineage-tanú a meglévő native consume
  tranzakció része. Nem jön létre új relief-író vagy második needs állapot.
- A [BOTH_MOVEINV](../../server/engine/src/engine/script/handlers/InvOps.ts)
  első mozgása előtt mindkét fél inventory + tradeoffer mennyisége rögzül.
  A [NativeFoodTrade](../../server/engine/src/mods/NativeFoodTrade.ts) csak a
  második mozgás és a valódi TradeEvidenceStore-bizonylat után ír tanút;
  mindkét Player mentése és e tanú közös checkpoint-tranzakcióban commitol.
  Overflow vagy eltérő before/after nem igazolható sikeres mennyiségi átadásként.
- A trade ledger külön SQLite authority. Nincs eljátszott distributed ACID:
  ledger-commit utáni checkpoint-hiba tanú nélküli trade-et hagyhat. Az olvasó
  ezt sourcegapként észleli, és nem igazol belső ellátást. A fiziológiai tény
  önállóan továbbra is ellenőrizhető; nincs elfogyasztott item-visszateremtés.

A SQLite-lezárásnál reprodukált cache-ből kiesett statement-handle hibát a
közös [OwnedDatabase](../../server/engine/src/io/OwnedDatabase.ts) kezeli.
A MarketStore és a korábbi food/needs kapcsolat saját statementjei strict
close előtt finalizálódnak. A close-hiba nem lesz lenyelve vagy false-ra állítva.

## Mennyiségi lineage

A [projectFoodLineage](../../food-loop/lineage.ts) kizárólag a natív tanúkból
számol olvasási projekciót, actor/world/lifecycle/material szerinti poolokkal.
Nem inventory authority, nem adhat ki tárgyat és nem változtathat tulajdont.
Az átadás előbb mindkét oldalt terheli, utána jóváír: a kölcsönös ajánlat nem
költheti el saját beérkező részét. Átadás nem termelés és nem végső fogyasztás.
A cook egy raw egységet költ; burnt nem cooked. A consume egy cooked egységet
költ, ezért a megmaradt részbatch továbbadható, az elfogyasztott egység nem.

A tárgyak fungibilis mennyiségi eredetet kapnak, nem kitalált slot/asset ID-t.
`evidence=quantity-lineage`, `exactAssetLineage=unavailable`. Az őssource-ok,
gyűjtők és szakácsok halmaza megmarad a split/merge után is; nem állítjuk, hogy
egy adott fizikai darab egy kiválasztott gyűjtési eseményből származott.
Ha két eltérő eredet keveredik, a teljes pool `mixed`, amíg ki nem ürül.
FIFO-val nem lehet az ismeretlen részt leválasztva belső eredetet gyártani.

Minden megfigyelt before-egyenleg egyezik a rekonstruált mennyiséggel, vagy
explicit `unwitnessed-balance` gap keletkezik és az egész érintett pool eredete
`unknown` lesz. A fizikailag igazolt fogyasztás ilyenkor is egy fogyasztás,
de belső ellátásként nem igazolt.

## Bootstrap, import és provenance

A [NativeFoodOpening](../../server/engine/src/mods/NativeFoodOpening.ts) az
offline-save meglévő integrity-határa után, ellenőrzött native Player-loadokból
ír opening tanút. A teljes before/after mutation és az inventory food-egyenlegei
egyeznek. A [SocietyIntegrityStore.foodMutationOrigin](../../society-integrity/store.ts)
csak a pontos, elhasznált genesis permitből ad `bootstrap`, illetve a commitolt
runtime interventionből `import` eredetet; az ismeretlen korábbi készlet egyik
sem lesz automatikusan. A proof a valódi run/result/clock/profile-hoz kötött,
és az olvasó a meglévő integrity auditból újra ellenőrzi. A checkpoint és opening
tanú közös lokális tranzakció; az offline save / integrity eltérő authority,
hibája explicit sourcegap, nem utólag gyártott eredet.

A population körén kívülről, natív transferrel érkező készlet `import` a kör
szempontjából. A natív gyűjtésből származó készlet `internal`; az opening,
import és unknown egységek nem számítanak új natív termelésnek.

Az eredet nem clean-title felmentés. A meglévő item-provenance audit,
`theftHistoryCount` és transformation ancestry megmarad. A `foodSourceGate`
az exact native source-ID/digesthez kapcsolt asset- és transformation-forrásokból
örökíti a `stolen` megállapítást, és megakadályozza a belsőellátás-igazolást.
Nincs „főzés után tiszta” állítás; `cleanTitleFinding=not-established` marad.
Az item-provenance Store új readonly módja nem migrál és nem hoz létre adatbázist.

## Backend olvasás

A [NativeFoodSource.lineage](../../food-loop/native-source.ts) a világon belüli
kanonikus checkpointot, a meglévő trade reader teljes auditját és szükség szerint
az integrity/provenance forrást olvassa. Feltöltött receiptet nem fogad el.
A trade witness pontos payloadjának egyeznie kell a natív ledgerrel; hiányzó,
ismeretlen régi food-trade/consumption tanú nem lesz belső eredetbizonyítás.
Foreign world, path escape, audit-tamper és tail truncation fail-closed.

A [readPopulationFoodLineage](../../server/gateway/admin/needs-runtime.ts)
az SI-A04 source/needs auditokkal már igazolt fogyasztásokat kapcsolja az
eredethez. Egy sor csak a fogyasztó applicationjéhez tartozik; a gyűjtő és a
szakács nem kap másolt reliefet. `physiology=verified` és `internalSupply`
külön státusz, hiányzó lineage esetén `unknown`/`unproven`.

Backend opciók: `nativeFoodCheckpointPath`, `nativeFoodTradePath`, opcionálisan
`nativeFoodProvenancePath` a kiválasztott workspace `.local/` területén lévő,
már létező item-provenance authorityhoz. Ha nincs kapcsolt asset authority,
a title gate `not-established`; ez sosem bizonyít clean title-t.
Az SI-A04 régi nutrition metrikája változatlanul külön kezeli az internal-origin
kérdést; az összesített SI-A12 mutatók és az SI-A15 élő acceptance külön feladat.

## Migráció és visszaállítás

Additive schema: `native_food_lineage_schema=1`, `native_food_lineage` és
`native_food_lineage_head` az engine checkpoint adatbázisában. A meglévő
consumption/production/delivery/needs/food/trade/integrity user_version és receipt
azonosítók megmaradnak. A következő natív store-inicializálás hozza létre;
readonly olvasás hiányzó séma esetén `unavailable`. Újabb vagy félkész séma tiltott.
Nincs régi receiptből kitalált visszamenőleges lineage vagy új relief.

Rollback előtt a világot le kell állítani. A teljes workspace és az összetartozó
SQLite adatbázisok + WAL/SHM fájlok közös mentése őrizze a Player-checkpointot,
trade ledgert, integrity/provenance és food/needs authorityt. A korábbi binary
az additive táblákat figyelmen kívül hagyhatja, de adatot nem kell törölni.
Újra felminősítéskor a régi binary alatt tanú nélkül végzett műveletek sourcegapek;
nem automatikus historikus belső ellátás. A receipt-lockokat/headeket törölni,
vagy a needs adatbázist önmagában régi állapotra visszatenni nem rollback-eljárás.

## Ellenőrzött határ

11 izolált natív próba valódi packed tartalommal, Player/save/inventoryval és
valódi SQLite source-adatbázisokkal: A→B→C és csak C reliefje; részbatch és több
trade; replay/reopen; unknown/mixed; hiányzó trade/tamper; production rollback;
stolen provenance; bootstrap/import; a valódi két BOTH_MOVEINV opcode; trade
checkpoint-hiba; truncation/foreign-path. A közös acceptance élő többavatáros
világfuttatása az SI-A15-ben marad. Az összes log, a megőrzött negatív eredmények,
időtartamok és a végleges teljes regresszió a
[progress naplóban](SOCIETY_INTEGRATION_PROGRESS.md) szerepelnek.
