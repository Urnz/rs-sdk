# SI-A15 – Technikai lezárás és külön kalibrációs feladat

## Lezárás, 2026-10-22

**SI-A15 technikai igazolása kész.** A végső
[bizonyítékcsomag és mért eredmény](SI_A15_TECHNICAL_RESULT.md) a 16 natív
mechanikai kaput, a háromnapos normál autonóm megfigyelést, a tervezett
restartot és az eredmény valódi újkönyvtáras restore-ját külön kezeli.
A teljes regresszió és a későbbi SDK-javítás célzott ellenőrzése PASS.
Nem módosítottunk világparamétert vagy eredeti D1-küszöböt.

Az autonóm ellátás nem lett önfenntartó; a teljes időablakos gazdasági
minősítés `inconclusive`. Eredeti D1/SI-M1 livelihood-PASS nincs állítva.
A következő SI-B döntési/együttműködési feladatok és a későbbi SI-C09
valósághű kalibráció megőrzik ezeket a korlátokat. Az alábbi dátumozott
feljegyzések korábbi, történeti állapotokat írnak le.

## Frissítés, 2026-10-22 16:21

**SI-A15 nyitott.** A legfrissebb [kontrollált natív bizonyítékok](SI_A15_CONTROLLED_NATIVE_PROOFS.md)
és [progress](SOCIETY_INTEGRATION_PROGRESS.md) felülírják az alábbi történeti
„még hátravan” megjegyzéseket. A díjnapló teljes regressziója PASS, 960,314 s;
a kétirányú díj, fizikai alvás/logout/return és fedezet-/férőhelyhiány élőben
igazolt. A pontos SDK-megérkezés hibája javítva és élő kijutással ellenőrizve.
Azóta a pozitív cook-/delivery-bér, teljes kontrollált belső étellánc és
valódi natív in-flight restart is igazolt. A végső forrásokból indított
új autonóm eredmény és annak archiválása még szükséges.

## Frissítés, 2026-10-22

Az utazási publication 201 után elkészült az új 1.3.0 fixture, öt exact
publikált pinnel. A 11:31-kor létrehozott új diagnosztikai baseline élő
próbája életcél-ütközést és a housing keleti megközelítésének fizikai
akadályát tárta fel. A root javításai új baseline-t igényelnek; a futó
világ forrása változatlan, a sikertelen intentek megmaradnak.
A [kanonikus hajódíj-elszámolás](SI_A15_NATIVE_FARE_ACCOUNTING.md)
implementálva, célzott és teljes ellenőrzése, majd élő igazolása folyamatban.
Ezek a mérnöki hibák nem kerülnek át az SI-C09 kalibrációs feladatba.

**Teljes regresszió PASS, 809,889 s** az új utazási művelettel, jogosultság-
és GP-envelope-pel, új verziózott fixture-támogatással és utility-trial
provisioninggel. Két normál backend trial-run és a verifier is PASS;
a javított nyugati konyha→housing út külön élő futással igazolt.
Az új skill [exact publikációs review-csomagja](SI_A15_TRAVEL_PUBLICATION_REVIEW.md)
külön emberi jóváhagyással, normál backend útján publikálva (201).
Az új fixture mind az öt exact publikált pinjének preflightja PASS.
A három food publication kész;
az SI-A15 egésze továbbra is nyitott.

A harmadik normál autonóm próba három játéknapja befejeződött, 61 mintával
és observer-read hiba nélkül. Az önálló gather natív sikere külön kanonikus
újraolvasással is igazolt. A távoli kereskedés előtt hiányzó meeting-gate és
a natív törlés utáni domain-/peer-felszabadítás javítva; az eredeti, elutasított
intent valódi forward-recoveryje változatlan fizikai készlet és pénzegyenleg
mellett felszabadította a 20 GP foglalást és a szakácsot.

Az autonóm utazási hiányhoz új bounded, még nem publikált travel draft és
forrásalapú útvonalválasztás készült. A móló–konyha utak élő próbái sikeresek;
a hajódíj és a visszahajózás is megfigyelt. Mindhárom célhelyhez két sikeres
diagnosztikai skill-futás van; a későn érkező állapot és a nyugati útvonal
külön javítást kapott. Normál backend trial, publikációs jóváhagyás és új
autonóm baseline még szükséges. A hajódíj SDK-megfigyelése önmagában nem
kanonikus pénzügyi sink-receipt. A teljes lánc, bérek, fizikai alvás,
logout/return, negatív esetek és valódi in-flight restart még lezárási kapuk.
Pontos bizonyítékok és ellenőrzési körök: [progress](SOCIETY_INTEGRATION_PROGRESS.md).

Az első autonóm eredmény valódi offline capture/verify/újkönyvtáras restore
kapuja teljesült; ugyanaz a natív riport olvasható vissza. A részletes
digestek a [result-archive jegyzőkönyvben](SI_A15_RESULT_ARCHIVE.md) vannak.
Ez a hiányos eredmény megőrzésének bizonyítéka, nem teljes SI-A15 acceptance.

