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

- [ ] Feltérképezni az engine adatmodelljét, scriptjeit, perzisztenciáját és kliensprotokollját.
- [ ] Meghatározni, mi marad konfiguráció/adat és mi igényel engine-módosítást.
- [ ] Elkülöníteni a projekt saját módosításait az upstream kódtól, ahol ez ésszerű.
- [ ] Feature flaget és migrációs stratégiát kialakítani az új funkciókhoz.
- [ ] Mintamodult készíteni, amely egy kis, visszafordítható játékelemet módosít.
- [ ] Lefuttatni regressziós tesztet a fontos alapmechanikákra.

Elfogadási feltétel: a módosítások helye, életciklusa, migrációja és tesztelése tisztázott.

## 8. Fázis – economy rebalance és diminishing XP

- [ ] Megkeresni az XP-jutalmazás központi és content-specifikus pontjait.
- [ ] Meghatározni az activity kulcsot: tevékenység + nyersanyag/célpont + régió/hely.
- [ ] Konfigurálható csökkenési görbét készíteni, első hipotézisként
  `1.00 / 0.90 / 0.70 / 0.40 / 0.15` szorzókkal.
- [ ] Időalapú regenerációt/felejtést kialakítani, hogy a korábbi tevékenységek
  később ismét értékessé váljanak.
- [ ] A számlálókat játékosonként tartósan menteni és verziózni.
- [ ] A játékos/agent számára lekérdezhetővé tenni az aktuális várható XP-szorzót.
- [ ] Tesztelni a határértékeket, regenerációt, újraindítást és párhuzamos jutalmakat.
- [ ] Mérni, hogy a rendszer ténylegesen növeli-e a felfedezést és diverzifikációt.
- [ ] Külön vizsgálni a resource respawn, árak és késztermékek értékének hatását.

Elfogadási feltétel: az ismételt azonos tevékenység/hely kombináció jutalma
konfigurálhatóan csökken, regenerálódik, és a tartós állapot tesztelt.

## 9. Fázis – vásárolható ingatlanok (MVP)

- [ ] Véglegesíteni az ingatlan domain-modellt: azonosító, hely, ár, tulajdonos,
  típus, állapot, belépési pontok, bevétel, karbantartás és jogosultságok.
- [ ] Kijelölni 1–3 tesztingatlant és hozzájuk szerveroldali konfigurációt készíteni.
- [ ] Atomi vásárlási tranzakciót megvalósítani: jogosultság, egyenleg, tulajdonjog,
  pénzlevonás és naplózás együtt sikerüljön vagy együtt hiúsuljon meg.
- [ ] Megakadályozni a dupla vásárlást, negatív egyenleget és párhuzamos versenyhelyzetet.
- [ ] Perzisztálni a tulajdonjogot, majd mentés-visszatöltéssel ellenőrizni.
- [ ] Játékbeli vizsgálat, vásárlás, belépés és tulajdonosi visszajelzés készítése.
- [ ] Adminisztrátori lekérdezést és fejlesztői resetet készíteni, naplózással.
- [ ] Unit- és integrációs teszteket írni sikeres és sikertelen vásárlásokra.
- [ ] Dokumentálni a gazdasági balansz későbbi kérdéseit: eladás, bérlet, adó,
  fejlesztés, közös tulajdon és inaktív tulajdonos.
- [ ] A modellt úgy kialakítani, hogy később ház, farm, bánya, bolt, műhely,
  fogadó, raktár, vár, banképület vagy kikötő is lehessen Property.
- [ ] Későbbi jogosultságok terve: belépődíj, bérleti díj, alkalmazottak,
  hozzáférési területek, árképzés és készletkezelés.

Elfogadási feltétel: egy tesztjátékos meg tud venni egy ingatlant, a tulajdonjog
újraindítás után is megmarad, és más nem tudja ugyanazt megvenni.

## 10. Fázis – persistent agent state és memória

- [ ] Agent-identitás sémája: név, háttértörténet és személyiségjegyek.
- [ ] Célhierarchia: életcél, hosszú távú, aktuális és azonnali feladat.
- [ ] Working memory: kis méretű, mindig elérhető aktuális helyzet.
- [ ] Episodic memory: időzített, visszakereshető konkrét események.
- [ ] Semantic memory: megtanult világ- és gazdasági ismeretek.
- [ ] Social memory/relationships: bizalom, tartozás, ígéretek és fontos interakciók.
- [ ] Assets és ismert skillek összekapcsolása az agent állapotával.
- [ ] Relevancia-, frissesség- és célalapú context-visszakeresés készítése.
- [ ] Rövid core identity előállítása, amely minden stratégiai döntéshez adható.
- [ ] Memóriakonszolidáció, duplikációkezelés, elévülés és törlési szabályok.
- [ ] Mindezt determinisztikus szabályalapú plannerrel, LLM nélkül is tesztelni.

Elfogadási feltétel: egy agent újraindítás után megtartja identitását, céljait és
fontos emlékeit, miközben egy döntéshez csak releváns, korlátozott context készül.

## 11. Fázis – LLM-integráció (első biztonságos változat)

- [ ] Pontos use case-t választani: tanácsadó NPC, játékosügynök, operátori segéd
  vagy többügynökös gazdasági kísérlet.
- [ ] Providerfüggetlen adaptert és konfigurációt kialakítani.
- [ ] Az LLM számára szűk, típusos eszközlistát adni; közvetlen engine- és fájlhozzáférést nem.
- [ ] Elkülöníteni a megfigyelést, tervezést, műveletjóváhagyást és végrehajtást.
- [ ] Bevezetni lépés-, idő-, költség- és műveleti limiteket.
- [ ] Eseményvezérelt újratervezést használni: skill vége, váratlan esemény,
  ajánlat, cél teljesülése vagy jelentős gazdasági változás.
- [ ] Elkerülni a tickenkénti/tile-onkénti LLM-hívást; a modell magas szintű skillt válasszon.
- [ ] Agentenként külön modell helyett támogatni a közös, sorba állított inference szolgáltatást.
- [ ] A játékbeli chatet és más külső szöveget nem megbízható bemenetként kezelni.
- [ ] Naplózni a modellverziót, kéréseket, eszközhívásokat, eredményeket és hibákat,
  titkok vagy felesleges személyes adatok nélkül.
- [ ] Determinisztikus mock modellel integrációs teszteket írni.
- [ ] Vészleállítást, visszajátszható futásazonosítót és sikertelen lépések kezelését bevezetni.
- [ ] Csak ezután bekötni egy valódi modellt kis jogosultságú lokális tesztkörnyezetben.

Elfogadási feltétel: az LLM egy korlátozott feladatot végrehajt, minden lépése
auditálható, és hibánál vagy limitnél biztonságosan leáll.

## 12. Fázis – multi-agent gazdaság

- [ ] Több agent párhuzamos futása elkülönített állapottal és közös világban.
- [ ] Kereskedelem, munkamegosztás, ajánlatok és egyszerű szerződések.
- [ ] Foglalkoztatás és vállalkozás kezdeti domain-modellje.
- [ ] Gazdasági eseménynapló, aggregált metrikák és visszajátszható kísérletek.
- [ ] Kontrollcsoportos kísérlet a diminishing XP és agent diverzitás hatására.

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
12. Agent által létrehozott draft automatikus verifierét és promóciós folyamatát megvalósítani.
13. A közös és izolált skill-felfedezési módhoz mérhető összehasonlító kísérletet készíteni.
