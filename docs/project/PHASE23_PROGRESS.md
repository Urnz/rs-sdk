# 23. fázis – eredmények

Az aktuális feladatsorrend és státusz egyetlen forrása a [TASKS.md](TASKS.md).
Ez a fájl a lezárt részfeladatok megvalósítási és ellenőrzési bizonyítékát őrzi;
a későbbi 24+ követelményeket nem emeli vissza a lezárt részfeladatok határába.

## 23.1 – véges PopulationMember-kötés kész (2026-10-13)

A `mature-society` és `historical-burn-in` profil pontos verzió- és digest-kötéssel
a terminális, respawnt tiltó `finite-population` policyhoz tartozik. A klasszikus
respawn külön `compatibility-experiment` policy marad, nincs world-profile-hoz
kötve, és nem hozhat létre `PopulationMember` rekordot.

A társadalomszimulációs genesis kimenete explicit, egyedi és profilhatáron belüli
taglistát köt a már létező player-agent identitáshoz, control profile-hoz,
avatarhoz, aktív karakter-életciklushoz és a közös SimulationClockhoz. A preview
eltérésnél zár, az apply pontos profile/policy/clock/result hivatkozással ír,
az exact replay idempotens, az eltérő kötés elutasított. A gateway a valódi
AgentState adatbázist és közös órát adja az adapternek. Resetkor a tagság nem
tűnik el: auditálható `reset` állapotba kerül, az identitás és a karakter-
életciklus megmarad.

Az AgentState v22 migráció additív és nem talál ki történeti tagságot. A v2
rollback-token felveszi a population tagokat, miközben a korábbi v1 asset-only
tokenek továbbra is visszaállíthatók. Részletes működés és rollback:
[Phase 23.1 finite population membership](features/phase23-1-population-lifecycle.md).

Ellenőrzés: fókuszált policy/store/adapter csomag **10 pass / 0 fail**
(`.local/verification/20261013-191655-380-phase23-1-final-focused.log`); format és
root/engine/webclient TypeScript PASS
(`.local/verification/20261013-190604-220-phase23-1-quality.log`). A teljes
tesztlefedettség **1453 pass / 0 assertion fail / 0 skip**: az elsődleges 209
fájlos készletből 1095 egyetlen soros futásban, az egy izolációs inicializálási
hiba célzott újrafuttatása 1/1, a további module/acceptance csomag pedig 357/357
zöld (`.local/verification/20261013-191431-644-phase23-1-primary-serial.log`,
`.local/verification/20261013-191612-276-phase23-1-primary-last-recheck.log`,
`.local/verification/20261013-191339-880-phase23-1-full-remainder.log`).

A párhuzamos `bun run check` két futása minden termékassertiont teljesített, de
Windows alatt egymástól eltérő régi tesztek temp-SQLite teardownja `EBUSY`
hibát kapott. Az érintett fájlok célzott soros ellenőrzése 16/16, illetve a
korábbi cache-függő csoporté 30/30 zöld
(`.local/verification/20261013-191323-942-phase23-1-ebusy-recheck.log`,
`.local/verification/20261013-191040-343-phase23-1-full-failure-recheck.log`).
Ez külön tesztinfrastruktúra-follow-up, nem 23.1 termékblokkoló; a sikertelen
wrapper-futások nem lettek PASS-ra átértelmezve.

## 23.2 – születési időből számolt életkor és konfigurálható szakaszok kész (2026-10-13)

A `PopulationMember` életkorát a változtathatatlan karakter-születési idő és a
pontos id/profile-digest szerint kötött közös SimulationClock adja. A tárolt
életkor-megfigyelés nem írja felül a hiteles születési időt. Hiányzó születési
adatnál az eredmény explicit `unknown`, szakasz és módosítók nélkül; a belépés
vagy karakter-létrehozás nem válik utólag születési bizonyítékká.

A külön verziózott `population-age-policy.json` változatlan 23.1 policy-
digesthez kötődik. Konfigurálható a szimulációs évhossz, az életkori szakaszok
és határaik, valamint a regenerációs, munkaterhelési és kockázati basis-point
módosítók. A határok alsó oldala inkluzív, a végső szakasz korlátlan; nincs fix
halálozási életkor. A kimenet pontos age-policy referenciát ad a későbbi
domainfogyasztóknak. Most még nem változtatja meg a játék mechanikáit.

Gyorsított óra gyorsítja, szüneteltetett óra megállítja az öregedést. Restart
után ugyanazokból a tartós forrásokból származik az életkor. Reset tagságnál a
történeti kimenet a reset idején rögzül és aktív módosítókat nem ad. Elhunyt
karakter meglévő státuszánál az életkor a státuszváltás idején megáll; új
halálesemény vagy halálátmenet ebben a részfeladatban nem készült.

Az admin agents/autonomy route a valódi AgentState-pathot és közös órát adja
az adatforrásnak; a `populationAge` domainkimenet a lifecycle mellett jelenik
meg. AgentState továbbra is v22: nincs új tartós modell, migráció vagy
történeti birth-backfill. Működés és rollback:
[Phase 23.2 population aging](features/phase23-2-population-aging.md).
A 23.3+ scope változatlan; `.canvas.tsx` nem készült.

