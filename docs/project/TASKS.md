# Projektfeladatok

Ez a lista az indulástól egy helyben futó, módosítható privát szerveren át az
LLM-integrációig vezeti a projektet. A jelölőnégyzetet csak az alatta megadott
elfogadási feltételek teljesülése után pipáld ki.

## 0. Fázis – keretek és döntések

- [x] Rögzíteni, hogy a cél a LostCity/rs-sdk helyi emulátora, nem a hivatalos OSRS.
- [x] Eldönteni a kezdeti operációs módot: minden komponens közvetlenül Windowson,
  vagy részben WSL/Docker alatt fusson.
- [x] Rögzíteni a támogatott Bun- és Node-verziót az upstream követelményei alapján.
- [x] Létrehozni egy rövid döntési naplót minden nehezen visszafordítható választáshoz.

Elfogadási feltétel: a környezet, a hatókör és a technikai alapok egyértelműek.

## 1. Fázis – fork és verziókezelés

- [x] A `MaxBittker/rs-sdk` GitHub-repozitóriumot saját fiókba forkolni.
- [x] Az upstream projektet a munkatér üres `rs-sdk/` könyvtárába klónozni.
- [x] A saját fork legyen az `origin`, az eredeti repo pedig az `upstream` remote.
- [x] Ellenőrizni az alapértelmezett ágat és létrehozni egy külön fejlesztői ágat.
- [x] Feljegyezni az induláskor használt upstream commit azonosítóját.
- [x] Átolvasni az upstream `README.md`, `DEVELOPERS.md`, `AGENTS.md` és licenc fájljait.

Elfogadási feltétel: `origin` és `upstream` helyesen mutat, a munkafa tiszta, az
alap commit dokumentált.

## 2. Fázis – helyi környezet és függőségek

- [x] Telepíteni/ellenőrizni a Git és Bun aktuálisan támogatott verzióját.
- [x] A gyökérfüggőségeket zárolt lockfile alapján telepíteni.
- [x] A `server/webclient` függőségeit külön telepíteni.
- [x] Létrehozni a szükséges helyi `.env` fájlokat kizárólag minta alapján.
- [x] Titkokat, lokális adatbázist és generált fájlokat kizárni a verziókezelésből.
- [x] Lefuttatni az upstream ellenőrzéseket (`bun run check`).

Elfogadási feltétel: friss klónból reprodukálható telepítés és sikeres alapellenőrzés.

## 3. Fázis – az rs-sdk helyi futtatása

- [x] Elindítani a game engine-t a `server/engine` könyvtárból.
- [x] Elkészíteni a webclient standard, bot és item-viewer buildjeit.
- [x] Elindítani a gateway-t a `server/gateway` könyvtárból.
- [x] Ellenőrizni, hogy a gateway a `ws://localhost:7780` címen elérhető.
- [x] Létrehozni egy kizárólag lokális tesztbotot.
- [x] A botot a helyi `localhost:8888` szerverhez és `localhost:7780` gatewayhez kötni.
- [x] Végrehajtani egy minimális smoke tesztet: csatlakozás, állapotlekérés, mozgás,
  egy egyszerű interakció és tiszta leállítás.
- [x] Ellenőrizni az újraindítás utáni állapotot és adatmegőrzést.
- [x] Külön manuális játékosfiókkal belépni, a tutorialt átugrani, és a futó botot
  ugyanabban a világban vizuálisan ellenőrizni.

Elfogadási feltétel: mindhárom szolgáltatás helyben fut, a bot csatlakozik, és a
smoke teszt dokumentáltan megismételhető.

## 4. Fázis – fejlesztői alapok

- [x] Készíteni egyetlen, dokumentált fejlesztői indítási folyamatot.
- [x] Egészségellenőrzést adni az engine, webclient és gateway komponensekhez.
- [x] Egységes naplókönyvtárat és log-szinteket kialakítani.
- [x] Meghatározni a gyors tesztek, integrációs tesztek és teljes smoke teszt parancsait.
- [x] CI-folyamatot készíteni formázásra, típusellenőrzésre és tesztekre.
- [x] Dokumentálni az upstream frissítések beolvasásának és konfliktuskezelésének módját.
- [x] Biztonsági mentési és visszaállítási próbát végezni a szerverállapotra.

Elfogadási feltétel: egy új fejlesztő a dokumentáció alapján el tud indulni, és a
hibák reprodukálásához elegendő napló áll rendelkezésre.

## 5. Fázis – saját agent skillek

- [x] Összegyűjteni a gyakran ismételt műveleteket és skill-jelöltekké bontani őket.
- [x] Feltérképezni az rs-sdk meglévő magas szintű API-ját, hogy ne építsük újra a
  `walkTo`, bankolás, kereskedés, shop- és interakciós képességeket.
