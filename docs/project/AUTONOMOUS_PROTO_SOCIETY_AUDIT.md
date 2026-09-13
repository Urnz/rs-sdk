# Autonóm proto-társadalom – capability- és integrációs audit

Állapotdátum: 2026-09-08

## Hatókör és módszer

Az audit a 0–14. fázis dokumentációját és a tényleges futási útvonalakat vizsgálta.
Az értékelés nem a checkboxokból indult ki, hanem külön ellenőrizte az
`agent-state`, `llm-runtime`, `agent-skills`, a gateway supervisor/replanning
réteg, valamint a Property, Business, contract, treasury, bank, governance,
World Director és multi-agent kísérleti implementáció kapcsolódási pontjait.

Az értékelésben a „domain létezik” nem jelenti automatikusan azt, hogy a player
agent látja, dönthet róla, végre tudja hajtani, vagy folyamatos lifecycle-ban
használja.

## Vezetői összegzés

A rendszer már rendelkezik az autonóm proto-társadalom legtöbb biztonságos
építőelemével: persistent agent identity és memória, szűk verified skill runtime,
friss élő megfigyelés, determinisztikus és LLM planner, közös inference queue,
event gate, decision ledger, skill-exit esemény, atomi treasury/escrow/settlement,
valamint több külön gazdasági domain. Egy exact avatarhoz kötött player agent
manuális vagy külső eseményből már képes egy allowlistelt verified skillt
automatikusan elindítani, majd ugyanabban a gateway-életciklusban a skill
befejezése vagy hibája után újratervezni.

Ez azonban még nem határozatlan idejű autonóm runtime. Nincs tartós autonóm
enrollment, idle/due-agent scheduler, startup recovery vagy teljes domain-event
inbox/outbox. A replan gate cooldownja és deduplikációja memóriában él, az
inference queue folyamaton belüli egyszerű sor, a supervisor bot- és skillfolyamatai
nem adoptálhatók újra restart után. A jelenlegi automatikus planner csak player
agentet futtat; a Business/Faction agent portjai nem részei egy futó döntési
lifecycle-nak. A normál gazdasági ajánlatok, contractok és player-megbízások
szintén admin útvonalon állnak meg.

A legfontosabb következő lépés ezért a meglévő runtime és domainek integrálása,
nem új needs-, idő-, aging-, durability- vagy production domain létrehozása.

## Capability-mátrix

Jelölések: **igen** = ténylegesen bekötött; **részben** = létező, de szűk vagy
kézi útvonal; **nem** = nincs használható integráció.

| Capability | Domain létezik | Agent látja | Agent dönthet róla | Végrehajtható | Folyamatos autonóm loop |
| --- | --- | --- | --- | --- | --- |
| Persistent identity, célhierarchia | igen | igen | részben | igen | részben |
| Working/episodic/semantic/social memória | igen | igen | igen | automatikus ingestion | részben |
| Élő avatarhelyzet érzékelése | igen | részben | igen | n/a | csak eseménykor |
| Determinisztikus immediate-goal planner | igen | igen | igen | igen | esemény esetén |
| LLM magas szintű planner | igen | igen | igen | policy után | esemény esetén |
| Verified skill végrehajtás | igen | igen | igen | igen | skill-exit láncban részben |
| Idle/startup wake-up | nem | nem | nem | nem | nem |
| Skill completion/failure wake-up | igen | igen | igen | igen | csak az aktuális gateway által indított runnál |
| Goal completion és automatikus célhaladás | ledger létezik | részben | részben | admin/manual | nem |
| Resource gathering és fix útvonal | igen | igen | igen | igen | allowlisttel igen |
| Shop sell/pénzkeresés | igen | igen | igen | igen | allowlisttel igen |
| Shop buy/beszerzés | igen | igen | igen | csak approval/manual | nem |
| Tárgybankolás | igen | részben | részben | igen | csak fix, defaultos skillben |
| Production | szűk MVP | igen | igen | carried inputból igen | inputpótlás nélkül nem |
| Player trade | szűk MVP | részben | részben | explicit partnerrel igen | policy tiltja |
| Player-action munka | igen | admin contextben igen | playernél részben | admin approval után igen | nem |
| Business/foglalkoztatás | igen | admin viewban igen | institution porton igen | admin/policy kapukkal | institution loop nincs |
| Ajánlat és contract | igen | plannerben nem | agent runtime-ban nem | adminból igen | nem |
| Property | igen | assetként igen | planner-eszközként nem | játékból/adminból igen | nem |
| Gazdasági bank/hitel | institution MVP | player agent nem | runtime-ban nem | domain serviceből | nem |
| Faction/jurisdiction/adó | igen | faction porton igen | inert javaslatig | admin/domain service | institution loop nincs |
| World Director | igen | külön runtime | seedelt választás | világjelzésig igen | saját schedulerben igen |
| Multi-agent futás | igen | igen | egy dispatch-döntés | párhuzamosan igen | futásonként egy ciklus |
| Gazdasági telemetria | igen | contextben csak részben | nem művelet | automatikus ingestion | igen |
| Engine/gateway restart utáni folytatás | részben | részben | nem | kézi helyreállítással | nem |

