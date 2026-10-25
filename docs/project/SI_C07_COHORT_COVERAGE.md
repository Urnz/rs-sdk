# SI-C07 – Prospektív founder-cohort megfigyelés

2026-10-25. Komponenslépés a [gather admission](SI_C07_GATHER_ADMISSION.md)
után; SI-C07 nyitott,27/45, preflight NO-GO. Nem hosszú gazdasági próba.

## Mit rögzít

- Az `item-lifecycle/native-mining-coverage.ts` saját, additív SQLite-sémája
  explicit, baseline előtti kiválasztást tárol: selectionId, teljes roster
  actor/username/lifecycle/world/clock azonosságokkal, sim-időablak, megengedett
  megfigyelési hézagok és az attempt/standing-intent nyitó source-headjei.
  A kiválasztás és a hash-láncolt események immutable-ek. A shared user_version
  és a szerszám/gazdasági tranzakciók változatlanok.
- Az engine tick-hook üres pending queue esetén is végigveszi a kiválasztott
  cohortot. Minden frame tartalmazza az aktuális authoritative roster digestet,
  a két source-prefix headet, session/tick/clockot és minden founder állapotát.
  Offline/restricted/hiányzó identity vagy aktív invocation külön gap.
- A natív Mining belépés az identity/tool korai kilépések **előtt** naplózódik.
  Régi/raw `interact-loc`, szerszámkötés nélküli út, hiányzó identity,
  unsupported natív forrás és admission előtti régi akció nem tűnik el.
  Az új csatorna sem Miningot, sem javítást, sem új eszközt nem indít.
- A korábbi `compatible-request` csak aktuális igénnyel egyező natív belépés,
  nem executor eredet; most külön provenance-gap. A későbbi
  [exact natív dispatch](SI_C07_NATIVE_DISPATCH.md) `source-bound-request`
  bejegyzése konkrét immutable admissionhöz/ScriptState-hez kötődik. A selected
  cohort raw/unbound Mining belépése már naplózott elutasítás, ore/wear nélkül.
  Teljes high-level demand nevező továbbra nincs, ezért nincs minimum PASS.
- Ingress-írási hiba után a következő sikeres frame külön gapet őriz. Ha ez sem
  készül el, a hiányzó tick/session/clock vagy ablakvég látszik az olvasónál.

## Olvasás és archívum

`society-metrics/tool-demand-coverage.ts` read-only ellenőrzi a teljes auditot,
a kiválasztás pontos egyezését az export actor/world/clock/window scope-jával,
valamint minden megadott source-head valódi prefixét a teljes attempt/intent
láncon. Actorlista vagy időablak utólagos szűkítésével nem lehet eltüntetni
egy founder hiányát. Egy függő igény nem hagyható ki a frame-ből.

A megszakadt session, kihagyott engine tick, túl nagy wall/sim gap, változó
roster, offline/hiányzó identity/source és megfigyeletlen ablakkezdet/-vég
nem interpolálható. A natív attempthez hiányzó ingress külön rés. Az observer
teljes ablakának megfigyelése önálló tulajdonság; az üres sor vagy nulla
megfigyelt kérés továbbra sem nulla demand és nem minimum-PASS.

Az outcome `toolDemand.cohortCoverage` önálló részcsatorna. Sérülése redaktált
`invalid` eredmény; egy másik, érvényes intent-naplóval bizonyított >1 óra
minimumsértés továbbra FAIL marad. A közvetlen coverage olvasó és a C06
selected-source ellenőrzése sérült audit/prefix/kiválasztás esetén elutasít.

A C06 az explicit required source-listába felvett coverage selectiont és a
hozzá tartozó audit/prefixeket baseline/result/restore alatt újraolvassa.
Az archívum saját schema/state hash-e az új táblák bytejait is köti. Ez nem
teszi teljessé a történeti C06 csomagokat és nem változtat régi backupokon.

## Bevezetés, rollback, korlát

Az inicializálás backend-owned `new NativeMiningCoverageStore(db,selection)`
művelet, a már inicializált attempt/intent forrás pontos nyitó headjeivel,
**baseline előtt**. Nincs avatartól fogadott konfiguráció, HTTP-admin út vagy
automatikus live install. Kiválasztás hiányában a collector inaktív, az export
`source-absent`; régi naplókból nincs visszatöltés.

DDL/selection/head egy tranzakcióban jön létre, idempotens újranyitással.
Hibás/ütköző kiválasztás rollback; nincs más komponens adatátalakítása.
Rollbackhez a korábbi kód használható az additív táblák megtartásával; az ilyen
folytatás nem szolgáltat új coverage-et. Új kiválasztás új, explicit workspace/
baseline-t igényel, a régi evidence nem törölhető vagy írható át.

Readerlimit100000 sor; a teljes outcome DB limit256 MiB. Konkrét C07 runhoz
még sor-/byte- és megfigyelési teljesítménybudget kell. Az olvasó a kiválasztott
hézagkeretet jelenti; a minimum bridge-nek ezt az eredeti policyhoz is kötnie
kell. A komponens nem választ világot vagy clock-ratiót és nem ad futási jogot.

**Következő:** az exact natív dispatch elkészült; a
[2. rögzített munkacsomag](SI_C07_REMAINING_WORK.md) a teljes high-level
igénylefedettség és17 requirement/8 integrity gate assessment,
founder tool/food/housing baseline, ratio-validálás, SI-A14 és külön jóváhagyható
hosszú terv. Nincs C08-továbblépés vagy M3/MVS PASS.

## Ellenőrzési kör

Saját upgrade/reopen/rollback/immutability, négy-founder üresqueue/hiányosframe,
identity/offline/restart/clock/roster/prefix negatív esetek; valódi packed Mining
raw/unbound/identity belépés; meglévő source-backed admission közös út; outcome
FAIL-megőrzés; selected-source capture/restore és preparer. Root és engine
TypeScript érintett; a webclient nem változott. A konkrét futási azonosítók és
idők a [rövid átadásban](SOCIETY_DEVELOPMENT_HANDOFF.md) és progressben vannak.
