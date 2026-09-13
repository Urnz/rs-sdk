# Hosszú távú társadalom- és gazdaságszimulációs vízió

## A dokumentum célja

Ez a dokumentum a hosszú távú társadalom- és gazdaságszimuláció közös tervezési
helye. Nem kész funkciókat és nem végleges balanszértékeket ír le. A cél az, hogy
az egymásra épülő rendszereket külön domainokra és verziózott modokra bontsuk,
majd ellenőrizhető, reprodukálható kísérleteket tervezzünk belőlük.

A projekt végső célja nem egyszerűen több RuneScape-mechanika hozzáadása, hanem
egy megfigyelhető, tartós agent-társadalom létrehozása. A szereplők született
adottságai, megtanult képességei, szükségletei, ideje, tulajdona, lakhatása,
munkája, vállalkozásai, együttműködése, kockázatai, öregedése és halála valódi
gazdasági és társadalmi következményekkel járjanak.

A cél nem az, hogy minden rendszer egyszerre készüljön el. A társadalmat kis,
külön tesztelhető vertikális szeletekből kell felépíteni, miközben az adatmodell
és a domainhatárok már korán kompatibilisek maradnak a későbbi életciklussal,
tulajdonnal és intézményekkel.

## Tervezési alapelvek

- A nagy rendszerek külön, verziózott modok legyenek, szűk domainhatárral.
- A modok típusos, idempotens eseményeken keresztül kapcsolódjanak, ne egymás
  belső adatbázisát írják.
- Egy mod kikapcsolása ne töröljön tulajdont, szerződést, emléket vagy történelmet.
  Új hatás ne keletkezzen, a meglévő állapot legalább read-only módon megmaradjon.
- A játékos, a Business, a faction és a világvezérlő külön gazdasági szereplő.
- Fizikai játékbeli műveletet avatár végezzen; az avatar nélküli intézmény csak
  policyt, szerződést vagy player-megbízást kezdeményezzen.
- Az LLM magas szintű és ritka döntéseket hozzon. Az ismételhető végrehajtás
  verified agent skill legyen.
- A balansz hipotézis, nem végleges igazság. Minden fontos szabály legyen
  konfigurálható, mérhető és kontrollfutással összehasonlítható.
- A társadalomszimulációs profilban a világ ne végtelen NPC-készletekből és
  végtelen NPC-pénzből éljen. A gazdaságilag jelentős szolgáltatókat agentek és
  valódi Business actorok váltsák fel.
- Az OSRS világ, skillek és tárgyak elsődlegesen meglévő építőelemek. Új személyes
  skill csak akkor készüljön, ha a kívánt képesség nem modellezhető ésszerűen
  meglévő RuneScape skill, verified eljárás és facility capability együttese révén.
- A target társadalomszimulációban az élet véges. Klasszikus respawn vagy
  mortalitás nélküli világ maradhat külön kompatibilitási és kontrollprofil, de
  nem ez határozza meg a hosszú távú társadalmi modellt.

## Már meglévő alapok

A vízió nem üres lapra épül. Már rendelkezésre áll:

- tartós player- és institution-agent identitás, célok és memória;
- ingatlan, tulajdonos és belépési jogosultság kezdeti modellje;
- Business-identitás, foglalkoztatás, policy, treasury és player-megbízási út;
- gazdasági ajánlat, szerződés, inventory escrow és idempotens settlement;
- banki betét, hitel, fedezet, default és auditált főkönyvi alapok;
- Faction/Jurisdiction modell, hierarchikus terület, adó-, vám-, illeték- és
  támogatási policy;
- verified skillek, skilltanulás és külön Skill Builder folyamat;
- többagent-es, seedelt kísérlet, gazdasági eseménynapló és aggregált metrikák;
- verziózott world-mod lifecycle és diminishing XP mechanika.

Ezek működő technikai alapok, de még nem alkotnak önfenntartó, véges életű,
teljes gazdaságot és társadalmat.

## 1. Fogalmi rétegek: attribute, személyes skill, agent skill és capability

A további fejlesztésben négy külön fogalmat kell következetesen elválasztani.

### Attribute

Az `Attribute` veleszületett vagy nagyon lassan változó alapadottság. Nem
RuneScape skill és nem végrehajtható agent-eljárás. Lehetséges, még nem végleges
készlet:

