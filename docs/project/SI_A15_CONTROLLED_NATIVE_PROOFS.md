# SI-A15 kontrollált natív mechanikai bizonyítékok

Állapot: SI-A15 nyitott. Ezek elkülönített mechanikai próbák, nem a normál
autonóm futás eredményei. A világban nincs autonomy enrollment vagy baseline
seal. Nincs RNG-, képesség-, pénz-, étel- vagy óraarány-módosítás.
Az explicit szünetek a külön esetek közötti előkészítésre szolgálnak;
a műveletek normál futó világórán történnek. Kézi etetés nem autonóm bizonyíték.

Világ: `backups/si-a15-fare-trials-20261022-1200/workspace`, fixture 1.3.0,
world `srv-2094c0b6-0bd9-4c4a-816f-b6e85d3f84d6`.
Az első runtime generation `1792663543199-067ad31b`, a paused állapotból
folytató második `1792678409905-1e6f99d0`. A nem titkos case-markerek exact
bájtjai SHA-256-tal és eredeti elérési úttal kerültek át; a forrás és a
kanonikus állapot nem lett hotpatch-elve vagy visszaállítva.

## Sikeres valódi műveletek

- **Utazás és díj:** normál publikált CLI, konyha → housing → konyha,
  két natív 30 GP levonás, 3800 − 60 = 3740 GP. A futár szárazföldi útja
  díjmentes. [Részletes pénzügyi határ](SI_A15_NATIVE_FARE_ACCOUNTING.md).
- **Fizikai alvás:** `20261022-121750-355-si-a15-actual-paid-bed-and-native-sleep`,
  PASS, 1,450 s. A futár ténylegesen 500 GP-t fizetett, a bérbeadó ennyit
  kapott; bed-1 pozíció 2972,3331,0, sleep-witness
  `c1287101-c926-4e5a-a01d-b53ffa8927ed`.
- **Valódi logout/return:** `20261022-121915-104-si-a15-sleeping-client-real-logout-and-normal-return`,
  PASS, 5,268 s. Csak a saját Lite-kliens állt le; a normál újracsatlakozás
  ugyanazt az életciklust és fizetett sleep-witnesst őrizte meg.
  Fatigue 10000 → 4069, hunger 4339 → 4939; nincs állapotnullázás.
- **Fedezet és férőhely:** `20261022-122325-475-si-a15-actual-native-funds-shortage-and-bed-capacity`,
  PASS, 4,677 s. A futár 200 GP-vel nem fizethetett 500-at, nem történt
  terhelés. A sikertelen foglalás normál cancel/finalize útja felszabadult.
  Két ténylegesen fizetett aktív ágy mellett a harmadik foglalást a natív
  határ elutasította. A belső átutalások a 3740 GP összeget megőrizték.
- **Kifogás és beszerzés:** `c3ba4ec4-5a96-4b04-8087-2660617eeb76` valódi
  raw lobster; quota 32 → 31. Normál natív procurement: egy raw a Businesshez,
  20 GP a halásznak, ugyanennyi levonás a treasuryből.
- **Pontos házkijárat:** `20261022-161434-587-si-a15-exact-housing-exit-preserved-world`,
  PASS, 30,815 s. A futár és bérbeadó fizikailag kijutott az északi ajtón.
  Külső, javított root `BotActions`, publikus SDK-csatorna; a klón forrása
  változatlan. A külső forrás digestje a case-artifactban szerepel, ezért
  ez nem a régi baseline teljes forrásával végzett acceptance.

## Megőrzött negatív eredmények

A `cdac7722-0969-4aab-9f47-f3e6211e141e` normál cook CLI valóban megégette
az alapanyagot. A natív konyha `returned-output`/`burnt`, a lejárt shift
`cancelled`/`unearned`, a kérés `failed`; nem járt 25 GP bér.
A `7b427fc7-767b-41e1-bc5f-b5f00252dc77` gather `food-no-output`, kanonikus
attemptje `attempted`, nem bizonytalan. Ezeket nem írjuk át sikerre.
Új, külön próbálkozás csak a végleges natív forrás újraolvasása után indult.

