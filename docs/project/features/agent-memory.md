# Agent identitás és memória

## Elkészült v1 alap

Az engine-től és az időleges botsessionöktől független `agent-state` modul
SQLite-ban tartósítja az identitást és a célokat. Az adatbázis alapértelmezett
helye a későbbi integrációban `.local/agent-state/agents.sqlite`; ez runtime
állapot, ezért nem kerül Gitbe.

Az identitás verziózott és validált: stabil agentazonosítóhoz egyedi játékosnév,
megjelenített név, háttértörténet, legfeljebb tizenkét személyiségjegy és opcionális
értékek tartoznak. A rekordok optimista `revision` mezője megakadályozza, hogy két
admin- vagy planner-művelet észrevétlenül felülírja egymást.

A célhierarchia kötelező sorrendje:

`life -> long-term -> current -> immediate`

Egy agentnek egyszerre egy aktív életcélja lehet. Minden alacsonyabb szintű cél
ugyanazon agent aktív, közvetlenül eggyel magasabb szintű céljára hivatkozik.
Aktív gyermekkel rendelkező szülő nem zárható le. A változtatások tranzakcióban
történnek, az állapot pedig adatbázis-újranyitási teszttel ellenőrzött.

A `buildCoreIdentity` determinisztikusan, prioritás szerint rendezi az aktív
célokat, és beállítható karakterkorláttal állítja elő a minden stratégiai döntéshez
adható rövid kontextust. Ebbe szándékosan még nem kerül memória: a későbbi
visszakeresés csak releváns elemekkel egészítheti ki.

A v2 séma már egyetlen, felülírható working-memory rekordot is tart agentenként.
Ez rövid helyzetösszefoglalót, aktuális tevékenységet, opcionális világpozíciót és
legfeljebb tizenkét rövid megfigyelést őriz az észlelés időpontjával. A frissítés
optimista revision-védett és újraindítás után is megmarad. A
`buildDecisionContext` csak a beállított korhatárnál frissebb working memoryt
illeszti a core identity után; alapértelmezésben az öt percnél régebbi pillanatkép
kimarad, nehogy a planner elavult helyzetből döntsön.

A v3 sémában az azonnali cél opcionálisan egy egzakt, változtathatatlan
`skill-id@verzió` hivatkozást kap. Az agentenkénti skillismeret ettől külön,
tartós rekord: `known`, `preferred` vagy `blocked`. Ettől a közös skillkatalógus
nem módosul, és egy újabb skillverziót az agent sem kap meg automatikusan.

Az első `planNextAction` szabályalapú planner a legmagasabb prioritású aktív
azonnali célt választja. Csak friss working memory és az egzakt skillverzió
ismerete, valamint a futtató által átadott megbízható katalógusban való jelenléte
mellett ad `execute-skill` döntést. Hiányzó vagy régi megfigyelésnél,
ismeretlen/blokkolt skillnél, illetve cél hiányában külön, nem végrehajtó eredményt
ad. A decision key az érintett rekordok revisionjeiből készül, ezért ugyanaz a
snapshot ugyanazzal az időparaméterrel teljesen reprodukálható.

Az első élő integráció egyetlen, ellenőrizhető ciklust futtat. A gateway friss
botállapotából korlátozott working memory készül, a persistent identity
játékosnevét összeveti a csatlakozott karakterrel, betölti a számára látható
verified skillkatalógust, majd meghívja a plannert. Alapból dry-run, tehát a döntést
csak kiírja; `--execute` mellett a már meglévő korlátozott `SkillExecutor` kapja az
egzakt skilldefiníciót. A futás ugyanazt az aktív marker- és változtathatatlan
journal-mechanizmust használja, mint a kézi agent-skill futtatás.

A working-memory megfigyelő helyet, HP-t, inventory-összefoglalót, közeli NPC-ket
és objektumokat, valamint a fő UI-állapotokat rögzíti. Játékosok chatjét nem teszi
az állandó döntési kontextusba; a későbbi social/episodic feldolgozásnak ezt külön,
nem megbízható bemenetként kell kezelnie.

## Adminpaneles kezelés

Az adminpanel `Agentek` füle a botkatalógusban már létező játékoshoz tud persistent
identitást létrehozni. Itt szerkeszthető a háttértörténet, a személyiség és az
értéklista, felépíthető a négyszintű célhierarchia, illetve egy verified, megosztott
skill egzakt verziója `known`, `preferred` vagy `blocked` állapotba helyezhető.
Minden írás optimista revision-védett és indoklásköteles auditált adminművelet.

Az agentkártya megmutatja a friss working memoryt, a korlátozott döntési contextet
és a planner aktuális, nem végrehajtott előnézetét. A `Planner dry-run` friss online
botállapotból új working memoryt ír és döntést készít, de nem indít játékbeli
műveletet. A külön `Döntés végrehajtása` gomb újabb indoklást és megerősítést kér;
csak friss online bot, elérhető credential, üres futási slot és egzakt verified
skill esetén indítja el a meglévő, naplózott skillfuttatót.

## Episodic memória

A v4 séma append-only, konkrét eseményeket tartalmazó episodic tárral bővült.
Egy emléknek stabil azonosítója, típusa, eseményideje, rövid összefoglalója,
részlete, 0–100 fontossága, kapcsolt céljai, szereplői és címkéi van. A forrás
`manual`, `system`, `skill` vagy `planner`; a megbízhatóság külön `trusted` vagy
`untrusted`, ezért például egy játékos chatállítása tárolható anélkül, hogy
automatikusan ténnyé válna. Az opcionális elévülési idő után az emlék megmarad az
auditálható történetben, de nem kerül elő döntéshez.