- [x] Kialakítani az `Agent knows Skill[]` modellt, nem külön `MiningAgent` vagy
  `SmithingAgent` osztályokat.
- [x] Első stabil skillek: bányászat + bankolás egy konkrét útvonalon.
- [x] Következő skillek: smithing/production, shop-vásárlás és player trade.
- [x] 5–10 stabil, hosszabb ideig LLM nélkül futó skillt létrehozni.
- [x] Minden skillhez egyértelmű bemenetet, kimenetet, korlátokat és hibakezelést írni.
- [x] A skill-végeket és megszakítási okokat egységes eseményként jelenteni.
- [x] Tiltani a titkok naplózását és a hivatalos OSRS szolgáltatáshoz való kapcsolódást.
- [x] A skilleket kis, determinisztikus példákon és hibás bemeneteken is tesztelni.

Elfogadási feltétel: legalább öt saját skill ismételhetően működik, dokumentált,
és egyikhez sem kell tickenként külső döntéshozó.

## 6. Fázis – botadminisztráció és gazdasági telemetria

- [x] Egységes botkatalógust készíteni az online/offline állapottal, aktuális
  skillel, pozícióval, futásazonosítóval és utolsó aktivitással.
- [x] Read-only bot részletező API-t készíteni: skillek/XP, inventory, bank,
  felszerelés, coins, pozíció, aktuális skill és legutóbbi hiba.
- [x] A gateway élő állapotát, az offline player save-okat, a bankot és az
  agent-skill futásjelzőket egy admin backend mögött egyesíteni.
- [x] Auditált adminparancsokat készíteni bot spawnhoz, leállításhoz,
  újraindításhoz és futó agent-skill megszakításához.
- [x] Online bothoz verified agent-skill hozzárendelést és megszakítást készíteni.
- [x] Online bothoz biztonságos, előre jóváhagyott célpontos teleportot készíteni.
- [x] Offline játékoshoz a kanonikus mentéskódon át szint/XP, pénz, inventory és
  bank módosítást készíteni; futó játékos mentésfájlját közvetlenül nem írjuk.
- [x] Minden elkészült állapotmódosításhoz jogosultságot, indoklást,
  időpontot és visszakövethető auditbejegyzést követelni.
- [x] Webes admin panelt készíteni kereshető, rendezhető és szűrhető botlistával,
  részletes profillal, helyzettel, skill-futásokkal és kontrollált műveletekkel.
- [x] A nagy bot-, tranzakció-, skilltörténet-, készlet- és backuplistákat belső,
  billentyűzettel is fókuszálható görgetőpanelekbe rendezni.
- [x] A befejezett agent-skill futásokat időrendben, eredménnyel, időtartammal,
  műveletszámmal és részletes eseménylistával megjeleníteni.
- [x] Élő világtérképet készíteni az online botokhoz.
- [x] Idősoros gazdasági alapnézetet készíteni: pénzmennyiség, itemkészlet,
  össz-XP, átlagos total level és online botszám.
- [x] A gazdasági nézetet bővíteni XP/órával, termelés/fogyasztással, valamint
  shop- és player-trade eseményekkel.
- [x] Exportálható kísérleti snapshotot és összehasonlítható futásjelölést készíteni.
- [x] Tesztelni az online/offline ütközést, jogosulatlan módosítást, auditot,
  újraindítást és több bot párhuzamos frissítését.

Elfogadási feltétel: az összes bot állapota egy helyen követhető, a gazdasági
idősorok lekérdezhetők, és az adminmódosítások biztonságosak, jogosultságvédettek
és teljesen auditálhatók.

## 7. Fázis – modolási keretrendszer

- [x] Feltérképezni az engine adatmodelljét, scriptjeit, perzisztenciáját és kliensprotokollját.
- [x] Meghatározni, mi marad konfiguráció/adat és mi igényel engine-módosítást.
- [x] Elkülöníteni a projekt saját módosításait az upstream kódtól, ahol ez ésszerű.
- [x] Feature flaget és migrációs stratégiát kialakítani az új funkciókhoz.
- [x] Szabványos, verziózott mod-manifestet és típusos konfigurációs sémát készíteni.
- [x] Modfüggőségeket, ütközéseket, hookokat és aktiválási életciklust modellezni.
- [x] A kért és az engine-ben ténylegesen aktív modállapotot külön kezelni, hogy a
  restartot igénylő változtatás egyértelműen látható legyen.
- [x] A lokális modkonfigurációt verziózottan, atomi fájlcserével és optimista
  revízióvédelemmel perzisztálni.
- [x] Jogosultságvédett, indoklást és auditot követelő World Admin API-t készíteni.
- [x] World Admin felületet készíteni a telepített modok áttekintéséhez,
  ki-/bekapcsolásához és séma alapján generált beállításaihoz.