- `intellect`: tanulás, tervezés, összetett összefüggések és elméleti munka;
- `dexterity`: finom kézi munka, pontosság és gyártási minőség;
- `vigor`: erőkifejtés és rövid intenzív fizikai teljesítmény;
- `endurance` vagy `vitality`: fáradás, tartós munka és testi terhelés tűrése;
- `perception`: észlelés, gyűjtés, veszély- és bűnészlelés;
- `social` vagy `will`: kommunikáció, vezetés, önfegyelem és stressztűrés.

Az NPC-k teljes induló attribute-pontkerete ne legyen azonos. Egy seedelt,
korlátozott statisztikai eloszlásból származzon, így létezzenek veleszületetten
kedvezőtlenebb és ritkán kiemelkedő adottságú karakterek is. Például egy adott
world profile-ban az átlagos teljes pontkeret lehet 10, miközben a tényleges
engedélyezett tartomány 5–15. Ezek nem végleges számok, csak a kívánt elv példái.

A kereten belüli elosztás se mindig optimalizált build legyen. Legyenek
kiegyensúlyozott generalisták, erősen specializált karakterek és kedvezőtlenül
kombinált profilok is. A világ ne legyen mesterségesen fair: valaki születhet
ritka adottságkombinációval, amelyből megfelelő életút mellett a világ legjobb
specialistája válhat.

Human player karakteralkotáshoz külön policy tartozhat. A játékos maga oszthatja
el a számára engedélyezett pontkeretet, vagy egy hardcore profilban ugyanaz a
seedelt genetikai lottó vonatkozhat rá, mint az NPC-kre.

### Személyes RuneScape skill

A Mining, Smithing, Fishing, Cooking, Thieving és más klasszikus skillek az
egyén megtanult személyes kompetenciáját jelentik. A 99-es szint továbbra is
jelenthet rendkívül magas, több évtizedes gyakorlással elérhető mesterszintet, de
nem szükséges minden karakternek minden skillben elérhetővé tenni.

### Verified agent skill

A verified agent skill végrehajtható eljárás: például egy útvonal bejárása,
bányászat és bankolás, főzés, szállítás, lockpick vagy egy üzleti megbízás
végrehajtása. Azt jelenti, hogy az agent ismeri és megbízhatóan végre tudja hajtani
a folyamatot. Nem azonos a karakter 1–99-es kompetenciájával.

### Facility és organizational capability

A `FacilityCapability` azt jelenti, hogy egy Property, műhely, gép vagy szervezet
képes bizonyos folyamatra. Példák:

- `mining.rune-extraction`;
- `smithing.basic-forging`;
- `smithing.rune-forging`;
- `storage.secure`;
- `cooking.commercial-kitchen`;
- később `machining.precision-1`.

Egy magas szintű ember facility és jogosultság nélkül ne tudjon minden magas
szintű termelést elvégezni. A facility ugyanakkor ne emelje mágikusan az alacsony
személyes kompetenciát: a személyes tudás és az infrastruktúra együtt alkotja az
effektív termelési képességet.

## 2. Skillpotenciál és tanulási pálya

A `SkillPotentialProfile` az attribute-okból, skill-specifikus súlyokból és
opcionális egyéni talent komponensből származtatott modell legyen. Legalább két
dolgot kezelhessen:

1. tanulási sebesség;
2. személyes potenciál vagy plafon.

A skillplafon nem pusztán balanszeszköz, hanem a világmodell fontos állítása: egy
karakter ne válhasson egyszerre világszínvonalú orvossá, kovácscsá, bányásszá,
vezetővé és más, egymástól távoli szakmák mesterévé.

Összehasonlítható policyk:

- klasszikus 99-es plafon mindenkinél;
- adottságfüggő kemény személyes plafon;
- adottságfüggő puha plafon, amely fölött a tanulás egyre lassabb;
- alacsonyabb személyes plafon, de erősebb facility/team hatás;
- ezek korlátozott kombinációi.

Elsőként csak néhány meglévő RuneScape skillen érdemes kipróbálni a rendszert,
például Fishing, Cooking, Mining és Smithing területen. Engineering, machining,
accounting, banking, management, medicine, law, logistics vagy politics ne
kapjon automatikusan külön 1–99-es skillt. Sok közülük jobban modellezhető domain
szabályként, szervezeti tudásként, facility capabilityként vagy verified
eljárásként. Új személyes skill csak konkrét, bizonyított modellezési hiányra
válaszoljon.

