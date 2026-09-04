# Multi-agent gazdasági kísérletek

## Első Phase 12 szelet

Az adminpanel `Kísérletek` füle legalább két player-agentből seedelt kohorszt
indít. Ez nem külön szimulált világ: minden résztvevő a gateway ugyanazon élő
játékvilágában marad, miközben identitása, céljai, memóriája, döntési ledgere és
skill-runja továbbra is a saját stabil `agentId` és exact avatar alatt él.

A teljes futás írás előtti preflightot kap:

- minden agentnek léteznie kell;
- csak `player` szerep és exact `player` subject–identity–avatar kötés fogadható el;
- minden avatárnak egyedinek és legfeljebb öt másodperces friss online állapotúnak
  kell lennie;
- egy hibás résztvevő az egész kohorszt elutasítja, így nem keletkezik részleges
  kísérlet vagy véletlen skillindítás.

Sikeres preflight után a résztvevők ugyanabban az időablakban, `Promise.all`
dispatch-csel kerülnek a Phase 11-ből származó autonóm event gate-re. Ettől még az
LLM inference queue, az agentenkénti napi döntési keret és az exact skill-policy
változatlanul érvényes. A kohorsz nem ad új jogosultságot, csak több elkülönített
agent meglévő biztonságos ciklusát koordinálja.

## Determinizmus és perzisztencia

A futás definíciója a normalizált név, seed, célleírás és rendezett agentlista
SHA-256 digestje. A dispatch sorrend a `seed + agentId` hashből származik, ezért a
beviteli lista sorrendje nem változtatja meg. Minden indítás új kísérletazonosítót
kap, de azonos definícióhoz azonos digest és résztvevősorrend tartozik.

A seed nemcsak a dispatch sorrendet rögzíti. Ha egy agentnek ugyanazon aktuális
cél alatt több azonos prioritású aktív immediate célja van, ezek helyettesíthető
alternatíváknak számítanak. A kísérleti event explicit, auditálható
`selectionSeed` mezőként viszi tovább a futás seedjét, és a planner a
`SHA-256(seed + goalId)` rendezéssel választ. Azonos snapshot és seed ugyanazt a
célt/skillel adja, eltérő seedek viszont determinisztikusan szétoszthatják a
kohorszt az alternatívák között. Magasabb prioritású cél továbbra is mindig nyer;
seed nélküli normál működésben megmarad a stabil goal-ID sorrend.

A `.local/admin/multi-agent-experiments.sqlite` megőrzi:

- a definíciót, seedet, digestet és státuszt;
- az engine-ből közvetlenül kiolvasott aktív world-mod revisiont, valamint minden
  mod exact verzióját, adatséma-verzióját, kapcsolóját és konfigurációját egy
  kanonikus, SHA-256 digestelt környezeti pillanatképben;
- az indítás előtti közös gazdasági baseline-t;
- a dispatch lezárása utáni közös pillanatképet;
- agentenként az event gate teljes rekordját, planner státuszt, indokot és
  esetleges skill-run azonosítót;
- az exact avatar élő gateway-koordinátáiból képzett, szintenként deduplikált
  64×64 tile-os régiókat, az indulási régióval együtt;
- a `runId`-hoz tartozó hiteles, terminális skill-naplót;
- minden résztvevő lezárása után a közös végső gazdasági pillanatképet és az abból
  számolt pénz-, XP-, session-XP-, online- és legfeljebb száz készletdeltát.

A gateway minden futó kísérlet exact avatarjának tényleges player-pozícióját
figyeli. Az indulási koordináta kötelező preflight-adat, utána pedig csak
régióváltáskor ír, így a gyakori state frame-ek nem terhelik felesleges SQLite
írásokkal a gatewayt. A `(level, floor(x / 64), floor(z / 64))` kulcs egy futáson
és agenten belül deduplikált. Ez a mutató a gateway által ténylegesen megfigyelt
bejárt régiókat méri; két state frame közötti átmenetet nem talál ki.

