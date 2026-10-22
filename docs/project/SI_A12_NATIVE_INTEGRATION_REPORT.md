# SI-A12 – Natív integrációs mérés és egyeztetés

## Implementáció

A `society-metrics/integration-sources.ts` kizárólag olvasásra nyitja a
backend által kiválasztott világ meglévő adatbázisait. A
`integration-report.ts` ugyanebből a gyűjtésből állítja elő a mérési tagokat,
az eredeti rekordokra mutató bizonyítékindexet és a tartalomdigestet.
Nincs gameplay writer, migráció, clock advance, providerhívás vagy feltöltött
riportból származó mérési authority.

A források külön `available`, `unavailable` vagy `invalid` állapotot és
digestet kapnak. A meglévő auditolvasók ellenőrzik a needs-, receipt-use-,
lineage-, WIP-, work-binding-, commerce-, escrow- és rent-bizonylatokat.
A PlayerTime és a fizikai alvás tanúlánca külön ellenőrzést kap. A hiányzó
csatorna nem lesz sikeres nulla. Az adapter explicit táblaméretkorlátot
ellenőriz; túlméretes forrást nem csonkít sikeres részriporttá.

## Nevező, relief és időhatár

Pontosan négy különböző actor explicit kiválasztása szükséges. Mindegyikhez
egy, az egész ablakot lefedő lifecycle, pontos nyitó/záró needs-revízió,
azonos világ/clock/profile és az alkalmazott PlayerTime-cursor kell.
Két actor nem fedheti el ugyanannak a natív játékosnak a szükségletét.
Az eseményablak `(from,to]`, a kitettség `[from,to)`.

Az éhség nevezője racionális mennyiség, `3 600 000` közös osztóval:

```text
D = Σ actor (nyitó éhség × 3 600 000 + nyitó pozitív remainder
             + Σ pozitív éhségráta/óra × szimulációs milliszekundum)
N = Σ igazolt belső eredetű natív fogyasztás tényleges reliefje × 3 600 000
arány basisPoints = floor(N × 10 000 / D)
```

A rateszakaszokat az auditált online/offline és awake/sleeping történet,
valamint az alvásjog lejárata határolja. A telítettségi plafonon elvesző
állapotváltozás nem törli a demandet. A fatigue jelentés elkülöníti a
potenciális regenerációt a ténylegesen alkalmazott, korlátozott recoverytől;
az utóbbit a záró fatigue-állapotig és remainderig visszajátssza.
Faliórából vagy pollinggyakoriságból nincs becsült kitettség.

A relief csak a SI-A04 egyszeri alkalmazási bizonylatából származik.
A SI-A05 eredet ugyanahhoz az actionhöz kapcsolódik, nem második
fogyasztás. A `no-use` külön alkalmazási diagnosztika, nem final use.
Az unknown/mixed eredet és a source gap inconclusive eredményt okoz;
a nulla nevező mellett nincs sikeres arány. A food delivery zárt tickjének
le kell fednie a záró időt, és minden natív receiptnek alkalmazottnak kell
lennie. A `completePopulationCoverage` kizárólag az explicit négytagú
kohorsz ezen fiziológiai lefedettségét jelenti, nem a teljes gazdaságét.

## Munka, pénz, készlet és függőségek

- A fogyasztási intent/native/domain állapot, a konyhai issue/process/return,
  a commerce és a bérlet egyeztetése külön sorokat kap. A natív commit
  önmagában nem aktiváltnak feltüntetett domain-állapot.
- A bér a work-binding settlementjével, a natív reward `coins_before/after`
  bizonylatával, a treasury terhelésével és a paid work-orderrel egyezik.
  A natív munkateljesítés külön bizonyítékot igényel. A jelenlegi reward
  táblának nincs szimulációs stampje: a kifizetés ezért `unplaced`, és nem
  kerül az időablak GP-forgalmába egy faliórás időbélyeg alapján.
- A valódi trade és clock-stamp nélküli completed commerce nem időablakba
  helyezett mérés. Az átadás, értékesítés és escrow-mozgás nem termelés.
  Termelésnek kizárólag a SI-A02 natív gather/cook outputja számít.