## 3. Közös szimulációs idő

A társadalom legtöbb későbbi rendszere időfüggő: éhség, alvás, fáradás, műszak,
bérlet, kamat, kopás, romlás, öregedés, betegség, termelési idő és halál.

Ezért külön `SimulationClock` szükséges, amely elválasztja:

- az engine ticket;
- a valódi wall clockot;
- a világ szimulációs idejét.

A szimulációs időarány legyen konfigurálható. Normál játékban lehet mérsékelt,
kísérletben pedig jelentősen gyorsított. Ugyanaz a seed és időprofil ugyanazt a
determinisztikus időbeli lefutást tegye reprodukálhatóvá, ahol a domain ezt
lehetővé teszi.

A logout önmagában ne legyen alvás, és egy játékos alvása ne gyorsítsa fel az egész
világot. A persistent world a human player távollétében is tovább működjön.

## 4. Világkezdet és történeti előállapot

Nem szükséges egyetlen kanonikus választ adni arra, hogy a világ nulláról vagy
már kialakult társadalommal induljon. A szerver több, verziózott
`WorldGenesisProfile`-t támogasson.

Lehetséges profilok:

- `blank-slate`: a RuneScape világépületei léteznek, de minimális gazdasági
  tulajdon, vállalkozás és készlet van;
- `frontier`: alapvető élelmiszer, eszköz, lakhatás és kis kezdővagyon;
- `seeded-economy`: generált tulajdon, vagyon, szakmák, vállalkozások, készletek és
  társadalmi kapcsolatok;
- `mature-society`: eltérő vagyoni rétegek, bérletek, hitelek, intézmények,
  működő vállalkozások és több lépcsős gazdasági kapcsolatok;
- `historical-burn-in`: más genesis profilból induló világ, amely meghatározott
  szimulációs ideig csak agentekkel fut, majd a kialakult állapotban nyílik meg
  human playerek számára.

A `historical-burn-in` különösen fontos lehet. Így a világ múltja nem pusztán
kézzel írt lore: egy több éves vállalkozásnak, tulajdonviszonynak vagy
kapcsolatnak tényleges eseménytörténete lehet.

Minden genesisből származó pénz, tárgy, Property, Business és intézményi vagyon
külön bootstrap eredetet kapjon. Később mérhető legyen, mi volt induló injekció és
mi keletkezett ténylegesen a futó gazdaságban.

## 5. Népesség és véges élet

A target társadalomszimulációban a karakterek nem halhatatlanok. A véges élet nem
külön „hardcore extra”, hanem a társadalommodell egyik alapfeltétele. Klasszikus
respawn vagy mortalitás nélküli mód továbbra is hasznos lehet kompatibilitási,
fejlesztői és kontrollkísérleti profilként.

A karakteridentitás már korán tartalmazzon legalább:

- létrejött-/születési szimulációs időt;
- életkort;
- lifecycle státuszt;
- későbbi mortalitási és estate hivatkozások helyét.

Később az életciklus kezelje az öregedést, egészséget, sérülést, halált,
hagyatékot és új népességi belépőket. A véges populáció utánpótlás nélkül csak
kihalni tud, ezért a halál érdemi aktiválásához legalább egy új NPC-belépési vagy
születési absztrakció is szükséges. A teljes család- és reprodukciós rendszer
külön későbbi modul lehet.

Az öregedés ne feltétlenül egy fix halálkort jelentsen. Egy seedelt, korlátozott
egyéni élettartam-hajlam és környezeti/egészségügyi tényezők együtt alakíthatják a
halálozást.

A generációváltás hosszú távon valódi társadalmi jelenségeket teremthet:
öröklés, mesterek és tanítványok, szakemberhiány, vállalkozások generációváltása,
vagyonkoncentráció és demográfiai sokkok.

## 6. Szükségletek, idő és életvitel

Külön `needs` mod kezelje elsőként az éhséget és a fáradtságot. Később
hozzáadható szomjúság, stressz, hőmérséklet vagy más szükséglet, ha valódi
szimulációs értéket teremt.

A rendszer célja gazdasági kereslet és életviteli döntések létrehozása, nem a
folyamatos mikromenedzsment.

