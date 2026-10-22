# SI-A15 – Technikai bizonyítékcsomag és mért megélhetési eredmény

**SI-A15 technikai igazolás: lezárva, 2026-10-22.** A 16 előírt mechanikai
kapu tényleges natív bizonyítéka, a normál autonóm megfigyelés és a végső
eredmény ellenőrzött restore-ja elkészült. Az autonóm ellátás hiányos maradt;
eredeti D1/SI-M1 túlélési vagy teljes gazdasági PASS-t nem állítunk.

## Értelmezési szerződés

A felhasználó 2026-10-21-i döntése szerint a technikai működést kell
igazolni, a világ valósághű paraméterkalibrációja külön SI-C09.
A társadalom hosszú fennmaradása és a technikai mechanikák helyessége
külön eredmény. Az eredeti D1 ellátottsági küszöbei és eredményei nem
változnak meg visszamenőleg.

A kontrollált mechanikai esetek ugyanazokat a natív szabályokat és véges
standard fixture-t használják. Előre rögzített céljaik a tényleges
könyvelési, jogosultsági és helyreállítási határokat vizsgálják. Az operátor
által vezérelt eset nem autonóm döntés; a bootstrap-étel nem belső termelés.
A normál autonóm trajectory külön fut: nincs kézi céladás vagy etetés.
A külön mechanikai siker sem írhat át sikertelen autonóm journalt.

## Ténylegesen végrehajtott mechanikai kapuk

- **Gather, procurement, cook, sale, consume:** valódi kifogott raw,
  20 GP belső beszerzés, natív cooked output, 40 GP eladás és a belső
  étel fogyasztása. A halász korábbi bootstrap-adagját előbb elhasználta.
- **Egyszeri needs-relief:** a belső étel egy darab, 2400 hunger-relief;
  azonos intent source-alapú visszaolvasása nem dispatch-el és nem ismétli.
- **Cook- és delivery-bér:** két külön valódi munkateljesítés, normál
  publikált CLI és kanonikus forrás alapján, egyenként 25 GP.
  Mindkét request completed, work paid, natív reward committed.
- **Rent és fizikai alvás:** valós 500 GP átutalás, érvényes bed-1 lease,
  tényleges ágykoordináta és natív sleep-witness; fatigue csökkent.
- **Logout/return:** a saját valódi Lite-kliens leállása és normál
  visszatérése ugyanazzal az életciklussal és fizetett sleep-witness-szel.
- **Inputhiány, fedezethiány és telt ágy:** a valódi natív/domain határ
  elutasítása; nincs kitalált alapanyag, sikeresnek könyvelt fizetés vagy
  jogosulatlan alvás. A sikertelen foglalás normál törléssel felszabadul.
- **Natív in-flight restart:** tényleges suspended content és held raw
  escrow, teljes stack-stop, új generation és ugyanaz a tartós waiting
  binding; egyszeri input-return, duplikáló hatás nélküli újraolvasás.
- **Gazdasági és utazási többlethatár:** két valódi 30 GP hajódíj egyedi,
  kanonikus bizonylattal: 3800 − 60 = 3740 GP. Másik standard világban a
  belső étellánc és két bér után is 3800 GP, felszabadult foglalásokkal.
- **Eredményrestore:** a végső forrású autonóm eredmény normál capture-je,
  beépített verify-ja és új könyvtáras restore-ja PASS; ugyanaz a natív
  logikai állapot és riport olvasható vissza, az eredeti korlátokkal együtt.

A [kontrollált natív jegyzőkönyv](SI_A15_CONTROLLED_NATIVE_PROOFS.md) a
workspace-okat, generationöket, natív ID-kat, megőrzött kudarcokat és
ellenőrzési logokat tételesen felsorolja. A [díjnapló határa](SI_A15_NATIVE_FARE_ACCOUNTING.md)
és [result-archive protokoll](SI_A15_RESULT_ARCHIVE.md) külön dokumentált.

## Végső normál autonóm megfigyelés

Világ: `backups/si-a15-technical-20261022-1648/workspace`, fixture 1.3.0,
input-source digest `a5d2ef1f660e773c625d2d59ebe392b62b85e3d85feb0ee714cf1b0e1d12ef6c`.
Run `a08a3a67-2fe3-4772-8943-d22c552124e3`, három játéknap,
**61 minta, 0 observer-read hiba**, majd paused óra és rendezett íróstop.
Megfigyelés: `20261022-165730-105-si-a15-final-three-day-autonomous-observation`,
PASS, 915,005 s. Ez a megfigyelési protokoll befejezése, nem D1-verdict.

A másfél napnál előre rögzített normál stack-restart után mind a négy
karakter ugyanabban az életciklusban visszatért. A vizsgált forráshash-ek
változatlanok; a teljes forrásazonosságot a result-archive külön ellenőrzi.
A megfigyelés saját restartja nem állít natív in-flight contentet; annak
erősebb, held-inputos bizonyítéka a külön mechanikai eset.
`20261022-165731-251-si-a15-final-predeclared-midpoint-restart`, PASS;
a wrapper a végső runtime-stopig maradt nyitva, ezért 980,787 s-os ideje
nem a kiesés hossza.

