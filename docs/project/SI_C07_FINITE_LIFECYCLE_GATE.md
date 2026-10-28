# SI-C07/2 P2-05 – Véges életciklus és respawn kizárása

2026-10-28. **P2-05 kész: 4/11 pont kész, 7 nyitott; 4/8 pozitív natív kapuút.**
[Rögzített lezárási lista](SI_C07_PACKAGE2_CLOSURE.md). Következő P2-06.
Ez implementációs eredmény; SI-C07 továbbra NO-GO, 27/45, SI-M3/MVS nem PASS.
Hosszú gazdasági próba nem indult.

## Összekötött natív bizonyíték

`society-metrics/lifecycle-enforcement.ts` a meglévő mortality, attempt, páros
World-census és [world-policy](SI_C07_WORLD_POLICY_GATE.md) olvasókat köti össze.
Nincs új journal, tábla, közös migráció vagy külön feltölthető proof-végpont.
A `sources.lifecycleEnforcement` a backend által kijelölt eredeti founder-
cohortból indul; a halott és offline alapító is a nevezőben marad.

Pozitív eredményhez az alkalmazott genesistől az evaluation zárásáig minden
natív tick és mindkét census stage kell. A természetes/éhezési pass, immutable
finite binding, auditált HP/death prefix, attempt head/fault és tényleges slotok
együtt számítanak. A kísérletek mindkét oldala a lezárt tickhez tartozik;
health-prefixük sem a mortality-passhoz, sem az attempt cursorral rendezett
censushoz képest nem léphet vissza. A death ID és a restricted latch nem lehet
pusztán egy szabadon állított jelző: a natív halál-audithoz kell kötődnie.

Az online avatar auditált `NetworkPlayer.applyDamage` útját a producer külön
jelöli. Alap `Player`, lecserélt damage method és régi, jelző nélküli online
sample nem ad pozitív garanciát. Üres avatarlista csak a hiánytalan, eredeti
rosterű, lezárt ablak és ismert build mellett fogadható el offline állapotként.
Önmagában az üres attempt/death ledger továbbra kevés.

Az original HP-eseménynek a saját tickjén, a natív pass és az end seal között,
megfigyelt auditált avatarhoz vagy natív admissionhöz kell tartoznia. Lethal
damage és natív death összetartozik. A closing health prefix utáni, még a futási
ablakba eső esemény nem tűnhet el. Tick/stage/session/prefix hiány, ismeretlen
authority, guard source failure vagy observer fault unknown marad.

A pozitív ág a reader által ismert, reviewzott lifecycle/HP implementációra
érvényes. A source pin a NetworkPlayer, damage-rollback helper, PlayerOps és
az ismert HP-snapshotot visszaállító natív műveletek fájljait is tartalmazza.
A P2-04 immutable application-input contract, engine/gateway startup és
policy/mutation history változatlanul szükséges. Ez nem ellenséges host vagy
az összes lehetséges dependency attesztációja.

## Konkrét működési javítás

A `STAT_ADD` negatív operandusokkal is hívható. Korábban így a finite avatar
HP-ja közvetlenül csökkenhetett, megkerülve a NetworkPlayer sérülési auditját
és lethal esetben a tartós death latch-et. A finite HP-csökkentés most ugyanazt
az `applyDamage` utat használja, mint a `STAT_SUB` és `STAT_DRAIN`.
Az írási hiba visszaállítja a HP-t és a hitmarkot; a sikeres lethal damage
végleg lezárja az életciklust, a login és a packed respawn blokkolt marad.

## PASS, FAIL és forráslefedettség

A minimum projection az eredeti `finite-lifecycle-no-respawn` kapunak adhat
PASS-t. A `native-health-deaths` és `login-respawn-enforcement` család is teljes
coverage-et kaphat az eredeti teljes időablakban. A coverage nem a működés
sikeressége: a hiánytalanul dokumentált latch-sértés továbbra FAIL.

Hiteles post-guard terminal/zero-HP/non-finite/dupla avatar, halál utáni
admission/respawn és a natív death ellenére hiányzó végleges avatar-latch
scoped FAIL. Másik forrás hiánya/faultja ezt nem törli; idegen scope nem
veheti át. A régi részleges readerek nem kaptak önálló teljes enforcement-jogot.

Az eredeti 1+7 frame négy founderrel, offline pontokkal, kontrollált online
avatarral és natív lethal HP/death eseménnyel pozitív lifecycle kaput ad.
Ugyanebben a fixture-ben a 90%-os túlélési szabály helyesen FAIL: a véges halál
helyes kezelése nem túlélési siker. A pozitív living/survival lower bound
továbbra P2-09, a globális `qualifiesMinimum:false` P2-11-ig megmarad.

## Bevezetés, rollback és ellenőrzés

Az opcionális `healthAudited` vitals mező a meglévő láncolt esemény payloadjában
van. Hiánya olvasható marad, online pozitív garanciát nem kap; nincs backfill,
új user_version vagy adatmódosítás. Az új teljes source inventory miatt
prospektív futás előtt új build/source pin kell. Régi manifesttel a jelenlegi
strict ellenőrzés nem folytatható. Rollbackhez stop és a korábbi, összetartozó
bináris/selection kell; evidence-t nem törlünk és nem írunk át.

Célzott próbák: valódi World-slot census és NetworkPlayer route felismerés,
lecserélt method kizárása; valódi PlayerOps opcode + izolált audit persistence,
HP/hitmark rollback, lethal closure és packed respawn tiltás; readonly SQLite
join, offline reread, teljes 1+7 gate, stale prefix, legacy/missing/fault/tail,
natív FAIL megmaradása és idegen scope kizárása. A teljes World.cycle és hosszú
gazdasági futás nem része ezeknek a fixture-próbáknak.

Az első teljes-frame próba a fixture ismételt teljes láncolvasásai miatt
15 s fölé ért. A builder most csak az aktuális tailt olvassa; a végső readerek
továbbra az egész auditot ellenőrzik. Mért build 11760 → 6377 ms, total
15029 → 8716 ms; az eredeti 15 s limit változatlan. A halál utáni új damage-et
a meglévő writer eleve elutasítja; a teszt ezt ellenőrzi, nem gyárt hozzá
lehetetlen sikeres forrásadatot.

Pontos végső logok, esetdarabszám és idő az [átadásban](SOCIETY_DEVELOPMENT_HANDOFF.md)
és a [progressben](SOCIETY_INTEGRATION_PROGRESS.md). Teljes regresszió helyett
a lifecycle/HP komponens, közvetlen metrics/minimum/preflight fogyasztók és a
módosult source-pin C06 archive/restore határa fut. Shared clock setter,
gazdasági transaction és általános authorization nem változott.
Nincs live install/start, providerhívás vagy történeti backup payload-read.
