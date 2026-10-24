# SI-C06 – A kibővült világ összehasonlítható baseline-ja

2026-10-24. Ág: `codex/si-c06-expanded-baseline`, baseline
`d57966d2f9c3a395166313e26d50a3090f9a1d6e`.

Hipotézis: a meglévő offline archívum garanciái megtarthatók, miközben explicit
source/schema/runtime/config/cache/model/report pin és baseline→result kötés
akadályozza meg a hiányos vagy eltérő kezdőállapot összehasonlítását.

Talált rés: az új canonical `server/engine/data/player-checkpoints.sqlite`
sidecarokkal és `.local/society-metrics` megfigyelések hiányoznak a gyökérlistából.
Needs/AgentState/economy/simulation tárolók meglévő gyökerek alatt vannak;
ezek jelenléte azonban eddig nem minden esetben volt kötelező a kiválasztott
kísérlethez. Az új adapter explicit kiválasztott source/table/schema coverage-t
kér; missing nem inicializálható érvényes üres világként.

Terv: additív archive-evidence és restore előtti validator hook, a v1 archívumok
változatlan olvashatóságával. Külön expanded baseline adapter saját versioned
pin/evidence-szerződéssel, immutable forrás-, policy-, packed-, provider- és
reportazonossággal. Baseline dirty/policy drift a pinhez képest elutasított;
result exact baseline manifesthez kötött. Generikus v1 verify önmagában nem
állít expanded/native reprodukciós garanciát. Restore kizárólag új könyvtárba,
native/schema/report ellenőrzés még publish előtt. Nincs adatmodell-migráció,
automatikus backfill vagy élő világ felülírása.

Olcsó kapu: eldobható kis Git/SQLite workspace; WAL-ban maradt committed sor,
needs/custody/work/finance megfigyelés; új könyvtáras baseline/result roundtrip,
azonos native state/report digest; hiányzó store/schema, dirty policy/source,
eltérő baseline pin és corrupt payload negatív próba. Korán valódi natív WIP
checkpoint elmentése/újranyitása, native child60 s/wrapper90 s. Provider0 USD,
nincs autonóm soak vagy historical SI-A15 DB. Offline-probe konkrét managed
worker felismerés célzottan vizsgálandó. Két hosszú hiba után kisebb diagnosztika.

Ellenőrzési határ: archive/expanded adapter, benchmark CLI, közvetlen controller/
offline-probe fogyasztók, root és szükség esetén engine TS, staged format.
Nem módosítjuk a SQLite-tranzakció, clock, gazdasági commit vagy auth alapját;
full nem taskzáró rutin. Archive v1 kompatibilitás és elutasítási kapuk célzottak.
Seed nem rögzít engine RNG-streamet, scheduler timingot vagy külső LLM-válaszokat;
exact archived evidence replay nem bitazonos autonóm világ-újrafuttatás.

## Elkészült szerződés

Az `archive.ts` v1 transportja a két hiányzó gyökeret és a canonical checkpoint
`-wal/-shm/-journal` fájljait is kezeli. A régi v1 bundle olvasható maradt.
Additív `baselineEvidence` és opcionális capture/read/restore validator; nincs
megváltoztatott SQLite-tranzakció vagy domain migrátor. Az archívum teljes
private lokális adat, nem publikálható/redaktált dataset. A meglévő path/link/
secret/file-count/byte-limit és offline kétoldali stabilitási kapuk megmaradtak.

Az `expanded-baseline.ts` saját `society-expanded-baseline-v1` pinje:

- Explicit world/clock/profile, run, declared seed, provider/model/effort és
  `si-c05.v1` reportverzió. Provider a tényleges override/default configgal
  egyező; seed a benchmark reportban a natív genesis seedjével egyeztetett.
- Dirty forrásfájlok is pontosan hash-kötöttek. A pin elkészítése után source,
  config, cache vagy selected native state módosítása más baseline. Nem kell
  a szándékosan pinned dirty kódot tiszta Git checkoutnak nevezni.