Tervezési kérdések:

- milyen szimulációs időskálán romlanak az értékek;
- mi történik az offline human player szükségleteivel;
- milyen állapot csökkenti csak a hatékonyságot, és mi okozhat sérülést;
- milyen determinisztikus rutin kezeli az alapvető önfenntartást;
- mennyi élelmiszer- és pihenési kereslet szükséges stabil gazdasághoz.

Az alapvető self-care ne igényeljen normál esetben LLM-döntést. Kritikus éhségnél
az agent fogyasszon megfelelő rendelkezésre álló ételt; kritikus fáradtságnál
keressen engedélyezett alvóhelyet.

## 7. Alvás és offline human player

Az alvás a karakter világon belüli állapota, a logout pedig klienskapcsolati
állapot. A kettőt külön kell kezelni.

NPC-agentnél:

1. megfelelő alvóhelyet keres;
2. alvó állapotba kerül;
3. a világ szimulációs ideje tovább telik;
4. fatigue regenerálódik;
5. felébred és folytatja életét.

Human playernél:

1. engedélyezett alvóhelyen alvást indíthat;
2. a karakter alvó állapotban maradhat a szerveren;
3. a user kijelentkezhet;
4. a világ tovább működik;
5. visszatéréskor az eltelt szimulációs idő alapján a karakter lehet még alvó vagy
   már kipihent.

A teljes világ ne ugorjon automatikusan reggelig attól, hogy minden online player
alszik. Ez persistent, folyamatos társadalom, nem kis session-alapú co-op világ.

Később opcionális `offline-delegated` mód készülhet. A human player előre
korlátozott policyt adhat, például meghatározott verified munka elvégzésére,
kiadási plafonnal és veszélytilalommal. Alapból azonban a logout ne adja át a
karakter teljes kontrollját egy szabad LLM-agentnek.

## 8. Lakhatás, bérlet, biztonság és berendezés

A Property mod maradjon a fizikai ingatlan, tulajdon és belépés forrása. Külön
housing/tenancy domain kezelje a lakófunkciót.

A lakhatás ne bináris állapot legyen, hanem komfort- és biztonsági hierarchia.
Lehetséges szintek:

1. utca vagy fedetlen alvás;
2. ideiglenes menedék;
3. közös hálóterem/fogadó/munkásszállás;
4. bérelt privát szoba;
5. saját lakás vagy ház;
6. erősebben védett ingatlan.

A magasabb lakhatási szint adhat:

- jobb fatigue-regenerációt;
- nagyobb privát storage-kapacitást;
- jobb lopás- és betörésvédelmet;
- nagyobb komfortot és későbbi health/stress előnyt.

Az utcán alvó karakter kevésbé regenerálódjon, ne rendelkezzen biztonságos privát
storage-dzsal, és könnyebb célpont legyen pickpocket vagy más vagyon elleni
cselekmény számára. Közös szálláson már lehet lockbox vagy közös storage, amely
biztonságosabb az utcánál, de gyengébb egy privát szobánál.

Első MVP-ben meglévő, üres vagy alulhasznált Varrock-, Lumbridge- és Falador-
épületeket érdemes Property/HousingUnitként használni. Nem szükséges rögtön új
épületeket generálni.

A berendezés külön általános mechanika legyen: megvásárolt ágy, chest, asztal,
workbench vagy más engedélyezett bútor a Propertyn belül elhelyezhető és konkrét
capabilityt adhat. Ez nem igényli a későbbi RuneScape Construction skill pontos
lemásolását. A későbbi földvásárlás és új építkezés erre épülhet rá külön land
parcel és building rendszerrel.

## 9. Tárgyélettartam és folyamatos kereslet

Külön `item-lifecycle` mod vezesse be:

- tartósságot és használati kopást;
- javítást, karbantartást és alkatrészigényt;
- minőséget és készítői eredetet;
- később romlandó élelmiszert;
- javíthatatlan törést és újrahasznosítható maradványt.

Ez technikailag itempéldány-szintű állapotot igényelhet bizonyos tárgyaknál,
miközben más stackelhető termékek továbbra is kezelhetők gyártási tételként.
Bevezetés előtt explicit dönteni kell, mely kategória melyik modellt használja.

