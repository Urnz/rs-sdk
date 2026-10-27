# SI-C07 – Natív lifecycle-kísérletek és terminal elutasítások

2026-10-27, a2. munkacsomag részeredménye. SI-C07 továbbra NO-GO,27/45;
[6 munkacsomag maradt](SI_C07_REMAINING_WORK.md). A17 eredeti követelmény és8
integrity gate/küszöb változatlan. Előzmény: [mortality-pass coverage](SI_C07_MORTALITY_COVERAGE.md).

## A parser, guard és valódi belépés külön bizonyíték

A `PlayerLoading.load` save-parser adminnézetben és session-átadásnál is fut.
Ezért a sikeres parse nem bizonyít világba engedést, és egy elhunyt avatar
ideiglenes parse-olt objektuma önmagában nem respawn. Az új saját1-es
`native_lifecycle_*` napló külön begin/result párként figyeli:

- a save betöltésének parsed/failed eredményét;
- a meglévő login guard passed, restricted/zero-HP block vagy source-unavailable döntését;
- a tényleges World admissiont és a meglévő session reconnectjét;
- a World terminal evictiont;
- a packed player-death script dispatchjét és terminal/sleep/busy elutasítását;
- az interpreter közvetlen terminal abortját is, mindkét érintett actornál.

A World login feltétele ugyanaz a finite/restricted/HP ellenőrzés, ugyanabban
a sorrendben. Ezt megfigyeléssel körülvett helper használja; az eredeti
hálózati elutasítások megmaradnak. A save-dekódolás, interpreter és terminal
tiltás szemantikája nem változott. Nem került be új allow/fallback döntés.

## Prospektív, eredeti forráshoz kötött napló

Az immutable selection a már explicit kijelölt mortality-selection digestjéhez
és7 megfigyelési route-hoz kötött. A journal saját audit/head/fault táblákat
használ. Nincs automatikus telepítés vagy korábbi műveletekből backfill.
Begin az érintett művelet előtt, result a tényleges visszatérés/guard-döntés
után íródik; félbehagyott, hibás vagy elveszett pár nem lesz siker.
World admission/reconnect esetén a receipt közvetlenül a beléptetés/sessioncsere
után, az `onLogin`/`onReconnect` hook előtt készül. Egy későbbi jogos HP-változás
így nem látszik tévesen terminal belépésnek.

A context a sikeres aktuális native mortality tickhez kötött, és readonly
clock-head/member/health/death olvasást végez. Nem lépteti az órát és nem
futtat új mortality- vagy engedélyezési döntést. Hiányzó vagy stale tick/identity
context null marad. Ez különösen az engine-ticken kívüli admin parse esetén
fontos: az ismeretlen megfigyelés nem válik kitalált natív időbélyeggé.

Csak a kijelölt roster nevei naplózhatók. Nincs IP, account-jelszó, chat,
packet-body vagy kivétel-payload. A vitals csak HP/finite/terminal állapot;
a scriptnév a natív packed scriptből jön. Az observerhibák nem módosítják a
gameplay döntését. Írási hibánál a tartós fault counter nő, ha a DB írható;
nem nullázható. Teljes DB-hiba vagy külső tranzakció rollbackje nem adhat
utólag teljességi állítást. A teljes route/source-head coverage még hiányos.

## Offline eredmény és bizonyított sértés

Az új `sources.lifecycleAttempts` az applied original founder/lifecycle/
membership/world/clockhoz és a valódi health/death/binding audit-prefixekhez
köti a megfigyelést. Ellenőrzi a párok identitását és sorrendjét; missing
result, idegen vagy stale authority unproven. A parser eredménye nem admission.
Az üres vagy részleges journalból nincs nulla-kísérlet vagy enforcement PASS.

Egy hiteles natív halál utáni guard-pass/world-admission/reconnect, illetve
igazolt befejezett HP-visszaállító respawn önálló sértésbizonyíték lehet.
Az actual terminal/zero-HP world-admission is felismerhető. Ilyenkor a
`finite-lifecycle-no-respawn` gate scoped FAIL-t és külön
`lifecycleIntegrityViolations` diagnosztikát kap. Ez hibás/teljesítetlen teljes
run frame mellett is megmarad; idegen query-scope nem vehet át ilyen bizonyítékot.
Más forráshiány vagy journal fault nem törli el a már igazolt sértést.

`completeLifecycleEnforcement:false` és partial-attempt-observations marad a
normál eredmény. A pozitív sértés felismerése nem jelenti az egész kapu pozitív
tanúsítását. A source-inventory továbbra16 család/17 requirement/8 gate,
selectedSources=null, qualifiesCoverage=false. Nincs SI-M3/MVS PASS.

## Bevezetés, rollback és ellenőrzés

A saját séma1 baseline előtt, a mortality-selection mellé explicit initelendő;
a közös user_version és a mortality/health/AgentState séma változatlan.
Legacy checkpointból nincs implicit journal. A C06 explicit requiredTables
esetén a selection/audit/head/fault forrást is validálja és izoláltan restore-olja.
Új source/schema/build pin szükséges. Rollback előtt stop és új pin kell:
régi bináris nem írja ezeket a route-okat, ezért nem folytathat igazolt coverage-et.
Evidence-t nem törlünk. Reader-limit100000 sor, nincs csonkolt siker.

Négy actual packed native próba: valós save-parse és CRC/magic failure; változatlan
guard döntés; natív lethal source +packed respawn/interpretált terminal abort,
változatlan HP/pozíció/save; observerhiba és missing context. Root SQLite
próbák: parser/block nem FAIL; kontrollált adapter-fixture-ben a valódi natív
halálforráshoz kötött admission esemény scoped integrity FAIL. Ez nem teljes
World-login futtatás. Frozen readonly reread, foreign scope, fél pár, stale/
foreign authority, shared user_version42, rollback és immutable audit.
A meglévő Mining/save-reload fogyasztói határ és root/engine TS is érintett.
Pontos scope/ID/idő: [átadás](SOCIETY_DEVELOPMENT_HANDOFF.md).

Full regresszió nem szükséges: a meglevő guard feltétele és shared economic/
clock/persistence/auth foundation változatlan, az observer és közvetlen
fogyasztói célzottan ellenőrizhetők. Nincs live install, providerköltség, új
baseline, hosszú run vagy történeti backup-read.

Következő a lifecycle head/fault összekötése a prospektív tick-watermarkokkal,
valamint a terminal guard utáni tényleges World-census/finite állapot tanúsítása.
A teljes8 integrity adapter és concrete source/boundary coverage még kell.
A2. csomag nyitott,6 maradt; a3. baseline és C08 nem indul.
