# Aktív projektfeladatok

Ez az aktív roadmap a 0–14. fázis elkészült technikai alapjaira épül. A korábbi,
lezárt feladatok történeti állapota az [old_TASKS.md](old_TASKS.md) fájlban marad;
az archív dokumentumot nem szabad aktív backlogként használni. A korábbi
15–23. fázisjavaslatot a
[TASKS_PHASES_15_23_REPLACEMENT.md](TASKS_PHASES_15_23_REPLACEMENT.md) őrzi.
Az aktuális sorrend elé külön integrációs mérföldkő került.

Az új fázisok megkezdése előtt az
[autonóm proto-társadalom capability- és integrációs auditja](AUTONOMOUS_PROTO_SOCIETY_AUDIT.md)
az irányadó baseline. A checkbox továbbra is csak az alatta rögzített bizonyíték
és elfogadási feltétel teljesülése után jelölhető késznek.

## 15. Fázis – autonóm proto-társadalom és MVP-integráció

A fázis célja nem új társadalmi szükséglet vagy hosszú production chain, hanem a
0–14. fázis persistent agent-, verified skill-, LLM-, Property-, Business-,
contract-, treasury-, bank-, governance-, world-mod- és telemetriai alapjainak
egyetlen tartós, eseményvezérelt autonóm lifecycle-ba kötése.

### 15.1 Auditbaseline és határok

- [x] A checkboxok helyett a tényleges agent → context → planner → policy →
  skill/domain action → journal/evidence → replan útvonalat auditálni.
- [x] Capability-mátrixban elkülöníteni a létező domaint, az agent számára látható
  vetületet, a döntési lehetőséget, a végrehajtást és a folyamatos lifecycle-t.
- [x] Rögzíteni az izolált MVP-ket, az admin-only útvonalakat, a hiányzó
  wake-upokat, a restartkockázatokat és a verified skill gapeket az
  [auditdokumentumban](AUTONOMOUS_PROTO_SOCIETY_AUDIT.md).
- [ ] Az audit megállapításait executable regression/acceptance tesztjegyzékké
  alakítani, és minden lezárt gaphez exact teszt- vagy run ID-t rögzíteni.

### 15.2 Reprodukálható proto-society fixture

- [x] Verziózott, seedelt `varrock-proto-v1` fixture manifestet készíteni hat
  player bottal/persistent player agenttel és egy Business institution agenttel.
  - Bizonyíték: `config/fixtures/varrock-proto-v1.json`; `varrock proto-society fixture manifest` 4 teszt.
- [x] A fixture-ben exact módon rögzíteni a player–agent–subject kötéseket,
  pozíciót, skill/XP-t, inventoryt, equipmentet, bankot, coint, célhierarchiát,
  memóriaseedet, ismert verified skilleket és autonomy policyt.
  - Bizonyíték: digest-, exact slot-, save-reader- és valódi verified katalógus regresszió.
- [x] A `varrock-forge` Businesshez Property-hivatkozást, külön treasuryt,
  jóváhagyott bounded operatív policyt és legalább két employmentet seedelni a
  meglévő domain API-kon keresztül.
  - Bizonyíték: `proto-society fixture bootstrap > applies exact saves and domain state idempotently with granular provenance`.
- [x] Minden fixture által létrehozott pénzt, tárgyat, Property-, Business- és
  treasury-állapotot `fixture-bootstrap` provenance-szal és digesttel jelölni;
  titkot vagy bot credentialt nem tenni a manifestbe.
  - Bizonyíték: erőforrás-szintű `fixture_provenance` ledger és manifest credential-regresszió.
- [x] Dry-run előnézetet, teljes preflightot, idempotens applyt, exportot és
  visszaállítási tervet adni. Részleges bootstrap ne maradhasson észrevétlenül.
  - Bizonyíték: `bun run fixture:proto` preview/apply/export/status/restore parancsok; tartós `applying`/`rollback-required` journal.
- [x] Ugyanabból a seedből és verzióból azonos kanonikus baseline-digestet
  bizonyítani; az engine save-, AgentState- és domainadatbázisok visszaállítását
  külön ellenőrizni.
  - Bizonyíték: kanonikus digest/export teszt és `journals a partial apply and restores engine saves plus pre-apply SQLite state`.
- [x] A vanilla NPC shop használatát explicit külső gazdasági függőségként
  megjelölni és mérni; a fixture még ne állítsa magáról, hogy önfenntartó.
  - Bizonyíték: két `vanilla-npc-shop` dependency saját metrikával, `selfSustaining: false` validációval.

### 15.3 Tartós autonomy enrollment és supervisor

- [x] A meglévő `AgentControlProfile` mellé kis, verziózott autonomy enrollment
  modellt adni desired/running/paused/quarantined állapottal, policyverzióval,
  lease-szel, `nextWakeupAt` értékkel és optimista revízióval.
  - Bizonyíték: AgentState schema v16 `agent_autonomy_enrollment`; a
    `durable autonomy enrollment` tesztcsoport 7/7 tesztje, benne v15→v17
    migrációval, reopen perzisztenciával, állapotinvariánsokkal és stale-write
    védelemmel (`bun test agent-state/test/autonomy.test.ts`, 2026-09-08).
- [x] A gatewayben a meglévő `BotSupervisor`,
  `AgentReplanCoordinator` és skill executor fölé due/idle supervisor réteget
  tenni; párhuzamos második agent runtime ne készüljön.
  - Bizonyíték: `GatewayAgentAutonomySupervisor`; a `gateway autonomy
    supervisor` tesztcsoport 7/7 tesztje és a live lease/instance-owner
    regressziós tesztek (`bun run check`, 2026-09-08: 700/700).
- [x] Startupkor enumerálni az enrolled agenteket, egyeztetni az online sessiont,
  a supervisor processállapotot és az active-skill markert, majd fresh state után
  idempotens startup/idle wake-upot küldeni.
  - Bizonyíték: a supervised runner 5 másodperces marker-heartbeatja,
    `BotSupervisor.reconcileSkillMarkers`, `ensureAutonomyBotSession`, valamint a
    `skill marker restart reconciliation` 3/3, az `autonomy bot session
    reconciliation` 5/5 és a `gateway autonomy supervisor` 5/5 tesztje.
- [x] Egy avatarhoz egyszerre pontosan egy controller és egy skill-run ownership
  tartozhasson; lease-vesztésnél új végrehajtás helyett előbb reconciliation fusson.
  - Bizonyíték: `avatarHasLiveAutonomyLease` + gateway controller admission,
    `BotSupervisor` avataronkénti start mutex és heartbeat-marker reconciliation;
    az `autonomy controller ownership` 3/3, a `skill marker restart
    reconciliation` 4/4 és az `autonomy bot session reconciliation` 5/5 tesztje.