- [x] Biztonságos, auditált engine-újraindítást készíteni a World Admin felülethez,
  kizárólag a fejlesztői indító által nyilvántartott helyi folyamathoz.
- [x] Konfigurációs backupot és egykattintásos visszaállítást készíteni a World
  Admin felülethez.
- [x] Meghatározni és tesztelni a `hot-reload`, `restart-required`, migráció és
  rollback állapotátmeneteket, hibánál fail-closed működéssel.
- [x] Modonként állapot-, hiba- és domainmetrikákat adni az admin telemetriához.
- [x] Mintamodult készíteni, amely egy kis, visszafordítható játékelemet módosít.
- [x] Lefuttatni regressziós tesztet a fontos alapmechanikákra.
- [x] Kötelező kikapcsolási lifecycle-szerződést és függőségi preflightot adni,
  hogy a modkapcsoló ne törölhessen vagy árván hagyhasson domainállapotot.

Elfogadási feltétel: a módosítások helye, életciklusa, migrációja és tesztelése
tisztázott; a World Admin megmutatja a kért és aktív állapotot, a modok
biztonságosan konfigurálhatók és visszaállíthatók, minden változás auditált.

## 8. Fázis – economy rebalance és diminishing XP

- [x] Megkeresni az XP-jutalmazás központi és content-specifikus pontjait.
- [x] Meghatározni az activity kulcsot: tevékenység + nyersanyag/célpont + régió/hely.
- [x] Konfigurálható csökkenési görbét készíteni, első hipotézisként
  `1.00 / 0.90 / 0.70 / 0.40 / 0.15` szorzókkal.
- [x] Időalapú regenerációt/felejtést kialakítani, hogy a korábbi tevékenységek
  később ismét értékessé váljanak.
- [x] A számlálókat játékosonként tartósan menteni és verziózni.
- [x] A játékos/agent számára lekérdezhetővé tenni az aktuális várható XP-szorzót.
- [x] Tesztelni a határértékeket, regenerációt, újraindítást és párhuzamos jutalmakat.
- [x] A tényleges felfedezési és diverzifikációs hatás mérését a 12. fázis
  kontrollcsoportos gazdasági kísérletébe áthelyezni, mert ehhez agentcélok,
  elegendő skill- és helylefedettség, valamint több párhuzamos agent szükséges.
- [x] A resource respawn, árak és késztermékek értékének közös kalibrációját a
  12–14. fázis ismételhető benchmark- és paraméterhangolási feladatai közé sorolni.

Elfogadási feltétel: az ismételt azonos tevékenység/hely kombináció jutalma
konfigurálhatóan csökken, regenerálódik, és a tartós állapot tesztelt.

## 9. Fázis – vásárolható ingatlanok (MVP)

- [x] Véglegesíteni az ingatlan domain-modellt: azonosító, hely, ár, tulajdonos,
  típus, állapot, belépési pontok, bevétel, karbantartás és jogosultságok.
- [x] Kijelölni 1–3 tesztingatlant és hozzájuk szerveroldali konfigurációt készíteni.
- [x] Atomi vásárlási tranzakciót megvalósítani: jogosultság, egyenleg, tulajdonjog,
  pénzlevonás és naplózás együtt sikerüljön vagy együtt hiúsuljon meg.
  - [x] Online játékos inventory-coin walletjét engine-tickre sorosítani,
    kompenzációval, azonnali autosave-val és fail-closed `pending` kezeléssel.
  - [x] Auditált gateway API-t és World Admin tesztvásárlási műveletet készíteni.
  - [x] Élő játékossal sikeres és elégtelen egyenleges vásárlást ellenőrizni.
  - [x] A binary save és a domainadat közötti crash-recovery egyeztető műveletet elkészíteni.
- [x] Megakadályozni a dupla vásárlást, negatív egyenleget és párhuzamos versenyhelyzetet
  a perzisztált foglalás, idempotenciakulcs és kompenzálható wallet-szerződés szintjén.
- [x] Perzisztálni a tulajdonjogot, majd újranyitással ellenőrizni.
- [x] Játékbeli vizsgálat, vásárlás, belépés és tulajdonosi visszajelzés készítése.
  - [x] Dedikált Property sign objektumot, Inspect/Purchase műveletet és
    tulajdonosi/nem tulajdonosi Enter visszajelzést készíteni, élőben ellenőrizve.
  - [x] A Varrock táblát a bank falából a déli, használaton kívüli műhely utcai
    bejáratához helyezni, és a banki notice boardokon görgethető, read-only
    ingatlannyilvántartást adni.
  - [x] A World Admin ingatlankártyáin koordinátát és az Élő világtérképre
    fókuszáló `Térképen` gombot megjeleníteni.
  - [x] A Varrock műhely tulajdonosi Enter engedélyét a tényleges ajtóhoz kötni,
    rövid automatikus áthaladással és visszazárással.
