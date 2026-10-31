# SI-C07/3 – Négy founder valódi lakhatási próbája

2026-10-31. Konkrét vékony próba az implementált owner/paid housing út után.
Nem hosszú C07 run, minimum-assessment vagy ratio-validálás. Provider/autonomy/
builder off;0 API-kérés és0 költség. Csak helyi/private LostCity.

## Hipotézis és kötött indulóállapot

Új saját `backups/si-c07-founder-housing-20261031-a/workspace`, a normál
`create-founder-baseline` packed diagnosztikai profillal. A korábbi sealed
opening és az A–F eljárás-trial világok érintetlenek. Az eredeti négy founder,
700–700 GP, négy nyitó étel, harvest32, személyes XP, pozíciók és288:1 clock
marad. A1.4.0 fixture saját normál applied genesisét/source manifestjét és
új native tool setupját a futás elején visszaellenőrizzük. Régi eredmény,
meglévő foglalás, korábbi run vagy mozgott óra nem vehető át friss nyitásnak.

- `silessor`: owner, bed-1,2973/3328/0, saját ingyenes álló jog.
- `sifisher`: paid bed-2,2973/3330/0, normál500 GP rent és30 GP komp.
- `sicook`: paid bed-3,2973/3332/0, normál500 GP rent és30 GP komp.
- `sicourier`: paid bed-4,2977/3332/0, normál500 GP rent, nincs komp.

A díjakat a négy kliens tényleges loginja és opening megfigyelése után,
a normál gateway-admission → typed engine → escrow/payment → domain-finalize
úton rendezzük. A három út ezután párhuzamos; így a skill már a házba is
érvényes joggal érkezik. A tulajdonos először rövid normál SDK útvonalon
megközelíti a saját ágyát és natívan elalszik. A másik három a publikált
`procedure.travel.native-sites@1.0.0` normál SkillExecutor útján utazik,
majd SDK-val az exact kijelölt ágy szomszédos járható mezőjére megy.
Teleport, native coordinate assignment, kézzel írt receipt vagy szerszám-damage nincs.

## Időkeretek és megállás

- Új-stage IO külön provisioning fázis, a natív bootstrap legfeljebb90s.
- Élő runner összesen legfeljebb480s; ebből saját engine/gateway readiness
  egyenként60s, négy Lite login legfeljebb60s. Minden fázis és actor naplózott.
  A két20s shutdown-ablak a480s része, nem utólag hozzáadott idő.
- Az utazási eljárás meglévő360s limitje változatlan; nincs vak újraindítás.
  Final bed-approach külön legfeljebb30s. A runner teljes kerete mindig elsőbbséget élvez.
- Native payment/sleep ACK nem bizonyíték: a kanonikus forrásból azonnali readback kell.
  Source/identity/profile drift, nem várt opening/mutation, route/run failure,
  slot/lease expiry, halál, hiányzó receipt, subprocess error vagy wall-limit esetén STOP.
- Clean gateway quiescence, engine save/stop, saját Lite/SDK processzek zárása,
  majd paused clock. Forced stop megőrzött FAIL/reconciliation, nem PASS.
- Két drága kudarc után kisebb konkrét diagnosztika kell, nem újabb teljes próba.

## Elvárt bizonyíték

Négy actual SDK opening és négy fizikai route/bed-arrival megfigyelés. Három
completed exact published travel run/admission; az owner útja normál SDK-val.
Három natív paid receipt és prepaid tenancy, egy owner reservation; négy
natív hash-láncos sleep witness, ugyanazon actor/lifecycle/world/clock/slot,
négy PlayerTime sleep-context és mentett végpozíció. Két valódi natív komp-díj.

Mérleg: GP-nyitás2800, rent összesen1500 belső transzfer, komp60 valódi sink;
záró actor GP2740, konyhai treasury1000 változatlan. Nyitó étel megmarad, nincs
harvest/import/procurement ebben a housing-próbában. A sleep után a mozgást
tiltó normal native állapot és a tartós current entitlement is ellenőrzendő.
Leállítás után DB+WAL együtt, readonly újranyitás/hash és source-manifest egyezés.

A futás sikeres eredménye lakhatási mechanika és route proof. Nem igazol
95% időbeli minimumot,1+7 napot, ételtermelést,51 warmup tool-use-t vagy288:1
gazdasági realizmust. A3. csomag lezárása a rögzített feltételek alapján külön
megállapítandó, a4. ratio-próba ettől még nem indul automatikusan.

## Megőrzött első eredmény

A-stage létrehozás `20261031-124738-482` PASS56,800s; exact offline inspect
`124900-475` PASS1,310s. Élő `124914-473` FAIL29,968s: a négy Lite és
négy eredeti SDK opening sikerült, de a szülőfolyamat managed környezetéből
kimaradt a `GATEWAY_URL`. A normál domain-path guard az első reservation
előtt elutasított;0 paid/owner admission és0 sleep. Clean stop/paused.
Az A-világ és a hibanapló megmarad, nem replayeljük vagy minősítjük át.

