# Hosszú távú társadalom- és gazdaságszimulációs vízió

## A dokumentum célja

Ez a dokumentum a még nem ütemezett, hosszú távú ötletek közös tervezési helye.
Nem kész funkciókat és nem végleges balanszértékeket ír le. A cél az, hogy az
egymásra épülő rendszereket külön modulokra bontsuk, és később ellenőrizhető
kísérleteket tervezzünk belőlük.

A projekt végső célja nem egyszerűen több RuneScape-mechanika hozzáadása, hanem
egy megfigyelhető agent-társadalom létrehozása, amelyben a szereplők szükségletei,
képességei, tulajdona, munkája, együttműködése és kockázatai tartós gazdasági
következményekkel járnak.

## Tervezési alapelvek

- A nagy rendszerek külön, verziózott modok legyenek, szűk domainhatárral.
- A modok típusos, idempotens eseményeken keresztül kapcsolódjanak, ne egymás
  belső adatbázisát írják.
- Egy mod kikapcsolása ne töröljön tulajdont, szerződést vagy történelmet. Új
  hatás ne keletkezzen, a meglévő állapot legalább read-only módon megmaradjon.
- A játékos, a vállalkozás, a faction és a világvezérlő külön gazdasági szereplő.
- Fizikai játékbeli műveletet avatár végezzen; az avatar nélküli intézmény csak
  policyt, szerződést vagy player-megbízást kezdeményezzen.
- Az LLM magas szintű, ritka döntéseket hozzon. Az ismételhető végrehajtás
  verified agent skill legyen.
- A balansz hipotézis, nem végleges igazság. Minden fontos szabály legyen
  konfigurálható, mérhető és kontrollfutással összehasonlítható.

## Már meglévő alapok

A vízió nem üres lapra épül. Már rendelkezésre áll:

- tartós player- és institution-agent identitás, célok és memória;
- ingatlan, tulajdonos és belépési jogosultság kezdeti modellje;
- Business-identitás, foglalkoztatás, policy és treasury;
- gazdasági ajánlat, szerződés, player inventory escrow és idempotens kifizetés;
- verified skillek, skilltanulás és külön Skill Builder folyamat;
- többagent-es, seedelt kísérlet, gazdasági eseménynapló és aggregált metrikák;
- verziózott world-mod lifecycle és diminishing XP mechanika.

Ezek működő technikai alapok, de még nem alkotnak önfenntartó, teljes gazdaságot.

## 1. Egyéni adottságok és karakteralkotás

### Alapadottságok

A karakter létrehozásakor korlátozott pontkeretből 5–6 lassan vagy egyáltalán nem
változó adottságot lehetne kiosztani. Lehetséges, még nem végleges készlet:

- `intellect`: tanulás, tervezés és összetett receptek megértése;
- `vigor`: erőkifejtés, teherbírás és rövid intenzív munka;
- `endurance`: fáradás, hosszú munka és nélkülözés tűrése;
- `dexterity`: finom kézi munka, pontosság és gyártási minőség;
- `perception`: észlelés, gyűjtés, veszély- és bűnészlelés;
- `will` vagy `social`: önfegyelem, stressz, tárgyalás és vezetés.

Az adottságok befolyásolhatják a tanulási sebességet, a személyes skillplafont,
a hibaarányt és a szükségletek terhelését. Ne legyen egyetlen mindenre jó build:
az induló pontkeret valódi kompromisszumokat teremtsen.

### Személyes skill és effektív képesség

Ajánlott két külön fogalom:

1. **Személyes kompetencia:** amit az egyén önállóan tud; ezt korlátozhatják az
   adottságai és a gyakorlása.
2. **Effektív termelési képesség:** személyes kompetencia + eszköz + műhely +
   gép + recept/tudás + csapat + szervezeti folyamat.

Így egy ember valóban ne tudjon egyedül mikrochipet vagy más ipari terméket
előállítani, de ezt ne a vállalkozási tagság által mágikusan feloldott 99-es
szint modellezze. A magas szintű termék receptje követeljen megfelelő létesítményt,
gépeket, több munkakört és összehangolt termelési lépéseket.