- [x] A kívánt botfolyamatokat engine/gateway restart után újraindítani vagy
  biztonságosan adoptálni. A helyi stack indító támogassa a teljes fixture-t, ne
  csak egy opcionális botot.
  - Bizonyíték: az enrolled player avatar friss sessionjét a gateway
    adoptálja, az offline avatart a meglévő helyi `bot.env`-ből újraindítja,
    credential-másolat nélkül. A runtime v2 launcher `-BotNames` vagy a
    titokmentes fixture manifest `bots[].username` listája alapján kezeli és
    egészségellenőrzi a teljes kohorszt; startup grace előzi meg a gateway
    reconciliationt. A PowerShell fixture-lista tesztje és az 5/5 autonomy bot
    session teszt igazolja a két indítási út szerződését.
- [x] Admin pause/resume, quarantine release és globális emergency stop
  auditált, idempotens és restart-álló legyen.
  - Bizonyíték: AgentState schema v17 `agent_autonomy_control`, optimista és
    idempotens transition metódusok, auditált admin API-k, gateway-startup gate,
    scheduler/replan/LLM stoplánc; `admin autonomy controls` 1/1, `durable
    autonomy enrollment` 7/7 és `gateway autonomy supervisor` 7/7 teszt.

### 15.4 Tartós eseménykapu és wake-upok

- [x] A process-local replan gate elé tartós event inbox/outboxot készíteni stable
  source keyvel, payload digesttel, claim/lease-szel, attempttel,
  `nextAttemptAt` értékkel és terminal outcome-mal.
  - Bizonyíték: a verziózott `ReplanInboxStore` exact source-key
    deduplikációt, SHA-256 payload digestet, atomi due claimet, lejárt lease
    recoveryt, bounded retryt és terminal outcome-ot ad; a `durable replan inbox`
    tesztcsoport 4/4 tesztje, valamint a lease-tulajdonoshoz kötött supervisor
    replay átment.
- [x] Az admission továbbra is a meglévő `LlmReplanEventGate`,
  decision ledger és közös inference útvonal szabályait használja; tick-facing
  vagy tile-facing LLM belépési pont ne készüljön.
  - Bizonyíték: `DurableAgentReplanCoordinator` a meglévő coordinatort burkolja,
    a plannerét nem duplikálja; exact terminal replay és expired-lease replay
    mellett a restart-cooldown és transient owner-retry tesztje is átment (4/4).
- [x] Persistálni vagy újraépíthetően rekonstruálni a deduplikációt és cooldownot,
  hogy restart se duplikáljon eventet vagy veszítsen el függő wake-upot.
  - Bizonyíték: stable source + payload digest deduplikáció az inboxban; a
    `DurableAgentReplanCoordinator` a trusted terminal rekordok accepted idejéből
    hidratálja a meglévő event gate agentenkénti cooldownját. A restart-cooldown
    regressziós tesztben az új coordinator nem hívja meg újra a plannert.
- [x] Bekötni az alábbi eseményforrásokat:
  - [x] startup, reconnect és idle/due agent;
    - Bizonyíték: a supervisor startup/idle eseményei mellett az első friss
      reconnect state külön `autonomy-reconnect` rekordot ír a durable inboxba;
      paused/quarantined enrollmentet nem ébreszt, és a planner csak a későbbi
      current-instance lease claim után fut.
  - [x] skill completed, failed, cancelled, timeout és orphaned;
    - Bizonyíték: a terminal journal minden `SkillRunStatus` értékét success vagy
      failure wake-uppá képezi; journal nélküli orphan csak valid marker +
      bizonyítottan halott PID + exact current enrollment esetén keletkezik.
  - [x] goal completed, blocked, abandoned vagy új immediate goal;
    - Bizonyíték: az atomi `agent_goal_event` ledger enrollment utáni `created`
      immediate és terminal `status-changed` rekordjaiból stable
      `goal:<id>:event:<sequence>` wake-up készül. A route fast path mellett a
      periodikus ledger-recovery a commit és inbox-írás közötti crash esetét is
      pótolja; paused/quarantined agent kimarad.
  - [x] CapabilityGap resolved/verified;
    - Bizonyíték: a verified gap stable source keyvel közvetlenül a durable
      inboxba kerül, a registry csak sikeres inbox-kézbesítés után tartja
      claimeltnek, és a kézbesítés nem hív lease-en kívül plannert.
  - [x] economic offer és contract lifecycle;
  - [x] player-action request, accepted, failed és settled;
  - [x] Business employment, approved policy és elérhető work order;
  - [x] releváns Property-, Governance- és allowlistelt world event.
  - Bizonyíték: a periodikus `recoverDomainEventWakeups` az authoritative
    contract, AgentState, Business, Governance, engine Property és World
    Director állapotból enrollment utáni, revision/version-alapú stable
    source keyeket rekonstruál. Az offer csak a címzettet, a kétoldalú lifecycle
    mindkét felet, a work order csak aktív employment + approved policy mellett
    a dolgozót, a Property actor-/business-kötés alapján, a governance a faction
    subjectet, a world event pedig kizárólag built-in approved exact verziót és
    globális vagy egyező régiót ébreszt. A domain-recovery regressziós tesztek
    az exact-once restartot és a paused kizárást is igazolják.
- [x] Az aggregate economic change fan-outot a fixture skálájához bounded módon
  szűrni; ne ébresszen minden agentet olyan esemény, amelyhez nincs releváns célja,
  régiója, actor-kötése vagy subscriptionje.
  - Bizonyíték: a gateway legfeljebb 25, aktív gazdasági céllal vagy nyitott
    commitmenttel rendelkező desired/running enrollmentet választ determinisztikus
    agent-ID sorrendben. A coordinator külön relevance-selector tesztje bizonyítja,
    hogy az irreleváns agentek helyett csak a kiválasztott célpont kap eseményt.
- [x] Crash/restart után az inbox függő rekordjait és a terminal journalból
  rekonstruálható eventeket idempotensen újrajátszani.
  - Bizonyíték: `recoverSkillTerminalWakeups` kizárólag a restartkor még
    `running` enrollment claimje után indult, exact avatarhoz tartozó terminal
    journalokat képezi stable skill wake-uppá; repeated scan idempotens. Az új
    gateway instance saját lease-owner azonosítót követel, a supervisor claim
    után a legrégebbi due/expired inboxeseményt részesíti előnyben, az idegen élő
    lease pedig terminal skip helyett bounded retry marad.

### 15.5 Egységes decision context és szerepspecifikus toolok