- [x] Adminisztrátori lekérdezést és fejlesztői resetet készíteni, naplózással.
  - [x] Read-only katalógus- és tulajdonlekérdezést adni a World Adminhoz.
  - [x] Biztonságos, indoklásköteles fejlesztői resetet és pending-egyeztetést készíteni.
- [x] Unit- és integrációs teszteket írni sikeres és sikertelen vásárlásokra.
- [x] Dokumentálni a gazdasági balansz későbbi kérdéseit: eladás, bérlet, adó,
  fejlesztés, közös tulajdon és inaktív tulajdonos.
- [x] A modellt úgy kialakítani, hogy később ház, farm, bánya, bolt, műhely,
  fogadó, raktár, vár, banképület vagy kikötő is lehessen Property.
- [x] Későbbi jogosultságok terve: belépődíj, bérleti díj, alkalmazottak,
  hozzáférési területek, árképzés és készletkezelés.
- [x] A Property, Business és Faction/Governance mod felelősségi határait,
  stabil hivatkozásait és eseményalapú integrációját dokumentálni.

Elfogadási feltétel: egy tesztjátékos meg tud venni egy ingatlant, a tulajdonjog
újraindítás után is megmarad, és más nem tudja ugyanazt megvenni.

## 10. Fázis – persistent agent state és memória

- [x] Agent-identitás sémája: név, háttértörténet és személyiségjegyek.
- [x] Célhierarchia: életcél, hosszú távú, aktuális és azonnali feladat.
- [x] Working memory: kis méretű, mindig elérhető aktuális helyzet.
- [x] Episodic memory: időzített, visszakereshető konkrét események.
- [x] Semantic memory: megtanult világ-, gazdasági, útvonal- és eljárásismeretek.
- [x] Social memory/relationships: bizalom, tartozás, ígéretek és fontos interakciók.
- [x] Assets (pénz, ingatlan, vállalkozás, követelés) összekapcsolása az agent állapotával.
  - [x] A player pénzét és az EconomicActorRef által birtokolt ingatlanokat az
    eredeti domainforrásból, read-only portfólióként feloldani.
  - [x] A kapcsolati tartozásokat és értékelt nyitott vállalásokat külön követelés-
    és kötelezettségösszegként összesíteni.
  - [x] Tartós, általános player/business/faction actor-linket készíteni, hogy a
    későbbi Business és Governance mod állapota adatmásolás nélkül csatlakozhasson.
- [x] Egzakt, verziózott ismert skillek összekapcsolása az agent állapotával.
- [x] Relevancia-, frissesség- és célalapú context-visszakeresés minden tartós
  memóriatípushoz.
  - [x] Determinisztikus episodic retrieval cél-, szereplő-, címke-, szöveg-,
    fontosság- és frissességi pontozással.
  - [x] Determinisztikus semantic retrieval cél-, címke-, szöveg-, confidence-
    és frissességi pontozással, érvényességi szűréssel.
  - [x] Determinisztikus social retrieval szereplő-, címke-, cél-, szöveg-,
    interakciófrissesség-, kapcsolat-, tartozás- és nyitottvállalás-pontozással.
- [x] Rövid core identity előállítása, amely minden stratégiai döntéshez adható.
- [x] Memóriakonszolidáció, duplikációkezelés, elévülés és törlési szabályok.
  - [x] Az episodic események idempotens külső kulcsát, opcionális elévülését és
    döntési contextből való automatikus kizárását elkészíteni.
  - [x] A befejezett skill journalokat és strukturált gazdasági eseményeiket
    automatikusan, idempotensen trusted episodic memóriává alakítani.
  - [x] Az ismétlődő, teljes és strukturált termelési bizonyítékokat tartós
    evidence ledgerrel, 3/5/10/20 megfigyelési küszöbökön semantic eljárástudássá
    konszolidálni, verziómegőrző felülírással és kézi tudás védelmével.
  - [x] A teljes player trade eseményekből automatikusan social kapcsolatot és
    ismertséget építeni úgy, hogy a kézi bizalom-, rokonszenv-, tartozás- és
    jegyzetértékek változatlanok maradjanak.
  - [x] Előnézetes, explicit és auditált retention műveletet készíteni, amely
    kizárólag elévült, semmilyen tartós bizonyítékként vagy külső forrásból nem
    hivatkozott episodic emléket törölhet.
- [x] Mindezt determinisztikus szabályalapú plannerrel, LLM nélkül is tesztelni.

Elfogadási feltétel: egy agent újraindítás után megtartja identitását, céljait és
fontos emlékeit, miközben egy döntéshez csak releváns, korlátozott context készül.

## 11. Fázis – LLM-integráció (első biztonságos változat)

- [x] Pontos use case-t választani: tanácsadó NPC, játékosügynök, operátori segéd
  vagy többügynökös gazdasági kísérlet.