A 99-es személyes szint megtartása, korlátozása vagy teljes megszüntetése külön
kísérleti policy legyen. Összehasonlítandó változatok:

- fix klasszikus 99-es plafon;
- adottságfüggő személyes plafon;
- puha plafon, amely fölött a tanulás egyre lassabb;
- alacsonyabb személyes plafon, de magas szervezeti/facility bónusz.

## 2. Szükségletek, idő és életvitel

Külön `needs` mod kezelheti az éhséget, szomjúságot, fáradtságot, alvást és
később az egészséget vagy stresszt. A rendszer célja gazdasági kereslet és
életviteli döntések létrehozása, nem a folyamatos mikromenedzsment.

Tervezési kérdések:

- milyen szimulációs időskálán romlanak az értékek;
- offline agentnél telik-e az idő, és ha igen, milyen korláttal;
- milyen állapot csökkenti csak a hatékonyságot, és mi okozhat sérülést vagy halált;
- az LLM helyett milyen determinisztikus rutin kezeli az alapvető önfenntartást;
- mennyi élelmiszer-, ital- és pihenési kereslet szükséges stabil gazdasághoz.

Az alvás kapcsolódjon a lakhatáshoz. Egy ágy vagy férőhely tartozhat saját
ingatlanhoz, bérelt lakáshoz, fogadóhoz, munkásszálláshoz vagy ideiglenes
menedékhez. Az alvás minősége és biztonsága külön hatás lehet.

## 3. Tárgyélettartam és folyamatos kereslet

Külön `item-lifecycle` mod vezetheti be:

- tartósságot és használati kopást;
- javítást, karbantartást és alkatrészigényt;
- minőséget és készítői eredetet;
- romlandó élelmiszereket;
- javíthatatlan törést és újrahasznosítható maradványt.

Ez technikailag itempéldány-szintű állapotot igényelhet, miközben a klasszikus
RuneScape inventory főként item ID + darabszám modellre épül. Bevezetés előtt el
kell dönteni, mely tárgyak kapnak egyedi példányazonosítót, és mely stackelhető
termékek kezelhetők gyártási tételként.

A kopás fontos pénz- és anyagelnyelő lehet, de nem szabad olyan gyorsnak lennie,
hogy minden gazdasági tevékenységet javításra kényszerítsen.

## 4. Lakhatás, bérlet és férőhely

A Property mod maradjon a fizikai ingatlan, tulajdon és hozzáférés forrása. Egy
külön housing/tenancy domain kezelje:

- a lakó- és hálóférőhelyek számát;
- egyéni, családi vagy többfős bérletet;
- bérleti díjat, kauciót és időtartamot;
- vendég-, alkalmazotti és tulajdonosi hozzáférést;
- kilakoltatást, felmondást és hátralékot;
- fogadót, munkásszállást és hajléktalanságot.

Az ajtó csak a Property domain fizikai kapuja legyen. A belépési jogot a bérlet,
a vállalkozási munkaviszony vagy más domain által kibocsátott, lejáró entitlement
igazolja.

## 5. Moduláris vállalkozások és munkamegosztás

A jelenlegi merev `manager | worker` szerepkör csak MVP. A cél vállalkozásonként
definiálható `BusinessRoleDefinition`:

- stabil szerepazonosító és szabad név, például mindenes, eladó, futár vagy kovács;
- engedélyezett exact skillek és feladattípusok;
- készlet-, raktár-, treasury-, ár- és szerződésjogosultságok;
- felvételi, elbocsátási és delegálási jog;
- ingatlan- és eszközhasználati entitlementek;
- bérmodell, költési plafon, műszak és teljesítési feltétel.

Egy tulajdonos létrehozhat egy széles jogosultságú `mindenes` szerepet, míg más
vállalkozás elkülönítheti az eladót, beszerzőt, futárt, raktárost és managert.
A közös rendszer csak képességeket és jogosultságokat ismerjen; a konkrét
szerepkombináció a vállalkozás policyje legyen.

A logisztika külön modul lehet. A szekér, hajó vagy teherhordó eszköz adjon
kapacitást, sebességet, útvonal- és karbantartási költséget. A Business csak azt
döntse el, ki használhatja és milyen megbízásra.

