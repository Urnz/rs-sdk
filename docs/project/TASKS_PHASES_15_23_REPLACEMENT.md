## 15. Fázis – szimulációs idő és világkezdet

- [ ] Külön, verziózott `SimulationClock` modellt készíteni, amely elválasztja a
  szimulációs időt a wall clocktól és az engine ticktől.
- [ ] Konfigurálható időarányt adni normál játékhoz és gyorsított kísérletekhez;
  ugyanabból a seedből és időprofilból reprodukálható időbeli lefutást biztosítani.
- [ ] A tartós domain-eseményekhez közös szimulációs időbélyeget és monoton
  eseménysorrendet adni anélkül, hogy a meglévő audit-időbélyegeket felülírnánk.
- [ ] Meghatározni az online, offline, alvó és későbbi delegált player állapot
  időkezelési szerződését; a kijelentkezés önmagában ne legyen alvás és ne állítsa
  meg a világot.
- [ ] A karakteridentitást már most életciklus-kompatibilissé tenni: születési/
  létrejöttkori szimulációs idő, aktuális életkor és lifecycle státusz tárolható
  legyen, még akkor is, ha az öregedés hatásai csak későbbi fázisban aktiválódnak.
- [ ] Verziózott `WorldGenesisProfile` modellt készíteni legalább az alábbi
  kezdeti profilokra:
  - [ ] `blank-slate`: meglévő világépületek, de minimális gazdasági tulajdon és
    vállalkozási állapot;
  - [ ] `frontier`: alapvető eszközök, élelmiszer, lakhatás és kis kezdővagyon;
  - [ ] `seeded-economy`: generált tulajdon, vagyon, szakmák, vállalkozások és
    készletek;
  - [ ] `mature-society`: eltérő vagyoni rétegek, szerződések, bérletek,
    intézmények és működő gazdasági kapcsolatok;
  - [ ] `historical-burn-in`: más genesis profilból induló, meghatározott ideig
    agent-only módon lefuttatott világ, amely csak ezután nyílik meg játékosnak.
- [ ] A genesis eredményét seedhez, konfigurációhoz és digesthez kötni, hogy ugyanaz
  a világkezdet reprodukálható legyen.
- [ ] A bootstrapként létrehozott pénzt, tárgyat, ingatlant és vállalkozási vagyont
  külön genesis eredetként megjelölni, hogy később ne keveredjen a gazdaság által
  ténylegesen előállított értékkel.
- [ ] A world genesishez dry-run előnézetet, admin indítást, resetet és tesztet adni.

Elfogadási feltétel: ugyanabból a seedből és genesis profilból reprodukálható
világ indul, a szimulációs idő az engine/wall clocktól külön kezelhető, és minden
későbbi időfüggő domain ugyanarra a kanonikus időforrásra tud épülni.

## 16. Fázis – adottságok, potenciál és személyes kompetencia

- [ ] A RuneScape skillektől külön `AttributeProfile` modellt készíteni 5–6
  alapadottsággal; kezdeti jelöltek: `intellect`, `dexterity`, `vigor`,
  `endurance/vitality`, `perception`, `social/will`.
- [ ] Az NPC-k teljes induló attribute-pontkeretét ne fixen, hanem konfigurálható,
  seedelt és korlátozott statisztikai eloszlásból generálni, hogy létezzenek
  veleszületetten kedvezőbb és kedvezőtlenebb adottságú karakterek.
- [ ] A generált teljes pontkereten belül seedelt elosztást készíteni úgy, hogy ne
  minden karakter optimalizált buildet kapjon; generalista és erősen specialista
  profilok egyaránt létrejöhessenek.
- [ ] Human player karakteralkotáshoz külön world policyt adni: a kiosztható
  pontkeretet és az elosztást a játékos maga választhassa, vagy opcionálisan ugyanaz
  a genetikai lottó vonatkozhasson rá, mint az NPC-kre.
- [ ] Külön kezelni a három eltérő fogalmat:
  - [ ] RuneScape skill = személyes, 1–99 jellegű kompetencia;
  - [ ] verified agent skill = végrehajtható, megtanult eljárás;
  - [ ] facility/organizational capability = infrastruktúra vagy szervezet által
    biztosított effektív képesség.
- [ ] `SkillPotentialProfile` modellt készíteni, amely az attribute-okból,
  konfigurálható skill-specifikus súlyokból és opcionális egyéni talent
  komponensből képez tanulási szorzót és személyes potenciált/plafont.
- [ ] A személyes skillplafon legalább négy policyját támogatni: klasszikus 99,
  adottságfüggő kemény plafon, adottságfüggő puha plafon és facility-központú
  alacsonyabb személyes plafon.
- [ ] Első vertikális szeletként csak néhány meglévő skillre – például Fishing,
  Cooking, Mining és Smithing – bekötni a potenciált; a többi skill maradjon
  vanilla viselkedésű, amíg külön nem validáltuk.
- [ ] A tanulási és plafonhatásokat verziózott profilként, telemetriával és
  kontroll–kezelés kísérlettel mérhetővé tenni.
- [ ] Új személyes skill bevezetését külön döntési kapuhoz kötni: csak akkor
  kerüljön be például engineering vagy machining, ha a kívánt képesség nem
  modellezhető ésszerűen meglévő RuneScape skill + verified procedure + facility
  capability kombinációval.

Elfogadási feltétel: két azonos tapasztalatú karakter eltérő veleszületett
adottságok miatt eltérő tanulási pályát és potenciált kaphat, miközben az agent
eljárások és a facility-képességek továbbra is külön fogalmak maradnak.

## 17. Fázis – szükségletek, alvás és lakhatás

- [ ] Külön `needs` modot készíteni, elsőként legalább `hunger` és `fatigue`
  állapottal; thirst, stress és további szükségletek későbbi bővítésként jöhessenek.
- [ ] A szükségletek romlását a `SimulationClock` alapján számolni, konfigurálható
  offline és alvási szabályokkal.
- [ ] Az alapvető önfenntartást determinisztikus rutin kezelje: kritikus éhségnél
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

## 18. Fázis – fogyasztás, tárgyélettartam és első zárt gazdasági körök

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

## 19. Fázis – agentizált gazdaság és Business 2.0

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

## 20. Fázis – adatvezérelt termelés, facilityk, logisztika és tőke

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

## 21. Fázis – tulajdonvédelem, bűnözés és igazságszolgáltatás

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

## 22. Fázis – népességéletciklus, öregedés, egészség, halál és öröklés

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

## 23. Fázis – önfenntartó társadalom és hosszú távú kísérletek

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

---

A jelenlegi `16. Fázis – több-szerveres admin vezérlőközpont` változatlan tartalommal
`24. Fázis – több-szerveres admin vezérlőközpont` számozást kapjon.
