# LLM-integráció – tervezési vázlat

## Első use case

Egyetlen kezelt játékosügynök kapja meg az aktív célhierarchiáját és tömör
játékállapotát. Ha van immediate cél, a modell ahhoz választ skillt. Ha nincs,
az élet-, hosszú távú vagy aktuális célból szabályos, immediate célig vezető
cél-láncot javasol. A modell a bot által ismert, nem blokkolt és a megbízható
katalógusban elérhető magas szintű agent skillek közül választhat. A döntés
először csak javaslat; a determinisztikus végrehajtó kizárólag egyszer használható
approval azonosítóval indíthatja el.

A dry-run a validált céljavaslatot módosíthatatlan snapshotként menti, de nem
hoz létre skillt, nem ír memóriát és nem kap alacsony szintű engine-, fájl-
vagy kódfuttatási eszközt. A célok és az opcionális skill csak külön admin
jóváhagyás után kerülnek végrehajtási állapotba.

## Rétegek

1. **Megfigyelés:** releváns játékállapot strukturált összefoglalása.
2. **Tervező/model adapter:** providerfüggetlen kérés és válasz.
3. **Policy/validator:** jogosultság, séma, költség-, idő- és lépéshatár.
4. **Végrehajtó:** szűk rs-sdk eszközök; közvetlen fájl- vagy engine-hozzáférés nélkül.
5. **Audit:** futásazonosító, modell, eszközkérés, eredmény, idő és hibakód.

## Elkészült 11A alap

- `llm-runtime/types.ts`: provider-, kérés-, döntés-, limit- és audit szerződések.
- `llm-runtime/planning.ts`: az agent snapshot, releváns memória és ellenőrzött
  skillkatalógus összekötése; a nem megbízható epizódok elkülönítése.
- `llm-runtime/orchestrator.ts`: közös inference queue, szigorú output-validáció,
  költség- és időkorlát, egyszer használható approval és emergency stop.
- `llm-runtime/mock-provider.ts`: hálózatmentes, determinisztikus provider a
  regressziós tesztekhez.
- `llm-runtime/audit.ts`: memóriabeli és JSONL audit sink; a nyers context helyett
  kérés-hash és korlátozott metaadat kerül a naplóba.
- `config/llm-runtime.json`: alapértelmezetten kikapcsolt mock konfiguráció.

## Elkészült 11B előnézet

- Az Agentek adminfülön külön `LLM dry-run` gomb kér friss, legfeljebb öt
  másodperces online botállapotot.
- A felület külön mutatja a célt, a trusted contextet, a nem megbízható adatot,
  a szűrt skilllistát, a mock modell döntését és annak futásazonosítóját.
- A dry-run önmagában szimuláció, de a validált `propose-goal-plan` eredményt
  az AgentState v14 adatbázis tartós, revíziózott proposal rekordként megőrzi.
- Az orchestration audit külön `.local/admin/llm-audit.jsonl` naplóba kerül; a
  szokásos admin audit csak a futásazonosítót, státuszt, döntést és usage adatot
  tartja meg.
- A gateway a skillfolyamat befejezését vagy hibáját, az immediate cél
  létrehozását és státuszváltását, az új trade-kérést, a halálátmenetet és a
  küszöbértéket átlépő aggregált gazdasági változást domain-eseménnyé alakítja.
- A tickek csak átmenetet érzékelnek: változatlan világállapotból nem keletkezik
  modellhívás. A forráskulcsos deduplikálás és cooldown a zajos ajánlat- és
  gazdasági burstöket összevonja, míg a skill-, cél- és halálesemények sürgősek.
- Az automatikus eredmények a `.local/admin/llm-replans.jsonl` fájlba kerülnek,
  és a `/api/admin/llm-replans` helyi admin végponton lekérhetők. Ezek továbbra
  is csak mock javaslatok: automatikus skillvégrehajtás nincs.
- Immediate cél hiányában a planner a legmélyebb aktív stratégiai célt választja
  horgonynak. A mock előnézet egyetlen kérésben pontosan a hiányzó horizontokat
  (`long-term`, `current`, `immediate`) javasolja, és az utolsó célhoz legfeljebb
  egy, már ismert és ellenőrzött skillt rendel.

## Elkészült 11C célterv-jóváhagyás

- A böngésző nem küldi vissza a modell céljait vagy skilljét: csak a szerveren
  tárolt proposal azonosítóját és várt revízióját. Így a jóváhagyott tartalom
  pontosan a korábban validált snapshot.
- A teljes hiányzó célhierarchia egyetlen SQLite-tranzakcióban jön létre. Ütköző
  célazonosító, megváltozott stratégiai horgony vagy elveszett skillismeret
  esetén sem marad félkész lánc.