- [x] Providerfüggetlen adaptert és konfigurációt kialakítani.
- [x] Az LLM számára szűk, típusos eszközlistát adni; közvetlen engine- és fájlhozzáférést nem.
- [x] Elkülöníteni a megfigyelést, tervezést, műveletjóváhagyást és végrehajtást.
- [x] Bevezetni lépés-, idő-, költség- és műveleti limiteket.
- [x] Eseményvezérelt újratervezést használni: skill vége, váratlan esemény,
  ajánlat, cél teljesülése vagy jelentős gazdasági változás.
  - [x] Típusos eseményszerződés, forráskulcsos deduplikálás és agentenkénti
    cooldown elkészítése tickenkénti belépési pont nélkül.
  - [x] A skill-, cél-, ajánlat- és gazdasági eseményforrásokat rákötni az
    újratervezési kapura és a közös inference queue-ra.
- [x] Elkerülni a tickenkénti/tile-onkénti LLM-hívást; a modell magas szintű skillt válasszon.
- [x] Agentenként külön modell helyett támogatni a közös, sorba állított inference szolgáltatást.
- [x] A játékbeli chatet és más külső szöveget nem megbízható bemenetként kezelni.
- [x] Naplózni a modellverziót, kéréseket, eszközhívásokat, eredményeket és hibákat,
  titkok vagy felesleges személyes adatok nélkül.
- [x] Determinisztikus mock modellel integrációs teszteket írni.
- [x] Vészleállítást, visszajátszható futásazonosítót és sikertelen lépések kezelését bevezetni.
- [x] Adminpaneles mock LLM dry-runt készíteni, amely friss élő állapotból
  megmutatja a trusted contextet, a nem megbízható szöveget, az engedélyezett
  skilleket és a modell javaslatát, végrehajtás nélkül.
- [x] Hierarchikus céltervezést készíteni: aktív immediate cél hiányában az
  élet-, hosszú távú vagy aktuális célból egyetlen modellhívással szabályos,
  immediate célig vezető cél-láncot és opcionális ellenőrzött skillt javasolni.
- [x] Valódi provider adaptert és biztonságos, környezeti változós API-kulcs
  konfigurációt készíteni kis jogosultságú lokális tesztkörnyezethez.
- [x] A jelenlegi szerverhez tartozó adminpaneles LLM-beállításokat készíteni providerhez,
  modellhez, szerepprompthoz, reasoninghez, költség- és futási limitekhez;
  write-only helyi API-kulccsal és nem felülírható biztonsági prompt-réteggel.
- [ ] Admin jóváhagyással atomikusan létrehozni a javasolt cél-láncot, majd
  egyszer használható approval azonosítóval elindítani a kiválasztott skillt.
- [ ] Korlátozott autonóm agent-életciklust készíteni: eseményre újratervezés,
  veszélytelen ellenőrzött skillek policy szerinti futtatása és skill-gap jelzés.