Javítás a futtatóban, nem a guardban: a szülő ugyanazt a teljes exact
managed endpoint-kötést kapja. Az új pure guard-próba a hiányzó gatewayt
kifejezetten elutasítja: `125038-667`,3 PASS1,027s. Új B-stage-ből folytatjuk,
azonos változatlan gazdasági openinggel, új source/setup kötés alatt.

## B-kudarc és szűk útvonal-diagnosztika

B-stage `125134-890` PASS30,232s; inspect `125500-290` PASS1,315s.
Élő `125510-736` FAIL55,997s: mind4 SDK opening, három valódi500 GP rent
és egy owner reservation sikerült. Az owner final-approach célja2972/3328
volt, de az SDK collision szerint ez blokkolt. A részleges út nem érkezés;
az exact pozícióassertion elutasította.0 sleep witness, clean stop/paused;
a három bérlet és a megőrzött hibanapló nem replayelhető friss openingként.

Két hiba után nem újabb teljes próbával folytattuk. A külön offline
`125644-570` diagnosztika22,323s alatt mind4 ágy nyolc szomszédját a valódi
SDK collision/pathfinder adatokkal vizsgálta meg, engine és DB-módosítás nélkül.
A2972/3328 mező blokkolt; az owner2972/3329 mezője teljes útvonallal elérhető.
A javított kliens távolság szerint választ szomszédot, kizárólag exact végpontú,
teljes SDK útvonalból; minden partial path elutasított. Sikertelen walk nem
fogadható el arrivalnak. A gazdasági/slot/minimum feltételek változatlanok.

A regresszió közvetlenül a valódi collision adatokkal ellenőrzi mind4 bed
szomszédválasztását és az elérhetetlen eset elutasítását. Csak e szűk próba
és az érintett TypeScript-projekt után készülhet új C-stage. Az A/B forrásai,
nyugtái és sikertelen live eredményei változatlanok maradnak.

## C-kudarc: átmeneti érintés nem stabil megállás

`125756-356`:4 célzott eset és root+három új script TS PASS73,299s;
`125912-498`:3 közvetlen preflight-fogyasztó PASS3,521s. C-stage
`125937-976` PASS27,296s. C-live `130011-602` FAIL301,925s, clean stop/paused.
Négy eredeti SDK opening, három rent és egy owner reservation; három exact
published travel completed és mind4 SDK bed-arrival. Owner sleep34,183s;
cook194,803s; fisher195,864s. Courier arrival291,322s, natív sleep elutasítva.

A külön readonly `130548-495` diagnosztika0,685s alatt igazolta: a courier
mentett natív pozíciója2975/3332, az SDK arrival-frame2976/3331 volt. Az utolsó
SDK parancs2975/3332 felé még mozgást hagyott maga után; az átmeneti target-frame
nem igazolta a végleges megállást. A natív távolságguard helyesen elutasított.
A záró GP170/170/200/2200, két komp és három sleep igazolt.
A C-világ forrását, állapotát és FAIL kimenetét sem írjuk át vagy folytatjuk.

Javítás: a final-approach után egyszeri normál SDK-walk parancs a kijelölt
pontos szomszédmezőre, majd három új, friss natív server-tick alatt azonos
pozíció, emelet, életciklus és élő állapot kell. Elutasított parancs, stale frame
vagy bármely drift FAIL; nincs retry és nincs lazított natív sleep guard.
A teljes approach továbbra30s. A regresszió residual-movement/rejected-stop/
position-drift eseteket fed le.

Új teljes négyszereplős futás előtt külön **owner→bed-4 SDK mozgásdiagnosztika**
kell friss saját D-stage-en: egy Lite/SDK, legfeljebb90s összesen, abból40s
shutdown-tartalék. Normál ingatlantulajdonos, nincs rent/owner admission, GP- vagy
sleep-művelet, másik szereplő utaztatása. Csak a hosszú C-kör végén jelentkező
keresztirányú bed-4 mozgást és stabil megállást vizsgálja. Külön eredményfájl;
nem teljes housing PASS, minimum vagy final-baseline, nem replayelhető teljes runként.

A kliensréteg konkrét hibája is feltárt: `lite/movement.ts` az aktuális mezőre
adott normál game-clicket packet nélküli no-opként kezelte. Az engine meglévő
`MoveClickHandler` egyetlen current-tile útvonallal tudja törölni a régi
waypointokat, ezért a Lite most ezt a szokásos MOVE_GAMECLICK packetet küldi.
Az already-in-range OPCLICK gyorsút változatlan. Két külön, socket/cache nélküli
packet-próba ellenőrzi a stop pontos bájtjait és a normál walk/interaction határt.
Nincs új natív admin parancs vagy engine guard-változás.

## D szűk diagnosztika

`130838-254`:5 housing-regresszió és root/script TS PASS67,926s.
`131100-064`:2 Lite packet-eset és webclient TS PASS27,360s.
D-stage `131204-889` PASS24,704s; az egyetlen owner→bed-4 kör
`131248-313` PASS39,135s, saját live idő38,055s. Három külön friss SDK-tick
61/62/63 alatt2976/3331/0, a leállított natív save pontosan ugyanott;
700 GP,0 admission és0 sleep. Readonly végellenőrzés `131400-135` PASS0,764s.