A kopás fontos anyag- és pénznyelő, de nem lehet olyan gyors, hogy minden
tevékenységet karbantartási grinddá változtasson.

Első vertikális szeletként egyetlen termelőeszköz-típus teljes
használat → kopás → javítás/csere ciklusát kell végigvinni.

## 10. Végső fogyasztás és első önfenntartó loopok

A gazdaságot nem a leghosszabb production chainnel kell kezdeni, hanem valódi
végső kereslettel.

### Élelmiszer

`Fishing/Farming → Cooking → Food → Hunger`

A hal vagy más étel ne csak Cooking XP input legyen. Legyen tényleges fogyasztója.

### Lakhatás

`Property → Bed/HousingUnit → Rent/Access → Sleep → Fatigue recovery`

A Property így valódi szolgáltatást termelő gazdasági asset lesz.

### Termelőeszköz

`Resource → Smithing/Crafting → Tool → Production → Wear → Repair/Replacement`

A késztermék értéke abból származzon, hogy ténylegesen lehetővé tesz vagy javít
termelést.

Ez a három loop együtt már képes alapvető munkamegosztást teremteni anélkül, hogy
új személyes skilleket vezetnénk be.

## 11. Agentizált gazdaság és az NPC szolgáltatók kiváltása

A target társadalomszimulációs profilban a gazdaságilag jelentős statikus NPC-ket
fokozatosan valódi agentek és intézmények váltsák fel.

Egy General Store ne legyen végtelen készletű és végtelen pénzű NPC. Legyen:

- Property;
- Business;
- valódi inventory/storage;
- treasury;
- tulajdonos vagy manager agent;
- alkalmazott agentek;
- beszerzési és árképzési policy.

Ha elfogy a rope, akkor tényleges hiány legyen, amíg valaki nem szerez vagy gyárt
újat. Ha az üzlet vezetője meghal vagy kilép, az intézménynek lifecycle-szabály
szerint kell tovább működnie, új vezetőt találnia vagy bezárnia.

Az ambient `Man`, `Woman`, állatok és mobok maradhatnak egyszerű nem-agent
entitások, amíg nincs tartós gazdasági vagy társadalmi állapotuk. Nem cél minden
vizuális NPC-hez LLM-et vagy teljes memóriát rendelni.

A klasszikus NPC shop fallback külön world policyként megmaradhat fejlesztői vagy
vanilla-közeli szerverhez, de a zárt társadalomszimulációs profilban kikapcsolható
legyen.

## 12. Moduláris vállalkozások és munkamegosztás

A jelenlegi merev `manager | worker` szerepkör csak MVP. A cél
vállalkozásonként definiálható `BusinessRoleDefinition`:

- stabil szerepazonosító és szabad név, például mindenes, eladó, futár, szakács,
  kovács vagy manager;
- engedélyezett exact verified skillek és feladattípusok;
- inventory-, storage-, treasury-, ár- és szerződésjogosultságok;
- felvételi, elbocsátási és delegálási jog;
- Property-, facility- és eszközhasználati entitlementek;
- bérmodell, műszak, munkaidő és teljesítési feltétel.

Egy tulajdonos létrehozhat széles jogosultságú `mindenes` szerepet, míg nagyobb
vállalkozás elkülönítheti az eladót, beszerzőt, futárt, raktárost, szakembert és
managert. A közös rendszer képességeket és jogosultságokat ismerjen; a konkrét
szerepkombináció a Business policyje legyen.

A Business saját inventoryja és storage-a különüljön el a tulajdonos vagy manager
személyes inventoryjától.

## 13. Termelési láncok, facilityk és szervezeti tudás

Az összetett termékekhez adatvezérelt receptek és több lépcsős workflow szükséges:

`nyersanyag → alapanyag → alkatrész → összeszerelés → ellenőrzés → késztermék`.

Egy `ProductionRecipe` vagy `ProductionWorkflow` követelhessen:

- több külön személyes RuneScape skillt vagy munkakört;
- megfelelő Property/facility típust;
- konkrét gépet és annak működő állapotát;
- szervezeti licencet vagy semantic tudást;
- verified végrehajtási eljárást;
- energiát, időt, inputot és minőség-ellenőrzést.

A szervezeti tudás ne automatikusan kerüljön minden alkalmazott memóriájába.
Lehet vállalati eljárás, oktatható skill, licenc vagy facility által hordozott
capability.