- Source-tree, config/policy, packed-cache külön digest. A `config/`, engine
  `data/config/`, valamint admin LLM/world-director/world-mod override is pinned.
  A metadata providerbeállítás nem titoktári kulcs és nem hív provider API-t.
- Backend-/operátor-kiválasztott role→relatív store-path→required-table lista.
  Csak a ténylegesen archivált state gyökerekből; nem lehet kívülről véletlenül
  a live világot olvasni. Kötelező paused native clock; role schema és állapot
  külön digest. A kiválasztott store hiánya vagy elvárt tábla hiánya hiba, nem
  üres világ. AgentState/clock jelenlegi verzió, needs-v1; Work/food-production/
  Business-binding meglévő audit/séma olvasója is lefut, ha kiválasztott.
- A store-lefedettség explicit. A C07 tervbe minden használt needs, health,
  custody, business, treasury, housing, bank, trade, provider queue stb. source
  felveendő; egy rövidebb kiválasztás nem teljes világminősítés. A benchmark
  eredeti genesis/initial-state/session/integrity gate-jeit a CLI is megtartja.

A result ugyanannak a pinnek és teljes plannak az exact baseline-manifest
digestjére hivatkozik. Result alatt selected state változhat, source/config/cache
és schema nem. A reportot a backend natív olvasó készíti. Restore új könyvtárba
vezet: byte/integrity ellenőrzés után, még az ideiglenes staging publish előtt
schema/state újraolvasás, resultnál report-digest egyezés. Hibás natív report
esetén nincs közzétett célkönyvtár. Az archive payloadot readonly SQLite-val sem
nyitjuk meg; az újraolvasás kizárólag a másolatban történik. Restore előtt nincs
még egy külön teljes verify; a beépített verify elég. A külön verify parancs is
egy inventory-ellenőrzést használ, nem két egymásra épülő teljes hash-kört.

A `benchmark-report-v2-expanded` opcionális ágába az SI-C05 outcomes kerül,
a kiválasztott workspace source-aiból, a natív controller evaluation ablakával.
Az LLM wall-window a valódi execution start/last-observation wall idő; nem
SimulationClock-aránybecslés. Observer-memóriaexport itt letiltott; a saját
scoped export továbbra a C05 API/CLI. Native report hiánya partial/inconclusive,
nem kitalált nulla. A default v1 riport ága és a minimumképletek változatlanok.

## CLI és upgrade/rollback

Előbb a normál domain migrátorokkal legyen kész, jelenlegi sémájú és offline a
világ. A C06 adapter nem futtat migrációt, nem hoz létre hiányzó DB-t, és nem
figyeli/mozgatja a clockot. Régi v1 archive helyreállítható a régi szerződéssel;
új expanded baseline csak explicit preflight/pin után készülhet. Új pin készítése
nem javítja visszamenőleg az eltérő baseline eredményét. Code rollbackhez nincs
adatátalakítás; C06 evidence-hez a hozzá tartozó validator/runtime-verzió kell.

Selection-példa (az adott run minden szükséges csatornájával kiegészítendő):

```json
{
  "worldId": "selected-world",
  "clockId": "world",
  "clockProfileDigest": "<native-profile-sha256>",
  "seed": "<native-genesis-seed>",
  "runId": "<plan-session-id>",
  "provider": { "provider": "mock", "model": "deterministic-scripted-v1", "reasoningEffort": null },
  "reportVersion": "si-c05.v1",
  "stores": [
    { "role": "agent", "path": ".local/agent-state/agents.sqlite", "requiredTables": ["agent_population_member", "character_attribute_binding"] },
    { "role": "clock", "path": ".local/simulation/simulation-clock.sqlite", "requiredTables": ["simulation_clock"] },
    { "role": "needs", "path": ".local/simulation/food-needs.sqlite", "requiredTables": ["needs_state", "needs_event"] },
    { "role": "checkpoint", "path": "server/engine/data/player-checkpoints.sqlite", "requiredTables": ["accounts", "native_tool_work", "native_tool_binding"] },
    { "role": "business", "path": ".local/economy/businesses.sqlite", "requiredTables": ["business", "business_work_binding"] },
    { "role": "treasury", "path": ".local/economy/institution-treasury.sqlite", "requiredTables": ["institution_treasury"] }
  ]
}
```