A második baseline megfigyelője három önálló étkezést rögzített, de
12 perc 39,967 s után SQLite lock miatt megszakadt; a finally paused-ra
állította az órát. Az első journal előtti readonly lekérdezés, a source
kapcsolat első SQL-je előtti busy-timeout és a bizonytalan food-intent
megőrzése külön javítást kapott. Az auditált, zsákmány nélküli próbálkozás
sikertelen marad, de nem technikai hiba miatti automatikus karantén.

A külön trial világban a már publikált gather normál CLI-je és a valódi
kanonikus forrás újraolvasása is sikeres (`ca53b119-7ba5-4e92-a323-9436148e4f77`).
Előtte fizikailag visszasétált a mólóra; a konyhánál indított próba
elérhetetlen forrás miatt bizonytalan maradt, a köztes sikertelen dobás
auditált `food-no-output`. Nincs RNG-állítás vagy utólagos értékjóváírás.
A friss autonóm baseline indulási különbsége és a teljes önálló útvonal
még vizsgálandó. A feladat checkboxa nyitott; a részleteket a
[progress](SOCIETY_INTEGRATION_PROGRESS.md) követi.

## Aktuális végrehajtási állapot, 2026-10-21 20:24

**Nyitott; az első normál autonóm technikai próba hiányos eredmény.**
A felhasználó külön jóváhagyása után a három food procedure normál
publication útja sikerült: [exact csomag és digestek](SI_A15_FOOD_PUBLICATION_REVIEW.md).
A gather 8, a cook és consume 2–2 független sikeres natív futással rendelkezik.
A korábbi sikertelen dobások, burnt főzések és no-use próbák megmaradtak.

Az új `society-integration-technical-v2` terv implementálva és ellenőrizve;
három játéknap, gyorsított profillal 16 perces felső korlát. Az első
production baseline `backups/si-a15-technical-20261021-2004/workspace`,
fixture `c03ff2ddd88b0bc76cb5d96093cc1975a60eb7503e4a0cb379af2259b7dc5066`,
run `e3019628-8637-4d82-8001-56c5c2a3ab97`. A normál engine/gateway/autonomy
15 perc 12,244 másodperc alatt 61 mintát szolgáltatott, majd a világóra paused.
Az observer befejezése nem technikai acceptance.

Valóban megfigyelt: két `rent-active` domain/natív fizetés; a futár önálló
étkezése `3411 → 1011`, pontosan 2400 hunger-relief, egyetlen alkalmazással.
A változatlan stack újraindult, a futár visszacsatlakozott. Natív in-flight
művelet az újraindításkor nem igazolt, ezért ez a kapu még nyitott.
A teljes ellátási lánc, cook/delivery bér, fizikai ágyhoz jutás/alvás és a
negatív forgatókönyvek még nem teljesültek. Ezek mérnöki hiányok, nem SI-C09.

A futás közben észlelt writer-lock alatti clock-admission versenyhelyzetet,
a coordinatorhiba után beragadt tétlen saját lease-t, az alapanyagra váró
konyha téves karanténját, a készlet nélküli commerce-ajánlatot és az előző
actor által már lefoglalt peer ismételt claimjét a root forrásban javítottuk.
A lezárt első baseline forrása változatlan maradt; a javítások új baseline-ba
kerülnek. A sikertelen eredmény offline archiválása és az új könyvtáras
visszaolvasás külön ellenőrzés, nem az élő acceptance pótlása.

Az eredeti observer journal-szelete a legrégebbi nyolc bejegyzést tartalmazta.
A végső audit a teljes kanonikus journalt olvasta újra:
`.local/verification/si-a15-first-technical-attempt-final.json`.
Az observer `missingRestart` mezője nem minősíti a külön megőrzött restartot;
a native in-flight kapu mindkét bizonyíték alapján hiányzó marad.

Az alábbi előkészítési szakaszok történeti állapotot is tartalmaznak;
a publication és a v2 terv elkészült, a teljes SI-A15 még nem lezárt.

## Elfogadott irány, 2026-10-21

A felhasználó döntése: előbb a technikai működés igazolása, később a
[világparaméterek valósághű kalibrációja](SOCIETY_REALISM_CALIBRATION.md).
A technikai eredmény, az agentek megélhetési eredménye és a modell
valósághűsége külön megállapítás. Egy szabályos éhhalál vagy veszteséges
gazdaság technikailag korrekt kísérleti eredmény lehet.

Ez nem minősíti át a korábbi D1 protokollt vagy egy nem lefutott
demonstrációt sikeres élő futássá. A roadmapben az SI-A15 teljes élő
igazolása addig nyitott, amíg annak tényleges bizonyítékai hiányoznak.

## A már rendelkezésre álló technikai bizonyíték

- SI-A01–SI-A14: natív fogyasztás, termelés, egyszeri needs-relief,
  lineage, konyhai custody, kereskedelem, bér, bérlet és alvás;
  a közös SI-A14 harness 26 esete, köztük nyolc process-kill helyreállítás.
- Az új napalapú profilok: azonos táplálkozási szabály, külön racionális
  világóra; valódi négyavatáros provisioning és baseline seal.