Az első hosszabb termelési lánc a meglévő RuneScape skillekre épüljön, például:

`érc → fém → szerszám/facility-upgrade`.

Csak később indokolt az `engineering` vagy `machining` személyes skill, ha a
meglévő modellek már nem tudják megfelelően leírni az egyéni kompetenciát.

## 14. Termelőtőke és gépek

A késztermékek ne mesterségesen kapjanak nagy értéket csak azért, mert a lánc
végén vannak. Tényleges gazdasági funkciót kell adni nekik.

Egy gép vagy facility-komponens például biztosíthat:

- új production capabilityt;
- nagyobb throughputot;
- jobb minőséget;
- kisebb hibaarányt;
- nagyobb storage- vagy szállítási kapacitást;
- alacsonyabb idő- vagy munkaerőigényt.

A tőke gazdasági értéke ebből emergálhat: valaki azért fizet érte, mert a jövőben
nagyobb vagy jobb termelést tesz lehetővé. Telemetria számolhat becsült
termelőtőke-értéket, de ez ne közvetlen, mesterséges gameplay ár legyen.

A tőkeeszköz maga is kophat és karbantartást igényelhet, így nem csak egyszeri
örök produktivitásbónusz.

## 15. Logisztika

A logisztika elsőként ne új 1–99-es személyes skill legyen, hanem domain,
facility/eszköz capability és verified procedure kombinációja.

A szekér, hajó vagy más szállítóeszköz adhat:

- kapacitást;
- sebességet;
- útvonal-korlátot;
- karbantartási és működési költséget;
- Property/storage betöltési és kirakodási pontokat.

A Business azt határozza meg, ki és milyen megbízásra használhatja. A fizikai
szállítást avatár hajtsa végre verified eljárással.

## 16. Bűnözés, tulajdonvédelem és igazságszolgáltatás

A meglévő Thieving skill bővíthető anélkül, hogy új `Burglary` személyes skillt
vezetnénk be. Lehetséges verified eljárások:

- pickpocket;
- lockpick;
- property burglary;
- container theft;
- későbbi fence/orgazdasági folyamat.

A lopás és betörés teljes következménylánccal együtt értelmes:

1. tulajdon- vagy hozzáférési jog megsértése;
2. zár, betörési módszer és Thieving-képesség;
3. tanú, észlelés, tárgyi nyom és evidence;
4. joghatóság és alkalmazandó szabály;
5. feljelentés, nyomozás vagy elfogás;
6. ítélet, bírság, kártérítés, börtön vagy más szankció.

A lakhatás és storage biztonsági hierarchiája közvetlenül kapcsolódjon ehhez. Az
utcán alvó karakter könnyebb célpont, egy közös lockbox nehezebb, a privát
szoba/ház pedig komolyabb behatolást igényeljen.

A bűn tényét, a bizonyíték erősségét és az ítéletet külön kell kezelni. Az LLM
legfeljebb korlátozott javaslatot adjon; vagyonelvonást, fogva tartást vagy halált
csak validált policy és hiteles evidence engedjen.

## 17. Egészség, öregedés, halál és hagyaték

Az egészség és sérülés külön domain legyen, amely később kapcsolódhat a needshez,
munkaterheléshez, bűnözéshez, harchoz, életkorhoz és alváshoz.

A `medicine` első változata nem feltétlenül igényel új személyes skillt. Lehet
Herblore + facility + verified treatment + semantic tudás kombinációja. Új
orvosi skill csak akkor indokolt, ha ez a modell már nem elegendő.

A hiteles halálesemény után:

- az avatar nem végezhet új fizikai műveletet;
- az agent aktív lifecycle-ja lezárul;
- a munkaviszony és intézményi szerep rendeződik;
- nyitott szerződések és tartozások estate folyamatba kerülnek;
- Property, Business-részesedés és más vagyon öröklési policy szerint rendeződik;
- episodic/social memória archiválható;
- semantic vagy szervezeti tudás csak explicit tudásátadással marad fenn.

A hosszú távú társadalmi szimulációhoz legalább egy új népességi belépési
mechanizmus is kell. Elsőként lehet seedelt új NPC-belépés; család, reprodukció és
gyermekkor külön későbbi bővítés maradhat.

## 18. Önfenntartó társadalom