A `b7ef64b2-1bb9-41b7-a9bd-2f2e89472355` kézbesítési kérés még a tényleges
trade dispatch előtt megállt a kijáratnál. Nem történt kézbesítés vagy bérfizetés.
Végső normál expiry/recovery újraolvasás:
`20261022-173816-640-si-a15-original-failed-delivery-normal-final-expiry`,
PASS, 0,668 s. A kérés failed, a műszak cancelled/unearned, a treasury-foglalás
0 GP, a Player+Business GP-összeg változatlanul 3740. A sikertelen marker
nem lett átírva; a kanonikus végső állapot külön auditban marad meg.
Az SDK az utolsó lépésnél a kért 0/1 helyett 2 mező toleranciát használt,
ezért még érkező állapot közben elakadást jelenthetett. A javítás tényleges
állapotfrissítésekkel tesztelt: késői pontos megérkezés siker, mozgás nélküli
transport ACK továbbra is kudarc. Célzott ellenőrzés:
`20261022-161243-532-si-a15-sdk-precise-arrival-boundaries`, 17 PASS, root
TypeScript és formázás PASS, 55,597 s. A parancsban szereplő, nem létező
`walkto-death.test.ts` nem futott tesztként; a 17 eset két létező fájlból jött.
A behatárolt SDK-javítás nem igényelte a már sikeres teljes regresszió ismétlését.

## A külön mechanikai világ teljes étellánca, bérei és natív restartja

Új standard fixture: `backups/si-a15-mechanics-20261022-1621/workspace`.
Létrehozás: `20261022-162200-396-si-a15-independent-mechanics-world`,
PASS, 28,037 s. E világ a root pontos SDK-megérkezési javítását is tartalmazza;
a régi világ nincs visszaállítva. Mindkét világ azonos fixture-azonossága
miatt a forrást mindig a teljes workspace-út és runtime generation köti.

**Kézbesítés:** a címzett normál SDK-val fizikailag Lumbridge-be sétált;
csak ezután indult a műszak és a publikált donor CLI.
`20261022-162422-835-si-a15-independent-delivery-native-wage`, PASS, 259,524 s.
Run `a95e9805-92cc-4a33-be85-af5b64271bea`, settlement
`08b22709-0768-414a-8376-2584e3ec77c3`; a natív trade után tényleges 25 GP
bér, kanonikus reward-checkpoint és változatlan 3800 GP összeg.
Utóellenőrzés: `20261022-163452-510-si-a15-canonical-deaths-and-real-delivery-wage-conservation`,
PASS, 0,568 s. A régi világ két éhhalálának natív bizonyítéka is újraolvasható:
mindkettő `starvation`, pontosan 604800000 ms, azaz hét nap deficit.

**Gyűjtés:** az első CLI megfelelő közeli NPC hiányában, még natív admission
előtt elutasult. Az eredeti `031c5c2f-a4ec-429e-abc7-85d39f7c7be9` napló
sikertelen maradt. Explicit operátori egyeztetés azonos action-ID-val,
kanonikus admission-hiány ellenőrzése után végleges `food-no-output`-ot
állapított meg. Ez nem autonóm recovery és nem újra sikeresre írt CLI.
Ezután külön 4, 8 és legfeljebb 8 dobásos eset indult. Az első kettő
készlet nélkül zárult; a harmadik ötödik normál CLI-je sikerült:
`da830f14-ba3b-432a-9615-756db74b2cad`, valódi raw és 90 Fishing XP.
Mind a 17 új CLI és az egyeztetett első próbálkozás megmaradt.
A 40-es Fishing natív tartalom szerinti esélye 41/256; nincs RNG-állítás.
A halász a saját kezdeti ételét előbb normál fogyasztással elhasználta.
A halász és szakács tényleges konyhai találkozása is igazolt.

