# SI-C07 – Forráscsalád-jegyzék és prospektív mortality-pass megfigyelés

**Ugyanaznapi folytatás:** a [natív lifecycle-attempt journal](SI_C07_LIFECYCLE_ATTEMPTS.md)
már külön figyeli a parsert, login guardot, World admission/reconnect/evictiont
és terminal respawn-script abortot. Ebből scoped sértés felismerhető; teljes
route/watermark/World-census coverage továbbra kell a pozitív enforcement kapuhoz.

2026-10-27, a2. munkacsomag részeredménye. SI-C07 továbbra NO-GO,27/45;
[6 munkacsomag maradt](SI_C07_REMAINING_WORK.md). Az eredeti17 requirement,
8 integrity gate és minden idő-/értékküszöb változatlan.

## Kötelező forráscsaládok és időbeli kötelezettségek

A `society-minimum/source-inventory.ts`16 explicit forráscsaládot rendel az
eredeti17 requirementhez és8 integrity gate-hez. Megkülönbözteti az applied
nyitást, warmup+evaluation történetet, minden native tick és minden native
boundary bizonyítékát. Tartalmazza a natív halál/finite binding/mortality-pass,
clock/policy, physiology, food, housing, tool/material/demand, custody és
admin/external-value forrásokat, valamint a még hiányzó login/load/respawn
enforcement historyt. Minden requirement és gate kap forráshivatkozást.

Ez forráscsalád-jegyzék, még nem az összes producer és konkrét kiválasztott fájl
lezárt leltára. A felsorolt táblák és meglevő readerek önmagukban nem teljességi
bizonyítékok. A preflight és minimum-report `requiredSourceInventory` mezője
`selectedSources:null`, `qualifiesCoverage:false`, inconclusive eredménnyel.
Nincs automatikus coverage PASS vagy implicit forrásútvonal-választás.

## Sikeres natív mortality-pass tanúsítása

A health-heartbeat nem mutatja meg, hogy az offline tagok ellenőrzése minden
tickben lefutott-e. Az új `population-lifecycle/native-coverage.ts` saját1-es
selection/event/head sémát használ, explicit baseline előtti kijelöléssel.
A teljes original roster/lifecycle/membership, world/clock, age/mortality és
opcionális survival-selection, illetve nyitó health-prefix kötött.

A meglévő `tickPopulationDeaths` sikeres teljes passza után válik elérhetővé
egy kizárólag az aktuális engine tickhez tartozó witness. A World ehhez kapcsolja
az új observer hívást, a szokásos terminal guard előtt. Sikertelen vagy régebbi
tickből nincs új witness. Az ellenőrzés minden population membert érint,
függetlenül attól, hogy van-e online avatarja. Az observer nem hajt végre
új mortality-döntést, nem éleszt fel és nem változtatja meg a guardokat.

A journal a completed pass óráját, sessionjét, policy- és roster-digestjét,
natív health/death/binding headjeit és actoronként a natív terminal-eventet
rögzíti. Hiányzó ismert születés, nem finite vagy nem igazolható állapot
unavailable. Az observer írási hibája külön megmarad a következő sample-ben;
a kimaradt tick is rés. A megfigyelési hiba nem változtatja a gameplay latch-et.

Starvation ellenőrzést csak kijelölt survival-profile mellett tanúsít. Legacy,
survival-selection nélküli világban a configured natural mortality passza
figyelhető meg; ebből nem lesz eredeti day-survival vagy SI-M3 PASS.

## Offline olvasás és pontos korlát

A readonly outcome új `sources.mortalityCoverage` csatornája az applied eredeti
founder-bindingshez, immutable membershiphez, policykhez és a valódi native
health audit-prefixekhez köti a journal teljes láncát. A teljes vizsgált
időszak a genesis óta tart, így a warmup sem marad ki. A reader sem offline
időt, sem sessionváltást, clock/tick rést vagy hibás köztes frame-et nem hidal át.
Hiányzó kezdő/záró megfigyelés nem teljesség; idegen roster, eltérő prefix,
változó binding vagy policy szintén rés. A később beírt, már korábban esedékes
natural/starvation halál nem rejtheti el a korábbi passz elmulasztott hatását.

A `completeMortalityTickCoverage:true` csak a configured natív passzok
teljességét jelenti az adott ablakban. A `completeLifecycleEnforcement` még
false: ebből nem következik folyamatos HP-megfigyelés, minden login/load/respawn
kísérlet lefedettsége, survival/living-founder alsó bound vagy integrity PASS.
A minimum mind a8 integrity gate-je továbbra inconclusive. Egy korábbi,
hiteles natív founder-halál FAIL-jét a sérült új forrás sem törli el.

## Bevezetés és rollback

Nincs health/AgentState séma- vagy közös user_version-változás. A health store
új metódusa readonly audit-head olvasás. Saját schema1 és immutable selection
csak explicit előkészítéssel jön létre, nincs legacy backfill vagy automatikus
live install. A Health authority v2-je szükséges. A journal külön checkpoint-
tranzakciója nem teheti meg nem történtté a már committed natív halált; írási
hiba coverage gap marad.100000 sor fölött nincs csonkolt siker.

C06-ban az explicit requiredTables mortality selection/event/head ellenőrzése
és izolált visszaállítása is bekötött. Baseline előtt új source/schema/build
pin szükséges. Rollback előtt stop és új pin kell: a régi bináris nem ír
passz-történetet, ezért nem folytatható vele a tanúsított ablak. Evidence-t nem
törlünk és nem töltünk vissza kitalált frame-ekkel. Live install/run nem történt.

## Ellenőrzés és következő kódhatár

Valódi SQLite/AgentState/clock/health authority és meglévő native mortality
függvények közös próbája: négy offline founder, completed tickek, változatlan
byteokkal readonly frozen reread. Kihagyott tick/session/roster/írás/birth,
foreign original binding, immutable history/tail, rollback és shared
user_version42 negatív ágak. A valódi esedékes offline természetes halál külön
terminal-frame-et és native event/headet ad; a login/respawn gate ettől nem PASS.

A célzott death-tesztekben előkerült egy régi v22 fixturehiba is: a v26–v29
táblákat a teszt bent hagyta a visszaverziózott adatbázisban. Csak a disposable
fixture lett a tényleges v22 alakra javítva, a migrációs termékkód változatlan.
Pontos check-ID-k/idők: [átadás](SOCIETY_DEVELOPMENT_HANDOFF.md).

Következő a natív login/load/respawn kísérletek és terminal elutasítások
prospektív naplózása. A teljes concrete source universe/boundary/access history,
8 integrity adapter,3. founder baseline, ratio és későbbi approved run még kell.
C08 nem indul. Full regresszió nem indokolt saját observer/journal és közvetlen
fogyasztók módosításakor; közös economic/clock/auth foundation nem változott.