## Mi működik ténylegesen

### Persistent agent és biztonságos döntés

- Az `AgentStateStore` tartósítja az identitást, a négyszintű célhierarchiát,
  az ismert exact skillverziókat, memóriát, actor-linkeket, control profile-t,
  player-action queue-t és döntési ledgert.
- A goal-, identity- és control-profile írások optimista revízióval működnek. A
  döntési admission egy SQLite tranzakcióban ellenőrzi a napi döntésszámot,
  LLM-költséget és operatív GP-keretet.
- Az episodic/semantic/social ingestion újranyitás és ismételt scan mellett
  idempotens, és a hiteles skill-journalból automatikusan épít memóriát.

### Player agent plan → skill útvonal

A tényleges automatikus út:

1. egy megfigyelt vagy admin/kísérleti esemény belép az `AgentReplanCoordinator`-ba;
2. az in-memory event gate deduplikál és cooldownoz;
3. a gateway friss online avatarstate-ből working memoryt ír;
4. a determinisztikus resolver először exact ismert skillt keres;
5. szükség esetén a közös process-local inference queue futtatja az LLM plannert;
6. az exact autonomous allowlist, verified státusz és operation/time limit kapu dönt;
7. a `BotSupervisor` külön processben elindítja a meglévő skill executort;
8. a journal és process exit gazdasági/memória ingestiont és új replan eseményt indít.

Ez a lánc valós implementáció, de csak akkor, ha az agent player role-ú, exact
avatarbindingja van, online/friss, van használható célja, a konfigurációban az
automatic replanning és autonomous execution engedélyezett, és a skill exact
allowlisten szerepel. Az alapkonfigurációban mindez ki van kapcsolva és az
allowlist üres.

### Atomi gazdasági domainek

- A Property purchase player inventory coinból, engine-ticken, autosave-val,
  idempotenciával és pending-reconciliationnel működik. Játékban a helyszíni
  signról is végrehajtható.
- A Business domain stabil identitást, owner/property hivatkozást, manager/worker
  employmentet, wage-et, inert policy proposal-t és jóváhagyott policyt kezel.
- A player-action queue exact assignee/skill/parameter/run kötést, treasury
  reserve/commit/release-t és engine által igazolt player rewardot ad.
- Az ajánlat/contract domain exact felekkel, digestelt feltételekkel, player
  escrowval, institution treasury settlementtel és immutable evidence-szel működik.
- A banking MVP institution-only, hiteles event és settlement receipt mögött
  betétet, kamatot, hitelt, fedezetet és auditláncot kezel.
- A Governance domain hierarchikus jurisdictiont, treasuryt, budgetet, policyt,
  obligationt, collectiont és lifecycle-t tartósít.

Ezek általánosan használható domain-infrastruktúrák, de többségüknek nincs
autonóm player/institution decision adaptere.

## Mi csak izolált vagy adminvezérelt MVP

### Az agent tényleges érzékelése szűkebb a domainmodellnél

Az automatikus LLM request working memoryje pozíciót, activityt, HP-t, run
energyt, legfeljebb öt inventory-sort, három közeli NPC-t, három közeli objektumot
és két game message-et lát. Az asset context pénzt, Propertyt, kapcsolatból
származó tartozást és vállalást ad, de nem ad teljes inventoryt, bankot, skilleket,
shopárakat, nyitott gazdasági ajánlatokat, contractokat vagy kereshető
lehetőségeket.