- [ ] A skill-gapből elkülönített, verziózott, tesztelt és publikálás előtt
  jóváhagyandó skill-készítési folyamatot indítani; a futó agent ne kapjon
  közvetlen tetszőleges kódfuttatást.
  - [ ] A `player`, `institution`, `service` és `world-director` agent-szerepeket
    elkülöníteni; ne minden önálló rendszer kapjon avatárt vagy szabad LLM-loopot.
  - [ ] Az agent identitását általános subject bindinghoz kötni, amely player,
    business, faction vagy rendszer-szolgáltatás lehet; a player controller továbbra
    is kizárólag a hozzá rendelt avataron hajthasson végre műveletet.
  - [x] A player planner hiányzó képesség esetén ismételt modellhívás helyett
    strukturált, tartós és deduplikált `CapabilityGap` munkajegyet hozzon létre.
    - [x] Perzisztens szemantikus fingerprint, requester-lista, kérésszámláló,
      lifecycle és konkurens írások mellett is atomi tárolás.
    - [x] A feloldatlan kézi és automatikus LLM-tervezési eredmény bekötése a
      registrybe, valamint megjelenítése az adminpanel AI-beállításainál.
    - [x] Függő gap esetén az automatikus újratervezést már a modellhívás előtt
      megállítani, majd verified skill létrejöttekor egyszer felébreszteni.
  - [x] Külön, nem playerhez kötött Skill Builder workert készíteni, amely a gap
    munkasorból, a meglévő skillekből és engedélyezett műveletekből deklaratív
    draftot készít, de tetszőleges JavaScriptet, fájl- vagy shellműveletet nem futtat.
    - [x] Providerfüggetlen worker-határ, atomikus gap-claim és kizárólag
      allowlistelt deklaratív skill-törzs elfogadása.
    - [x] A provenance, draft státusz és shared policy szolgáltatásoldali
      rápecsételése; provider által küldött extra vagy jogosultsági mezők elutasítása.
    - [x] OpenAI Skill Builder provider és felügyelt gateway scheduler bekötése.
  - [x] A Skill Builder hívásait egyedi gapenként, költségkerettel és cooldownnal
    korlátozni; ugyanarra a gapre több agent csak feliratkozzon, ne írja újra a skillt.
    - [x] Per-gap tartós attempts, költség, utolsó hiba, cooldown és konkurens
      workerek között kizárólagos attempt token.
    - [x] Szerverenkénti összesített napi költségkeret és admin stop/resume policy.
  - [x] A draftot elkülönített tesztboton, statikus validatorral és élő futási
    bizonyítékkal ellenőrizni, majd csak verifier/human approval után publikálni.
    - [x] Statikus schema- és biztonsági validálás után csak draftként menthető.
    - [x] Tesztbot queue, egzakt draft/verzió/paraméter alapján gyűjtött élő evidence,
      tartós verifier-jelentés és külön admin human approval bekötése.
  - [x] A skill objektív létezését, az agent hozzáférését és az agent megtanult
    tudását külön kezelni; a globális katalógus ne jelentsen automatikus ismeretet.
  - [ ] A megosztási policy-t `public/common`, `organization`, `teachable/licensed`
    és `private` szintekre bővíteni, determinisztikus tanulási eseményekkel.
  - [ ] Shared/public verified skillhez determinisztikus resolverrel, LLM-hívás
    nélkül lehessen megfelelő találatot és tanulási módot választani.
    - [x] Determinisztikus resolver ismert-skill prioritással, megosztási módokkal
      és többértelmű találat esetén biztonságos visszautasítással.
    - [ ] A találatból explicit tanulási eseményt és LLM nélküli determinisztikus
      végrehajtási döntést készíteni.
  - [ ] Az általánosítható skilleket paraméterezni és kisebb eljárásokból építeni,
    hogy ne keletkezzen külön skill minden érc–lelőhely–bank kombinációra.
  - [ ] Business- és faction-agenteknek domain eszközöket, költségvetést, memóriát
    és döntési ritmust adni; játékbeli fizikai műveletet képviselő/player végezzen.
  - [ ] A World Directort seedelt, determinisztikus eseményválasztóként kezelni;
    az LLM legfeljebb validálandó eseménysablont javasoljon, ne írja át szabadon a világot.

Elfogadási feltétel: az LLM egy korlátozott feladatot végrehajt, minden lépése
auditálható, és hibánál vagy limitnél biztonságosan leáll.

## 12. Fázis – multi-agent gazdaság

- [ ] Több agent párhuzamos futása elkülönített állapottal és közös világban.
- [ ] Kereskedelem, munkamegosztás, ajánlatok és egyszerű szerződések.
- [ ] Foglalkoztatás és vállalkozás kezdeti domain-modellje.
- [ ] Gazdasági eseménynapló, aggregált metrikák és visszajátszható kísérletek.
- [ ] A diminishing XP kísérlet előfeltételeként agentcélokat, legalább több
  egymással helyettesíthető pénzkereső skillt/helyet és determinisztikus seedet biztosítani.
- [ ] Kontrollcsoportos kísérletet futtatni azonos agentekkel és seeddel, a mod
  kikapcsolt és bekapcsolt állapotát összehasonlítva.
- [ ] Mérni a bejárt régiókat, célpont- és skilldiverzitást, koncentrációt,
  termelést, készletet, árakat, jövedelmet és agentenkénti célhaladást.
- [ ] A respawn-, XP-, ár- és késztermék-paramétereket verziózott kísérleti
  konfigurációként kezelni; előbb kézi/kereséses, később automatizált vagy
  tanulásalapú optimalizálással vizsgálni, egyetlen univerzális optimum ígérete nélkül.

## 13. Fázis – bankrendszer, hitelek és vállalkozások

- [ ] Pénzbetét, kamat, tartalék és könyvelési főkönyv modellje.
- [ ] Hitel, futamidő, kamat, törlesztés és késedelem.
- [ ] Fedezet és nemteljesítés; például műhely lefoglalása.
- [ ] Atomi, kettős könyveléshez közelítő tranzakciók és auditálás.
- [ ] Csőd, bankroham és pénzügyi fertőzés biztonságos szimulációs korlátai.

## 14. Fázis – új skillek és termelési láncok

- [ ] A klasszikus játék-skillektől független, adatvezérelt `Skill[]` rendszer.
- [ ] Lehetséges új skillek: engineering, machining, accounting, banking,
  management, medicine, law, logistics és politics.
- [ ] Hosszú termelési lánc prototípusa: érc → olvasztás → acél → öntés →
  megmunkálás → alkatrész → gép → gyár.
