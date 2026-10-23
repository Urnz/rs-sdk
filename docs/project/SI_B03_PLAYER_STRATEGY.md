# SI-B03 – Player-stratégia

2026-10-23: kész. Következő: SI-B04; az nem indult el.

## Elfogadási terv és határ

Hipotézis: megszűnt saját employment után egy current állapotcél alatt a modell
két ellenőrzött, megfigyelhető resource/beszerzési út közül választ; a választás
nem actor-névhez vagy szerveroldali szöveges egyezéshez kötött. A typed választás
az SI-B02 adoption/dispatch/state-evidence útján kap következményt.

Komponens: `player-strategy-options.ts`, `player-strategy-runtime.ts`, saját
AgentState stratégia-receipt; LLM planning/validator/provider és gateway replan
közvetlen kapcsolódás. A régi determinisztikus livelihood policy és a publikus
skill-grant nem változik.

Natív thin path: a meglévő eldobható `NativeFoodSkill.test.ts` fixture és SDK
socket/packed engine. Scripted provider választás után valódi native gather,
raw output → elégtelen cooked-food state, majd natív főzés → teljesülés.
A fixture reviewed státusza tesztelőfeltétel, nem publication. A meglévő
world/clock/lifecycle azonosítókat a harness adja; élő világot nem indítunk.
Külső névfilteres child watchdog 30 s, belső eset 15 s; hiba esetén logőrzés,
szűk javítás és csak az érintett próba ismétlése, nem új világ vagy full.

Olcsó előfeltételek: known verified exact skill, grant/művelet/paraméter/GP,
saját friss inventory és élő avatar, megfigyelt stock/price/target, parent
revision, model response allowlist, tartós cooldown és idempotencia.
Külön két scripted választás hajtja végre mindkét alternatívát controlled
executor adapterrel; ez a mechanikai választási/goal-kapcsolatot igazolja,
nem önmagában natív shop- vagy élő LLM-autonómia bizonyíték.

Teljes regresszió nem tervezett: saját additív stratégiaadat és felsorolható
közvetlen fogyasztók; a közös economic commit/clock alap nem változik.

## Megvalósított szerződés

- Új stratégiai mód: `choose-player-strategy`. A szerver legfeljebb 12
  végrehajtható **próbálkozást** sorol fel a jogszerűen látható reviewed
  catalogból és ismert exact skillverziókból. Nincs actor-név vagy szakma
  szerinti választó ág. A modell az opció ID-ját választja; paramétert,
  teljesülési feltételt, eszközt vagy új jogosultságot nem írhat hozzá.
- Minden lehetőséghez szerepel céljelleg, GP-költség felső korlátja,
  kockázat, előfeltétel és forráshivatkozás. A work reward ismert feltétel,
  nem befolyt jövedelem. A modell megkapja az egyéni traits/values,
  engedélyezett állapotcél és saját gazdasági tények korlátos kontextusát.
- Preconditions: saját friss inventory, készségszint és szabad slot;
  megfigyelt reachable gather target vagy konfigurált natív source és tool;
  aktuális shop-interface exact stock/price; policy/paraméter/GP-envelope,
  rendelkezésre álló saját cash és napi keret. A végső sikerhez továbbra is
  natív outcome kell: egy előfeltételezett gather hozhat no-output eredményt.
- Támogatott resource/beszerzési út: megfigyelt gyűjtés, native food gathering,
  exact shop buy/sell, hunger célhoz saját készétel fogyasztása; illetve
  az actorhoz címzett, már jóváhagyott és nem lejárt typed work request
  ugyanezen ellenőrzött skillekkel. Work binding forrása a konkrét request,
  nem az LLM. Más actor munkája nem használható.
- A későbbi intézményi policy, új work-order vagy kitchen-custody előkészítését
  ez nem találja ki. Prepared natív kitchen proof nélküli főzés, ismeretlen
  bank/trade/travel vagy más nem ellenőrizhető művelet nem kerül executable
  opcióként a modell elé. Az unsupported preflight explicit context/input
  hiány, nem skillhiány. Ez a selector konzervatív lefedettsége; nem minden
  catalog-skillhez állít teljes gazdasági tervet.
- Chat és ajánlatszöveg nem ad authorityt. A stratégiai trusted context saját
  identity/state és typed gazdasági tények összegzése; a working-memorybe
  másolt chatet nem használja. Az esemény szövege külön `untrustedText`.
  Az OpenAI structured schema ugyanazt az ID-választást szállítja; a teszt
  fetch-adapterrel igazolt, tényleges providerhívás nem történt.

Az új út aktív current állapotcéllal rendelkező player automatikus economic,
startup/idle, skill-failed és skill-finished eseményeire kapcsolódik. Az explicit
`society-livelihood` fix policy és a korábbi kézi/legacy utak változatlanok.
Inputhiány esetén a friss előfeltételek alapján másik acquisition/work út
választható; az input pótlása után az eredeti skill sincs örökre kizárva.
Sikeres skill és még elégtelen állapot után a következő választás a current
célhoz tér vissza. A régi immediate blokkba kerülhet, hamis completion nélkül.

Nulla executable alternatívánál nincs modellkérés. Konkrét, hiányzó assigned
reviewed procedure a meglévő CapabilityGapStore-ba kerül, idempotensen.
Készlet-, input-, budget-, context- vagy permissionhiány önmagában nem indít
Skill Buildert. Abstain és hiány esetén explicit wait/input-required marad;
az új stratégiai döntések között tartós 60 s-os cooldown akadályozza a
tickenkénti LLM-loopot. A meglévő supervisor/inbox scheduler működik tovább.