Ellenőrzés: fókuszált policy/age/store/genesis csomag **45 pass / 0 fail**
(`.local/verification/20261013-193016-093-phase23-2-focused.log`), format és
root/engine/webclient typecheck PASS
(`.local/verification/20261013-193235-886-phase23-2-quality.log`). A teljes
tesztkészlet **1468 tesztjének lefedettsége ellenőrzött, 0 assertion fail és
0 skip**: a fő csomag 1102 pass / 1 teardown fail eredményéből az egyetlen
érintett régi fájl elkülönítve **4/4 PASS**, a további modulcsomag **365/365 PASS**
(`.local/verification/20261013-193314-432-full.log`,
`.local/verification/20261013-193554-259-phase23-2-ebusy-recheck.log`,
`.local/verification/20261013-193601-814-phase23-2-full-remainder.log`).

Az egyszer lefuttatott `bun run verify:full` sikertelen exitet adott: a régi
`server/gateway/admin/crime-knowledge.test.ts` afterEach tempkönyvtár-törlése
Windows alatt `EBUSY` hibát kapott. A termékassertion teljesült, az elkülönített
újrafuttatás zöld; ez a korábban jelzett tesztinfrastruktúra-follow-up marad.
A wrapper eredménye továbbra is FAIL, nem lett átértelmezve.
Két korábbi sandboxos quality-próba Bun `CouldntReadCurrentDirectory` hibával
leállt; a korlátozás nélkül futtatott quality ellenőrzés és a full futás
quality lépései egyaránt zöldek voltak.

## 23.3 – seedelt, korlátozott egyéni természetes halálozás kész (2026-10-13)

A külön verziózott `population-mortality-policy.json` pontos age-policy
referenciához kötődik. A genesis eredmény-digest, agent-id, lifecycle-kezdőidő
és mortality-policy digest alapján minden tag külön referencia-élettartamot
és korlátozott halálozási hajlamot kap. A genesis digest tartalmazza a seed
hatását, de az audit falióraidejét nem; restart, exact replay, enumerációs
sorrend és lekérdezési gyakoriság nem változtatja meg a sorsolt értékeket.

A `sha256-annual-hazard-v1` algoritmus explicit természetes korhatárok között,
korlátozott éves próbákból választ egyéni életkort és seedelt éven belüli
időpontot. A hajlam és referencia-élettartam módosítja az éves kockázatot;
az utolsó éves intervallum garantálja a felső korlátot, de ott is egyéni
időpontot választ. Alapkonfiguráció: 60–100 év referencia-élettartam,
7500–12500 bp hajlam és [40,120) év természetes élettartam. Nincs közös fix
halálozási életkor, és egy kihagyott lekérdezés nem hagy ki mortalitási próbát.

Az `AgentStateStore.getPopulationMortality` és a determinisztikus domain-
projektor stabil jelöltazonosítót, pontos szimulációs időpontot, esedékességet,
egyéni értékeket és policy-referenciákat ad. Túlkorosan importált tag
legkorábban belépéskor kap esedékes jelöltet, nem belépés előtti haláleseményt.
Ismeretlen születési időhöz nem készül életkor vagy halálozási jelölt; resetelt
és elhunyt karakter történeti hajlama megmarad, aktív jelöltje nincs.
Pontos órakötés vagy policy-eltérés esetén a művelet fail-closed.

Az admin backend a valódi AgentState-adatbázisból és a közös órából olvassa
a `populationMortality` kimenetet. A jelölt önmagában nem halálbizonyíték:
nincs lifecycle-státuszváltás, avatar-lezárás, health domain vagy estate írás.
A 23.4+ határa változatlan. AgentState schema v22 maradt; nincs új tartós
modell, birth/death-backfill vagy migráció. `.canvas.tsx` nem készült.
Részletes modell és rollback:
[Phase 23.3 population mortality](features/phase23-3-population-mortality.md).

Ellenőrzés: fókuszált mortality/age/store/genesis csomag **41 pass / 0 fail**
(`.local/verification/20261013-194923-490-phase23-3-focused-final.log`),
500 tag egyéni változatosságával és korlátaival, pontos időhatárral, valódi
genesis seed-eltéréssel, mindkét adatbázis restartjával, pause/replay/reset és
direct/incremental catch-up paritással. A teljes `bun run verify:full`
**PASS, exit 0**, **1484 pass / 0 fail / 0 skip**, format és
root/engine/webclient typecheck PASS
(`.local/verification/20261013-195048-317-phase23-3-full.log`,
`.local/verification/20261013-195051-423-full.log`).

## 23.4 – sérülés-/health domain-MVP kész (2026-10-13)

Az új `population-health` domain a pillanatnyi engine HP-tól elkülönített,
tartós sérülésterhelést, ellátási és pihenésigényt ad. A valóban alkalmazott
NetworkPlayer-sebzés engine-owned, hash-láncos SQLite-bizonyítékot ír; ha az
audit nem írható, a HP és hitmark változása visszaáll, a művelet hibával zár.
Az engine World-tick producer-heartbeatje megkülönbözteti az aktív forrást a
leállt engine után maradt fájltól. A gateway read-only forrást ellenőriz,
avatar szerint pontosan köt, közös órabélyeget és tartós source cursort használ.
Exact replay idempotens; megváltozott/csonkított forrás fail-closed.

Nincs kitalált egészséges baseline: tagság önmagában nem hiteles health-adat.
A gyógyulás csak sérülés utáni, igazolt, folytonos és nem lejárt alvási
ablakot számol; offline helyzetben bed entitlement kell. A beteg globális
regenerációs keretét a 23.2 életkori szakasz módosítja, és a szakaszhatárok
időarányosan osztják az intervallumot. BigInt és tartós maradék biztosítja a
direct/incremental/restart paritást; több kis sebzés nem sokszorozza a keretet.
Ismeretlen birth, szüneteltetett óra, hibás/hiányzó/elavult forrás vagy source
backlog nem ad plusz gyógyulást. A blokkolt időszak utólag sem írható jóvá.
Súlyos sérülés ellátás nélkül csak care floor-ig javulhat. Reset/deceased
tagság mellett az egészségtörténet megmarad, aktív mutation nincs.