Az engine által ténylegesen használt checkpointot kell megadni, például a legacy
`market.sqlite` helyett nem szabad üres `player-checkpoints.sqlite`-t gyártani.
Az egyszerű `backup-local.ps1` engine-only mentése nem expanded society baseline.
A managed worker relatív indítóparancsa az offline probe-ban is writer; a probe
nem állít le folyamatot, és a `--offline` operátori állítás továbbra szükséges.

```powershell
bun scripts/society-benchmark.ts --command prepare-expanded --root <world> --offline --plan <plan.json> --selection <selection.json> --output <outside-world>/pin.json
bun scripts/society-benchmark.ts --command capture --root <world> --offline --plan <plan.json> --expanded-pin <pin.json> --kind baseline --output <baseline-bundle>
bun scripts/society-benchmark.ts --command capture --root <world> --offline --plan <plan.json> --expanded-pin <pin.json> --kind result --baseline <baseline-bundle> --output <result-bundle>
bun scripts/society-benchmark.ts --command restore --bundle <result-bundle> --output <new-directory>
bun scripts/society-benchmark.ts --command compare-expanded --baseline <baseline-bundle> --result <result-bundle>
```

Ez nem futtatási engedély, és nem indít új világot. A run/kezelés és annak
költség-/stopfeltételei külön terv tárgyai. A comparison artifact selected archive
evidence-comparabilityt mond: completeWorldCoverage, engineRandomStreamSeeded,
externalResponsesReplayable, bitIdenticalWorldRerun és causalEffectEstablished
nem lesz automatikusan true. Az eddigi controller kezelés/enforcement korlátai
és unsupported összehasonlítási tengelyei nem változtak a pinningtől.

## Elfogadási bizonyíték

[Source-bound eredmény](SI_C06_NATIVE_RESULT.json). Két külön mechanikai út:

- Jelenlegi AgentState/attribute, paused clock, needs, native custody/work,
  Business-binding és treasury sémák, valamint finance megfigyelés külön
  könyvtáras replay-e. WAL-only committed42 sor megmarad. Treasury42 GP result
  exact baseline/pin/plan linkkel; rossz report előtt staging eltakarítva.
- Valódi engine repair inputfogyasztás és WIP200000 ms. A canonical checkpoint
  új archívumgyökérrel elmentve/újranyitva, miközben az eredeti600000 ms-ig
  befejeződik. A másolat még working/200000 ms, result null; intent/material
  digest és player checkpoint megmarad. E natív transport fixture meta-világa
  külön van a pin fixture-től; nem közös autonóm gazdasági runnak állítjuk be.

A valódi controller/Phase12/clock/XP report ugyanabból a readonly állapotból
v2-expanded ágon is újraolvasható másik könyvtárban, forrásból újraszámolva.
13 expanded eset, régi archive/CLI/path/link/secret/corruption kapuk, managed
offline-probe; current root/engine TS. Teljes logindex az eredményben.

Korai fixture pause-argumentum/population-clock/attribute admission és CLI
literal type hibák szűken javítva. Egy hat soros negatív teszt5 s összesített
keretbe futott; a keret emelése helyett külön névvel/idővel futó `test.each`
esetekre bontottuk. Assertions és gazdasági feltételek nem gyengültek.

Full nem futott: a módosítás saját offline archive adapter/coverage, opcionális
staging callback és olvasó/CLI, nem közös DB-tranzakció, clock, gazdasági commit,
auth vagy dependency alap. A célzott kompatibilitási/hiba/restore határok fedettek.
**SI-C06 kész;27/45. Következő SI-C07 új kérésre és külön tényleges futási
jóváhagyással; SI-M3/MVS/önfenntartás most nem PASS.**
