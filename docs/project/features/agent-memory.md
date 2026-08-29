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

A következő integráció a bot élő megfigyeléséből frissíti a working memoryt, majd
a planner `execute-skill` döntését az agent-skillek meglévő, korlátozott futtatójához
adja át. Ezután jön az episodic, semantic és social memória külön tárolóval és
retrieval-szabályokkal.