- Natív határtesztek: autonóm étkezési választás, normál adag/clamp,
  no-use, nem projektált commit, hetedik napi végleges halál és gateway
  recovery; korai etetés nem bankolható, késői étel nem támaszt fel.
- Legutóbbi teljes regresszió: `20261020-094641-256-full`,
  **2302 PASS / 0 FAIL / 0 skip**, 1103,914 s, root/engine/webclient
  typecheckkel. A részleteket a [progress](SOCIETY_INTEGRATION_PROGRESS.md)
  és az ott hivatkozott helyi verification-artifactok őrzik.

Ezek modul- és adapterhatárokra szóló bizonyítékok. Az SI-A14 név szerint
szimulálja a publication availabilityt, a fizikai megérkezést és az SDK
controller transportját; a saját observed-wall-time drivere sem élő soak.
Ezeket a határokat a technikai lezáráskor is láthatóan meg kell őrizni.

## Következő technikai végrehajtási sorrend

1. **Valódi draft-trial és normál publication:** két független natív
   gather/cook/consume futás a normál skill-executor útján, tartós
   run/intent/receipt újraolvasással. Új verified verzió és exact ref/checksum;
   a publikációs előnézet és approval meglévő szabályai érvényesek.
2. **Natív útvonalak:** a négy actor tényleges Karamja/Lumbridge/Falador
   útja, hajó-/útiköltsége, visszatérése, meeting/facility/bed elérése.
   Bootstrap-pozíció nem utazási bizonyíték; nincs teszt-arrival vagy teleport.
3. **Új, előre rögzített technikai futási terv:** külön verzió, a végleges
   napalapú szabályokkal. Jelölt ablak három játéknap: élő profillal 180,
   gyorsított profillal 15 valós perc. A natív menetidők és működési keretek
   még igazolandók; ez jelenleg nem indítható vagy PASS-nak nevezett terv.
   Négy avatárnál 12 névleges napi adag, főzési veszteség és tartalék külön.
4. **Normál izolált engine/gateway/autonomy futás:** a rögzített műveletek
   valóban végrehajtódnak, minden natív precondition és a végleges halál
   tiltása érvényesül. Tervezett in-flight stack-restart és tényleges
   input/fedezet/kapacitáshiány bounded, forrással igazolt kezeléssel.
5. **Előrehaladt eredmény megőrzése:** rendezett íróstop, konzisztens
   result-snapshot, új könyvtáras restore és ugyanazoknak a natív
   forrásoknak az újraolvasása. A változatlan genesishez kötött SI-A13
   baseline-capture nem alakítható át puszta átnevezéssel result-capture-ré.
   A külön [result-archive út](SI_A15_RESULT_ARCHIVE.md) implementálva;
   mindkét napalapú profilban valódi natív étkezés utáni roundtrip teszteli.
   Ez az eszköz technikai bizonyítéka; a teljes D1 élő futás eredményének
   archiválása a tényleges futás után lesz igazolható.

Az első localhost státuszpróba sandbox socketkorlátozást jelzett; az
ismételt, korlátozáson kívüli readonly próba 8888/7780 porton timeoutot
adott, kezelt runtime-folyamat és runId nélkül. Ez nem futási bizonyíték,
és önmagában nem jogosít meglévő világ resetjére vagy idegen folyamat
leállítására. A jelenlegi checkoutban a három exact food procedure draft;
az SI-A13 production create kapuja ezeket helyesen elutasítja.

## A kétféle eredmény elválasztása

A technikai PASS feltétele a tényleges natív hatás, helyes jogosultság,
azonosság és könyvelés, egyszeri alkalmazás, őszinte blocked/uncertain
állapot, valamint restart/restore után is egyező bizonyíték. Egy kiküldött
SDK-parancs vagy kézzel sikeresre írt domainrekord ezt nem teljesíti.

Az ellátási arányt, kritikus állapotban töltött időt, fogyasztást, készletet,
veszteséget és halált minden futásban mérni kell. A 95%-os ellátottság és
a társadalmi fennmaradás gazdasági kimenet; a felhasználó új iránya szerint
egy külön, verziózott technikai protokollban nem fedheti el a mechanikák
korrekt működését. A régi D1 saját 95%-os/kététkezéses eredményét továbbra
is a régi szabály szerint kell értelmezni, utólagos küszöbcsökkentés nélkül.
Az új technikai terv elfogadási sémáját és végrehajtását még meg kell írni;
a mostani v1 validator feltételeit ez a dokumentum nem változtatja meg.

Az egy-/hétnapos szabály, napi adag, véges erőforrás, 0 providerhívás,
értékinjekció-tilalom és a teljes konzisztencia megmarad. A paraméterek
kézi átállítása a jelenlegi négy avatár megmentésére nem technikai javítás.
Az időgyorsítás munka/utazás/needs arányait a hosszú kísérlet előtt külön
validálni kell; az azonos needs-szabály önmagában nem teljes dinamikai paritás.

A későbbi SI-C09 nem függősége az SI-A15 technikai igazolásának, és nem
gyűjtőhelye a fenti hiányzó végrehajtási kapuknak.