A `listAdminAgents()` által felépített admin `decisionContext` tartalmaz control
profile-t, player-action queue-t, treasuryt és Business-vetületet. A tényleges
`runAdminLlmDryRun()` azonban új contextet épít, és ezeket nem adja át. Ezért a
dokumentált „agent látja a megbízásokat és a Business állapotát” állítás az admin
nézetre igaz, a futó automatikus LLM plannerre jelenleg nem.

### Institution agentek

A Business- és Governance-portok szűk, típusos és helyesen fail-closed adapterek.
Az automatikus replan runtime ugyanakkor minden avatár nélküli és minden nem-player
agentet `skipped` eredménnyel lezár. Nincs scheduler, amely institution agent
cadence alapján döntést kérne, majd a domain toolokat meghívná. A World Director
külön schedulerrel rendelkezik, de csak approved sablonból globális világjelzést
küld; nem helyettesíti az általános institution runtimet.

### Multi-agent kísérlet

A kohorsz dispatcher egyszerre több exact player agentnek küld egy-egy
`manual-request` eseményt, majd a hozzájuk tartozó egy skill-run lezárását méri.
Ez reprodukálható E2E és jó mérési infrastruktúra, de nem hosszú életű
multi-agent supervisor. A kísérlet maga nem indít újabb ciklust, nem állítja
automatikusan a célokat, és nem éleszti újra az agenteket restart után.

## Az autonóm lifecycle konkrét hiányai

### 1. Tartós enrollment és supervisor

Nincs tartós rekord arról, hogy mely agentek legyenek autonómak, milyen world
profile-ban, milyen policyverzióval és kívánt runtime állapottal. A gateway nem
enumerálja és nem ébreszti a friss, idle agenteket. A bot supervisor processlistája
memóriában él; az adminból indított botokat gateway restart után nem adoptálja.
A lite runner gatewayt újracsatlakoztat, de engine session megszűnésekor kilép,
és a helyi indító alapból csak egy botot indít.

Szükséges: a meglévő control profile mellé kis, verziózott autonomy enrollment,
desired/running/paused/quarantined állapot, lease és next-wakeup; startupkor
reconcile, majd due/idle agentek ébresztése. Ez a meglévő supervisor és replan
coordinator fölötti tartós réteg legyen, ne második agent runtime.

### 2. Tartós eseménykézbesítés és wake-up lefedettség

Jelenleg a skill exit, death/trade-request, aggregate economy, goal-admin-change és
capability-ready események léteznek. Hiányzik vagy nem általános:

- első indulás és idle-agent wake-up;
- bot reconnect/fresh-state wake-up;
- rendes goal completion/block/abandon eseményből automatikus továbbhaladás;
- gazdasági offer/contract lifecycle esemény;
- player-action request/accept/settlement esemény;
- Business employment/policy/work-availability esemény;
- Property és releváns Governance/world esemény;
- gateway restart alatt befejezett skill vagy megérkezett domain-esemény replaye.

Az event gate `seen` és cooldown mapje process-local, a replan log append-only
JSONL, nem feldolgozási inbox/outbox. Restart után a deduplikáció elveszik, a
függő eventek nem játszódnak vissza. Szükséges tartós event inbox, stable source
key, claim/lease, outcome, retry time és dead-letter/quarantine; az események
továbbra is ugyanazon `AgentReplanCoordinator` kapun menjenek át.

### 3. Skill- és goal-lifecycle

A normál active immediate goal nem rendelkezik géppel ellenőrizhető completion
conditionnel. A sikeres skill-run nem zárja vagy frissíti automatikusan a célt,
ezért a következő skill-finished esemény tipikusan ugyanazt a skillt indítja újra.
Ez ismétlődő megélhetési célnál hasznos lehet, egyszeri beszerzésnél vagy contract
teljesítésnél viszont hibás.

Szükséges: goalhoz kötött bounded completion/progress evidence, recurring vs
one-shot policy, journalból idempotens goal transition, majd `goal-changed`
wake-up. A postcondition és a következő cél kiválasztása ne az LLM szabad
szövegéből történjen.

### 4. Paraméterezett verified skillek

Az LLM decision schema csak `skillId` és `version` értéket választ. Az automatikus
runtime minden skillt üres `{}` paraméterrel indít. Emiatt a required partner-,
item-, koordináta- vagy work-order paraméterrel rendelkező reusable skillek nem
használhatók autonóm módon. A fix route skillek azért működnek, mert minden
paraméterüknek van defaultja.