- [x] A tényleges automatikus LLM contextet ugyanabból a builderből képezni, mint
  az admin előnézetet; külön, csendben eltérő context ne maradjon.
  - Bizonyíték: a provider request és az admin `decisionContext` exact-equality regressziója.
- [x] Player agentnek bounded módon elérhetővé tenni a teljes releváns inventoryt,
  ismert bankstate-et, coin/asset adatot, személyes skill/XP-t, active
  player-actiont, offert/contractot, shop/piaci lehetőséget és legutóbbi run
  eredményét.
  - Bizonyíték: authoritative gateway inventory/bank/XP/shop, typed offer és last-run context tesztek.
- [x] A control profile-t, exact subject/avatar bindingot, napi kereteket és
  authorization envelope-ot minden automatikus döntés trusted contextjébe tenni.
  - Bizonyíték: közös control-context és explicit authorization envelope.
- [x] Business institution agentnek kizárólag a saját Business-, employment-,
  policy-, treasury-, open work/order/contract- és releváns Property-vetületét
  adni; idegen actor adatát ne kapja meg implicit módon.
  - Bizonyíték: exact Business subject és érintettségre szűrt action/offer/contract regressziók.
- [x] Faction agentnél ugyanígy a meglévő Governance port szűk snapshotját
  használni; fizikai művelet továbbra is player-action request legyen.
  - Bizonyíték: exact Governance port; a contextből kizárt idegen jurisdiction/policy teszt.
- [x] Az LLM által nem megbízható chat-, mod- és külső szöveget elkülöníteni,
  méretkorlátozni és soha nem tool-authorityként kezelni.
  - Bizonyíték: a szabad offer/contract szöveg csak bounded `decisionUntrustedText`, a trusted context csak típusos termeket tartalmaz.
- [x] Context freshness/provenance jelzőket adni, és hiányzó kritikus forrásnál
  guess helyett refresh/wait/fail-closed döntést hozni.
  - Bizonyíték: `decisionContextProvenance`, `decisionContextBlockers` és az automatikus `requireAuthoritativeContext` kapu.

### 15.6 Planner, paraméterezés és célhaladás

- [x] A planner outputját típusos, sémavalidált skill-parameter bindinggal
  bővíteni. Paraméter forrása csak exact goal, work order, contract obligation,
  approved policy vagy bounded LLM-javaslat lehessen.
  - Bizonyíték: `autonomous-skill-binding.ts`, scalar LLM output parser és exact source-kind allowlist.
- [x] A validált paramétereket, policyverziót és digestet a decision recordhoz,
  event outcome-hoz és skill-runhoz kötni; üres `{}` ne legyen implicit általános
  autonóm paraméterezés.
  - Bizonyíték: schema v18 `agent_skill_dispatch`/`agent_skill_outcome`, journal `parameters`, SHA-256 binding; source nélküli dispatch elutasítva.
- [x] Goalhoz géppel ellenőrizhető completion/progress conditiont és
  `one-shot | recurring` execution policyt adni.
  - Bizonyíték: `agent_goal_execution` successful-run condition, progress, policy, cooldown és lifecycle tesztek.
- [x] Terminal skill journalból idempotensen frissíteni a goal progress/statuszt,
  majd ugyanazon persistent event útvonalon újratervezést indítani.
  - Bizonyíték: `recordSkillRunOutcome` tranzakció + `recoverGoalEventWakeups`; replay csak egy status eventet hoz létre.
- [x] Ismétlődő megélhetési célnál bounded ciklust és pihenőidőt, egyszeri
  beszerzésnél automatikus goal completiont használni.
  - Bizonyíték: fixture bootstrap/migráció: livelihood 60 s recurring, hammer `target-items=1` one-shot.
- [x] Active immediate goal hiányában policy szerint engedett, verziózott
  goal-template-ből lehessen következő célt képezni; szabad stratégiai goal-chain
  továbbra is approvalt kérjen.
  - Bizonyíték: exact policy-versionhöz kötött `goal-templates.ts`; ismeretlen chain továbbra is goal proposal approval.
- [x] Precondition failuret külön osztályozni: hiányzó input esetén acquire-input
  alternatíva, átmeneti world hiba esetén retry, tartós capability-hiánynál
  deduplikált `CapabilityGap`, jogosultsági hibánál fail-closed.
  - Bizonyíték: terminal classification teszt, egyszeri outcome-feldolgozás és deduplikáló `CapabilityGapStore.report`.

### 15.7 Hétköznapi authorization envelope

- [x] Az exact autonomous allowlistet skillverzió mellett paraméter-, item-,
  mennyiség-, partner-, egységár-, runonkénti és napi GP-limitre bővíteni.
- [x] Policy alapján engedni a hétköznapi gathering, travel, production,
  bank deposit/withdraw és NPC shop sell műveleteket.
- [x] Külön, alapból tiltott bounded envelope-ot adni kis shop buyhoz és
  player trade-hez; allowlistelt partner és eszköz nélkül maradjanak tiltva.
- [x] Approved Business policy + active employment + exact work order esetén a
  player-action accept/approve/start lépést előre delegált, egyszer használható
  authorizationnel automatizálni.
- [x] Már accepted contract bounded fizikai kötelezettségét exact obligation/run
  bindinggal végrehajthatóvá, a journal evidence beadását idempotenssé tenni.
- [x] Továbbra is explicit human approvalhoz kötni:
  - [x] skill publikálást és autonomous policy/allowlist szélesítését;
  - [x] Property vásárlást, eladást, transfer/collateral/seizure műveletet;
  - [x] nagy treasury-mozgást, hitelt, defaultot és kompenzációt;
  - [x] Business/Faction létrehozást vagy végleges lezárást;
  - [x] governance/world/mod policy aktiválását;
  - [x] bizonytalan pending purchase/escrow/settlement reconciliationt.
- [x] Minden gazdasági műveletnél megőrizni az atomi reserve/commit/release,
  idempotencia, audit és fail-closed mintát.

### 15.8 Verified skill/capability lefedettség

- [x] A meglévő tíz shared verified skillből fixture-kompatibilis exact
  allowlistet és ismert-skill kiosztást készíteni; draftot ne futtatni autonóm módon.
- [x] A meglévő Skill Builder/CapabilityGap/verifier pipeline-nal bezárni a
  következő eljárási hiányokat, új személyes RuneScape skill hozzáadása nélkül:
  - [x] bounded általános travel/meet/return;
  - [x] bank withdraw és szükséges tárgy megszerzése;
  - [x] policy-korlátos shop buy;
  - [x] input acquisition → production → output bank/sell/trade;
  - [x] crafted output eladás vagy exact partneres átadás;
  - [x] kétoldalú player trade;
  - [x] player-action request accept/execute;
  - [x] contract obligation végrehajtás és evidence;
  - [x] shortage/precondition fallback.