- [ ] A késztermékeknek termelőtőke-értéket adni, nem csak XP-veszteséget.
- [ ] Ingatlanok fejlesztése, eladása/bérlése és gazdasági hatásvizsgálata.
- [ ] Regressziós benchmark feladatok és ismételhető értékelés.
- [ ] Mentések verziózása és automatizált migrációs tesztek.
- [ ] Telemetriai dashboard a szerver, botok, gazdaság és LLM-költségek számára.
- [ ] Dokumentált kiadási és visszaállítási folyamat.

## 15. Fázis – factionök, államok és joghatóságok

- [ ] Általános Faction és Jurisdiction modell királyságokhoz, városokhoz,
  uradalmakhoz, céhekhez és más hierarchikus egységekhez.
- [ ] Területi tagságot és egymásba ágyazott joghatóságot konfigurálni.
- [ ] Kincstárat és költségvetést a közös gazdasági főkönyvhöz kapcsolni.
- [ ] Adó-, vám-, illeték- és támogatási szabályokat verziózott policyként kezelni.
- [ ] Property- és Business-eseményekből idempotens kötelezettségeket képezni.
- [ ] Adóbeszedést, mentességet, hátralékot és auditálható adminbeavatkozást készíteni.
- [ ] Az uradalmat joghatósági egységként kezelni, amely több ingatlant birtokolhat,
  és opcionálisan egy várat vagy más Propertyt használhat székhelyként.
- [ ] Biztonságos lifecycle: kikapcsolva új kötelezettség ne keletkezzen, de a
  meglévő kincstár, tartozás és tulajdon read-only módon megmaradjon.

Elfogadási feltétel: két egymásba ágyazott joghatóság szabályai determinisztikusan
képeznek és könyvelnek adót ugyanabból a gazdasági eseményből, dupla terhelés nélkül.

## 16. Fázis – több-szerveres admin vezérlőközpont

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

## Aktuális következő lépések

1. [x] Karamja lobster–bank útvonalhoz szükséges komp/dialog műveleteket szabványosan
   hozzáadni az engedélyezett adapterhez.
2. [x] Elkészíteni és élő bottal ellenőrizni az első fishing + banking skillt.
3. [x] A Karamja fishing draftot második független élő futással ellenőrizni, majd a
   verifier/promóciós folyamaton át új, változtathatatlan `verified` verzióvá tenni.
4. [x] A bányászat után production, shop és trade skillekkel elérni az első
   5–10 stabil, LLM nélkül futó skillt.
5. [x] A 6. fázis első használható admin kiadását elkészíteni: botkatalógus,
   profilok, szűrők, spawn/despawn, audit és gazdasági alapidősor.
6. [x] A 6. fázis második kiadásából az auditált, paraméterezhető verified
   agent-skill hozzárendelést és megszakítást elkészíteni.
7. [x] A biztonságos, auditált online teleportot előre jóváhagyott célpontokkal
   és engine-ticken végrehajtott paranccsal elkészíteni.
8. [x] A 6. fázis offline szerkesztőjét szint/XP-, pénz-, inventory- és
   bankmódosítással, automatikus backuppal és restore-ral elkészíteni.
9. [x] A befejezett agent-skill futások adminpaneles történetét és részletes
   eseménylistáját elkészíteni.
10. [x] A valódi MapView-ra épülő élő világtérképet botlistával, fókuszálással
   és Spectate-átjárással elkészíteni.
11. [x] A 6. fázis következő részében részletes tranzakciós telemetriát készíteni.
    - [x] Élő session XP-növekedés és XP/óra botonként, skillenként és összesítve.
    - [x] Termelés/fogyasztás, shop- és player-trade események naplózása.
12. [x] Agent által létrehozott draft automatikus verifierét és promóciós folyamatát megvalósítani.
13. [x] A közös és izolált skill-felfedezési módhoz mérhető összehasonlító kísérletet készíteni.
14. [x] A 7. fázis alapozását lezárni.
    - [x] A modolási architektúrát feltérképezni és dokumentálni.
    - [x] A mintamodot a World Admin felületről engedélyezve, játékbeli belépéssel
      élőben ellenőrizni.
15. [x] A 7. fázis lifecycle állapotgépét és regressziós kapuját elkészíteni.
    - [x] Modonkénti runtime-, hookhiba- és domainmetrikákat megjeleníteni.
    - [x] A `hot-reload`, `restart-required`, migráció és rollback átmeneteit
      fail-closed tesztekkel lefedni.
    - [x] A fontos alapmechanikák kikapcsolt mod melletti regressziós tesztjét
      hozzáadni.
16. [x] A 8. fázis első függőleges szeletét elkészíteni: központi XP-hook,
    konfigurálható csökkenési görbe és World Admin megfigyelhetőség.
    - [x] Az alapból kikapcsolt `economy.diminishing-xp` modot elkészíteni.
    - [x] A konfigurációt és a játékosonkénti várható szorzót a World Adminban
      szerkeszthetővé, illetve megfigyelhetővé tenni.
    - [x] A tartós számlálókat, regenerációt és regressziós teszteket elkészíteni.
    - [x] A `stateless`, `suspend`, `read-only` és `blocked` kikapcsolási policyt,
      admin preflightot, valamint mentés/restore védelmet megvalósítani.