Az első cél nem az emberi civilizáció teljes történetének újraszimulálása, hanem
egy gazdaságilag önfenntartó agentközösség létrehozása.

Egy megfelelő bootstrap után a közösség meghatározott ideig képes legyen:

- élelmet termelni és elfogyasztani;
- alvást és lakhatást biztosítani;
- dolgozókat foglalkoztatni és bérezni;
- alapvető termelőeszközöket létrehozni, javítani és pótolni;
- inputot beszerezni és outputot értékesíteni;
- vállalkozásokat működtetni;
- adót és szerződéses kötelezettséget teljesíteni;
- specializációt és munkamegosztást fenntartani;
- indokolatlan külső pénz- vagy tárgyinjekció nélkül tovább működni.

A teljes `blank-slate` civilizáció és a gyűjtögetés → földművelés → falu → város
történeti evolúció külön kísérleti irány lehet. A jelenlegi OSRS térképen az
`economic blank slate` praktikusabb: az épületek léteznek, de tulajdonuk és
gazdasági használatuk kezdetben minimális vagy szabad.

## 19. Külső gazdaság és bootstrap

A target zárt társadalomszimulációban ne a vanilla NPC shop legyen a külső
gazdaság. Ha egy world profile külső kereskedelmet enged, az explicit import/
export domain legyen véges szabályokkal és mérhető settlementtel.

Külön kell mérni:

- genesis/bootstrap injekció;
- belső agent↔agent és Business↔Business gazdaság;
- explicit külső import/export;
- admin vagy fallback beavatkozás.

Ez teszi lehetővé a valódi önfenntartási mutatókat.

## 20. Diminishing XP mint hosszú távú kísérlet

A diminishing XP mod technikailag működik, de csak akkor értékelhető érdemben,
ha már létezik valódi kereslet, fogyasztás, kopás, lakhatás, munkamegosztás és
facility-előny.

Összehasonlítandó policyk:

- klasszikus korlátlan ismétlési XP;
- tevékenység- és régióalapú diminishing XP;
- adottságfüggő tanulási sebesség;
- puha személyes skillplafon;
- facility/team által növelt effektív képesség;
- ezek korlátozott kombinációi.

A cél nem egyetlen univerzális optimum, hanem annak mérése, hogy melyik policy
milyen specializációt, mobilitást, egyenlőtlenséget, együttműködést és
rendszerkockázatot okoz.

## 21. Megfigyelhetőség

Az átláthatósághoz a nyers eseménynapló és az összesített metrika egyszerre
szükséges. Az architektúra alapja változtathatatlan domain-esemény legyen,
amelyből újraépíthetők a származtatott dashboardok.

### Operációs állapot

- engine, gateway, botok, queue-k, hibák és LLM-költségek;
- elakadt escrow, settlement, szerződés vagy mod-lifecycle művelet;
- adatfrissesség és legutóbbi sikeres feldolgozás;
- simulation clock és world genesis profil.

### Agent-idővonal

- cél, döntés, futtatott verified skill, helyváltoztatás és eredmény;
- bevétel, kiadás, étkezés, alvás, fáradás és kapcsolati esemény;
- életkor, health és lifecycle esemény;
- releváns memória és annak döntésre gyakorolt hatása.

### Vállalkozási nézet

- treasury, lefoglalt pénz, inventory, storage, eszközök és Propertyk;
- alkalmazottak, dinamikus szerepkörök, műszakok, munkák és bérek;
- termelési input/output, work-in-progress, árbevétel, költség és profit;
- facility capabilityk és tőkeeszközök;
- beszállítói és vevői szerződések.

### Piaci és világszint

- pénzkínálat, pénzáramlás és pénzforrások/-nyelők;
- ár, forgalom, készlet és hiány termékenként/régiónként;
- jövedelem- és vagyoneloszlás, munkanélküliség és mobilitás;
- lakhatási kihasználtság és homelessness;
- szükséglethiány, bűnözés, egészség és halálozás;
- skill-, célpont-, régió- és vállalkozási koncentráció;
- demográfiai korstruktúra és szakember-utánpótlás.

### Önfenntartási mutatók

Külön kiemelt mérőszámok:

- food self-sufficiency;
- tool/maintenance self-sufficiency;
- housing self-sufficiency;
- bootstrap-függőség;
- explicit import/export arány;
- készletnapok és hiányidő;
- fogyasztásból belső termelés által fedezett rész.

