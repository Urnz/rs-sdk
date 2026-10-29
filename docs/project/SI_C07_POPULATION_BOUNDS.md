# SI-C07/2 P2-09 – Pozitív living/survival korlátok

2026-10-29. A [rögzített lezárási lista](SI_C07_PACKAGE2_CLOSURE.md) P2-09 pontja.
**8/11 kész, 3 nyitott; 7/8 pozitív natív kapuút.** Következő P2-10, majd
P2-03 végellenőrzés és P2-11. A fő roadmap 27/45; C07 NO-GO, SI-M3/MVS nem PASS.

## Bizonyítás és kötés

A terminális halálesetek eddig csak felső korlátot adtak a living/survival
szabályhoz. Az új readonly `society-metrics/population-bounds.ts` a már meglévő
[P2-05 finite lifecycle/health bizonyítást](SI_C07_FINITE_LIFECYCLE_GATE.md)
fogyasztja. Teljes, PASS eredetileg véges cohort esetén a záráskor élő eredeti
alapítók minden korábbi értékelési időpontban is éltek: nincs respawn vagy
replacement. Számuk ezért konzervatív alsó korlát a teljes evaluation alatt.

A zárási túlélési arány pontos tört: `survivors × 10000 / originalFounders`.
Nincs kerekítés, halott/offline alapító elhagyása vagy új aktuális névsor.
A teljes történeti bizonyítás nélkül az üres death ledger továbbra unknown.
Az alsó korlát nem állítja, hogy a korábban élő, később meghalt alapító már
korábban is halott volt; csak a biztosan mindvégig élő tagokat számolja.

Kötelező a teljes eredeti roster/genesis/world/clock/scope, a verified deaths
health-snapshot azonossága, a parent enforcement digest és a parenttel egyező
SQLite checkpoint SHA. A záró census actor/lifecycle/membership és terminal
latch/deathEventId is egyezik. Hiány, FAIL parent, rossz vagy megváltozott
snapshot, eltérő nevező és idegen scope nem ad pozitív korlátot.

## Népességi és fizikai határpontok

A `MinimumFrame.populationBoundaries` kizárólag a living szabály ütemezése.
Natív end-of-tick pontok, exact nyitás/zárás, legfeljebb az eredeti egyórás rés,
maximum 10000 pont és a teljes scoped cell budget érvényes. A megadott fizikai
boundary időpontok is bekerülnek ebbe a népességi unióba; a bizonyított alsó
korlát ott is érvényes. Régi frame-eknél a meglévő boundary fallback megmarad.

A census tickpontjai nem kerülnek át a fizikai food/reserve snapshot-leltárba.
Így nem kell miattuk minden tickre drága teljes fizikai mentést készíteni,
és a population coverage nem teljesíti más család hiányzó bizonyítékát.
A source-coverage scope binding nem változott; a fizikai boundary proof továbbra
a saját inventoryját ellenőrzi. A hiányzó fizikai/access/demand család P2-10.

## Ellenőrzés

- Pure calculation/sourceCoverage: 18 PASS, 1,169 s
  (`20261029-170157-377-si-c07-p209-calculation`). Külön népességi ütemezés,
  fizikai unknown, sparse/duplicate/idegen endpoint/budget/evidence elutasítás.
- Natív olvasók: 22 PASS, 47,694 s
  (`20261029-170208-264-si-c07-p209-population-native`). Teljes eredeti 1+7,
  mind a négy alapító offline, 169 population boundary, living/survival PASS.
  Befagyasztott readonly SQLite újraolvasás azonos, byte-módosítás nélkül.
  Valódi online HP-halál mellett lower 3, survival `30000/4`, eredeti FAIL.
  Warmup/zárás/jövőbeli halál, eredeti nevező és meglévő scoped FAIL megmarad.
- Közvetlen fogyasztók és a bővített fault-ág: 48 PASS, 25,421 s
  (`20261029-170334-647-si-c07-p209-consumers`). Ebből egy korábbi eset ismétlése
  indokolt új fault assertionnel; összesen ezzel 87 külön célzott eset.
  Minimum projection, native-outcomes, sourceCoverage, food, contract/preflight;
  hiányos health/census, stale checkpoint és idegen/nevező binding unknown.
- A teljes 1+7 population-fixture külön mért setup 3849 ms / 5000 ms keret,
  export/assessment/frozen 3232 ms / 10000 ms; teljes mért út 7002 ms.
  Eredeti összesített 15 s helyi keret, nincs vak limitnövelés.
- Végső projection és offline benchmark restore: 3 PASS, 16,284 s
  (`20261029-170526-802-si-c07-p209-final-boundaries`). Két érintett ismétlés
  a típusnarrowing javítása után, egy közvetlen benchmark-fogyasztó;
  **összesen 88 külön célzott eset PASS**, nem teljes regresszió.
- Kezdeti root TS FAIL, 58,406 s (`20261029-170407-578-si-c07-p209-types`):
  Source-unió `digest` hozzáféréséhez explicit available-szűkítés kellett.
  Javítva; végső root TS PASS48,739 s
  (`20261029-170634-966-si-c07-p209-types-final`). Nincs dependency/type suppression.

Preflight `20261029-170734-270-si-c07-p209-preflight`:PASS1,125 s, várt NO-GO
exit2, aktuális forráshashek/digest és28 dokumentum linkjei. Formázás az átadásban.
Új producer, journal, tábla, séma vagy közös tranzakciós alap nem változott;
teljes regresszió helyett az érintett readerek és közvetlen fogyasztók futottak.
Nincs live install/start, baseline vagy providerkérés. A canonical minimum
policy változatlan; a natív összesítő `qualifiesMinimum:false` maradt.