A kezelési kapu immutable klinikai completion-bizonyítékot, pontos
patient/injury/clock/policy/genesis referenciát, verified skill-versiont és
checksumot, patient-bound completed runt, Herblore kompetenciát és hiteles
facility-jogosultságot igényel. Revizióütközés, hamis receipt, generikus run
vagy többször fogyasztott bizonyíték nem gyógyít. A későbbi valódi protokollok
hozzáadása új verziójú, auditált policy-migrációval működik, változatlan
biológiával és korábbi sérüléstörténettel.

**Medicine-határ:** a szállított treatment-lista üres. A repositorynak jelenleg
nincs valódi verified klinikai eljárása/completion producere; ezt nem váltja
ki a sikeres tesztfixture és nem lett kész medicine-rendszernek minősítve.
Az egészség-/gyógyulás-/ellátási igény MVP működik, súlyos sérülésnél a hiányzó
kezelés explicit blokkolt állapot marad. Klinikai kezelés csak tényleges
verified forrás bekötése után aktiválható; új személyes medicine skill nincs.

A gateway tíz másodperces ciklusa és admin backendje a valódi AgentState-pathot,
közös órát és új health-store-t használja. A `populationHealth` kimenet és a
trusted döntési kontextus jelzi az ellátási igényt és a forrás verified/
unavailable/pending állapotát. Hiányzó health-adat nem jelent wellness-t.
Engine source és health store új v1 táblákkal indul; AgentState v22 és
SimulationClock store v4 maradt. Migráció, korlátok és összehangolt rollback:
[Phase 23.4 population health](features/phase23-4-population-health.md).
Nincs halálesemény/lifecycle-lezárás, estate, UI redesign vagy `.canvas.tsx`;
bot nem indult, a 23.5+ scope változatlan.

Ellenőrzés: a végleges health/engine/admission/source-status csomag
**22 pass / 0 fail**, format és root/engine/webclient typecheck PASS,
**exit 0**
(`.local/verification/20261013-211248-471-phase23-4-final-confirmation.log`).

A teljes regressziós készlet **1506 tesztjének lefedettsége ellenőrzött,
0 assertion fail és 0 skip**: a fő készlet 1105 pass / 4 teardown fail volt
(`.local/verification/20261013-202404-641-full.log`); a két érintett régi fájl
soros újrafuttatása **16/16 PASS**
(`.local/verification/20261013-203028-283-phase23-4-ebusy-recheck.log`),
a további modulcsomag **393/393 PASS**
(`.local/verification/20261013-203029-732-phase23-4-full-remainder.log`).
Ebből a korábbi 18 health tesztet a végleges 22-es csomag váltotta fel;
a négy utólagos forrás-/migrációs-/születésihatár-ellenőrzés és a hozzájuk tartozó kód külön
végleges health/typecheck csomagokban is zöld, nem lett teszt kihagyva.

Az egyszer lefuttatott `bun run verify:full` továbbra is **FAIL, exit 1**:
`llm-dry-run.test.ts` három és `replan-runtime.test.ts` egy temp-SQLite
afterEach törlése Windows `EBUSY` hibát kapott. Mindegyik termékassertion
teljesült, az elkülönített ellenőrzés zöld; ez a meglévő tesztinfrastruktúra-
follow-up, nem health-termékhiba. A wrapper eredménye nem lett átértelmezve.

## 23.5 – hiteles halálesemény és terminális avatar-lifecycle kész (2026-10-13)

Az engine tick a valódi AgentState-ből és közös SimulationClockból, pontos
world/lifecycle/age/mortality kötésekkel fogyasztja a 23.3 esedékes jelöltjét,
offline tagoknál is. Másik hiteles halálok a tényleges pozitív HP-vesztés nullára.
Az új engine v2 journal egy tranzakcióban rögzíti a lethal sebzést és a tartós
avatar-lezárást; sikertelen írásnál a HP/hitmark és mindkét journalhatás visszaáll.
A hash-lánc és tail anchor a csonkított forrást is felismeri. A tartós finite-
avatar kötés miatt eltűnt AgentState nem válik compatibility fallbackká.

Az engine tiltja a terminális avatar gameplay packetjeit, mozgását, protected
accessét, queue/timer/script/interaction futását, exchange-műveletét és
login/reconnectjét. A script runner minden opcode előtt mindkét player pointert
és az eredeti actort ellenőrzi, a world loop a feldolgozási szakaszok között is
újraellenőriz. A klasszikus respawn/logout script helyett az engine normál
session/save lezárása történik. Offline save edit/restore sem éleszthet újra.
Hiányzó authority vagy bizonyíték nélküli nulla HP tiltást ad, halált nem talál ki.

A gateway a read-only engine-forrást idempotensen vetíti AgentState schema v23-ba.
Egy tranzakcióban marad meg a hiteles receipt, lesz `deceased` a karakter,
fagy meg az életkor a pontos halálidőnél, és szűnik meg az autonomy lease/wakeup.
Exact replay nem növel revíziót; konfliktus vagy birth/reset közbeni változás
fail-closed. A gateway SDK-forwarding, bot-spawn és skill-start kapuja már az
engine latch alapján tilt, az ingest késésétől függetlenül. A lezárt managed
skill/bot leáll; az admin `populationDeath` és lifecycle/authority blockert ad.
A finite avatar identity/control binding nem köthető át, deceased autonomy nem
resume-olható. A kapu kizárólag olvas, nem végez migrációt.