Ettől külön a verified runtime a sikeres `walk-to`/`wait-for-area` lépések
deklarált és ellenőrzött célkoordinátáját, valamint a sikeres gather-lépések
célponttípusát és nevét strukturált journal-evidence-ként rögzíti. Ezekből külön
`skillEvidenceRegions` és egyedi `loc`/`npc` célpontok készülnek. Így az
adminfelület nem nevezi bejárt régiónak azt, ami csak egy skill sikeres
célkoordinátája volt.

Az összesített eredmény mellett minden résztvevő külön, tartós eredménysort kap:
nettó journal-GP, termelt és felhasznált tárgymennyiség, shop- és player-trade
darabszám, egyedi célpontok, megfigyelt élő régiók, skill-célrégiók, exact skill,
valamint a planner döntésének goal ID-ja. A dispatch előtti és lezáráskori
goal-adattári snapshot exact státusz- és revision-változást is ad. A
`successfulGoalRuns` továbbra is csak sikeres célhoz kötött skill-run; ettől külön
az `actualGoalChanges` és `actualGoalsCompleted` jelzi a cél tényleges tartós
változását, illetve teljesülését. A mérő nem módosít célállapotot automatikusan.

A hiteles shop- és player-trade coin-deltákból a rendszer a nettó változás mellett
külön bruttó bevételt és kiadást számol agentenként és teljes kohorszra. A shop
buy/sell események egyértelmű, egy terméket érintő inventory- és coin-deltáiból
termék/oldal szerint súlyozott egységár készül. Ellentétes coinirányú vagy több
termékre nem felbontható eseményből nem talál ki árat. A piaci árlista és a
bevétel/kiadás a kísérleti adminnézetben is megjelenik.

A második snapshot továbbra is külön dispatch-állapot: a kísérlet addig `running`,
amíg minden `executing` résztvevőhöz meg nem érkezik a skill-exit és a hiteles
napló. Sikeres process-exit napló nélkül fail-closed hibának számít. Az ismételt
exit esemény nem írja felül a terminális rekordot és nem készít új snapshotot.

Ez a szelet már a teljes kohorsz tényleges futási ablakát és agentenkénti
tevékenységét méri. A kontrollcsoportos replay és a hosszabb idősoros metrikák
továbbra is a 12. fázis következő részei.

## Kontrollált futáspárok

Az adminpanel két már lezárt futást tud diminishing XP kontroll–kezelés párként
összevetni. Az összehasonlítás fail-closed: mindkét futásnak hibamentesen
`completed` állapotúnak, azonos seedűnek és pontosan azonos agentkohorszúnak kell
lennie. Az összes mod exact verziója, adatséma-verziója és konfigurációja azonos
kell legyen; kizárólag az `economy.diminishing-xp` aktív `enabled` értéke térhet
el, kontrollnál `false`, kezelésnél `true` irányban.

A kísérlet indítása függő hot reload, restart, migráció, rollback vagy elérhetetlen
engine esetén még az adatbázisírás előtt leáll. Így a kért adminbeállítás helyett
mindig a ténylegesen futó engine-állapot kerül a mérés mellé. Az összehasonlítás a
kezelés mínusz kontroll pénz-, XP-, gazdasági esemény-, skill-, célpont-, régió- és
célhoz kötött sikerdeltáit adja vissza, és auditbejegyzést készít. Ez még nem
kapcsolja át automatikusan a modot és nem állítja vissza a botmentéseket: a két élő
futást a kezelő indítja el külön, azonos előfeltételekkel.

## Bevételtermelő előfeltétel

A réz- és vasérc Varrock General Store-ban történő értékesítésére két bounded,
forráskódos verified skill készült. Mindkettőt két külön 5 érces élő journal
igazolja. A külön helyszínű és tevékenységű
`fishing.karamja.lobster-to-general-store@1.0.0` két további, azonos paraméterű
élő körben a teljes Draynor → Port Sarim → Karamja → helyi bolt → Draynor
útvonalat teljesítette, körönként +55 gp nettó eredménnyel. A három alternatíva
nettó pénzváltozást, shop-sell telemetriát, eltérő régiót és két külön játékbeli
skillt ad a diminishing XP kontrollált összehasonlításához; exact allowlistre és
agenttudásba helyezhetők.
