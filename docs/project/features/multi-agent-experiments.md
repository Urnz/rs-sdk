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

## Verziózott paraméterprofilok

Minden új multi-agent futás exact `profileId@version` kísérleti paraméterprofilt
igényel. A profil négy, egymástól függetlenül bővíthető listát tartalmaz:

- resource/célpont respawnidőt tickben;
- activity-kulcshoz tartozó XP-jutalomszorzót;
- itemenkénti vételi és/vagy eladási piaci árat;
- késztermék itemenkénti gazdasági értékét.

A listaelemek kulcs szerint egyediek, méret- és értékkorlátosak, kanonikus
sorrendűek. A teljes tartalom SHA-256 digestet kap, a `profileId + version` pedig
változtathatatlan: módosításhoz új szemantikus verzió szükséges. Exact ismétlés
idempotens, ugyanazon verzió eltérő tartalma fail-closed hibát ad. Az `origin`
megkülönbözteti a `manual`, `grid-search`, `automated` és `learning` eredetet,
de egyik sem állítja, hogy univerzális optimumot talált.

Az adminpanelen profil készíthető, listázható és futáshoz választható. A futás a
teljes profilt és digestjét saját SQLite rekordjába másolja, ezért a későbbi
visszajátszás nem függ egy változó „aktuális” konfigurációtól. Kontroll–kezelés
összehasonlítás csak azonos, sértetlen profildigesttel engedélyezett.

Ez a réteg reprodukálható kísérleti bemenet és provenance, nem általános
engine-konfigurációs kerülőút. Mind a négy kategóriaadapter elkészült. Egy profil
létezése önmagában nem bizonyít aktív értéket: ezt az engine-ből visszaolvasott
world-mod snapshot igazolja. Indítás előtt, még a futásrekord és a skill-dispatch
előtt, minden nem üres kategória exact aktív adaptert igényel, támogatott verzióval
és teljes konfigurációegyezéssel. Üres kategória adaptere nem lehet bekapcsolva.
Ugyanez a kapu a korábban eltárolt futások összevetésekor is érvényes.

### XP-kalibrációs adapter

Az admin profilkártyájának **XP-profil alkalmazása** gombja az exact profil
XP-listáját az alapból kikapcsolt `experiment.xp-calibration` hot-reload modba
írja. A művelet automatikus konfigurációmentést készít, aktiválja a modot, hot
reloadot kér, majd az engine aktív állapotából visszaolvassa a profilazonosítót,
verziót, teljes profildigestet és az XP-listát. Csak teljes egyezésnél sikeres; az
alkalmazás külön admin auditbejegyzést kap.

Az `activityKey` nem szabad szöveg az adapterben, hanem az alábbi selectorok
egyike. A felsorolás egyben a prioritás, tehát a legkonkrétabb találat nyer:

- `activity:<skill>/<script>/<target-kind>/<target-id>/<level>/<x>/<z>` – exact
  aktivitás és mező, például
  `activity:fishing/fishing-spot/npc/316/0/2924/3179`;
- `target:npc:316`, `target:loc:2090` vagy a megfelelő más targettípus;
- `script:fishing-spot` – normalizált engine scriptnév;
- `skill:mining` – minden, az adott skillhez tartozó XP-jutalom;
- `all` – végső globális fallback.

Ha egyik selector sem illeszkedik, az XP változatlan. Találatnál az engine a
profil szorzójával kalibrálja az alap XP-t, és csak ezután futtatja az opcionális
`economy.diminishing-xp` modot. A két hatás külön runtime számlálókat kap. Hibás
kalibrációs konfiguráció fail-open módon az eredeti XP-vel folytatja a diminishing
hookot, ezért az adapterhibából nem lesz elveszett jutalom. A mod kikapcsolása
azonnal visszaállítja az eredeti XP-folyamot, tartós gameplay-adatot nem töröl.

### Respawn-kalibrációs adapter

Az admin profilkártyájának **Respawnprofil alkalmazása** gombja az exact profil
respawnlistáját az alapból kikapcsolt `experiment.respawn-calibration` hot-reload
modba írja. Az XP-adapterhez hasonlóan automatikus backupot és auditbejegyzést
készít, majd csak az engine-ből visszaolvasott exact profilazonosító, verzió,
digest és targetlista egyezésekor jelez sikert.