A rövid életű AgentState-kapcsolatok cache-elt statementjei explicit lezárást
kaptak. Ez valódi kapcsolatlezárási javítás: a reprodukált health-admin Windows
SQLite `EBUSY`/zombie connection oka megszűnt, assertion vagy teszt nem lett
gyengítve. AgentState v23 és engine source v2 additív; SimulationClock v4 és
population-health store v1 maradt. Történeti death/birth backfill nincs.
Migráció, korlátok és összehangolt rollout/rollback:
[Phase 23.5 population death](features/phase23-5-population-death.md).

A 23.6+ estate, öröklés és memóriaátadás scope változatlan; gazdasági settlement
nem készült. `.canvas.tsx` nem készült, bot nem indult. Az élő engine/gateway
folyamatok nem lettek újraindítva; a helyi AgentState séma már v23, death receipt
darabszáma a read-only ellenőrzéskor nulla volt. A runtime aktiválásához az új
engine/gateway összehangolt újraindítása szükséges.

Ellenőrzés: a népességi/health/genesis modulcsomag **77 pass / 0 fail / 0 skip**
(`.local/verification/20261013-223718-495-phase23-5-module-final.log`),
az utólag hozzáadott valódi admin-death integráció **1/1 PASS**
(`.local/verification/20261013-224017-609-phase23-5-admin-death.log`).
A 14-es death csomag és root/engine/webclient typecheck PASS a read-only kapu
ellenőrzésében (`.local/verification/20261013-223229-368-phase23-5-readonly-gates.log`).
Az első full futás **FAIL, exit 1**, egy korábbi `llm-dry-run` temp-SQLite
teardown miatt (`.local/verification/20261013-223019-679-full.log`); ezután a
közös statement-élettartam javítása új teljes regressziót indokolt.

A javítás utáni teljes `bun run verify:full` **PASS, exit 0**,
**1521 pass / 0 fail / 0 skip**, format és root/engine/webclient typecheck PASS
(`.local/verification/20261013-223706-478-phase23-5-full-after-cleanup.log`,
`.local/verification/20261013-223710-083-full.log`). Ez már a végleges,
15 death tesztet és a valódi admin-death integrációt is tartalmazza.
A korábbi wrapper FAIL megmaradt az auditban; a végleges teljes futás zöld.

## 23.6 – hiteles, fail-closed hagyatéki őrizet kész (2026-10-13)

A `population-estate` folyamat kizárólag pontosan egyező engine death és
AgentState receipt alapján indul. A tartós eset kötése a halál digestjét, a
verziózott custody-policyt és a valódi forráspathokat is rögzíti. A jogosultság
és a Business-/contract-kontextus runtime-branddel védett; modellállítás vagy
kívülről összeállított objektum nem ad hagyatéki írásjogot.

A nyolc kötelező forrás külön, atomi bizonylatot ad: AgentState, Business,
szerződések, treasury, banking, Property, governance és shared engine escrow.
A nem-self gazdasági szerepek archiválódnak és megszűnnek, az elhunyt aktív
munkaviszonya véget ér, saját Business-e dormant lesz. Az érintett szerződés,
funding/reserve, hitel/fedezet, tartozás/követelés és Property őrizetbe kerül.
Az eredeti owner/title, pénzegyenleg és történet megmarad. A Business vagy más
intézmény vagyona külön jogalanyé marad; a jelentett social debt és explicit
commitment nincs összeszámolva vagy jogerős követelésnek átminősítve.

Tartós SQL-kapuk tiltják a közönséges gazdasági mutationt; másik agent sem
kaphat új jogot az őrzött Businesshez. UPDATE esetén a régi és az új alany is
ellenőrzött. A source-effect, seal, receipt és ideiglenes write permit egyetlen
tranzakcióban történik; hibánál minden visszaáll, a korábbi hold megmarad.
A coordinator-ack előtti source-commit restart után exact replayként folytatódik.
Nincs adatbázisok közötti hamis atomicitási ígéret vagy ismételt pénzmozgás.

Hiányzó adatbázis/tábla, sérült journal/receipt/sealed row, eltérő treasury-
reservation vagy engine escrow, illetve bizonytalan in-flight settlement
`blocked` eredményt ad. Hiányzó forrásból nem készül üres ledger. A
`custody-ready` mind a nyolc hiteles receiptet és funding-egyezést igényli;
nem jelent kifizetett tartozást vagy felosztott hagyatékot. A később elveszett
death authority a kész esetet is blokkolja.

A gateway a death reconciliation után futtatja a folyamatot; az admin backend
`populationEstate` kimenetet és explicit blokkolót ad. A coordinator schema v1,
a források namespaced estate schema v1-et és kapukat kapnak. AgentState v23,
engine death v2 és SimulationClock v4 változatlan. Nincs történeti backfill.
Részletes működés, valódi forráspathok, aktiválás és összehangolt rollback:
[Phase 23.6 population estate](features/phase23-6-population-estate.md).