- A kiválasztott egzakt skillverzió csak exact player-avatar kötésen, online,
  credentiallel rendelkező és szabad boton indulhat. A rövid életű approval
  egyszer használható; a futásazonosító még a supervisor hívása előtt tartósan
  elfogyasztja.
- Ha nincs alkalmas skill, a jóváhagyás csak a célokat hozza létre. A későbbi
  capability-gap és Skill Builder folyamat ettől elkülönítve marad.

## Elkészült 11D korlátozott autonóm életciklus

- A skill-, cél-, halál-, trade-, gazdasági és capability-ready események a
  meglévő deduplikált event gate-en keresztül indítanak újratervezést; változatlan
  tick önmagában továbbra sem okoz modellhívást.
- Minden elfogadott esemény előbb bekerül az AgentState döntési ledgerébe. A
  control profile napi döntés- és LLM-költségkerete, valamint optimista revíziója
  fail-closed módon sorosítja a versengő döntéseket.
- Az automatikus újratervezés és az automatikus végrehajtás két külön kapcsoló.
  Az utóbbi csak egzakt `skill@verzió` allowlist, verified állapot, agent-szintű
  hozzáférés és ismeret, friss exact player-avatar kötés, valamint külön művelet-
  és időlimit mellett indíthat skillt.
- Vásárlás, eladás és playernek adott tárgy automatikusan tiltott; az első policy
  composed skillt sem indít, mert annak teljes függőségi gráfját külön kell majd
  biztonsági osztályozással ellátni.
- A stratégiai célterv automatikus eseménynél is tartós proposal lesz és adminra
  vár. A hiányzó képesség deduplikált capability gap; verified feloldás után az
  agent egyszer ébred fel. A skill befejezése vagy hibája új eseménnyel folytatja
  a ciklust.

## Elkészült 11E operátori próba és megfigyelhetőség

- Az Agentek fülön minden player-agent külön `Autonóm ciklus indítása` gombot
  kapott. Ez ugyanazt a tartós event gate-et, döntési admission ledgert,
  plannert és végrehajtási policy-t használja, mint a játékvilág eseményei;
  nem kerülőút és nem ad közvetlen skillindítási jogosultságot.
- A gomb előre figyelmeztet, hogy engedélyezett policy esetén valódi skill is
  elindulhat. Az automatikus újratervezés kikapcsolása, cooldown, költségkeret,
  hiányzó cél vagy tiltott skill továbbra is biztonságos leállást eredményez.
- Az AI-beállítások fül görgethető autonóm életciklus-naplója megmutatja az
  eseményt, event-gate eredményt, státuszt, indokot, validált döntést és az
  esetleges skill-run azonosítóját. A sikertelen vagy limit miatt elutasított
  kézi próbák után is frissül.
- A felület legfeljebb a legutóbbi 100 rekordot tölti be; a tartós teljes audit
  továbbra is a `.local/admin/llm-replans.jsonl` fájlban marad.
- Az izolált elfogadási teszt valódi AgentState SQLite-adatbázissal, éles
  katalógusskillel és mockolt processzhatárral ellenőrzi a teljes utat. Ugyanabban
  a tesztben egy szigorúbb műveleti limit már a supervisor előtt leállítja a
  következő ciklust, miközben mindkét döntés és auditrekord tartós marad.

## Tartós replan inbox migráció és visszaállítás

A gateway a `.local/admin/replan-inbox.sqlite` külön, verziózott SQLite-
adatbázisában őrzi az automatikus eseményeket. Az első indítás additívan létrehozza
az 1-es sémát; nem módosít engine-save-ot vagy AgentState rekordot. A stable
source key és payload digest ugyanazt az eseményt restart után sem engedi eltérő
tartalommal újra felhasználni.

Gateway-restartkor a terminális skill journalból csak a még `running` enrollment
aktuális claimje után indult, exact avatarhoz kötött futások épülnek vissza. Az új
gateway előbb saját autonomy lease-t szerez, és csak ezután claimeli az agent
legrégebbi esedékes inboxrekordját. Egy még élő, másik gatewayhez tartozó lease
átmeneti retry, nem végleges `skipped` eredmény.

Az enrolled avatar első friss reconnect state-je és a verified CapabilityGap
csak inert inboxrekordot hoz létre; közvetlen plannerhívást egyik sem végez. A
valid markerrel rendelkező, bizonyítottan halott skill PID journal hiányában
`skill-failed` wake-up lesz. Ha terminal journal létezik, mindig az a hiteles
forrás, ezért külön orphan esemény nem készül.

A cél-életciklus forrása az AgentState append-only `agent_goal_event` ledgere.
Az enrollment után létrejött új immediate cél, illetve a completed, blocked vagy
abandoned státusz stable sequence-kulccsal kerül az inboxba. A közvetlen admin
útvonal gyorsan kézbesít, a gateway periodikus ledger-recoveryje pedig pótolja a
céltranzakció commitja és az inbox-írás közötti esetleges restartot.