A támogatott `targetKey` formák:

- `loc:<id>`, `obj:<id>` vagy `npc:<id>` – minden ilyen base resource típus;
- `loc:<id>:<level>:<x>:<z>` és ennek `obj`/`npc` változata – egyetlen exact
  világpont, amely mindig elsőbbséget élvez a típus-szintű selectorral szemben.

Például a `loc:2090` a 2090-es base loc minden kitermelés utáni timerét, a
`loc:2090:0:3285:3367` csak az adott mezőn található példányt állítja. A konkrét
ID az admin élő állapotában vagy az SDK `nearby.locs`, `nearby.groundItems` és
`nearby.npcs` megfigyelésében kereshető meg. A szimbolikus
`loc:copper-rocks:varrock-east` alak szándékosan nem elfogadott, mert nem kötődik
egyértelmű engine-entitáshoz.

A profil `ticks` értéke találatnál a ténylegesen ütemezett respawn timer. NPC és
ground-object esetén a vanilla játékosszám-skálázás előbb kiszámolódik, de exact
profiltalálat felülírja, így az alkalmazott kísérleti érték nem függ az online
létszámtól. Nem egyező target megtartja a vanilla timert. A mod csak az újonnan
ütemezett respawnokra hat; a már futó timereket hot reloadkor nem írja át. Hibás
konfigurációnál fail-open módon szintén a már kiszámolt vanilla timer marad.

### Bolti piaciár-adapter

Az admin profilkártyájának **Piaci árprofil alkalmazása** gombja az exact profil
`marketPrices` listáját az alapból kikapcsolt `experiment.market-calibration`
hot-reload modba írja. Az alkalmazás automatikus backupot és auditot készít, majd
az engine aktív állapotából exact profilazonosító, verzió, digest és teljes árlista
egyezést követel.

Az adapter az item globális cache-`cost` értékét nem módosítja, mert az az
alkímiára, a halálkori item-megőrzésre és más játékrendszerekre is nem kívánt
hatással lenne. Ehelyett két célzott RuneScript opcode kizárólag a shop
`adjusted_item_cost_buying` és `adjusted_item_cost_selling` folyamataiban kér
profilárat. Emiatt ugyanaz az exact ár jelenik meg az információs üzenetben és
kerül levonásra vagy kifizetésre a valódi tranzakcióban.

Egy market sor az engine `itemId` mellett külön `buyGp` és `sellGp` értéket
tartalmaz. Itt a `buyGp` az az összeg, amelyet a játékos fizet egy darabért a
boltnak; a `sellGp` az, amelyet a bolt fizet a játékosnak. Bármelyik irány lehet
`null`: abban az irányban továbbra is a vanilla készlet- és shopfüggő képlet fut.
A nulla explicit profilár, tehát nem azonos a `null` fallbackkel. Ismeretlen item,
kikapcsolt mod vagy adapterhiba szintén a vanilla képletre esik vissza.

A runtime metrikák elkülönítik a buy/sell lekérdezéseket, a profil-találatokat és
a vanilla fallbackeket. Ezek árlekérdezések, nem tranzakciószámlálók, mert a shop
több darab vásárlásakor vagy eladásakor darabonként újraszámolja az árat. A valódi
tranzakciók továbbra is a gazdasági eseménynapló hiteles shop eseményeiben mérhetők.

### Késztermékérték-adapter

Az admin profilkártyájának **Késztermékérték-profil alkalmazása** gombja a
`finishedProducts` listát az alapból kikapcsolt
`experiment.finished-product-valuation` hot-reload modba írja. Backup és audit
után csak az engine-ből visszaolvasott exact profilazonosító, verzió, teljes
profildigest és terméklista egyezésekor jelez sikert.