A 23.7+ öröklési policy, örökösválasztás, vagyonfelosztás és memóriaátadás nem
készült. `.canvas.tsx` nem készült, bot nem indult, az élő engine/gateway
nem lett újraindítva. Hiányzó valódi banking/governance/escrow authority esetén
az aktivált runtime őrizeti blokkolót ad; provisioning nem helyettesíthető
kitalált nulla tartozással.

Ellenőrzés: a végleges célzott estate/death/gazdasági integrációs csomag
**83 pass / 0 fail / 0 skip**, root/engine/webclient typecheck és format PASS,
**exit 0** (`.local/verification/20261013-234403-867-phase23-6-final-focused.log`).
Az utolsó UPDATE-kapu után a teljes estate csomag **15 pass / 0 fail / 0 skip**,
root typecheck és format PASS
(`.local/verification/20261013-235021-346-phase23-6-final-barriers.log`).
A valódi shared wallet teszt igazolja a visszautasított escrow release atomi
rollbackjét és az őrzött pénz megmaradását; a source saját statementjei explicit
lezáródnak. A fejlesztés korábbi timeout/SQLite-close hibái az auditlogban
megmaradnak; a végleges célzott futások zöldek.

A teljes `bun run verify:full` **PASS, exit 0**, **1536 pass / 0 fail / 0 skip**,
format és root/engine/webclient typecheck PASS
(`.local/verification/20261013-234833-432-phase23-6-full.log`,
`.local/verification/20261013-234835-974-full.log`). A futás a végleges, 15 tesztes
estate csomagot is tartalmazza.

## 23.7 – faction/jurisdiction-kötött admin öröklési MVP kész (2026-10-14)

A verziózott `population-inheritance-policy.json` explicit Property-listával
köt egy admin által alkalmazható szabályt létező, aktív factionhöz és opcionális,
ahhoz tartozó jurisdictionhöz. Az üres szállított kötéslista nem enged éles
öröklést. Nincs implicit default jog, rokonsági következtetés vagy másik agent
modellállításából származó örökös. Az első működő változat admin-kijelölést
használ; előzetes végrendelet nem feltétele az MVP-nek.

Az új, meglévő admin-auth mögötti preview/apply endpoint pontos estate-revíziót,
preview-digestet, halál-/custody-/policy-/governance-/forráskötést és stabil
döntésazonosítót kér. Az örökös kizárólag különálló, aktív player-agent lehet.
Az engine-ben már lezárt, de AgentState-ben még aktív örökös is tiltott.
Végrehajtáskor az identitás-, death- és governance-írók foglalása alatt ismét
ellenőrződik az örökös, az eredeti halálesemény és a pontos jogi állapot.

Az MVP a személyes Propertyket adja át egyetlen örökösnek, egyetlen atomi
Property-tranzakcióban. Tulajdonosváltás, verziólépés, native `property_transfer`,
tervhez kötött öröklési bizonylat és a megfelelő Property-hold feloldása együtt
történik. Későbbi asset hibája az összes korábbi átadást is visszavonja;
`RAISE(IGNORE)` miatt kihagyott UPDATE sem hozhat létre sikeres bizonylatot.
A permit commit előtt eltűnik. Az elhunyt actor-holdja és más gazdasági kapuk
megmaradnak.

Nyitott személyes contract/funding, social debt/követelés, commitment,
governance-igény, személyes hitel/escrow vagy fedezett Property blokkol. A nyolc
23.6 forrás ellenőrzött állításaiból nem lesz elengedett vagy kifizetett tartozás.
Business-vagyon, intézményi pénz és hitel nem válik személyes örökséggé.
Az MVP nem oszt inventoryt/készpénzt/Business-equityt, nem választ több örököst,
nem adóztat és nem adjudikál különleges liability domainokat. A completed állapot
a személyes Property-döntésre vonatkozik; az estate többi része őrizetben marad.

A coordinator az eredeti hash-láncos eset-auditban tárolja a prepared/completed
döntést; új coordinator séma nem szükséges. A Property source additív, namespaced
inheritance schema v1-et kap. AgentState v23, engine death v2 és SimulationClock
v4 változatlan; nincs kitalált történeti örökös vagy backfill. Az eredeti custody
receipt megmarad, az átadott Property sealjét csak a pontos központi terv és
native transfer proof váltja fel. Az örökös későbbi szabályos tulajdonátruházása
nem írja át a hagyatéki történetet és nem teszi hibássá a korábbi esetet.

Source-commit/coordinator-ack közti megszakítást a következő normál estate
ciklus fejez be, új tulajdonosváltás nélkül. Source-commit előtti hibánál ugyanaz
az admin-kérés újrapróbálható, friss authority-ellenőrzéssel. Eltérő örökös,
indok, preview, revízió vagy policy nem exact replay. Hiányzó/sérült/hamis
öröklési vagy native bizonylat fail-closed.

A coordinator és engine death-forrás cache-elt statementjei explicit lezáródnak;
a ciklus tagonként egyszer olvassa az öröklési tervet. Az új, több teljes nyolc-
forrásos ciklust végző öröklési integrációk külön 15 másodperces limitet kaptak;
a korábbi általános 5 másodperc változó SQLite-I/O pontokon timeoutolt.
Az eredeti custody tesztek limitje és minden assertion változatlan, nincs retry
vagy skip. A sikertelen wrapper-futások megmaradnak az auditban.

Részletes működés, konfiguráció, admin API, migráció és összehangolt rollback:
[Phase 23.7 population inheritance](features/phase23-7-population-inheritance.md).
A 23.8+ memóriaarchiválás és tudásátadás scope változatlan. `.canvas.tsx` nem
készült, bot nem indult, élő engine/gateway újraindítás és éles öröklés nem történt.