Szükséges: típusos, sémavalidált parameter binding a goalból, megbízásból vagy
policyból; az LLM legfeljebb az engedélyezett bounded mezőkre tegyen javaslatot.
Az exact validált binding és digest kerüljön a decision ledgerbe és a runba.

### 5. Queue, limitek és fairness

A közös inference queue sorosít, de nincs tartós backlog, maximális queue-hossz,
agentenkénti fairness, prioritás, lease vagy restart recovery. A per-run LLM limit
és az agentenkénti napi decision/LLM/GP limit működik, de az automatikus planner a
becsült maximális LLM-költséget előre könyveli, a tényleges provider usage-t nem
egyezteti vissza; nincs teljes proto-society szintű napi költségkeret.

Szükséges: bounded admission, globális és agentenkénti limit, fair queue,
provider rate-limit backoff, tényleges cost reconciliation és admin emergency
stop. A deterministic resolution maradjon zéró LLM-költségű gyors út.

### 6. Stuck és failure kezelés

A skill executor bounded timeouttal, operation limittel és journal eseményekkel
rendelkezik, de a supervisor nem figyeli a marker heartbeatját vagy a world-state
progresszt. Ismételt skill-failure minden alkalommal sürgős replant válthat ki;
nincs failure fingerprint, exponenciális backoff, circuit breaker vagy agent
quarantine. A friss state hiánya egyszerű `skipped`, tartós retry szándék nélkül.

Szükséges: skill/run heartbeat és progress deadline, ugyanazon failure
fingerprint számláló, bounded retry/backoff, alternatív skill/cél választás,
quarantine és egyértelmű operator alert. A fail-closed pénzügyi
reconciliation továbbra is kézi maradjon, ha a kimenetel nem bizonyítható.

### 7. Crash/restart recovery

A journal és az agent/domain állapot tartós, de a futási szándék nem teljes. A
supervisor csak saját processének exit callbackjéből küld skill-finished/failed
eseményt. Gateway restart alatt futó vagy befejeződő child process nem kerül újra
adoptálásra; a stale marker legfeljebb törlődik. Nincs journal-vízjel alapján
replan replay. Engine stopnál a lite bot kilép, és automatikus respawn nincs.

Szükséges startup reconciliation:

1. desired autonomous botok újraindítása/adoptálása;
2. active marker, PID, journal és agent run-state összevetése;
3. bizonyított terminal journalból idempotens completion/failure event;
4. bizonytalan pénzügyi állapot fail-closed reconciliation queue;
5. fresh avatarstate után resume/idle wake-up;
6. ugyanazon run/event/settlement ID megőrzése retrykor.

## Approval-határok

### A. Policyval előre engedélyezhető hétköznapi tevékenységek

Ezek nem automatikusan „korlátlanul engedélyezettek”; exact skillverzióhoz,
paramétertartományhoz, összeghez, partnerhez, időablakhoz és napi kerethez kötött
authorization envelope szükséges.

- ismert, verified, bounded gathering/travel/production/banking skill;
- NPC shop sell és kis összegű buy exact item-, mennyiség-, egységár- és napi
  költési plafonnal;
- bank deposit/withdraw exact item- és mennyiségi korláttal;
- kis értékű player trade előre engedélyezett partnerrel, tárggyal és plafonnal;
- aktív employment + approved Business policy szerinti player-action elfogadása
  és végrehajtása;
- már elfogadott contract exact, bounded fizikai kötelezettségének teljesítése;
- Business work order vagy beszerzés approved policy, treasury reserve és napi
  limit alatt;
- deterministic skill/capability learning már publikált policy szerint.

### B. Továbbra is explicit human approvalt igénylő műveletek

- új vagy módosított agent skill publikálása;
- autonomous allowlist vagy széles jogosultságú policy létrehozása/aktiválása;
- Property vásárlása, eladása, átruházása, fedezetbe adása vagy lefoglalása;
- nagy treasury-mozgás, hitelfelvétel, collateral/default és auditált
  kompenzáció;
- Business/Faction létrehozás, végleges lezárás és nagyhatású governance policy;
- world mod, World Director sablon vagy világpolicy aktiválása;
- crash utáni bizonytalan pending purchase/escrow/settlement feloldása;
- titok-, infrastruktúra-, szerver- és biztonsági konfiguráció módosítása.

### Jelenlegi eltérések

- Az autonomous skill policy helyesen exact allowlistes, de minden shop buyt és
  player transfer műveletet kategorikusan tilt; nincs bounded spending/trade
  envelope.