Ez az érték szándékosan nem itemár: nem módosítja a cache `cost` mezőjét, a
shopokat, az alkímiát, a halálkori item-megőrzést vagy a tényleges GP-egyenleget.
A multi-agent kísérlet a futáskor rögzített aktív modból és a kiválasztott exact
profilból értékeli a baseline és a végső teljes, legfeljebb 2000 különböző itemet
tartalmazó készletsnapshot különbségét. Külön közli a létrejött, az elfogyott és a
nettó termelőtőke-értéket, valamint az itemenkénti darab- és GP-deltát.

A kikapcsolt adapter `null`/nem elérhető metrikát ad, nem hamis nullás eredményt.
Ha az aktív mod provenance-e nem egyezik a futáshoz választott profillal, a mérés
fail-closed hibával megáll. A nulla `valueGp` érvényes kísérleti érték. Az adapter
kikapcsolása semmilyen játékállapotot nem módosít vagy töröl.

A `.local/admin/multi-agent-experiments.sqlite` megőrzi:

- a definíciót, seedet, digestet és státuszt;
- az engine-ből közvetlenül kiolvasott aktív world-mod revisiont, valamint minden
  mod exact verzióját, adatséma-verzióját, kapcsolóját és konfigurációját egy
  kanonikus, SHA-256 digestelt környezeti pillanatképben;
- az indítás előtti közös gazdasági baseline-t;
- az exact verziózott kísérleti paraméterprofilt és annak digestjét;
- agentenként a kanonikus, SHA-256 digestelt induló avatárállapotot: pozíciót,
  HP-t, run energyt, inventoryt, equipmentet, ismert bankot és teljes skill/XP
  listát, továbbá a goal-adattár induló snapshotját;
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

Az AgentState v15-től a célmódosításokat külön, append-only `agent_goal_event`
ledger is rögzíti. A cél létrehozása, státuszváltása és skill-hozzárendelése az
állapotírással azonos tranzakcióban kap monoton sorszámú eseményt. Régi célok
egyszeri `imported` állapotként kerülnek át, mert azok történeti létrehozási ideje
nem rekonstruálható hitelesen. A kísérlet kizárólag a saját kezdő- és záróideje
közé eső eseményeket fogadja el.

A hiteles shop- és player-trade coin-deltákból a rendszer a nettó változás mellett
külön bruttó bevételt és kiadást számol agentenként és teljes kohorszra. A shop
buy/sell események egyértelmű, egy terméket érintő inventory- és coin-deltáiból
termék/oldal szerint súlyozott egységár készül. Ellentétes coinirányú vagy több
termékre nem felbontható eseményből nem talál ki árat. A piaci árlista és a
bevétel/kiadás a kísérleti adminnézetben is megjelenik.

Az összesítés mellett a lezárás a futás kezdetéhez igazított, nulláról induló
perc-bucketeket is képez. Minden bucket tartalmazza az evidence-et adó agenteket, a
gazdasági események számát, bruttó bevételt és kiadást, termelést, felhasználást,
valamint az adott percben először megfigyelt agent–régió párok számát. A
célledgerből ugyanide kerül a célesemények, teljesülések, elakadások és elhagyások
száma. Ugyanez az
idősor agentenként is tartós része az eredménynek. Üres perceket a rendszer nem
talál ki és nem tárol; a timestampen kívüli eseményt nem húzza be a futási ablakba.
Ez rövid futásnál jellemzően egyetlen bucket, hosszabb kísérletnél viszont már
megmutatja, mikor változott a termelés, mobilitás, piaci aktivitás vagy célállapot.
Az evidence-agent nem online jelenlétmérő: egy mozdulatlan, gazdasági esemény
nélküli agent nem kerül bele pusztán attól, hogy a gatewayhez kapcsolódott.

A második snapshot továbbra is külön dispatch-állapot: a kísérlet addig `running`,
amíg minden `executing` résztvevőhöz meg nem érkezik a skill-exit és a hiteles
napló. Sikeres process-exit napló nélkül fail-closed hibának számít. Az ismételt
exit esemény nem írja felül a terminális rekordot és nem készít új snapshotot.