Ellenőrzés: a teljes custody/inheritance csomag **32 pass / 0 fail / 0 skip**,
az érintett engine death-source csomag **5 pass / 0 fail**. Format és
root/engine/webclient typecheck **PASS, exit 0**
(`.local/verification/20261014-174241-557-phase23-7-quality.log`).
A célzott végleges futás összesen **37 pass / 0 fail / 0 skip**. Az első két
TypeScript-próba szintaktikai hibája és a korábbi 5 másodperces timeoutos futások
FAIL eredménye nem lett PASS-ra átértelmezve; a végleges ellenőrzés zöld.

Az első teljes `verify:full` **FAIL, exit 1** lett
(`.local/verification/20261014-174632-773-phase23-7-full.log`,
`.local/verification/20261014-174633-507-full.log`): hat régi Lite cache teszt
a leállt `localhost:8888` forrás miatt nem tudott indulni. Ez nem lett zöldnek
minősítve. A helyi native `main_file_cache` read-only FileStream-olvasásából,
eredeti CRC-kkel és `ondemand.zip`-pel ideiglenes loopback HTTP-forrás készült;
a child ellenőrzés kapott `LITE_TEST_ORIGIN` override-ot. Ezzel a teljes Lite
csomag **43 pass / 0 fail / 0 skip**, valódi browser collision-oracle paritással
(`.local/verification/20261014-175333-556-phase23-7-cache-preflight.log`).
Világ-szimuláció és gateway nem indult; a tesztcache a child végén leáll.

A natív cache-függőség helyreállítása utáni teljes `bun run verify:full`
**PASS, exit 0**, **1553 pass / 0 fail / 0 skip**, format és
root/engine/webclient typecheck PASS
(`.local/verification/20261014-175406-807-phase23-7-full-native-cache.log`,
`.local/verification/20261014-175407-722-full.log`). A wrapper a teljes, változatlan
`bun run check` láncot futtatta; a cache-szerver az ellenőrzés végén leállt.
A TASKS 23.7 státusza `[x]`; a következő véges feladat a 23.8 memóriaarchiválás
és explicit tudásátadási szabály.

## 23.8 – terminális memóriaarchívum és explicit tudásátadás kész (2026-10-14)

Az AgentState v24 a hiteles halálreceipt, deceased lifecycle és autonomy-lezárás
tranzakciójában archiválja a teljes episodic/social memóriát, a semantic tényeket,
skill-knowledge rekordokat és consolidation evidence-et. Nem retrieval-oldalt
ment: az 500-nál több epizódot tartalmazó teljes történet is megmarad. Az engine
halál- és felvételi ideje, a snapshot capture ideje, a pontos death-digestek,
control profile és az akkori economic actor linkek külön kötést kapnak.

Tartós SQL-kapuk tiltják a lezárt agent memóriájának utólagos insert/update/delete
módosítását. A prune explicit `population-archive` védelmet jelez és nem töröl.
Bizonyíték nélküli deceased állapot is megőrzési tiltást ad, kitalált archívumot
nem. Hibás vagy ignorált archive-/audit-/tail-írás az egész AgentState death-
projectiont visszavonja; az engine fizikai closure ettől végleges marad.
Az új táblák, receipt/checksum, hash-lánc és tail anchor a hiányzó/csonkított/
módosított történetet és a megváltozott fagyasztott forrást is felismeri.

A v23→v24 migráció additív és üres metadata-t hoz létre, nem történeti emlékeket.
Régi, igazolt death mellett a jelenleg rendelkezésre álló memória később explicit
`late-reconciliation` snapshotként vehető fel; nem lesz visszamenőleg a halálkori
memória bizonyítéka. Szervezeti jogosultság igazolására ilyen late snapshot nem
használható. Az új admission pillanatában készülő archive sem igazol olyan actor
linket, amely csak az engine halálidőpontja után jött létre vagy módosult.

A `population-memory-transfer-policy.json` szabálylistája alapból üres. Csak
pontos source/recipient/archive-digest, kijelölt semantic knowledge ID-k,
inheritance/organization mód és confidence-plafon alapján történhet átadás.
A címzett személyes öröklésnél élő player-agent, szervezeti átadásnál a pontos
intézményi controller. Az engine-ben már lezárt, de még active AgentState-
címzett is tiltott. Inaktív/lejárt vagy már létező aktív subject/predicate tény
nem válik új, csendben felülírt tudássá; stale preview fail-closed.

Az admin-auth mögötti archive/preview/transfer végpontok pontos preview-digestet
és stabil transfer ID-t használnak. A source archive, recipient-check, új tény,
új acquisition epizód, provenance receipt és audit egy AgentState-tranzakcióban
van. Az AgentState és engine writer-foglalás az öröklési kapuval egyező sorrendű.
Exact replay restart után sem másol újra; eltérő kérés konfliktus. A címzett későbbi
szabályos semantic supersessionje megőrzi a történeti bizonylatot, az immutable
ténytartalom vagy acquisition evidence megváltozása elutasított.

Csak kiválasztott semantic tény másolódik, `manual` source-szal, nem növelt
confidence-szel és `archived report` döntési kontextus-jelöléssel. Az új saját
tanulási epizód `untrusted` és csak provenance-azonosítókat tartalmaz. Az eredeti
személyes epizód, social trust/affinity/adósság, személyiség, cél, skill-státusz,
verified skill, licenc és grant nem másolódik. A szervezeti tudás MVP az AgentState
semantic rekordjait kezeli; más domain-repository külön explicit adaptert igényel.