### Gazdasági függőségi gráf

A hiteles tranzakciókból és production eseményekből agent-, Business- és
termékszintű függőségi gráf képezhető. Mérhető például:

- melyik agent vagy Business kritikus;
- mely termék single point of failure;
- milyen mély a supply chain;
- mekkora a beszállítói koncentráció;
- milyen továbbgyűrűző hatása van egy szereplő kiesésének.

### Kísérleti nézet

- konfiguráció, genesis profile, seed, build/mod verzió és agentkohorsz;
- attribute/potential eloszlás;
- kontroll és kezelés közötti delta, idősor és bizonytalanság;
- egy aggregált értékről lefúrható exact események;
- reprodukálható export elemzéshez.

## 22. Javasolt függőségi sorrend

A konkrét munkát a `TASKS.md` tartalmazza, de a jelenlegi javasolt sorrend:

1. szimulációs idő és world genesis;
2. attribute-ok és skillpotential;
3. hunger/fatigue + alvás;
4. meglévő épületekre épülő housing/tenancy;
5. food consumption és egyetlen tool-lifecycle vertikális szelet;
6. gazdaságilag jelentős NPC szolgáltatók agentizálása és Business 2.0;
7. adatvezérelt production workflow, facility, storage és logisztika;
8. első valódi tőkeeszköz/facility-upgrade;
9. tulajdonvédelem, Thieving-bővítés és justice MVP;
10. health, öregedés, halál, estate és népesség-utánpótlás;
11. hosszabb önfenntartási és társadalmi kontrollkísérletek.

Ez függőségi sorrend, nem azt jelenti, hogy minden alrendszer végleges változatát
be kell fejezni, mielőtt a következő elkezdődik. A cél kis vertikális szeletek
fokozatos összekapcsolása.

## 23. Nyitott termékdöntések

- Pontosan melyik 5–6 attribute maradjon a végleges alapkészletben?
- Milyen eloszlásból származzon az NPC-k teljes attribute-pontkerete, és mennyire
  legyen ritka a kiemelkedő vagy nagyon kedvezőtlen karakter?
- Human player fix, választható vagy szintén véletlen teljes attribute-keretet kapjon?
- Milyen függvényből képződjön skillenként a tanulási szorzó és személyes potenciál?
- Mekkora legyen egy szimulációs nap, műszak és tipikus alvási ciklus?
- Mi történjen az offline, de nem alvó human player fatigue/hunger állapotával?
- Milyen korlátokkal legyen később engedélyezhető az `offline-delegated` mód?
- Mekkora legyen az utca, közös szállás, privát szoba és saját ház közti
  regenerációs és biztonsági különbség?
- Mely meglévő világépületek legyenek az első housing Propertyk?
- A bútorok dinamikus world objectként vagy más engine-adapteren keresztül
  kerüljenek elhelyezésre?
- Mikor váljon szükségessé valódi land parcel + új épület construction rendszer?
- Mely itemkategóriák kapjanak egyedi példányazonosítót és durabilityt?
- Milyen world profile-ban és milyen ütemben távolítsuk el a vanilla NPC shopokat?
- Mekkora bootstrap vagyon és készlet kell ahhoz, hogy a világ ne haljon ki még
  azelőtt, hogy a gazdasági loopok elindulnának?
- Mely genesis profil legyen az alapértelmezett fejlesztési és későbbi public
  survival szerverhez?
- Mennyi historical burn-in ad érdekes, de még érthető világot?
- Mikor indokolt valóban új személyes skill, például engineering vagy machining?
- Mi legyen a mortalitás alapmodellje és milyen életkorban kezdődjenek az
  öregedési hátrányok?
- Az első népesség-utánpótlás seedelt bevándorlás legyen-e, vagy rögtön családi/
  reprodukciós rendszer?
- Permadeath után mi örökölhető: vagyon, Business-részesedés, szervezeti pozíció,
  semantic tudás vagy csak explicit hagyatéki elemek?
- Mely metrikák jelzik a „jó” társadalmat: túlélés, önfenntartás, specializáció,
  mobilitás, stabilitás, innováció, egyenlőtlenség, szabadság, biztonság vagy ezek
  többcélú kompromisszuma?

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