Tényleges eredmény: négy önálló, bootstrap-adagból származó étkezés,
0 függő food-alkalmazás; három sikeres utazási CLI és két natív hajódíj.
A három gather-CLI mind `food-no-output`; nem volt új termelt alapanyag,
autonóm cook, értékesítés vagy munkabér. Három rent-active befejezés
látszik. A futár és bérbeadó a hiány miatti bounded policy-karanténig jutott;
a halász/szakács a hiányállapotot őrzi. Nincs sikertelen utazási CLI,
életcél-UNIQUE hiba vagy a replan naplóban rögzített runtime-hiba.

A provider tényleges adatbázisában 0 foglalás, 0 kérés, 0 költség;
a provider kikapcsolt. Záró audit:
`20261022-171351-403-si-a15-final-normal-stop-canonical-outcome-and-provider-audit`,
PASS, 1,043 s. Teljes readonly eredmény:
`.local/verification/si-a15-final-autonomous-attempt.json`.
A titkok nélküli observer/restart bizonyíték exact másolata és SHA-256
eredetjegyzéke a világ `.local/simulation/technical-evidence/` könyvtárában
az eredményarchívumba is bekerül.

A rögzített natív riport `partial-native-observations`, mind a négy actor
lefedett, `issues: []`; a négy consumption és három rent natív/domain
egyeztetése `reconciled`, a műveleti egyenletek maradéka nulla.
A teljes időablak gazdasági mérlege és a `societyMinimumVerdict` viszont
`inconclusive`: e riporthoz nincs kiválasztva minden szükséges fagyasztott
nyitó/záró adatforrás, `completeEconomicCoverage:false`. Az archívum ezt
megőrzi. A külön kontrollált GP-egyenletek nem helyettesítik ezt a hiányzó
teljes ablakos gazdasági minősítést; a technikai lezárás nem emeli PASS-ra.

Ez a futás nem önfenntartó társadalom bizonyítéka. A világparaméterek és
a döntési/együttműködési rutin hozzájárulását külön kísérletekben kell
szétválasztani. A következő SI-B feladatok és a későbbi SI-C09 kalibráció
nem kapnak utólag sikeressé nyilvánított autonóm termelési eredményt.

## Eredményarchívum és ellenőrzés

Bundle: `backups/si-a15-technical-result-20261022-1715`;
restore: `backups/si-a15-technical-restored-20261022-1726/workspace`.
Capture `20261022-171522-038-si-a15-final-native-result-capture`, PASS, 608,330 s.
Normál restore a beépített natív verify-jal:
`20261022-172914-759-si-a15-final-result-verified-restore`, PASS, 1049,612 s.
14493 fájl; manifest
`498e6a79b08d5e8b68bf4a04997ee9a2535e5837543a8ba730b6beba992045ef`,
natív report
`3791d96746ba81232c96469ff806a292ca2ab92910fb244977b234119886e792`.
A visszaadott manifest, logikai natív inventory és titokmentes evidence-origin
egyezése külön is PASS:
`20261022-175048-192-si-a15-final-restored-result-and-evidence-digests`, 0,527 s.
A payload adatbázisait csak eldobható ellenőrző másolat nyitotta meg.
Az archívum `liveAcceptance:not-established-by-archive` értéke megmaradt.

E lezárás a felhasználó által kért technikai működés igazolása. A világ
paraméterei, az egy-/hétnapos szabály és az egynapos adag változatlanok;
nem indult optimalizáló, tanítás vagy karaktermentő paramétermódosítás.

## Megőrzött negatív eredmények és korlátok

Az elégett főzésért nem járt bér. A zsákmány nélküli dobások és a négy-/
nyolcdobásos, készlet nélkül zárult esetek nem tűntek el a sikeres eset
mellől. A kezdeti, NPC-hiány miatti bizonytalan CLI sikertelen maradt;
ugyanazon action-ID explicit operátori egyeztetése külön bizonyíték.
A régi utility-világ két szereplője pontosan hét nap deficit után végleg
meghalt; az üzleti jogosultság lezárult. Nincs feltámasztás vagy feltöltés.

A teljes regresszió az új gazdasági perzisztencia miatt futott, PASS,
960,314 s. Az ezt követő behatárolt SDK-megérkezési javítás célzott
ellenőrzése 17 PASS, root TypeScript és formázás PASS, 55,597 s, valamint
két karakter valós pontos kijutása PASS. A teljes kör ismétlését új
alapozó változás nem indokolta.

A [SI-C09 kalibráció](SOCIETY_REALISM_CALIBRATION.md) nem a karakterek
megmentésére optimalizál. Egy műszaki hiba nem kalibrációs kérdés;
a későbbi stratégiai/együttműködési feladatok sem kaphatnak már meglevő
mechanikai hiányt elhallgató átadást. Az időgyorsítás kizárólag a világóra
profilja; teljes fizikai/dinamikai paritást ez a bizonyítékcsomag nem állít.