Az admin `populationMemoryArchive` metadata/count kimenetet kap. A read-only
fizikai kapu elfogadja az additív v24-et; engine death v2, SimulationClock v4 és
estate coordinator v1 változatlan. A korábbi death-migráció tesztje valódi v22
alakot állít elő, az öröklési fixture pedig még a halál előtt rendezi a pozitív
teszthez szükséges követeléseket; postmortem íráskapu nem lett megkerülve.

Működés, policy-konfiguráció, admin API, migráció és összehangolt rollback:
[Phase 23.8 population memory](features/phase23-8-population-memory.md).
A 23.9+ új belépő generálása és demográfiai metrikák scope változatlan.
`.canvas.tsx` nem készült, bot nem indult, élő engine/gateway nem lett újraindítva.

Ellenőrzés: death + memory + estate modulcsomag **64 pass / 0 fail / 0 skip**,
format és root/engine/webclient typecheck **PASS, exit 0**
(`.local/verification/20261014-182724-461-phase23-8-module-quality.log`).
A végleges memóriacsomag **21 pass / 0 fail / 0 skip**; a pontos szervezeti
időkapu utáni root typecheck is zöld
(`.local/verification/20261014-183016-665-phase23-8-final-provenance.log`,
`.local/verification/20261014-183119-346-phase23-8-closed-memory.log`).
Az induló generic-return és teszt-signature TypeScript hibák, illetve az érvénytelen
lejárati idejű korai fixture FAIL eredményei megmaradnak az auditban. A végleges
futások assertionjei és időkorlátai nem lettek gyengítve; nincs skip vagy retry.

Az első teljes futás **FAIL, exit 1** volt
(`.local/verification/20261014-183230-424-phase23-8-full-native-cache.log`,
`.local/verification/20261014-183231-337-full.log`): a fő csomagban **1128 pass /
2 fail**. A v15 autonomy fixture-ből hiányoztak az akkor már létező memóriatáblák;
a v21 membership fixture csak a version markert állította vissza, de megtartotta
a v24 archive struktúrát. A minták valódi régi sémaalakra javultak, a migrációs
kapuk és assertionök változatlanok. A sikertelen membership afterEach `EBUSY`
a korábbi exception miatt kihagyott clock-lezárás következménye volt, nem elhallgatott
sikeres futás. A javított legacy + memory csomag **33 pass / 0 fail / 0 skip**
(`.local/verification/20261014-183726-383-phase23-8-legacy-migrations.log`).

A javított fixture-ök utáni teljes `bun run verify:full` **PASS, exit 0**,
**1574 pass / 0 fail / 0 skip**, format és root/engine/webclient typecheck PASS
(`.local/verification/20261014-183802-715-phase23-8-full-final.log`,
`.local/verification/20261014-183803-658-full.log`). A változatlan teljes
`bun run check` lánc a natív cache ideiglenes read-only kiszolgálásával futott,
amely a child végén leállt. Az első teljes FAIL az auditban megmaradt.
A TASKS 23.8 státusza `[x]`; a következő véges feladat a 23.9 új népességi
belépők generálásának absztrakciója.


## 23.9 – seedelt, korlátozott népességi belépés kész (2026-10-14)

A `generatePopulationEntry` különválasztja a determinisztikus generálást az
AgentState-admissiontől és a helyi avatárnévtér ellenőrzésétől. Az első generátor
`seeded-arrival-v1`: új player-agent identitást, avatár-kötést, személyiségjegyet
és ismert generált születési időt ad, exact finite lifecycle-, world-profile-,
age-policy-, genesis- és közös SimulationClock-provenance-szel. A szállított
policy 8 fős batch-et, 64 élő tagot és clock/profile-élettartamonként összesen
256 belépőt enged; a generált érkezési életkor 18–35 szimulációs év.

Új admission szüneteltetett közös órát kér, preview digesttel ellenőrzött,
atomikus identitás/birth/tagság/receipt írással. A batch kulcsának seed/count/anchor
átkötése konfliktus. A pontos replay restart, halál vagy reset után az eredeti
receiptet adja vissza, újraélesztés és új kvóta nélkül. Elhunyt alapító is lehet
unreset genesis anchor: a kihalt alapító populáció után új szereplők érkezhetnek.
A genesis reset az eredeti rollback-token óta érkezett tagokat is atomikusan
`reset` állapotba helyezi, megőrzött identitással, birth adattal és receipt-tel.

Az AgentState v25 additív migrációja üres, módosítást/törlést tiltó entry historyt
hoz létre. Restartkor a receipt/plan digest és a tagság/birth/source összerendelés
ellenőrzött; hiányzó vagy sérült forrás blokkol. Történeti belépőt nem talál ki.
A helyi admin preview/apply a gateway valódi AgentState- és közös clock-kötését
használja. Read-only engine v2 terminal authority és SQLite account registry,
valamint save/bot/online névtérellenőrzés védi a már használt neveket. Hiányzó
forrásból nem készít üres helyettesítőt. Nincs automatikus refill, vagyon-,
memória-, skill- vagy jogosultságátadás. A credential/save/bot fizikai aktiválása
külön meglévő helyi regisztráció/login lépés; ez a feladat nem indított botot vagy
élő engine-t. Család/reprodukció és a 23.10 demográfiai metrikák külön scope.

Részletes API, működési határ, migráció és rollback:
[23.9 population entry](features/phase23-9-population-entry.md).