Ez a szelet már a teljes kohorsz tényleges futási ablakát és agentenkénti
tevékenységét méri. A tényleges kontroll–kezelés élő futtatását és a verziózott
profilok kézi/rácskereséses összevetését a
[2026-09-05-i elfogadási próba](phase12-calibration-2026-09-05.md) igazolja.

## Kontrollált futáspárok

Az adminpanel két már lezárt futást tud diminishing XP kontroll–kezelés párként
összevetni. Az összehasonlítás fail-closed: mindkét futásnak hibamentesen
`completed` állapotúnak, azonos seedűnek és pontosan azonos agentkohorszúnak kell
lennie. Az összes mod exact verziója, adatséma-verziója és konfigurációja azonos
kell legyen; kizárólag az `economy.diminishing-xp` aktív `enabled` értéke térhet
el, kontrollnál `false`, kezelésnél `true` irányban.

Azonos agentnév önmagában nem jelent azonos kezdőállapotot. Az összehasonlító
kapu ezért agentenként megköveteli az avatár-baseline digest és a teljes induló
goal-snapshot egyezését is. A banknak mindkét futás kezdetén ismertnek kell lennie;
két üres, de valójában ismeretlen bank nem tekinthető egyező állapotnak. Emiatt
egy valódi kontroll–kezelés pár előtt az agentmentéseket és az AgentState-adatot is
azonos baseline-ra kell visszaállítani. A digest az itemeket és skilleket
kanonikus sorrendben kezeli, tehát a kliens listasorrendje nem okoz hamis eltérést.

A kísérlet indítása függő hot reload, restart, migráció, rollback vagy elérhetetlen
engine esetén még az adatbázisírás előtt leáll. Így a kért adminbeállítás helyett
mindig a ténylegesen futó engine-állapot kerül a mérés mellé. Az összehasonlítás a
kezelés mínusz kontroll pénz-, XP-, gazdasági esemény-, skill-, célpont-, régió- és
célhoz kötött sikerdeltáit adja vissza, és auditbejegyzést készít. Ez még nem
kapcsolja át automatikusan a modot és nem állítja vissza a botmentéseket: a két élő
futást a kezelő indítja el külön, azonos előfeltételekkel.

A két ritka aktivitási idősort a rendszer nem falióra-időpont, hanem a futás
kezdetétől számított percszám alapján illeszti össze. A csak az egyik futásban
szereplő perc másik oldala nulla, ezért a kezelés mínusz kontroll eltérés
bucketenként is látható bevételre, kiadásra, termelésre, felhasználásra, új
agent–régiókra, gazdasági és céleseményekre, céllezárási kimenetekre és
evidence-agentek számára. Ismétlődő vagy
negatív percindexnél az összehasonlítás fail-closed leáll.

## Phase 12 lezárási protokoll

Az első lezárási kísérlet egy kézi és két előre rögzített rácspontot jelent,
profilonként külön kontroll–kezelés párral (összesen hat élő futás). A rács
kézzel felsorolható, például egyetlen XP-szorzó két értékével, a többi paraméter
rögzítése mellett. A `grid-search` címke önmagában nem bizonyít keresést:
előre fel kell jegyezni a tengelyt, az értékeket, majd minden jelöltet le kell futtatni.

1. Válassz legalább két exact player-agentet, közös seedet és azonos célleírást.
   Mentsd a leállított agentek avatár- és AgentState-baseline-ját, valamint a
   világ/mod állapotát. A bank legyen ismert. A többi autonóm futást állítsd le.
2. Hozd létre a változtathatatlan kézi és a két `grid-search` profilt. Minden
   nem üres kategóriájukhoz alkalmazd a meglévő adaptert az adminpanelen.
   Az üres kategóriák adaptereit kapcsold ki. Várd meg az aktív visszaolvasást.
3. Minden egyes futás előtt ugyanazt a baseline-t állítsd vissza; alkalmazd a
   jelölt profilt, majd állítsd a diminishing XP kapcsolót a futás ágának
   megfelelően. Indítsd ugyanazt a kohorszt és várd meg a terminális eredményt.
   Őrizd meg a hat külön futásazonosítót, a profilokat és a naplókat.
