# SI-C07/2 – Applied genesis és natív indulóállapot

2026-10-27. **P2-02 kész komponensszinten; 2/11 lezárási pont kész, 9 nyitott.**
2/8 pozitív natív integritási kapuút. [Rögzített lista](SI_C07_PACKAGE2_CLOSURE.md).
SI-C07 nyitott, 27/45, preflight NO-GO; nincs tényleges MVS PASS.

`society-metrics/genesis-opening.ts` a meglévő alkalmazási és natív adatokat
olvassa. Az explicit backend `population.opening` a **genesis utáni induló**
mentéskészletet választja ki. Ez különbözik az egy nap warmup utáni evaluation
nyitópontjától és a későbbi aktuális állapottól. Nincs automatikus current-state
fallback, HTTP-n megadható path vagy feltöltött PASS-bizonyíték.

Az ellenőrzés az eredeti resultId/digest, teljes founder cohort és alkalmazási
idő alapján köti össze:

- az applied application pontos resultját, schema2 rollback tokenjét és nyugtáit;
- a verified integrity bootstrap-complete és opening-snapshot eseményeket,
  az induló értékek számát/digestjét és az egyszer felhasznált bootstrap
  mutation permitjeit, a tényleges before/after payloadokhoz kötve;
- az azonos profilú, pontos genesis-időn paused natív órát;
- a kanonikus mentésből olvasott GP-t, inventory/bank/equipment készleteket,
  XP-t, pozíciót és pozitív HP-t a rollback + deklarált kiosztás eredményével;
- az eredeti finite-avatar kötést, population receiptet és genesis-admission
  szerinti kezdeti szükségletállapotot;
- a Business létrehozási/készlet-, treasury-credit és property-assignment
  natív nyugtáit, valamint tényleges induló egyenlegét, készletét és tulajdonjogát.

Az összehasonlítás a deklarált bootstrap gazdasági és karakterállapotát méri;
a készletek mennyiségi azonosságát, equipmentnél a slotot is. Nem bitenként
azonos mentésfájlt vagy az egész host atomi snapshotját állítja.
Az olvasók workspace-path-, 256 MiB/100000 sor- és stabil snapshot-védelme
változatlan; az adapter nem hoz létre adatbázist vagy történeti bejegyzést.

Hiteles, azonos runhoz tartozó fizikai eltérés `applied-genesis-baseline:fail`.
Egy ilyen korábban ellenőrzött forrássértés másik hiányzó forrás mellett is
megmarad; ilyenkor `completeOpeningSources:false`. A hibás részolvasás közben
még nem hitelesített mismatch visszavonódik. Hiányzó/hibás/idegen nyugta,
nyitóforrás vagy óra nem ad pozitív kaput. Érvényes teljes 1+7 frame szükséges
a pozitív natív minimum-projekcióhoz; hiteles scoped FAIL rövidebb frame-ben is látszik.

A facade továbbra `qualifiesMinimum:false`: ez az indulóállapot igazolása,
nem teljes run coverage, túlélés, belső lineage vagy a társadalom önfenntartása.
A későbbi adminérték vagy import külön integritási kapu. A konkrét C07
nyitópont elkészítése/kijelölése és archiválási leltára a 3./5. csomag feladata;
a mostani adapterhez nincs új journal, producer, migráció vagy live telepítés.

A teszt a valódi `startAdminWorldGenesis` → `LocalLostCityWorldGenesisAdapter`
utat, tényleges domain SQLite store-okat és kanonikus save-byteokat használja,
izolált ideiglenes workspace-ben. A hálózati/offline-editor hívás helyi fixture,
nincs futó játékvilág. Pozitív opening/offline újraolvasás, player/stock/treasury/
property eltérés, natív nyugtasértés, fel nem használt permit, sérült snapshot,
hiányzó/idegen/későbbi source, külön visszamásolt opening és prefix FAIL-védelem
próbázott. Az eredeti bootstrap fixture running órája először helyesen unknown
lett; a fixture-t valóban paused indulópontra javítottuk, az adapter nem lazult.

Ellenőrzési kör és idő a [handoffban](SOCIETY_DEVELOPMENT_HANDOFF.md), a korábbi
FAIL-ekkel együtt a [progressben](SOCIETY_INTEGRATION_PROGRESS.md).