- A gather/cook, fogyasztás, natív rent és elhelyezhető commerce
  before/inflow/outflow/after egyenletei külön residualt és evidence ID-t
  kapnak. A pénz nem keletkezik pusztán a rent két oldalának összeadásától.
- Az inter-actor gráf a lineage szerinti gyűjtő/főző → fogyasztó, a fizetett
  szállás és az igazolt food-transfer kapcsolatát mutatja. Az éleknek saját
  bizonyítékhivatkozásuk van.
- A jelenlegi player inventory/bank/equipment, Business inventory/storage,
  unissued WIP, treasury és natív escrow külön hely. A már kiadott natív
  WIP domain-tükre nem újabb item; a reserved treasury GP a balance része.
  A bizonytalan in-transit/native-domain különbség egyeztetendő hely marad.

## Nyitó/záró vagyon

A jelenlegi egyenleg nem történelmi nyitó vagy záró vagyon. A backend
opcionálisan `openingBoundary` és `closingBoundary` natív adatbázis-készletet
adhat át. Egy készlet `checkpointPath`, `businessPath`, `treasuryPath`,
`clockPath`, `needsPath` útvonalakból áll; HTTP-paraméter nem adhatja meg.
Ezek befagyasztott, meglévő SQLite-források, nem JSON-ban feltöltött számok.

Elfogadásukhoz pontos, paused clock/profile, mind a négy actor adott idejű
needs-kötése, azonos idejű zárt natív food-watermark és hiánytalan
alkalmazási lánc kell. A checkpointok CRC-ellenőrzött natív mentések.
Az ismeretlen, nem üres persistált inventory-konténer vagy a bizonytalan
escrow/konyha/commerce domain-egyeztetés megakadályozza a zárt vagyonhatárt.

A két natív készletből GP/item mennyiségenként készül
`opening + production - use - closing = residual` egyenlet. Belső átadás
nem ad hozzá termelést. A nem nulla residual látható mismatch. A nulla
residual csak a megfigyelt egyenlet zárását igazolja; hiányzó más mutációs
csatornák miatt a `completeEconomicCoverage` és a society-minimum verdict
továbbra sem lesz automatikusan sikeres.

## API, dashboard, export

- Authenticated GET `/api/admin/society/integration` a meglévő
  `from`, `to`, `clockId`, `clockProfileDigest`, ismételt `actor` paraméterekkel.
- GET `/api/admin/society/integration/evidence/<id>?…&snapshot=<digest>`:
  a natív források újbóli olvasása után adja vissza az eredeti rekordot.
- A meglévő evaluation/dashboard négy actor mellett tartalmazza az adaptert.
  A coverage panel külön mutatja a needs-, custody-, work-, rent- és
  vagyonadatokat. Legfeljebb 100 bizonylatgombot jelenít meg; a teljes
  indexet és az eredeti rekordokat a natív JSON-letöltés tartalmazza.

A gyűjtés két teljes tartalomlenyomatot hasonlít össze. Változáskor 409 és
újratöltés szükséges; korábbi snapshotból nincs újabb rekordhoz vezető
észrevétlen drilldown. Ez nem cross-database ACID, és ezt a riport jelzi.
A feltöltött observations/source-path paraméterek nem mérési inputok.

## Ellenőrzés és rollback

A részletes parancsok, időmérések és végső forráshash-manifeszt:
[integrációs progress](SOCIETY_INTEGRATION_PROGRESS.md).
A tesztek valódi store-olvasókat, négytagú nevezőt, zero-demand/no-use,
határidőt, unknown origint, source gapet, két világot, snapshot driftet,
nyitó/záró bank/GP-t, eltérő clockot, natív bért, fizikai rent/sleep és
órakötés nélküli valódi trade-bizonylatot ellenőriznek.

Nincs adatmodell-migráció vagy új journal. Rollback: az adapter API/UI
bekötése és új moduljai eltávolíthatók; a natív és domain adatbázisokhoz
nem kell visszaalakítás. A mentésolvasó meglévő fájlútja ugyanazt a tiszta
byte-parsert használja; a szigorú asset-container ellenőrzést csak a
vagyonolvasó kéri. A közös, élő demonstráció és kimeneteinek újraolvasása
SI-A15; a fixture/capture konfiguráció SI-A13 feladata marad.