Ellenőrzés: a végső teljes `bun run verify:full` **PASS, exit 0**, **1592 pass /
0 fail / 0 skip**, benne a 18 új entry teszttel; format és root/engine/webclient
typecheck PASS. Bizonyíték: `.local/verification/20261014-185931-585-full.log`,
külső natív cache runner:
`.local/verification/20261014-185930-731-phase23-9-full-final.log`. A natív cache
csak read-only, a teszt-child idejére futott, majd leállt; élő World import és
production clock-léptetés nélkül. A végső reset/account-integrációs fókusz **22
pass / 0 fail / 0 skip** és root typecheck PASS
(`.local/verification/20261014-185820-371-phase23-9-final-focused-fixed.log`);
a két további alapító-kihalás/más-genesis teszt a végső teljes futás része.

A korai két fixture/elvárás-hiba, a SQLite transaction-return típuseltérés és a
resetadapter korai szintaktikai hibájának FAIL naplói megmaradtak az auditban.
A javítások nem gyengítettek assertiont vagy időkorlátot; nincs skip vagy retry.
A TASKS 23.9 státusza `[x]`; a következő véges feladat a **23.10 demográfiai
metrikák**.

## 23.10 – hiteles demográfiai metrikák kész (2026-10-14)

A védett `GET /api/admin/population-demographics?fromSimulationTime=...` a gateway
valódi AgentState-, közös SimulationClock-, engine-death-, archive-, estate- és
Property-forrásából ad összesített JSON-t. A korstruktúra a konfigurált életkori
szakaszokat használja; az ismeretlen birth külön ismeretlen marad. A születés,
genesis-admission, seedelt belépés, reset és természetes/lethális halál `(from,to]`
szimulációsidő-ablakot kap. Az importált felnőtt belépő nem születés.

A halál még AgentState-projekció előtt csökkenti az élő létszámot és a potenciális
munkaerőt. A szakembervesztés exact skill ID/verzió és death-admission archívum
alapján számolt; a hiányzó vagy későn archivált skill-profil részleges lefedettség,
nem teljesnek állított nulla. A munkaerő életkori/munkakapacitás-küszöbe és a
skill-alapú szakembercsoportok konfigurálhatók; mérhető az alkalmas belépés, az
alkalmassági korhatár átlépése és a halálozási veszteség. Ez potenciális kapacitás,
nem foglalkoztatás, injury readiness vagy műveleti jogosultság.

Az öröklés a tényleges, ellenőrzött natív személyes Property-átadásokat és az
estate-döntések állapotát méri. A forráscommit utáni, coordinator-visszaigazolás
előtti átadás külön pending completion; replay nem dupláz. GP-értékelés és
szimulációs időbélyeg híján az érték és az időablakos öröklési hozzárendelés `null`;
a közölt Property-mutató explicit kumulatív. Intézményi vagyon vagy Business-equity
öröklését nem következteti ki.

Minden metrikaszekció verified/partial/unavailable státuszt, értéket és hibákat
kap. Hiányzó, stale vagy sérült forrás nem válik nullaszámlálóvá. A teljesen
elérhetetlen jelentés HTTP 503, a részleges jelentés 200, explicit státusszal.
Source/policy/report digest biztosít provenance-t. Jövőben megfigyelt halál és
visszanyitott lifecycle melletti halálprojekció nem állíthat elő hiteles metrikát.

A forráskapcsolatok és a SQLite snapshotok read-only módban futnak; nincs
migráció, backfill, óraléptetés, archívumkészítés, death-reconciliation, estate-cycle
vagy inheritance-completion. A séma változatlan: AgentState v25, engine v2,
estate v1. Ha a szimulációs idő olvasás közben előrelép, a jelentés elérhetetlen;
stabil megfigyeléshez új lekérés vagy szüneteltetett óra használható. A meglévő
író konstruktorok működése megmaradt. Nem indult bot vagy élő engine.

Részletes mezők, működési határ, konfiguráció és rollback:
[23.10 population demographics](features/phase23-10-population-demographics.md).

Ellenőrzés: az első teljes futás **1620 pass / 0 fail / 0 skip, exit 0**
(`.local/verification/20261014-193021-257-full.log`). A végső két konzisztenciakapu
és három regressziós eset indokolta az új teljes futást: **1623 pass / 0 fail /
0 skip, exit 0**, format és root/engine/webclient typecheck PASS, benne 31 új teszt
(`.local/verification/20261014-193713-253-full.log`, külső runner:
`.local/verification/20261014-193712-320-phase23-10-full-consistency-final.log`).
A natív cache mindkét futásban csak a teszt-child idejére, read-only módban futott,
majd leállt; production World import és clock-léptetés nélkül.

A végső aggregáció/source/HTTP fókusz **29 pass / 0 fail / 0 skip** és root
typecheck PASS (`.local/verification/20261014-193621-201-phase23-10-final-consistency.log`).
A valódi estate/öröklés integrációval együtt futott köztes csomag **58 pass** volt;
annak typecheckje a tesztfixture körkörös típusára FAIL-t jelzett, amely explicit
PopulationDeathRecord típussal javult. A korai natural-death fixture helytelen
eseményablakának FAIL naplója szintén megmaradt az auditban. Assertion, timeout és
skip nem lett gyengítve. A TASKS 23.10 státusza `[x]`, a Phase 23 feladatsor minden
eleme kész; a következő véges feladat a **24.1 önfenntartó társadalom mérhető
minimumának meghatározása**.
