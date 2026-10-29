# SI-C07/2 P2-10 – Boundary/access/demand történeti integráció

2026-10-29. [Rögzített lista](SI_C07_PACKAGE2_CLOSURE.md): **9/11 kész,
2 nyitott; 7/8 pozitív natív kapuút**. Következő P2-03 közös natív coverage-audit,
majd P2-11 összesítő. Fő roadmap27/45; C07 NO-GO, SI-M3/MVS nem PASS.

## Teljes történeti scope, külön numeric ablak

Az evaluation facade az ellenőrzött applied baseline és eredeti native
founder/lifecycle binding alapján képezi a genesis→evaluation-end scope-ot.
A `minimum-history.ts` a meglévő readonly readerekből állítja elő a történeti
lefedettséget. A food/tool/housing boundary-projekció az evaluation időpontjait
kapja, a warmup külön megmarad a coverage-ben; nincs új observation-upload API.

- Physiology: minden eredeti actor hunger/fatigue története a genesi admissiontől
  replayel, az eredeti policy/dynamics és teljes natív nutrition/mode cursorral.
  Ismeretlen rész nem satisfied idő; teljesen dokumentált éhezés is lehet FAIL.
- Physical: a food/tool/housing leltár uniójának minden pontjához valid, pontos
  paused clock/profile/cohort/genesis snapshot kell. Genesis, evaluation opening
  és closing kötelező; maximum az eredeti egyórás rés,1000 konfigurált pont.
  Food/tool agent/health/needs snapshot identity is egyezik. Egy másik adapter
  megfigyelési pontja vagy caller-selected extra boundary nem tűnhet el.
- Housing: változatlan versioned authority/epoch és teljes eredeti cohort
  mellett az intervallumoknak a warmupot is hiánytalanul le kell fedniük.
  A paid access, expiry és capacity meglévő szabályai változatlanok.
- Executor: külön eredeti teljes-window olvasás. Az evaluation csak ellenőrzött
  teljes eredeti producer history mellett használhat belső contained-window
  olvasást; az alapértelmezett exporter továbbra exact selectiont követel.
  Actor/world/clock/roster és külső időhatár nem tágítható. Üres, de teljesen
  megfigyelt producer coverage lehet teljes, numeric opportunity ettől még nincs.
- Custody: minden kötelező frozen wealth pont kell az összes player/escrow/
  Business/storage/WIP/treasury helyről. Ehhez a teljes eredeti sealed food/tool
  lineage, admin/fallback és external-value flow történet is kötelező.
  Aktuális készlet vagy snapshotok önmagukban nem adnak flow-coverage PASS-t.

A bridge mind az öt családot beköti az eredeti16-családos leltárba. A teljes
fizikai ütemezés csak valid history-binding mellett complete, és külön marad a
[P2-09 population census](SI_C07_POPULATION_BOUNDS.md) ütemezésétől. A source
coverage numerikus minimumot nem igazol, a hiteles korábbi FAIL megmarad.

## Natív próba és költség

Hipotézis és határ: eredeti1 nap warmup +7 nap evaluation,193 óránkénti paused
SQLite pont, eredeti founder/clock/policy. Setup15 s és reader/assessment30 s
külön wall guarddal. Nincs live run, provider, gazdasági küszöb- vagy sémaváltozás.

A valódi teljes fixture physiology/physical/housing coverage-e pozitív,169
native evaluation boundary-vel. Custody boundary teljes, de a bridge a hiányzó
flow-k miatt nem teszi complete-tá a custody családot. A numerikus minimum FAIL,
a globális `qualifiesMinimum:false` megmarad. Ez nem közös16/16 natív PASS:
az a következő P2-03 audit, az all17+8 összesítő pedig P2-11.

A rövid, három snapshotos natív facade-próba kétszer olvasott stabil forrásokat,
sparse leltárt és rossz clock-idejű snapshotot is ellenőriz. A teljes193-pontos
reader→history→assessment út egyszer validál minden pontot; az összes frozen
fájl és eredeti DB hash-e előtte/utána egyezik. A második azonos193-pontos audit
nem fut újra. A source-coverage contract próba mind az öt pozitív join és az
idegen/warmup/gap/extra-boundary/hiányzó custody-flow elutasítását ellenőrzi.