## Tartós döntés és jogosultság

Az event-ID-hoz kapcsolt requestben együtt szerepel a trigger/source key,
context digest, grant/policy digest, parent revision, cserélhető gyerek
revision és a konkrét opciók/paraméterbindingok. Az AgentState decision ledger
és a stratégiai admission egy tranzakció; újrapróbálás nem hoz létre második
decisiont. Az inference claim tartós, egyszer fogyasztható.

Az inference után a source, opció, parent, grant, élő avatar és exact lease
owner újra ellenőrzött. A költségfoglalás, régi gyerek blokkolása, új goal,
adoption receipt és stratégiai `adopted` állapot együtt commitolódik. A
dispatch és stratégiai run-ID szintén közös tranzakció. Azonos eseményből
legfeljebb egy proposal és dispatch lehet.

Inference közbeni crash/bizonytalan providerterminal esetén a replay **nem küld
újabb modellkérést és nem foglal újra**. A bizonytalan foglalás megmarad;
későbbi új esemény csak az eredeti budget/cooldown határain belül indíthat
új döntést. Ez tudatos fail-closed viselkedés, nem ingyenes provider-retry.
Adoption után dispatch nélkül az eltárolt választás friss ellenőrzéssel
folytatható. Már rögzített dispatchot nem indít újra; a meglévő process/run
recovery dönti el a natív terminalt. Tetszőleges külső műveletre nincs új
exactly-once állítás.

## Migráció és rollback

AgentState v26→v27: egy saját additív `agent_player_strategy` tábla és agent/
cooldown index. Régi cél, outcome, grant, control-profile és enrollment nem
minősül át. A stratégiai opciókban nincs globális idegen inventory vagy token.
Migrációs ütközéskor a v26 állapot marad; future schema fail-closed.

Upgrade előtt állítsd le az érintett írókat és mentsd az összetartozó DB/WAL
és kódállapotot a meglévő backup eljárással. Rollbackkor leállított runtime
mellett az upgrade előtti mentés és kód együtt állítandó vissza. Aktív v27
DB-ből ne töröld a strategy/adoption receiptet, és ne csökkentsd kézzel a
user_versiont: ezzel elveszne a provider- és dispatch-dedup. Ebben a feladatban
csak eldobható fixture-adatbázisok migrálódtak; élő világ nem indult.

## Ellenőrzési bizonyíték

- `20261023-143313-480-si-b03-strategy-component-types`: **6 célzott PASS**;
  a typecheck egy új teszt nullable run-ID assertionjén bukott, javítva.
  Korábbi két gyors tesztkör az érvénytelen gather fixture argumentumot és
  a gap-státusz téves `pending` elvárását őrzi. Runtime assertion nem gyengült.
- `20261023-143642-026-si-b03-native-choice-first`: **2 natív PASS**, 2,673 s.
  SI-B02 és SI-B03 célzott névfilter; egyik sem élő gazdasági soak.
- `20261023-143925-685-si-b03-consumers-and-native`: **106 PASS / 1 FAIL**,
  13,443 s. Közvetlen legacy goal/decision, LLM, queue/inbox, binding/envelope
  és observer-fogyasztók. Az új gateway-teszt tévesen az elhagyott chatet várta
  a modell inputjában; az elkülönített eseményszöveg és trusted-chat kizárás
  ellenőrzése maradt. A sikeres független fogyasztókat nem ismételtük mind újra.
- `20261023-144305-800-si-b03-final-runtime-types`: **32 PASS + root TS +
  engine TS + format**, 37,017 s. Javított valódi gateway út, input-helyreállítás,
  approved-work ownership/expiry, provider schema és a két érintett native eset.
- `20261023-144529-990-si-b03-lease-state-final`: **29 PASS + root TS + engine
  TS + format**, 36,875 s. Inference közbeni lease-owner váltás és halál is
  fail-closed; közvetlen állapotcél-fogyasztó és az új natív eset ellenőrzött.
- `20261023-145314-568-si-b03-docs-final-retry`: **PASS**, 1,105 s;
  roadmap (18 kész, következő SI-B04), helyi linkek, native case-leltár és
  formázás. Az első docs-helper tévesen minden runtime-case-hez külön statikus
  `test()` sort várt; a meglévő kétértékű wage factoryt a javítás számolja.

Két külön scripted választás a controlled executor adapterben mindkét
resource/beszerzési út state-következményét igazolta. Másik integráció valódi
Business employment végétől a gateway modellkéréséig és dispatchjáig halad;
az actor neve nem választ útvonalat. A natív SDK/packed engine esetben a
modell gatheringet választott: raw output nem elég a cooked-food célhoz,
natív főzés után a cél teljesül. A második shop opció ebben a natív esetben
controlled preflight fixture; natív shop-vásárlást ez a próba nem állít.

Rollback-injekció, bizonytalan inference, adoption/dispatch utáni reopen és
replay igazolták a provider-, decision-, proposal- és task-dedupot. A
tesztszámok átfednek; a korábbi FAIL-ek logjai/resultjai `.local/verification/`
alatt megmaradtak. **Full nem futott.** A sikeres célzott körök nem teljes
regressziós PASS-ok. SI-B06 élő stratégiai E2E, SI-M1/SI-M2 autonóm/túlélési
eredmény és új publication továbbra sincs igazolva.