- [x] Megkülönböztetni a valódi procedure-gapet a parameter binding-, context-,
  policy- és lifecycle-gapektől; az utóbbiakat ne route-onkénti új skillekkel
  kerüljük meg.
- [x] Minden új paraméterkombinációt statikus validációval, izolált tesztbottal,
  két független élő evidence runnal és human verifier/publish approvalval kezelni.

### 15.9 Queue-, költség- és hibavédelem

- [x] A közös inference queue-hoz maximális backlogot, agentenkénti fair
  ütemezést, prioritást, persistált claimet és provider rate-limit backoffot adni.
- [x] Per-run limitek mellett globális fixture/szerver napi LLM-költség- és
  döntésszámkeretet bevezetni; deterministic resolution továbbra se fogyasszon
  modellkeretet.
- [x] A becsült admission költséget a tényleges provider usage-dzsal idempotensen
  egyeztetni; retry ne könyveljen kétszer.
- [x] Skill heartbeatot és world/journal progress deadline-t figyelni, a PID
  életben létét önmagában ne tekinteni haladásnak.
- [x] Failure fingerprintet, bounded retryt, exponenciális backoffot, circuit
  breakert és quarantine-t készíteni.
- [x] Ugyanazon sikertelen plan/skill ismétlése után alternatív ismert skillt,
  waitet vagy operator figyelmeztetést választani; végtelen gyors replan loopot
  teszttel kizárni.

### 15.10 Restart recovery és reconciliation

- [x] Startupkor az autonomy enrollment, bot session, supervisor process, active
  marker, skill journal, agent decision/run és domain settlement állapotát
  egyetlen reconciliation folyamban összevetni.
- [x] Terminal journalból akkor is completion/failure wake-upot képezni, ha a run
  gateway restart alatt fejeződött be.
- [x] Élő, bizonyíthatóan ugyanahhoz a runhoz tartozó skillfolyamatot adoptálni
  vagy békén hagyni; bizonytalan állapotban új skillt nem indítani.
- [x] Engine stop miatt kilépett enrolled botokat a stack visszaállása után
  bounded backoffal újraindítani, friss online state előtt nem tervezni.
- [x] Accepted work order, contract obligation, reserved treasury/escrow és
  settling payment restart után ugyanazon stabil ID-val folytatódjon.
- [x] Migrációs terv: additív, verziózott autonomy/event/run-state táblák,
  ismert régi sémáról lépésenkénti upgrade és reopen teszt.
- [x] Visszaállítási terv: writerek leállítása, adatbázismentés, függő lease-ek
  lejáratása/reconciliationje; commitolt gazdasági műveletet séma-rollback ne
  fordítson vissza, csak új auditált kompenzáció.

### 15.11 Megfigyelhetőség és operáció

- [x] Agentenként egységes timeline-t adni wake-up, context digest, decision,
  policy result, parameter binding, skill/domain action, evidence, memory/goal
  update és next wake-up eseményekkel.
- [x] Dashboardon megjeleníteni az enrolled/idle/planning/executing/backoff/
  quarantined/offline/recovering állapotot, a queue-kat, lease-eket, költséget és
  utolsó hiteles progresszt.
- [x] Külön jelezni az admin approvalra, friss state-re, capabilityre vagy
  fail-closed reconciliationre váró agentet.
- [x] A fixture külső NPC shop függőségét, bootstrap eredetű vagyonát és az
  agent↔agent/Business interakcióit elkülönített metrikában mérni.
- [x] Exportálható acceptance bundle-t készíteni manifesttel, seeddel,
  build/mod/policy verzióval, baseline digestekkel, run/event ID-kkel és
  auditlánc-ellenőrzéssel.

### 15.12 Tesztek és elfogadás

- [x] Unit tesztelni az enrollment, event dedup/lease/retry, parameter envelope,
  goal progress, backoff/quarantine, fairness és cost reconciliation határait.
- [x] Integrációs tesztben legalább két player és egy Business agent útján
  bizonyítani: work order → policy admission → exact skill → journal →
  treasury reward → goal/memory update → replan.
- [x] Restart-injection teszteket futtatni legalább az alábbi pontokon:
  event claim után, inference előtt/után, skill spawn után, terminal journal
  után, treasury reserve/engine reward között és goal update előtt.
- [x] Bizonyítani, hogy restart/replay nem duplikál skillt, coint, itemet,
  settlementet, contract evidence-et, memoryt vagy goal transitiont.
- [x] A `varrock-proto-v1` fixture-rel 60–90 perces felügyelet nélküli élő soakot
  futtatni legalább hat persistent player agenttel.
- [x] A soak közben előre tervezetten leállítani és újraindítani az engine-t és a
  gatewayt; az admin csak emergency stopot vagy bizonytalan fail-closed állapotot
  rendezzen, agentenként kézi restartot/célt ne adjon.
- [x] Agentenként legalább három terminal verified skill-runt vagy igazolt,
  backoffolt capability/precondition állapotot, továbbá kohorszszinten
  production-, shop-, bank- és legalább két player↔player vagy Business↔player
  eseményt rögzíteni.
- [x] Az acceptance bundle-ben pontos run/event/settlement ID-kkel dokumentálni a
  restart előtti és utáni folytonosságot, a limiteket és minden kézi beavatkozást.

Elfogadási bizonyíték: `phase15-soak-20260912T201229Z-a104dbef`, fixture
`varrock-proto-v1@1.5.0`, 3600,58 másodperc, 62 egészséges snapshot, tervezett
stack restart `20260912-221212` → `20260912-224302`, nem tervezett beavatkozás
nélkül. Az acceptance bundle digestje
`975ebb737bb04332c39cc80632607157e6f65df12df508a350bad25615ffc7de`; a teljes
helyi bundle a `.local/phase15-soak/phase15-soak-20260912T201229Z-a104dbef/acceptance.json`
útvonalon tartalmazza a run-, event- és settlement-azonosítókat.

Elfogadási feltétel:

> Egy reprodukálható kezdőállapotból 5–10 persistent player-agent hosszabb,
> felügyelet nélküli futásban önállóan tervez, verified skilleket választ és hajt
> végre, skill- és világ-eseményekre újratervez, gazdasági/társadalmi eseményeket
> generál, és restart után adminonkénti kézi újraindítás nélkül folytatja
> működését.

A fázis csak akkor zárható le, ha a működést a fenti determinisztikus,
restart-injection és élő soak bizonyítékok együtt igazolják. Hunger, fatigue,
sleep, housing, aging, death, item durability, új személyes RuneScape skill,
teljesen zárt gazdaság és hosszú új production chain nem lezárási előfeltétel.