A diagnosztikai reader két toolinghibája is megőrzött: a sleep-művelet nélküli
világban helyesen hiányzik a lazy `native_housing_sleep` tábla (`131332-235`);
egy readonly SQLite-open pedig létrehozhat0 bájtos WAL-lockkísérőt (`131346-183`).
Az utóbbi nem tartalmaz WAL-headert vagy adatframe-et. A végső reader a teljes
DB-t és minden nem üres WAL-t hash-eli előtte/utána, a0 bájtos WAL és SHM
metadata külön, explicit kizárás. Tartalombájt/migráció változás nem engedett.
Az eredeti D-világot újrakezdés vagy új mozgás nélkül olvastuk vissza.

A tényleges natív save megerősíti a szűk javítást; csak ezután indul új,
azonos openingű E-stage teljes négyszereplős próba. A sikertelen A/B/C és a
külön diagnosztikai D nem válik teljes housing vagy minimum eredménnyé.

## E teljes eredmény: négy founder PASS

Workspace `backups/si-c07-founder-housing-20261031-e/workspace`, stopped/paused.
Stage `131448-792` PASS27,502s. A teljes élő kör `131620-378` PASS241,609s;
saját teljes live idő240,552s, a változatlan480s határon belül. Négy eredeti
SDK opening, három500 GP native rent és prepaid tenancy, egy owner reservation,
három exact published travel run, négy tényleges bed-arrival/stabil megállás
és négy natív hash-láncos sleep witness. Sleep-idők: owner38,598s,
cook173,166s, fisher173,711s, courier236,009s. Shutdown/paused240,550s.

[Gépi eredmény](SI_C07_FOUNDER_HOUSING_RESULT.json): a frozen E-reader két
független readonly visszaolvasása `132028-574` PASS1,418s. Aktuális négy
entitlement és eredeti lifecycle/world/clock, négy PlayerTime sleep-context és
kanonikus save, három paid receipt és két natív30 GP ferry charge egyezik.
Záró GP170/170/200/2200, összesen2740; a1500 rent belső transzfer,60 valódi
sink. Négy nyitó cooked lobster, kitchen treasury1000/reserved0 és courier
durability100 tool megmaradt;0 food/harvest/tool-use művelet. DB és nem üres
WAL bájtok a readonly olvasás előtt/után azonosak; minden frozen source SHA egyezik.

- Fixture `0c8d509361c9a69fd75107152f4ea6d424fa40a84083845bbe9eff51ec538940`.
- Source manifest `13ad7cd0d6dec734ea3ac83a4ea6772f52b5825cbc00167126015549317d65f4`.
- Opening seal `57db7a1c75f24332566be5d85f857e23d9b7b3d750c13c33e4bcca2ca6c63e40`.
- Setup `5d7a89ee0bf75c83f623c9fe4f97571ab11cec1eac82dae97493e0023940e45e`.
- Result `d017794de20215782eb7c88654604086bcfbdbd11beb27437497104135cc5c29`.

A fixture/world ID determinisztikus, az A–E klónoknál azonos lehet; az E
workspace és a fenti source/seal/setup/operation/witness kötés együtt azonosít.
Az eredeti sealed common opening és az A/B/C FAIL, valamint D diagnosztika megmaradt.

**A3. implementációs/integrációs csomag lezárt.** A korábbi normál eljárás-
trial/review/publication, közös offline installation és a mostani négy founder
housing út teljesíti a rögzített mechanikai feltételeket. A4. ratio-validálás,
51 valódi warmup use, teljes belső karbantartás/reuse a gazdaságban, food headroom,
végső teljes-source baseline/engedély és hosszú1+7 run későbbi feltételek.
Ez a diagnosztikai1.4.0 világ továbbra kizárt a final baseline/result capture-ből.
Négy nagy csomag maradt,4–7;27/45, C07 NO-GO, SI-M3/MVS nem PASS.

Érintett komponens: housing-próba runner/SDK-kliens/readonly reader és a Lite
current-tile game-click; közvetlen fogyasztó a minimum preflight source-lista.
Célzott tesztek és root/script/webclient TS, nem teljes regresszió: közös
transaction/migration/clock/economic alap és globális authorization nem változott.
Provider0/0 USD; új hosszú gazdasági run nem indult.

Végső ellenőrzés `132051-115`:3 közvetlen preflight teszt és root/script TS
PASS51,734s. Összesen10 különböző célzott eset (5 housing,2 Lite,3 preflight).
Artifact/policy/link/formázás `132355-182` PASS3,030s:244 aktuális source SHA,
egyező NO-GO/baseline, eredeti minimum/policy és11/11 P2,236 helyi link;
az érintetlen régi common opening26 native DB/WAL/save fájlja és exact
derived fixture egyezik. Engine-kód nem változott, engine TS nem ismétlődött.