17. [x] A 8. fázist technikailag lezárni, a hosszú távú diminishing XP
    hatásvizsgálatot pedig a szükséges agentcélokkal és skilllefedettséggel együtt
    a 12. fázis kontrollcsoportos kísérletébe átütemezni.
18. [x] A 9. fázis ingatlan-domain modelljét, validátorát és három verziózott
    tesztingatlanát elkészíteni, a katalógust a későbbi tulajdonállapottól elválasztva.
19. [x] Atomi ingatlanvásárlást és külön perzisztált tulajdonállapotot készíteni.
20. [x] A Varrock keleti műhelyhez játékbeli Property sign objektumot és
    Inspect/Purchase/Enter jogosultsági visszajelzést készíteni, majd a sikeres,
    elégtelen egyenleges és visszaállítási útvonalat élő botokkal ellenőrizni.
21. [x] A Property sign saját világtérképi ikonját és Key-szűrőjét elkészíteni,
    az admin egyszeri koordinátafókuszát pedig bezáráskor törölni.
22. [x] A 9. fázist normál klienses vásárlással, belépés-ellenőrzéssel és a banki
    ingatlannyilvántartással kézzel elfogadni.
23. [x] A 10. fázis első tartós szeletét elkészíteni: verziózott agent-identitás,
    négyszintű célhierarchia és korlátozott core identity context.
24. [x] Tartós, frissességkorlátos working memoryt és korlátozott döntési
    kontextust készíteni az aktuális helyzethez, tevékenységhez és pozícióhoz.
25. [x] Az agent céljait egzakt, verziózott agent skillekhez kötni, az ismert
    skilleket tartósítani, és fail-closed determinisztikus skillválasztót készíteni.
26. [x] Az élő botállapotot working memoryvé alakító, egy planner-döntést végző
    és csak explicit engedéllyel verified skillt futtató teljes ciklust elkészíteni.
27. [x] Az Agentek adminfület elkészíteni identitás-, cél- és skillismeret-kezeléssel,
    korlátozott döntési contexttel, planner dry-runnal és megerősített kézi
    skillvégrehajtással.
28. [x] Tartós episodic eseménytárat, determinisztikus relevancia-visszakeresést,
    korlátozott context-integrációt és adminpaneles emlékrögzítést készíteni.
29. [x] Bizonyítékhoz kapcsolható semantic tudástárat, verziómegőrző felülírást,
    determinisztikus retrievalt és adminpaneles tudásrögzítést készíteni.
30. [x] Tartós társas memóriát készíteni irányított kapcsolatokkal, kétirányú
    pénztartozással, bizonyítékokkal, lezárható vállalásokkal, relevancia-
    visszakereséssel és adminpaneles kezeléssel.
31. [x] A tartós agentet gazdasági szereplőkhöz kapcsolni, majd az aktuális pénzt,
    ingatlant, követelést és kötelezettséget read-only asset-portfólióként az
    adminnézetbe és a korlátozott döntési contextbe illeszteni.
32. [x] Háttérben futó, LLM nélküli episodic ingestiont készíteni a lezárt
    agent-skill journalokból és azok termelési, fogyasztási, shop-, trade- és
    banki eseményeiből, duplikáció- és journal-módosítás elleni védelemmel.
33. [x] A megbízható termelési epizódokból tartós bizonyítékszámlálással,
    lépcsőzetes confidence-szel és felülírási előzményekkel automatikus semantic
    eljárástudást képezni úgy, hogy kézi tudást soha ne írjon felül.
34. [x] A strukturált player trade-okból idempotens social kapcsolatot,
    bizonyítéklistát, utolsó interakciót és fokozatos ismertséget képezni anélkül,
    hogy az automatika bizalmat, rokonszenvet vagy tartozást találna ki.
35. [x] Az elévült episodic emlékekhez védettségi előnézetet és explicit,
    auditált admin törlést készíteni; minden semantic, social, commitment,
    konszolidációs vagy külső forráshivatkozással rendelkező emléket megőrizni.
36. [x] A semantic retrievalt korlátozott frissességi ponttal, a social retrievalt
    interakciófrissességgel és az aktív cél szövegének külön súlyozásával bővíteni,
    majd az admin context minden részét közös időpillanatból felépíteni.
37. [x] Újraindítást szimuláló end-to-end tesztben skill journalból automatikus
    episodic, semantic és social memóriát képezni, releváns korlátozott contextet
    építeni, majd ugyanazt a verified skillt kétszer azonos döntéssel kiválasztani.