## 16. Fázis – szimulációs idő és világkezdet

- [x] Külön, verziózott `SimulationClock` modellt készíteni, amely elválasztja a
  szimulációs időt a wall clocktól és az engine ticktől.
- [x] Konfigurálható időarányt adni normál játékhoz és gyorsított kísérletekhez;
  ugyanabból a seedből és időprofilból reprodukálható időbeli lefutást biztosítani.
- [x] A tartós domain-eseményekhez közös szimulációs időbélyeget és monoton
  eseménysorrendet adni anélkül, hogy a meglévő audit-időbélyegeket felülírnánk.
- [x] Meghatározni az online, offline, alvó és későbbi delegált player állapot
  időkezelési szerződését; a kijelentkezés önmagában ne legyen alvás és ne állítsa
  meg a világot.
- [x] A karakteridentitást már most életciklus-kompatibilissé tenni: születési/
  létrejöttkori szimulációs idő, aktuális életkor és lifecycle státusz tárolható
  legyen, még akkor is, ha az öregedés hatásai csak későbbi fázisban aktiválódnak.
- [x] Verziózott `WorldGenesisProfile` modellt készíteni legalább az alábbi
  kezdeti profilokra:
  - [x] `blank-slate`: meglévő világépületek, de minimális gazdasági tulajdon és
    vállalkozási állapot;
  - [x] `frontier`: alapvető eszközök, élelmiszer, lakhatás és kis kezdővagyon;
  - [x] `seeded-economy`: generált tulajdon, vagyon, szakmák, vállalkozások és
    készletek;
  - [x] `mature-society`: eltérő vagyoni rétegek, szerződések, bérletek,
    intézmények és működő gazdasági kapcsolatok;
  - [x] `historical-burn-in`: más genesis profilból induló, meghatározott ideig
    agent-only módon lefuttatott világ, amely csak ezután nyílik meg játékosnak.
- [x] A genesis eredményét seedhez, konfigurációhoz és digesthez kötni, hogy ugyanaz
  a világkezdet reprodukálható legyen.
- [x] A bootstrapként létrehozott pénzt, tárgyat, ingatlant és vállalkozási vagyont
  külön genesis eredetként megjelölni, hogy később ne keveredjen a gazdaság által
  ténylegesen előállított értékkel.
- [x] A world genesishez dry-run előnézetet, admin indítást, resetet és tesztet adni.

Elfogadási feltétel: ugyanabból a seedből és genesis profilból reprodukálható
világ indul, a szimulációs idő az engine/wall clocktól külön kezelhető, és minden
későbbi időfüggő domain ugyanarra a kanonikus időforrásra tud épülni.

## 17. Fázis – adottságok, potenciál és személyes kompetencia

- [x] A RuneScape skillektől külön `AttributeProfile` modellt készíteni 5–6
  alapadottsággal; kezdeti jelöltek: `intellect`, `dexterity`, `vigor`,
  `endurance/vitality`, `perception`, `social/will`.
- [x] Az NPC-k teljes induló attribute-pontkeretét ne fixen, hanem konfigurálható,
  seedelt és korlátozott statisztikai eloszlásból generálni, hogy létezzenek
  veleszületetten kedvezőbb és kedvezőtlenebb adottságú karakterek.
- [x] A generált teljes pontkereten belül seedelt elosztást készíteni úgy, hogy ne
  minden karakter optimalizált buildet kapjon; generalista és erősen specialista
  profilok egyaránt létrejöhessenek.
- [x] Human player karakteralkotáshoz külön world policyt adni: a kiosztható
  pontkeretet és az elosztást a játékos maga választhassa, vagy opcionálisan ugyanaz
  a genetikai lottó vonatkozhasson rá, mint az NPC-kre.
- [x] Külön kezelni a három eltérő fogalmat:
  - [x] RuneScape skill = személyes, 1–99 jellegű kompetencia;
  - [x] verified agent skill = végrehajtható, megtanult eljárás;
  - [x] facility/organizational capability = infrastruktúra vagy szervezet által
    biztosított effektív képesség.
- [x] `SkillPotentialProfile` modellt készíteni, amely az attribute-okból,
  konfigurálható skill-specifikus súlyokból és opcionális egyéni talent
  komponensből képez tanulási szorzót és személyes potenciált/plafont.
- [x] A személyes skillplafon legalább négy policyját támogatni: klasszikus 99,
  adottságfüggő kemény plafon, adottságfüggő puha plafon és facility-központú
  alacsonyabb személyes plafon.
- [x] Első vertikális szeletként csak néhány meglévő skillre – például Fishing,
  Cooking, Mining és Smithing – bekötni a potenciált; a többi skill maradjon
  vanilla viselkedésű, amíg külön nem validáltuk.
- [x] A tanulási és plafonhatásokat verziózott profilként, telemetriával és
  kontroll–kezelés kísérlettel mérhetővé tenni.
- [x] Új személyes skill bevezetését külön döntési kapuhoz kötni: csak akkor
  kerüljön be például engineering vagy machining, ha a kívánt képesség nem
  modellezhető ésszerűen meglévő RuneScape skill + verified procedure + facility
  capability kombinációval.

Elfogadási feltétel: két azonos tapasztalatú karakter eltérő veleszületett
adottságok miatt eltérő tanulási pályát és potenciált kaphat, miközben az agent
eljárások és a facility-képességek továbbra is külön fogalmak maradnak.

## 18. Fázis – szükségletek, alvás és lakhatás

- [x] Külön `needs` modot készíteni, elsőként legalább `hunger` és `fatigue`
  állapottal; thirst, stress és további szükségletek későbbi bővítésként jöhessenek.
- [x] A szükségletek romlását a `SimulationClock` alapján számolni, konfigurálható
  offline és alvási szabályokkal.
- [x] Az alapvető önfenntartást determinisztikus rutin kezelje: kritikus éhségnél
  rendelkezésre álló étel fogyasztása, kritikus fáradtságnál megfelelő alvóhely
  keresése; ehhez normál esetben ne kelljen LLM-hívás.
- [ ] Az alvást külön domainállapotként kezelni a logouttól:
  - [ ] NPC-agent fizikailag alvó állapotba kerül és a világ tovább fut;
  - [ ] human player engedélyezett alvóhelyen alvást indíthat és kijelentkezhet;
  - [ ] a teljes világ ideje ne ugorjon előre attól, hogy egy vagy több játékos alszik;
  - [ ] későbbi opcionális `offline-delegated` mód számára előkészíteni a policyhatárt,
    de az offline avatárt alapból ne vegye át szabad LLM-agent.