## 6. Termelési láncok és szervezeti tudás

Az összetett termékekhez adatvezérelt receptek és több lépcsős workflow szükséges:

`nyersanyag → alapanyag → alkatrész → összeszerelés → ellenőrzés → késztermék`.

Egy recept követelhessen:

- több külön személyes skillt vagy munkakört;
- megfelelő Property/facility típust;
- konkrét gépet és annak működő állapotát;
- szervezeti licencet vagy semantic tudást;
- energiát, időt, inputokat és minőség-ellenőrzést.

A szervezeti tudás ne automatikusan kerüljön minden alkalmazott memóriájába.
Lehet vállalati eljárás, oktatható skill, licenc vagy csak a facility által
végrehajtható folyamat.

## 7. Bűnözés, tulajdonvédelem és igazságszolgáltatás

A lopás és betörés csak teljes következménylánccal együtt érdemes:

1. tulajdon- és hozzáférési jog megsértése;
2. zár, betörési módszer és Thieving-képesség;
3. tanú, észlelés, tárgyi nyom és bizonyíték;
4. joghatóság és alkalmazandó szabály;
5. feljelentés, nyomozás vagy elfogás;
6. ítélet, bírság, kártérítés, börtön vagy más szankció.

Ehhez legalább Property, item ownership, needs, Faction/Jurisdiction és tartós
evidence ledger szükséges. A bűnözői út legyen valódi gazdasági stratégia, de
magas kockázattal és ne korlátlan tárgyteremtéssel.

Az igazságszolgáltatás is policyvezérelt legyen: más szabályai lehetnek egy
királyságnak, városnak, uradalomnak vagy céhnek. A bűn tényét és az ítéletet
külön kell kezelni; az LLM legfeljebb korlátozott javaslatot adjon, ne dönthessen
ellenőrizetlenül vagyonról vagy karakterhalálról.

## 8. Halál és permadeath

A permadeath nagy hatású, opcionális világpolicy legyen, alapból kikapcsolva.
Bevezetése előtt szükséges:

- sérülés, gyógyítás és halálok hiteles eseménye;
- hagyaték, tulajdon, tartozás és szerződés rendezése;
- vállalkozás és munkaviszony folytonossága;
- agentmemória archiválása és esetleges öröklése;
- új karakter belépési és utánpótlási szabálya;
- admin-helyreállítás és kísérleti rollback.

Lehetséges profilok: klasszikus respawn, tartós sérülés, korlátozott életek és
teljes permadeath. Ezek gazdasági és társadalmi hatását külön kell mérni.

## 9. Diminishing XP mint hosszú távú kísérlet

A jelenlegi diminishing XP mod technikailag működik, de egy rövid teszt még nem
válaszolja meg, jobb társadalmat vagy gazdaságot eredményez-e. Érdemi vizsgálathoz
szükséges:

- sok, egymást helyettesítő megélhetési és termelési skill;
- működő kereslet, fogyasztás és tárgykopás;
- munkamegosztás, vállalkozások és facility-előny;
- lakhatás és alapvető szükségletek;
- stabil ár- és jövedelemtelemetria;
- hosszabb, azonos seedű kontroll- és kezelésfutás.

Összehasonlítandó policyk:

- klasszikus korlátlan ismétlési XP;
- tevékenység- és régióalapú diminishing XP;
- adottságfüggő tanulási sebesség;
- puha személyes skillplafon;
- facility/team által növelt effektív képesség;
- ezek korlátozott kombinációi.

A cél nem az egyik univerzális optimum megtalálása, hanem annak mérése, melyik
szabály milyen specializációt, mobilitást, egyenlőtlenséget és együttműködést okoz.

## 10. Megfigyelhetőség

Az átláthatósághoz a nyers napló és az összesített metrika egyszerre szükséges.
Ajánlott nézeti szintek:

### Operációs állapot

- engine, gateway, botok, queue-k, hibák és LLM-költségek;
- elakadt escrow, settlement, szerződés vagy mod-lifecycle művelet;
- adatfrissesség és legutóbbi sikeres feldolgozás.