Ugyanez a restartbiztos recovery lefedi az economic offer/contract,
player-action, Business employment és approved-policy work order, releváns
Property/Governance, valamint a kézbesített World Director eseményeket. A stable
source key mindenhol domain ID + revision/version. Property csak exact actor- vagy
Business-kötéshez, governance csak a vezérelt factionhöz, world event csak built-in
approved exact template-verzióhoz és egyező régióhoz (vagy `global`) jut el. Az
aggregate economy observer legfeljebb 25, aktív gazdasági céllal vagy nyitott
commitmenttel rendelkező enrolled agentet választ. Tartós coordinator mellett a
live observer is kizárólag inboxba ír; supervisor lease-en kívül nem fut planner.

Visszaállításhoz leállított gateway mellett mentsd együtt az SQLite fájlt és az
esetleges `-wal`/`-shm` társakat, majd használd az előző alkalmazásverziót; az a
külön inboxot figyelmen kívül hagyja. A fájl csak az elvárt függő események
exportja vagy tudatos elvetése után törölhető. Terminal outcome-ból rollbackkor
sem szabad automatikus műveletet rekonstruálni.

## Egységes decision context

Az admin agent-view és az automatikus LLM-kérés ugyanazt az egyszer felépített,
legfeljebb 10 000 karakteres trusted contextet használja. Player szerepnél ez az
authoritative live gateway snapshotból — admin előnézetnél jelölt save fallbackból
— adja az item-ID/count/slot inventoryt és equipmentet, ismert bankot, coint,
XP-t, nyitott shopárakat, player-actionöket, érintett typed gazdasági termeket és
a legutóbbi skill-runt.

Business és Faction institution agent csak az exact control-profile subjecthez
tartozó domain port vetületét kapja. Az authorization envelope minden contextben
rögzíti a subject/avatar kötést, napi limiteket és azt, hogy institution fizikai
műveletet csak player-action requesttel kérhet. Offer/contract cím és leírás,
chat, modszöveg és modellkimenet nem trusted authority: a szabad szöveg bounded
`untrustedText` mezőbe kerül, a trusted rész csak típusos termeket tartalmaz.

Minden context forrás-, idő- és freshness-jelölést, továbbá explicit blockerlistát
kap. Az automatikus replan hiányzó player/bank/domain forrás mellett nem kér
modellt: refresh/wait/fail-closed eredményt ad, és nem talál ki hiányzó állapotot.

## OpenAI provider helyi beállítása

Az OpenAI adapter a Responses API-t használja `store: false` és szigorú JSON
sémás kimenettel. A kulcs az adminpanelen write-only helyi secretként állítható
be; ennek hiányában az `OPENAI_API_KEY` környezeti változó a fallback. A kulcs
nem kerül a konfigurációs JSON-ba, adatbázisba, API-válaszba vagy auditnaplóba.
Az adapter a HTTP hibákat a válasz és a kulcs visszaidézése nélkül jelenti.

1. Az adminpanel AI fülén válaszd az OpenAI providert, a modellt és a limiteket,
   majd add meg az API-kulcsot a jelszómezőben. A szerver a kulcs értékét később
   nem küldi vissza a böngészőnek.
2. Alternatívaként ugyanabban a PowerShell ablakban, amelyből a gateway indul,
   állítsd be: `$env:OPENAI_API_KEY = "sk-..."`.
3. Az admin `LLM dry-run` valódi modellhívást végez, de továbbra sem indít skillt;
   a célterv mentése és az autonóm végrehajtás külön policy alatt marad.

A mintában az `automaticReplanning` értéke `false`: így csak a kézzel indított
dry-run kerül pénzbe. Az eseményvezérelt automatikus modellhívások csak ennek a
kapcsolónak a tudatos `true` értékre állítása és gateway-újraindítás után indulnak.

Az ármezők modellváltáskor kézzel frissítendők a szolgáltató aktuális díjaihoz.
A gateway a válasz tokenhasználatából számolja a becsült `costMicros` értéket;
API-hívás előtti teljes költséggarancia nincs, ezért a szolgáltatói projekt- és
felhasználási limitet is alacsonyan kell tartani.

## Biztonsági alapok

- A játékchat és minden külső szöveg nem megbízható adat.
- Titok nem kerülhet promptba vagy naplóba.
- A modell nem kap tetszőleges kódfuttatást az első verzióban.
- Minden futásnak van maximális lépésszáma, ideje és költségkerete.
- Vészleállítás után újabb modell- vagy eszközhívás nem indulhat.
- A tesztek alapértelmezetten determinisztikus mock modellt használnak.
- Az OpenAI provider tesztjei injektált helyi HTTP-válaszokat használnak, ezért
  nem olvasnak valódi kulcsot és nem fogyasztanak API-egyenleget.