- [ ] A lakhatást biztonsági és komfort-hierarchiaként modellezni, például:
  utca → ideiglenes menedék → közös hálóterem → bérelt szoba → saját lakás/ház →
  erősen védett ingatlan.
- [ ] A lakhatási szint befolyásolja legalább a fatigue-regenerációt, a privát
  storage lehetőségét és a lopással szembeni védelmet.
- [ ] A meglévő Property domainre külön `HousingUnit`/`BedSlot` és tenancy
  réteget építeni kapacitással, bérleti díjjal, időtartammal, hátralékkal és
  lejáró belépési entitlementtel.
- [ ] Elsőként meglévő, használható vagy üres világépületeket kijelölni Varrockban,
  Lumbridge-ben és/vagy Faladorban, és azokba konfigurált ágy-/férőhely-kapacitást
  tenni; új épület létrehozása ne legyen MVP-feltétel.
- [ ] Egyszerű berendezési rendszert tervezni, amelyben megvásárolt ágy, chest,
  asztal vagy más engedélyezett bútor Propertyn belül elhelyezhető és domain-
  capabilityt ad; ne legyen kötelező a későbbi RuneScape Construction mechanika
  közvetlen lemásolása.
- [ ] A későbbi földvásárlás → építkezés → új épület útját külön extensionként
  előkészíteni Property/land parcel hivatkozásokkal, de az első lakhatási MVP-t
  meglévő épületekkel lezárni.

Elfogadási feltétel: egy agentnek rendszeresen ennie és aludnia kell; az utca,
közös szállás és privát lakhatás mérhetően eltérő regenerációt és vagyonbiztonságot
ad, a human player alvása pedig nem állítja meg vagy gyorsítja globálisan a világot.

## 19. Fázis – fogyasztás, tárgyélettartam és első zárt gazdasági körök

- [ ] A Fishing/Farming → Cooking → Food → hunger csökkentés láncból elkészíteni az
  első valódi nyersanyag → feldolgozás → végső fogyasztás gazdasági kört.
- [ ] Az élelmiszer-fogyasztást hiteles gazdasági eseményként naplózni, hogy a
  termelés és a végső felhasználás külön mérhető legyen.
- [ ] `item-lifecycle` modot készíteni tartósságra, használati kopásra, javításra,
  törésre és későbbi minőség/eredet támogatására.
- [ ] Eldönteni és dokumentálni, mely tárgyak igényelnek itempéldány-szintű
  állapotot és melyek kezelhetők továbbra is stackként vagy gyártási tételként.
- [ ] Első vertikális szeletként egyetlen termelőeszköz-típuson végigvinni a
  használat → kopás → javítás vagy csere teljes ciklust.
- [ ] A javítás valódi inputot, időt, személyes kompetenciát és szükség esetén
  facility-hozzáférést igényeljen; ne legyen ingyenes durability-reset.
- [ ] A késztermékek gazdasági hasznát tényleges mechanikai hatásból képezni:
  termelékenység, hozzáférhető capability, minőség, kapacitás vagy élettartam;
  ne pusztán mesterséges statikus „capital value” mező tegye őket értékessé.
- [ ] Későbbi romlandó élelmiszer és tárolási minőség számára batch/expiry
  szerződést előkészíteni, de csak az első zárt food + tool loop stabilitása után
  aktiválni.
- [ ] A loopokhoz készlet-, hiány-, fogyasztási és replacement-rate metrikát adni.

Elfogadási feltétel: legalább egy élelmiszer és egy termelőeszköz olyan zárt
keresleti körben működik, ahol a készterméknek tényleges fogyasztója vagy
termelési funkciója van, nem pusztán XP-ért gyártják.

## 20. Fázis – agentizált gazdaság és Business 2.0

- [ ] A gazdaságilag jelentős statikus NPC-k – különösen shopkeeper-ek és más
  szolgáltatók – kiváltásához migrációs stratégiát készíteni agent + Business +
  Property + inventory + treasury modellre.
- [ ] Az ambient `Man`/`Woman` jellegű járókelőket, állatokat és mobokat ne kelljen
  automatikusan tartós gazdasági agentté alakítani; csak az kapjon teljes actor-
  identitást, akinek a szimulációban gazdasági vagy társadalmi állapota van.
- [ ] Zárt társadalmi profilban megszüntetni a végtelen készletű és végtelen pénzű
  NPC shopot; minden eladható készletnek és minden kifizetésnek valódi actor-
  inventory/treasury forrása legyen.
- [ ] A genesis alatt seedelt boltot, készletet vagy vagyont külön bootstrap
  eredettel létrehozni, de a futó világban ne töltődjön újra indoklás nélkül.
- [ ] A jelenlegi `manager | worker` MVP fölé adatvezérelt
  `BusinessRoleDefinition` modellt készíteni stabil szerepazonosítóval, névvel,
  engedélyezett verified skillekkel, készlet-/storage-/treasury-/ár-/szerződés-
  jogosultságokkal és delegálási/felvételi policyval.
- [ ] Business inventory- és storage-modellt adni, amely elválik a tulajdonos vagy
  manager személyes inventoryjától.
- [ ] Beszerzési, készletminimum-, árképzési és értékesítési policyt adni úgy, hogy
  az institution agent magas szintű döntést hozzon, a konkrét árumozgatást pedig
  player/avatar verified skill vagy hiteles settlement végezze.
- [ ] Fizetett munkát, műszakot, munkaidőt, work ordert és facility-/Property-
  entitlementet a role-hoz kötni.
- [ ] Elsőként legalább egy teljesen agentek által működtetett üzletet vagy
  vendéglátóhelyet élőben működtetni: beszerzés → készletezés → értékesítés → bér/
  profit → újrarendelés.
- [ ] A statikus NPC shop fallbacket külön world policyként megtartani fejlesztői
  vagy klasszikus játékmódhoz, de a társadalomszimulációs profilban kikapcsolhatónak
  kell lennie.

Elfogadási feltétel: legalább egy korábbi NPC-szolgáltatás valódi agentekkel és
Business domainnel működik, készlete és pénze véges, és a zárt gazdasági profil
nem igényel végtelen NPC shop injekciót az adott szolgáltatáshoz.

## 21. Fázis – adatvezérelt termelés, facilityk, logisztika és tőke

- [ ] Általános, verziózott `ProductionRecipe` és több lépcsős `ProductionWorkflow`
  modellt készíteni inputtal, outputtal, idővel, személyes skillkövetelménnyel,
  facility-, tool-, knowledge- és jogosultsági követelménnyel.