Konstrukciós optimalizálás csak a fixture-ben: a tényleges needs és checkpoint
producerek owned memory DB-n építenek, majd valódi SQLite fájlt serializálnak;
a clock a natív store marad. Nem tartóssági teszt; a változatlan durability
próbák külön élnek. Clock/needs/checkpoint minden időpontban önálló snapshot;
a változatlan többi forrás egyszer másolt immutable fájl, mutable hardlink nincs.
Éles olvasáskor csak collection-local policy/input és közös food/tool census
újrahasználat van; nincs globális vagy éles DB-state cache. A facade második
stabilitásgyűjtése friss domain-validáció.

## Bizonyíték és megőrzött hibák

- `20261029-173110-159-si-c07-p210-native-final-scope`:2 PASS33,656 s.
  Teljes setup5876 ms, reader/projection24595 ms; a rögzített15+30 s keretben.
- `20261029-173345-063-si-c07-p210-consumers`:75 PASS/1 tesztassertion FAIL,
  25,261 s, tíz pontos fájl. A hiányzó `qualifiesCoverage` mező helyett a tényleges
  unknown integrity coverage-et ellenőrzi a javítás; produktum nem változott.
- `20261029-173545-698-si-c07-p210-source-types`:a teljes11 source-coverage
  eset és root TypeScript PASS19,749 s. A sikeres többi consumer nem ismétlődött.
- `20261029-173714-259-si-c07-p210-final-native-consumers`:19 PASS54,785 s;
  hét natív boundary/history/evaluation,11 native-outcome és egy benchmark restore.
  A tíz consumer fájllal együtt **95 külön célzott eset PASS**.
- `20261029-174209-822-si-c07-p210-health-binding-final`:22 érintett eset és
  végső root TS PASS19,786 s. A frozen health death-setet az eredeti current
  native authority pontig igazolt haláleseteihez is kötjük; régi fájl nem rejthet
  el korábbi halált. Az eredeti halott/offline founder nem kerül ki a nevezőből.
- `20261029-174420-205-si-c07-p210-health-native-closed`:három érintett natív
  eset PASS36,694 s; teljes setup4878/body25582 ms. Nem három új eset.
- `20261029-174605-675-si-c07-p210-preflight`:PASS1,147 s; várt NO-GO exit2,
  aktuális forráshashek/digest és29 dokumentum linkjei.
- Korai `171851-296`:29 PASS/2 FAIL1,237 s; opcionális dependency hiányát és
  az exact-window alapértelmezés megőrzését javítottuk. Mindkettő a consumer körben PASS.
- `172138-573`:193-pontos első fixture FAIL53,693 s, régi közös checkpointból
  hiányzott a pontonkénti closed-tick marker. A hárompontos diagnosztika ezt
  pontosította (`172327-016` FAIL1,774 s), a javított szűk próba PASS2,576 s
  (`172434-555`). Nincs vak timeout-emelés.
- `172530-496`:1 PASS/1 setup FAIL30,889 s; setup20210 ms volt. A konstrukció
  fsync-költségét csökkentettük. `172746-012`:szűk konstruktor-diagnosztika FAIL
  0,926 s, a clock store tényleges path-aláírása javítva. `172821-731`:1 PASS/
  1 body timeout50,268 s, setup5835 ms, a két teljes audit együtt42309 ms.
  Újabb drága próbák előtt scope-korrekció: rövid facade + egyszeri teljes mátrix.
  Az összes termékassertion megmaradt, egyik időkeret sem emelkedett.

Végső natív consumer/preflight/formázási index az
[átadásban](SOCIETY_DEVELOPMENT_HANDOFF.md). Full regresszió nem indokolt:
readonly mérési adapterek, evaluator és közvetlen export/restore határok;
shared persistence/clock/economic/auth/runtime-dependency alap nem változott.
Nincs új journal/tábla/producer, live install/start, baseline vagy providerkérés.
Canonical minimum SHA596720f42dd059b713ce0d075b08b9655d25413fdf7b31a8db1a86f3afa6754a változatlan.
