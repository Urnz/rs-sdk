# SI-C07/2 P2-06 – Genesis utáni admin/fallback értékmozgások

2026-10-28. **P2-06 kész: 5/11 lezárási pont, 6 nyitott;
5/8 pozitív natív kapuút.** [Rögzített lista](SI_C07_PACKAGE2_CLOSURE.md).
Következő P2-07, külső shop/import érték. SI-C07 továbbra NO-GO, 27/45;
hosszú C07 gazdasági próba és SI-M3/MVS PASS nincs.

## Meglévő napló, teljes natív időablak

`society-metrics/administrative-value.ts` a meglévő SocietyIntegrity auditot
köti az eredeti applied genesishez és a páros natív policy tickpontokhoz.
Az engine minden pontban az integrity headet, run/clock/genesis kötést és a
mutable resolution/permit állapot digestjét rögzíti. Ez opcionális mező a
meglévő policy payloadban; nincs új journal, tábla vagy user_version.
`SocietyIntegrityStore.coverageSnapshot` kizárólag readonly snapshotot készít;
az eddigi before/commit/compensation gazdasági szemantika változatlan.

A pozitív kapuhoz a teljes genesis→warmup→evaluation ablak kell. Minden cursor
az eredeti runra és hiteles prefixre mutat, monoton, és natív mortality-pass
pozícióhoz kötött. A záró állapotnak a tényleges frozen integrity head/run/
event-status/permit állapotával is egyeznie kell. A puszta clean-run flag vagy
üres audit nem PASS. Legacy gap, pending, hibás/idegen/hiányzó cursor,
kihagyott stage, zárás utáni tail és bizonyítatlan no-effect unknown marad.

A [P2-04 immutable runtime](SI_C07_WORLD_POLICY_GATE.md) mellett az ismert nyolc
admin/fallback producer natív dispatch-, wrapper- és payment-coordinator
forrásai is reviewzott source pin részei. A tényleges producer csak akkor
ad natív cursort, ha a wrapper által támogatott engine cwd/module rootból
fut; a wrapper meglévő cwd-bypassára nem épülhet pozitív garancia.
Ez az alkalmazás rögzített útvonalainak szerződése, nem ellenséges host vagy
az összes dependency attesztációja. A külső shop/import teljes univerzuma P2-07.

## Működési hiány javítása és belső kifizetés

A privileged `setvar`, `setvarbit`, `setvarother`, `npcadd` és `locadd`
érték-/erőforrásmódosítása eddig kimaradt a naplóból. Most a már meglévő
`engine.debugproc` határon mennek át; új source-kategória nem keletkezett.
A callback egyszer fut, az eredeti jogosultsági döntés változatlan.
Az olvasó parancs továbbra nem értékbevitel. A privileged script/config-
assistance meglévő szabálya konzervatívan jelöl; nem feltételez számszerű nullát.

A nyolc producer hitelesen lezárt runtime-injectionje scoped FAIL lehet,
beleértve a warmupot és a bootstrap után azonos simulation timestampen írt
értéket. A resolutionnek már natív zárópont előtt meg kell lennie; későbbi wall
eredményből nincs visszamenőleges sértésbizonyíték. Igazolt cheat grant 0 natív
eredménye no-effect lehet, más producer puszta no-effect címkéje nem elég.
Más policy-forrás hiánya a már lezárt natív sértést nem törli; idegen scope
nem veheti át. Az érvénytelen integrity auditból nincs új bizonyíték.

A meglévő internal-payment permit önmagában nem adminérték-mentesség.
Szükséges az azonos mutation/backing lezárása és consumed permit, a natív
treasury committed reservationje, valamint a canonical checkpoint committed
rewardja: pontos settlement/reservation/payer/player/amount és coin-delta.
Hiányzó fedezet vagy függő debit/credit unknown, nem új pénz és nem PASS.
A treasury forrást a backend választja; query vagy modell nem tölthet fel proofot.

## Bekötés, restore és korlátok

`sources.administrativeValue` a minimum eredeti
`no-post-genesis-admin-or-fallback-value` kapuját és az
`administrative-value-history` sourceCoverage családot táplálja.
A global `qualifiesMinimum:false` megmaradt; P2-03 és P2-07–P2-11 nyitott.
A pozitív 1+7 SQLite fixture implementációs bizonyíték, nem gazdasági run.

C06 a cursorhoz kötelezővé teszi a kijelölt integrity forrást és ellenőrzi a
run/clock/prefix kötést. Capture/restore után a readonly cursor azonos;
kihagyott audit és érvénytelen prefix nem archiválható igazolt forrásként.
Részleges/függő futási eredmény továbbra megőrizhető, nem lesz tőle minimum PASS.

Bevezetéshez új build/source pin szükséges; nincs történeti backfill vagy
adatátírás. Régi, cursor nélküli sample olvasható, ehhez a kapuhoz unknown.
Rollback előtt stop és az összetartozó korábbi bináris/source selection kell;
régi binárissal nem folytatható új garanciával tanúsított ablak.

Célzott ellenőrzés: readonly audit/state seal és meglévő integrity/replay/
compensation esetek; valódi ClientCheat változó/spawn és PlayerLoading fallback,
független clock/policy bizonyíték hibás value audit mellett; eredeti 1+7 PASS,
nyolc producer FAIL, gap/legacy/tail/no-effect/future-wall, native payment és
frozen reread; sourceCoverage/minimum/preflight és C06 restore.
Nem teljes World.cycle vagy hosszú live gazdasági próba.

Az első típuspróba a Bun `.deferred()` void típusát jelezte; explicit readonly
snapshot-visszaadás javítva. Két fixture-hiba is javult: legacy gap csak bootstrap
alatt hozható létre, a worldBuild azonosító kisbetűs. Minimum- és futási limit
nem változott. Az új source inventory mellett a régi C06 manifest round-trip
mért fázisösszege 5106 ms + cleanup, ezért az egyetlen eset 5 s helyett a
szomszédos archive-próbák 10 s helyi keretét használja; phase logok és
assertionök megmaradtak. A 15 s teljes-frame limit változatlan.
A Bun tesztfájlokat explicit `./` útvonallal kell kijelölni: a bare path
szövegszűrőként régi backup tesztmásolatokat is bevont. Az így keletkezett
darabszámok nem a végső scope bizonyítékai. A pontos aktív fájlokon újramért
95 külön eset PASS. Pontos logok/idők az [átadásban](SOCIETY_DEVELOPMENT_HANDOFF.md)
és a [progressben](SOCIETY_INTEGRATION_PROGRESS.md).
Teljes regresszió helyett az érintett komponensek/közvetlen fogyasztók futottak;
shared clock, economic commit, általános auth és runtime dependency nem változott.
Nincs live install/start vagy providerhívás. A scope-hiba auditjához csak régi
fixture-forrást olvastunk; az saját temp adatbázisokat készít. Történeti DB-
payloadot az audit során nem nyitottunk meg; a régi tesztkör eredményeit kizártuk.