- [ ] A recept ugyanazzal a keretrendszerrel tudjon egyszerű és hosszabb láncot
  kezelni, például food, ore → bar, bar → tool és később alkatrész → gép.
- [ ] `FacilityCapability` modellt készíteni Propertyhez vagy Businesshez kötött
  képességekkel, például `smithing.basic-forging`, `storage.secure`,
  `cooking.commercial-kitchen` vagy később `machining.precision-1`.
- [ ] A facility-hozzáférést munkaviszonyhoz, bérlethez, szerződéshez vagy explicit
  entitlementhez kötni; a magas személyes skill önmagában ne helyettesítse a
  szükséges infrastruktúrát.
- [ ] Gépet és más termelőtőkét olyan tárgyként/facility-komponensként modellezni,
  amely tényleges throughput-, minőség-, hibaarány-, kapacitás- vagy capability-
  hatást ad, és maga is kopik/karbantartást igényelhet.
- [ ] A késztermék tőkeértékét elsősorban ebből a hasznosságból és a piaci
  eredményekből mérni; külön telemetriai értékelés lehet, de ne ez diktálja
  közvetlenül a gameplay árat.
- [ ] Business storage-, inputfoglalás- és work-in-progress állapotot adni, hogy
  több lépcsős workflow közben ne lehessen ugyanazt az inputot kétszer felhasználni.
- [ ] Logisztikai domain-MVP-t készíteni kapacitással, útvonallal, szállítási
  idővel és költséggel; elsőként gyalogos/futár és egy nagyobb kapacitású
  szállítóeszköz vagy konténer modelljével.
- [ ] A szekér, hajó vagy más szállítóeszköz használatát Business-role és
  Property/storage entitlementhez kötni.
- [ ] Első hosszabb termelési prototípust a meglévő RuneScape skillekre építeni;
  például érc → fém → szerszám/facility-upgrade. Engineering/machining csak akkor
  legyen új személyes skill, ha ezt a fázis tapasztalata ténylegesen indokolja.
- [ ] Legalább egy olyan tőkeberuházást megvalósítani, amely mérhetően javít egy
  Business későbbi termelékenységén és így valódi beruházási döntést teremt.

Elfogadási feltétel: egy Business több lépcsős, adatvezérelt workflowban képes
inputot vásárolni, facilityt és dolgozókat használni, készterméket előállítani és
legalább egy olyan tőkeeszközt alkalmazni, amely mérhető termelési előnyt ad.

## 22. Fázis – tulajdonvédelem, bűnözés és igazságszolgáltatás

- [ ] Az item-, storage- és Property-tulajdon, valamint a belépési entitlement
  megsértéséből egységes, hiteles jogsértési eseményt képezni.
- [ ] A meglévő Thieving RuneScape skillt kiterjeszteni több verified eljárásra,
  például pickpocket, lockpick, property burglary, container theft és későbbi
  orgazdasági/fence folyamatokra; ne készüljön külön „Burglary” személyes skill.
- [ ] Zár- és storage-biztonsági szinteket adni, amelyek a lakhatási hierarchiával
  együtt működnek: utcán alvó személy, közös lockbox, privát szoba és védett
  ingatlan eltérő támadási felület legyen.
- [ ] Tanú-, észlelés-, tárgyi nyom- és evidence-ledger eseményeket készíteni úgy,
  hogy a bűncselekmény ténye és annak bizonyítottsága külön állapot legyen.
- [ ] A már meglévő Faction/Jurisdiction szabályaihoz verziózott crime policyt
  kapcsolni joghatóságonként eltérő szabályokkal.
- [ ] Feljelentés, elfogás, bírság, kártérítés, vagyon-visszaadás és egyszerű
  börtön/korlátozás MVP-t készíteni auditált, idempotens állapotátmenetekkel.
- [ ] Az LLM legfeljebb javaslatot vagy intézményi döntés-előkészítést adhasson;
  vagyonelvonás, bebörtönzés vagy halál kizárólag validált policy és hiteles
  evidence alapján történhessen.
- [ ] A bűnözői stratégia jövedelmét, lebukási kockázatát, károkozását és
  visszaesését mérhetővé tenni.

Elfogadási feltétel: egy agent képes betörni vagy lopni a Thieving skillre és
verified eljárásra támaszkodva, a tulajdonátruházás nem tárgyteremtés, és a
jogsértésből bizonyíték-, joghatósági és szankciós lánc képezhető.

## 23. Fázis – népességéletciklus, öregedés, egészség, halál és öröklés

- [ ] A társadalomszimulációs world profile-ban a karaktert véges életű
  `PopulationMember` lifecycle-hoz kötni; klasszikus respawn csak külön
  kompatibilitási/kísérleti policy legyen.
- [ ] Születési időből számolt életkort és konfigurálható életkori szakaszokat
  bevezetni; az öregedés ne csak UI-adat legyen, hanem később módosíthassa például
  regenerációt, munkaterhelést vagy kockázatot.
- [ ] Seedelt, korlátozott egyéni élettartam-/halálozási hajlamot készíteni úgy,
  hogy a halál ne egyetlen fix életkorban történjen.
- [ ] Sérülés- és health domain-MVP-t készíteni hiteles állapottal, gyógyulással,
  kezelés- és pihenésigénnyel; a medicine első változata lehet meglévő Herblore +
  facility + verified treatment, nem szükséges rögtön új személyes skill.
- [ ] Hiteles haláleseményt és lezárt avatar/player-agent lifecycle-t készíteni,
  amely után az agent nem hajthat végre új fizikai műveletet.
- [ ] A halálkor nyitott szerződéseket, munkaviszonyt, Business-szerepet,
  treasury-jogosultságot, hitelt, tartozást és Propertyt rendező estate folyamatot
  készíteni fail-closed módon.
- [ ] Hagyaték- és öröklési policyt adni faction/jurisdiction szabályhoz köthetően;
  első MVP-ben adminnal vagy egyszerű előre kijelölt örökössel is működhessen.
- [ ] Az agent episodic/social memóriáját archiválni; semantic vagy szervezeti tudás
  csak explicit tanulási/öröklési szabály alapján kerülhessen másik agenthez.
- [ ] Új népességi belépők generálásának absztrakcióját elkészíteni, hogy a véges
  populáció ne csak kihalni tudjon. Az első változat lehet seedelt új NPC-belépés;
  tényleges család/reprodukció külön későbbi modul maradhat.
- [ ] Demográfiai metrikákat adni: korstruktúra, születés/belépés, halál,
  szakembervesztés, vagyonöröklés és munkaerő-utánpótlás.

Elfogadási feltétel: a társadalomszimulációs profil karakterei öregszenek és
végleg meghalhatnak, a halál nem hagy árva gazdasági állapotot, és a populáció
utánpótlásának legalább egy determinisztikus mechanizmusa létezik.