4. A meglévő kontroll–kezelés összehasonlítóval ellenőrizd a három párt.
   Ezután az alábbi admin API-val hasonlítsd össze a kalibrációkat.
5. Állítsd vissza a kísérlet előtti konfigurációt/állapotot, és rögzítsd a mért
   eredményt, a futási időket és a korlátokat. Csak ezután pipálható ki a feladat.

`POST /api/admin/multi-agent-experiments/calibration-compare`, a meglévő admin
hitelesítéssel és CSRF-védelemmel, a következő törzset fogadja:

```json
{
  "reason": "Phase 12 kézi és kétpontos rácskeresés összevetése",
  "manual": { "controlExperimentId": "manual-control", "treatmentExperimentId": "manual-treatment" },
  "grid": [
    { "controlExperimentId": "grid-1-control", "treatmentExperimentId": "grid-1-treatment" },
    { "controlExperimentId": "grid-2-control", "treatmentExperimentId": "grid-2-treatment" }
  ]
}
```

Ugyanez a **Kísérletek → Kézi és rácskereséses kalibráció összevetése** panelen
is elérhető. A választók csak hibamentesen lezárt, megfelelő provenance-ú és
kapcsolóállapotú futásokat kínálnak. Két rácspont kötelező, további pontok 16-ig
hozzáadhatók és eltávolíthatók. A szerver ellenőrzi a kiválasztott párokat;
hibánál a felület a sikertelen összevetést jelzi az előző eredmény helyett.

Az azonosítók helyére valódi, hibamentesen lezárt futások kerüljenek. Az API
2–16 különböző paraméterű rácsjelöltet fogad; újrafelhasznált futást, hibás
provenance-t, eltérő seedet, kohorszt, célleírást, avatár/goal-baseline-t vagy
nem kalibrációs modbeállítást elutasít. Minden páron belül csak a diminishing XP
kapcsoló térhet el. A válasz megőrzi a profilokat, a páronkénti hatást és az
`effectMinusManual` mezőben a rácsjelölt kezelés–kontroll hatásának eltérését a
kézi profil kezelés–kontroll hatásától. A siker és a hiba admin auditba kerül.

Ez leíró összevetés: nem választ univerzális optimumot, nem állít statisztikai
szignifikanciát, és nem generál vagy indít automatikusan rácsfutásokat. A seed a
planner választását rögzíti; az élő engine teljes véletlenfolyamát és az összes
világállapot azonosságát a jelenlegi összehasonlító kapu nem bizonyítja.

Migráció: nincs új adatbázisséma vagy meglévő rekordot módosító migráció.
A régi, alkalmazott profilt nem igazoló futások megmaradnak, de az összevetés
elutasítja őket. Visszaállítás: a kódváltozás visszavonható, az audit és a
futásnaplók megtartandók; új méréshez megfelelő aktív adapterekkel új futás kell.

Ellenőrzés (2026-09-05): `bun run check` sikeres, 609 teszt, 0 hiba; a külső
collision-oracle ellenőrzést a teszt elérhetetlenség miatt kihagyta. A helyi
stack elindítása után hat élő kohorszfutás és tizenkét agent-skill futás
hibamentesen lezárult. A kalibrációs API és a böngészős felület ugyanazt az
ellenőrzött összevetést adta. Az eredeti konfigurációk visszaállítása igazolt;
a [részletes jelentés](phase12-calibration-2026-09-05.md) rögzíti a korlátokat is.

## Bevételtermelő skillek

A réz- és vasérc Varrock General Store-ban történő értékesítésére két bounded,
forráskódos verified skill készült. Mindkettőt két külön 5 érces élő journal
igazolja. A külön helyszínű és tevékenységű
`fishing.karamja.lobster-to-general-store@1.0.0` két további, azonos paraméterű
élő körben a teljes Draynor → Port Sarim → Karamja → helyi bolt → Draynor
útvonalat teljesítette, körönként +55 gp nettó eredménnyel. A három alternatíva
nettó pénzváltozást, shop-sell telemetriát, eltérő régiót és két külön játékbeli
skillt ad a diminishing XP kontrollált összehasonlításához; exact allowlistre és
agenttudásba helyezhetők.