- A player-action `accepted → approved → running` út minden alkalommal külön admin
  indítást kér, még előre jóváhagyott, kis értékű munkapolicy esetén is.
- A Business policy aktiválása, offer create/accept, contract evidence beadása és
  settlement retry admin API. Ezekből nincs agent-esemény vagy automatikus domain
  tool invocation.
- Az LLM goal-chain proposal mindig admin approvalra vár. Ismert goal-template és
  szűk policy esetén később engedhető automatikus, verziózott célbővítés; szabad
  stratégiai cél- vagy policyváltás maradjon human approvalos.

## Verified skill lefedettség

A katalógusban tíz shared verified skillverzió van:

- három pénztermelő bányászati route;
- két Karamja lobster route;
- egy carried-input bronze dagger production;
- egy hammer shop-buy route;
- egy exact partneres player gift/trade route;
- két reusable gathering/banking procedure.

Ez elegendő a gather → fixed NPC shop sell és gather → bank technikai körök
demonstrálásához, valamint carried inputból egyszeri productionhöz. Nem elegendő
egy minimális társadalom napi gazdasági működéséhez.

Pontos capability-gapek, új személyes RuneScape skill nélkül:

1. típusos skill-parameter binding és exact goal/work-order binding;
2. általános, bounded travel/meet/return procedure;
3. bank withdraw és „szükséges tárgy megszerzése” procedure;
4. bounded shop buy policy item/quantity/price/spend limitekkel;
5. teljes production cycle: input beszerzés/withdraw → gyártás → output
   bank/sell/trade;
6. crafted output értékesítése vagy exact partnernek átadása;
7. kétoldalú player trade request/accept/verify, nem csak egyoldalú gift;
8. player-action request érzékelése, policy szerinti elfogadása és exact run;
9. contract obligationből képzett exact fizikai skill binding és evidence
   automatikus beadása;
10. shortage/precondition failure után determinisztikus acquire-input fallback;
11. reusable skillek új paraméterkombinációinak verifier evidence/promotion
    folyamata.

A meglévő `CapabilityGapStore` és Skill Builder alkalmas a hiányok tartós
deduplikálására és deklaratív draft készítésére. A gapet azonban csak akkor kell
új skillként kezelni, ha nem parameter binding-, context-, policy- vagy lifecycle
integrációs hiba. A generic parameter/runtime hiányt nem szabad route-onként új
skillpéldányokkal elfedni.

## Javasolt proto-society fixture

### `varrock-proto-v1`

A fixture hat player botból, hat persistent player agentből és egy avatar nélküli
Business institution agentből áll. A vanilla NPC shopok ebben a fázisban explicit,
mért külső gazdasági függőségként megmaradnak; a fixture nem állítja magáról, hogy
önfenntartó.

| Bot | Induló szerep és lehetőség | Kezdő állapot | Ismert verified capability |
| --- | --- | --- | --- |
| `VRCopper1` | réz kitermelés és NPC eladás | Varrock east, pickaxe, kis coin | copper-to-store |
| `VRCopper2` | réz készlet felhalmozása | Varrock east, pickaxe | copper-to-bank |
| `VRIron1` | vas kitermelés és NPC eladás | Varrock east, megfelelő Mining/pickaxe | iron-to-store |
| `VRSmith1` | műhelytermelés | hammer, bounded bronze bar készlet | bronze-daggers + input/output eljárás |
| `VRTrader1` | beszerzés és csere | kis policy-korlátos coin, üres slotok | buy/travel/trade eljárás |
| `VRWorker1` | változó Business munka | alap toolok, több ismert skill | player-action accept/execute |

A `varrock-forge` Business az `varrock.east-workshop` Propertyhez kapcsolódik,
külön treasuryvel, egy approved bounded operatív policyval, valamint `VRSmith1`
és `VRWorker1` employmenttel. Az institution agent `varrock-forge-mind` csak
work ordert, kis beszerzést és kifizetést kezdeményezhet a policy keretein belül.
Property-t, skillt vagy policyt nem módosíthat.

A bootstrap manifest tartalmazza és digesteli:

- fixture/schema verzió, seed és world/mod build;
- bot/agent/subject exact bindingok;
- pozíció, skill/XP, inventory, equipment, bank és coin baseline;
- identity, célok, memory seed, known skill és autonomy policy;
- Property owner/version, Business/employment/policy és treasury balance;
- minden induló pénz és tárgy `fixture-bootstrap` provenance-ét;
- reset/restore tervet és a szükséges titkoktól különálló bot-credential
  hivatkozásokat.