## 24. Fázis – önfenntartó társadalom és hosszú távú kísérletek

- [ ] Definiálni az „önfenntartó társadalom” mérhető minimumát: a bootstrap után
  a populáció meghatározott ideig képes legyen legalább élelmet, alvást/lakhatást,
  alapvető eszközpótlást és munkamegosztást fenntartani indokolatlan gazdasági
  injekció nélkül.
- [ ] A társadalomszimulációs profilban minden bootstrap pénzt/tárgyat külön
  genesis eseményként kezelni; futás közbeni admin- vagy fallback-injekciót
  automatikusan jelölni és a tiszta kísérletet opcionálisan érvényteleníteni.
- [ ] Self-sufficiency mutatókat készíteni legalább food, tool/maintenance,
  housing és fő inputkategóriák szerint.
- [ ] Ha egy world profile explicit külső kereskedelmet enged, azt külön
  import/export domainként mérni; ne végtelen NPC shop legyen a külső gazdaság.
- [ ] Gazdasági függőségi gráfot képezni hiteles tranzakciókból és termelési
  eseményekből agent-, Business- és termékszinten.
- [ ] Mérni a kritikus szereplőket, single-point-of-failure termékeket,
  supply-chain mélységet, termelési koncentrációt és egy Business/agent kiesésének
  tovagyűrűző hatását.
- [ ] A meglévő Phase 12 kísérleti infrastruktúrára hosszabb futásokat építeni
  azonos genesis seed, attribute-eloszlás, populáció és world policy mellett.
- [ ] Összehasonlítani legalább:
  - [ ] eltérő attribute/potential eloszlásokat;
  - [ ] diminishing XP be/ki állapotot;
  - [ ] eltérő facility-előnyt;
  - [ ] blank-slate, seeded és historical-burn-in világkezdetet;
  - [ ] eltérő housing/need szigorúságot;
  - [ ] mortalitással és kontrollként mortalitás nélkül futó profilt.
- [ ] A „jó társadalom” értékelését többcélú metrikaként kezelni: túlélés,
  önfenntartás, specializáció, mobilitás, vagyoneloszlás, árstabilitás,
  munkanélküliség, innováció/beruházás, bűnözés és rendszerkockázat.
- [ ] Az aggregált metrikából exact eseményekig lefúrható dashboardot készíteni
  agent-, Business-, termék-, régió- és idődimenzióval.
- [ ] Dokumentált társadalmi benchmark futást, exportot, visszaállítást és
  reprodukciós folyamatot készíteni.

Elfogadási feltétel: legalább egy seedelt agentpopuláció hosszabb, reprodukálható
futásban képes alapvető szükségleteit és termelőeszközeit belső gazdasági
kapcsolatokkal fenntartani, és a rendszer megmutatja, hol és miért válik függővé,
instabillá vagy önfenntartóvá.

## 25. Fázis – több-szerveres admin vezérlőközpont

- [ ] Az adminfelületet a játékszerver-folyamattól független control plane
  szolgáltatásként futtatni, hogy leállított engine mellett is elérhető maradjon.
- [ ] Bejelentkezést, felhasználói fiókot és tulajdonosi jogosultságokat készíteni.
- [ ] Szerverregisztert és „Saját szervereim” kezdőoldalt létrehozni.
- [ ] Új szerver létrehozása, verzió-/világsablon-választás, indítás, leállítás,
  újraindítás és archiválás felületről.
- [ ] Minden szerverhez elkülönített portokat, folyamatokat, adatbázist, mentéseket,
  botokat, modokat, LLM-konfigurációt, titkokat és auditnaplót biztosítani.
- [ ] A jelenlegi bot-, world-, property-, gazdasági és AI-admin nézeteket
  kötelező szerverkontextus alá helyezni.
- [ ] Titkokat operációsrendszer- vagy szolgáltatói titoktárban tárolni; az admin
  csak állapotot lásson, a kulcsok visszaolvasását ne engedje.
- [ ] Folyamatfelügyeletet, health checket, ütközésmentes portfoglalást,
  migrációt, backupot és hibából visszaállást készíteni.
- [ ] Későbbi távoli eléréshez TLS-t, CSRF-védelmet, rate limitet, session-kezelést
  és szerepköralapú engedélyezést bevezetni.

Elfogadási feltétel: egy bejelentkezett felhasználó két, egymástól teljesen
elkülönített szervert létrehoz, külön beállít, elindít és leállít úgy, hogy az
admin control plane mindkét engine leállítása közben is elérhető marad.

## 26. Fázis – admin UX és backend–frontend képességparitás

- [ ] A teljes adminfelület információs architektúráját felhasználói célok és
  végrehajtható workflowk szerint átszervezni; a belső backend-domainnevek ne
  legyenek a felület megértésének előfeltételei.
- [ ] Verziózott capability-mátrixban minden támogatott backend-művelethez
  felületi belépési pontot, jogosultságot, előfeltételt, állapotot, eredményt és
  hibamegjelenítést rendelni; az árva backend- és frontend-képességeket teszttel
  kimutatni.
- [ ] A veszélyes vagy emberi jóváhagyást igénylő műveleteknél pontosan leírni,
  mi változik, milyen bizonyíték alapján, mi nem történik meg, és hogyan lehet
  visszaállni vagy újrapróbálni.
- [ ] Minden hosszabb művelethez látható indítási visszaigazolást, futási
  állapotot, befejezést és diagnosztizálható hibát adni. Külön regresszióként
  lefedni a Kísérletek néma indítását: a megerősítés után jelenjen meg a futás,
  vagy egy konkrét, teendőt is tartalmazó hiba.
- [ ] Beépített, rövid ellenőrzési útmutatót és kontextusos magyarázatot adni a
  ritkán használt workflowkhoz, hogy a felhasználónak ne kelljen a backend
  felépítését ismernie egy funkció kipróbálásához.
- [ ] A kritikus admin-workflowkat böngészős end-to-end és API/UI contract
  tesztekkel lefedni, beleértve az üres, betöltési, siker-, részleges és
  hibaállapotokat.
- [ ] Az egységesítés végén használhatósági, hozzáférhetőségi, reszponzív és
  capability-paritási auditot futtatni, majd minden feltárt hiányt lezárni.

Elfogadási feltétel: a backend minden támogatott admin-képessége megtalálható és
érthetően használható a felületen, minden felületi művelet látható eredménnyel
vagy teendőt adó hibával zárul, és egy új felhasználó külön fejlesztői segítség
nélkül végre tudja hajtani a dokumentált alap-workflowkat.