### Agent-idővonal

- cél, döntés, futtatott skill, helyváltoztatás és eredmény;
- bevétel, kiadás, fogyasztás, pihenés és kapcsolati esemény;
- releváns memória és annak döntésre gyakorolt hatása.

### Vállalkozási nézet

- treasury, lefoglalt pénz, készlet, eszközök és ingatlanok;
- alkalmazottak, szerepkörök, munkák, bérek és kihasználtság;
- termelési input/output, árbevétel, költség és profit;
- beszállítói és vevői szerződések.

### Piaci és világszint

- pénzkínálat, pénzáramlás és pénzforrások/-nyelők;
- ár, forgalom, készlet és hiány termékenként/régiónként;
- jövedelem- és vagyoneloszlás, munkanélküliség és mobilitás;
- lakhatási kihasználtság, szükséglethiány, bűnözés és halálozás;
- skill-, célpont-, régió- és vállalkozási koncentráció.

### Kísérleti nézet

- konfiguráció, seed, build/mod verzió és agentkohorsz;
- kontroll és kezelés közötti delta, idősor és bizonytalanság;
- egy aggregált értékről lefúrható exact események;
- reprodukálható export elemzéshez.

Az architektúra alapja változtathatatlan domain-esemény legyen, amelyből
újraépíthetők a származtatott dashboardok. A részletes eseményeket nem kell mind
egyszerre megjeleníteni: szűrés, lapozás, idősáv, összehasonlítás és drill-down
tegye egyszerre áttekinthetővé és visszakövethetővé a rendszert.

## 11. Javasolt függőségi sorrend

1. Közös szimulációs idő és új domain-események megfigyelési szerződése.
2. Karakteradottságok és a személyes/effektív képesség külön modellje.
3. Enyhe, biztonságosan kikapcsolható szükséglet-MVP.
4. Egyetlen eszköztípus tartóssági és javítási vertikális szelete.
5. Lakhatási férőhely, alvás és egyszerű bérlet.
6. Vállalkozásspecifikus szerepkörök és facility-hozzáférés.
7. Készlet, árképzés, beszerzés, logisztika és hosszabb termelési lánc.
8. Faction/Jurisdiction és bizonyítékalapú bűnüldözési MVP.
9. Sérülés, hagyaték és csak ezután opcionális permadeath.
10. Hosszú diminishing XP/adottság/facility kontrollkísérletek.

Ez függőségi sorrend, nem új fázisszámozás. A konkrét munkát továbbra is a
`TASKS.md` tartalmazza, kis, külön tesztelhető szeletekre bontva.

## 12. Nyitott termékdöntések

- Mekkora legyen egy szimulációs nap, műszak és alvási ciklus?
- Mi történjen az offline agent szükségleteivel?
- A személyes skillplafon kemény, puha vagy teljesen facility-függő legyen?
- A klasszikus RuneScape skillek mellett vagy helyett éljen az új skillrendszer?
- Ki hozhat létre vállalkozást, szerepkört, receptet és új intézményi policyt?
- Milyen fogyasztás számít hasznos keresletnek, és mi csak frusztráló grindnak?
- A piac NPC-árait, agent-ajánlatokat vagy mindkettőt használja?
- Milyen bizonyíték szükséges lopáshoz, elfogáshoz és ítélethez?
- Permadeath után mi örökölhető: vagyon, szervezeti pozíció, semantic tudás vagy semmi?
- Mely metrikák jelzik a „jó” szimulációt: stabilitás, mobilitás, specializáció,
  túlélés, innováció, egyenlőtlenség vagy ezek többcélú kompromisszuma?

## Kapcsolódó dokumentumok

- [Projektfeladatok](TASKS.md)
- [Diminishing XP](features/diminishing-xp.md)
- [Ingatlanok](features/properties.md)
- [Business manager](features/business-manager.md)
- [Gazdasági szerződések](features/economic-contracts.md)
- [Institution agentek](features/institution-agents.md)
- [Multi-agent kísérletek](features/multi-agent-experiments.md)
- [Termelési gazdaság](features/production-economy.md)
- [Bankrendszer](features/banking.md)