Az első induló állapot szándékosan ad használható lehetőséget: toolokat,
visszaúti díjat, néhány production inputot és bounded Business treasuryt. A
hiányok és a külső NPC shop használata mérendő, nem rejtett fallback.

## Elfogadási és restart-próba

A 15. fázis acceptance két rétegből áll.

### Determinisztikus/integrációs kapuk

- ugyanaz a fixture seed azonos, titokmentes manifest- és baseline-digestet ad;
- event inbox/outbox, lease, cooldown, retry és decision admission újranyitás
  után is idempotens;
- terminal journal → memory/economy/goal/domain evidence → replan út exact replaye
  nem duplikál;
- sem egy skill, sem egy avatar nem kaphat két párhuzamos controller/run tulajdont;
- repeated failure backoff/quarantine és global/per-agent limitek teszteltek;
- settlement, escrow, treasury és Property műveletek megőrzik a meglévő
  fail-closed/atomikus szabályokat.

### Élő soak és restart

- a fixture legalább hat player agentje 60–90 percig fut admin mikromenedzsment
  nélkül;
- indulás után az egyetlen tervezett operátori beavatkozás az engine/gateway
  leállítása és újraindítása, valamint szükség esetén emergency stop;
- minden agent legalább három terminal verified skill-runt ér el vagy igazolt,
  backoffolt capability/precondition állapotba kerül;
- a kohorsz termelési, shop, banki és legalább két player↔player vagy
  Business↔player eseményt generál;
- a restart után a botok/agentek desired stateből újraindulnak vagy adoptálódnak,
  a journalok és eventek egyeztetődnek, majd friss state után folytatódik a loop;
- nincs dupla skill-run ownership, dupla reward/settlement, elveszett accepted
  work order vagy adminonkénti kézi goal/agent restart;
- a timelineból agentenként végigkövethető: wake-up → context → decision →
  policy → skill/domain action → evidence → memory/goal update → következő wake-up.

Az acceptance nem követel hungert, fatigue-et, housingot, aginget, deathöt,
durabilityt, új személyes skilleket, teljesen zárt gazdaságot vagy hosszú új
production chaint.

## Javasolt megvalósítási sorrend

1. Rögzíteni az audit baseline-t és a `varrock-proto-v1` fixture szerződését.
2. Tartós autonomy enrollmentet és a meglévő BotSupervisor/ReplanCoordinator fölé
   idle/due/startup supervisort tenni.
3. A replan eseményeket tartós inbox/outbox + lease/retry állapotba emelni, majd
   bekötni a hiányzó skill/goal/domain wake-upokat.
4. Egységesíteni a valódi planner contextet, és a player/institution szerepekhez
   csak a saját typed domain toolokat adni.
5. Bevezetni az exact parameter/authorization envelope-ot, majd policyval
   engedélyezni a kis hatású buy/trade/work műveleteket.
6. A CapabilityGap/Skill Builder folyamaton át bezárni a konkrét verified
   procedure-hiányokat; nem létrehozni új RuneScape személyes skilleket.
7. Journal evidence alapján idempotens goal/progress/contract/work reconciliationt
   készíteni.
8. Hozzáadni a stuck detectiont, failure fingerprintet, backoffot, quarantine-t,
   globális költséglimitet és operációs timeline-t.
9. Lefuttatni a determinisztikus restart teszteket, majd a 60–90 perces élő
   fixture soakot.

## Vizsgált fő implementációs pontok

- `agent-state/live.ts`, `planner.ts`, `context.ts`, `store.ts`
- `llm-runtime/events.ts`, `planning.ts`, `queue.ts`, `orchestrator.ts`
- `server/gateway/admin/replan-coordinator.ts`, `replan-runtime.ts`,
  `supervisor.ts`, `llm-dry-run.ts`, `multi-agent-experiments.ts`
- `agent-skills/catalog`, `executor.ts`, `capability-gaps.ts`, `builder.ts`
- `business-manager.ts`, `business-agent-port.ts`, `economic-contracts.ts`,
  `economic-contract-settlement.ts`, `institution-treasury.ts`
- `banking-*`, `governance-*`, `properties.ts`, `world-director-*`