**Inputhiány és in-flight restart:** üres Business raw-készlet mellett a
normál konyhai foglalás `Business production input stock is insufficient`,
változatlan készlettel. Utána valódi 20 GP procurement, majd natív konyhai
`waiting`, valóban held alapanyaggal és elmentett `wakeTick`-kel.
Az első előkészítő segédparancs kihagyott `tradePath` miatt a már elvégzett
vásárlás domain-finalizálásánál megállt. A javított segéd ugyanazt az
operation-ID-t véglegesítette; nem vásárolt újra.
`20261022-164156-741-si-a15-same-procurement-forward-to-native-waiting-and-stop`,
PASS, 2,820 s; run `si-a15-real-inflight.1792680117316`.
Teljes stack-stop után új generation, változatlan forrás, normál kliensek;
ugyanaz a natív waiting-digest és inputcustody olvasható vissza.
Az explicit natív return egy raw-t adott vissza a Businessnek; azonos return
és finalize ismétlése nem módosította a készletet vagy natív digestet.
`20261022-164247-110-si-a15-actual-native-inflight-reopen-and-once-only-input-return`,
PASS, 4,325 s. Ez valódi függő content/escrow restart, nem tétlen újraindítás.

**Főzés és fogyasztás:** a visszaadott raw új, normál műszakba került.
Publikált cook run `b6956c06-0072-4efd-b203-cdb7eb9ed7e4`, natív cooked output,
majd tényleges 25 GP bér.
`20261022-164316-533-si-a15-recovered-real-input-normal-cook-and-native-wage`,
PASS, 89,462 s. A prepare segéd régi stdoutja ezen a raw-újraolvasási ágon
tévesen `emptyInputRejected:true`-t írt; a marker üres hibamezője ezt nem
igazolta. A tényleges inputhiány-bizonyíték a fenti restart-előkészítésből van;
a segéd kiírása azóta a valós hibamezőt használja.
Normál belső sale 40 GP-ért, majd consume
`ac4d48f6-7bc2-40d0-b3f3-6bc02f1e1157`:
`20261022-164548-562-si-a15-actual-internal-food-sale-and-consumption`, PASS, 22,733 s.
Kanonikus újraolvasás: egy darab, **2400 relief**, mindkét bér `completed`/`paid`,
két külön natív 25 GP reward-checkpoint, 0 raw/cooked Business-zárókészlet,
felszabadult treasury-foglalások, **3800 GP** összeg. Ugyanannak a food-intentnek
a source-alapú visszaolvasása dispatch nélkül nem adott újabb reliefet.
`20261022-164734-013-si-a15-full-controlled-chain-canonical-wages-and-relief-audit`,
PASS, 1,232 s; utána rendezett stop, paused óra.

## Korábbi világ megőrzése és végső lezárás

A második runtime-ban a világ elérte a hetedik táplálékhiányos napot.
A futár és bérbeadó végleg meghalt; a bérbeadóhoz kötött Business új
beszerzését az `Approved Business policy required` authority-gate már
elutasította. A halásznak és szakácsnak korábban normál úton elfogyasztott
kezdeti adagja volt. Nincs feltámasztás vagy policy-visszaállítás. A
függő natív restart előkészítése ezen a ponton nem teljesült; a világ
paused órával szabályosan leállt (`20261022-162035-964-si-a15-old-utility-final-pause-and-stop`).
További független mechanikai esetekhez új standard fixture szükséges;
ez nem a régi világ túlélésének folytatása vagy javítása.

Az új autonóm megfigyelés és annak capture/restore-ja elkészült;
[végső technikai eredmény](SI_A15_TECHNICAL_RESULT.md). A kontrollált
mechanikai siker nem bizonyít önfenntartást, és egy technikai hiba nem
minősíthető SI-C09 paraméterkalibrációs kérdéssé.