Az `externalKey` azonos külső esemény ismételt feldolgozását idempotenssé teszi.
Azonos kulcs és azonos tartalom a már létező emléket adja vissza; eltérő tartalom
ütközésként, fail-closed hibával áll le.

A determinisztikus retrieval fontosságot és kor szerinti frissességet pontoz,
majd az aktív cél-, szereplő-, címke- és szövegegyezést súlyozza. Lejárt, jövőbeli,
túl régi és alapértelmezésben nem megbízható emléket kizár. Az eredmény stabil
sorrendű, darabszám-korlátos, és csak ez a kiválasztott rész kerülhet a karakterben
is korlátozott döntési contextbe.

Az Agentek fül `+ Emlék` művelete kézi eseményrögzítést ad aktív célokhoz. A kártya
az utolsó harminc eseményt belső görgetéssel mutatja; a jelenlegi célokhoz releváns
emlékeket zöld jelölés és a retrieval pontszáma emeli ki. Plannerrel ténylegesen
elindított skillekről automatikus, célhoz kötött `action` emlék készül.

## Semantic memória

A v5 séma az eseményektől elkülönített, tartós tudástárral bővült. A tudás egy
strukturált `subject – predicate – object` állítás és egy ember számára olvasható
összefoglaló. Típusa világ-, gazdasági, útvonal- vagy eljárásismeret; tartozhat
hozzá confidence, aktív cél, címkék, érvényességi idő és legfeljebb húsz bizonyító
episodic emlék. A bizonyíték és a cél csak ugyanahhoz az agenthez tartozhat.

Ugyanarra az agentre és azonos alany–állítás párra egyszerre csak egy aktív tudás
engedélyezett. Megváltozott ár, útvonal vagy világszabály esetén az új tudás explicit
`supersedesId` kapcsolattal, egyetlen tranzakcióban teszi felülírttá a régit. A régi
rekord, revisionje és bizonyítéka megmarad, ezért a tudás változása később is
visszakövethető. Külső konszolidációhoz itt is rendelkezésre áll idempotens
`externalKey`, eltérő tartalmú kulcsütközésnél fail-closed viselkedéssel.

A semantic retrieval csak az időben érvényes, aktív és minimális confidence fölötti
tudást használja. Confidence-, cél-, címke- és szövegegyezés alapján stabil sorrendet
képez; a felülírt tudást kizárja, a vitatott állítást pedig csak explicit kérésre
engedi vissza. A döntési context külön `Relevant semantic knowledge` blokkot kap,
de továbbra is a teljes karakterkorláton belül marad.

Az Agentek fül `+ Tudás` párbeszédében célok és korábbi episodic bizonyítékok
kapcsolhatók az állításhoz. Korábbi aktív tudás felülírásakor az alany, az állítás
és a címkék automatikusan kitöltődnek; az új értéket, összefoglalót és confidence-t
az admin adja meg. A kártyán zöld jelölést kapnak az aktuális döntéshez releváns
semantic elemek.

## Társas memória

A v6 séma agentenként irányított kapcsolatokat tárol stabil szereplőkulccsal és
megjelenített névvel. A bizalom és a vonzalom `-100..100`, az ismerősség
`0..100` skálán szerepel. Az `agent tartozik a szereplőnek` és a `szereplő
tartozik az agentnek` pénzösszeg külön mező, így a követelés iránya nem veszhet
el. Jegyzetek, címkék, utolsó interakció és ugyanazon agent episodic bizonyítékai
kapcsolhatók a rekordhoz; önmagával az agent nem hozhat létre kapcsolatot.

A kapcsolathoz tartós vállalások adhatók. Egy vállalás leírja, ki tartozik a
teljesítéssel, mi a feladat, mekkora opcionális GP-értéke és határideje van, illetve
mely episodic emlék bizonyítja. Az `open` állapot egyszer válthat `fulfilled`,
`broken` vagy `cancelled` állapotra; a lezárt vállalás változtathatatlan marad.
Minden módosítható társas rekord optimista revision-védett.

A determinisztikus social retrieval az aktuális cél szövegét, a szereplőt, címkéket,
bizalmat, vonzalmat, ismerősséget, tartozást és nyitott vállalásokat pontozza. Csak
a korlátozott, stabil sorrendű eredmény kerül a döntési context `Relevant social
memory` blokkjába, és abban már lezárt vállalás nem jelenik meg. Az Agentek fülön
kapcsolat rögzíthető és szerkeszthető, vállalás nyitható és lezárható; minden írás
indokláskötött admin auditot készít.

## Tartós agentmodell

- **Identity:** név, háttértörténet, személyiség.
- **Goals:** életcél, hosszú távú, aktuális és azonnali cél.
- **Memory:** working, episodic, semantic és social memória.
- **Relationships:** bizalom, kötelezettségek és fontos társas állapot.
- **Assets:** pénz, ingatlan, vállalkozás, követelés és tartozás.
- **Skills:** ismert/engedélyezett magas szintű képességek.

## Context-stratégia

Minden döntéshez jár egy nagyon rövid core identity, az aktuális helyzet és cél.
A nagyobb emléktárból csak relevancia, frissesség, érintett szereplő és cél alapján
kerülnek elő elemek. Céltartomány: nagy élettörténet mellett is körülbelül
1000–3000 token releváns context egy stratégiai döntéshez.

## LLM előtti teszt

A sémát, perzisztenciát, visszakeresést és konszolidációt először szabályalapú
plannerrel kell bizonyítani. Így az LLM nem rejti el az állapotkezelési hibákat.

## Következő szelet

Az agent pénz-, ingatlan-, később vállalkozás- és követelésállapotának stabil
hivatkozásokkal való összekapcsolása következik. Ezután a memóriakonszolidáció és
az összes tartós memóriatípust együtt használó szabályalapú planner-teszt zárhatja
le a 10. fázist.

