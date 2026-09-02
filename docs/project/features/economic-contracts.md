# Gazdasági ajánlatok és egyszerű szerződések

## Cél és határ

A Phase 12 szerződésledger két létező persistent agent közötti megállapodásokat
tartósít. A támogatott kezdeti típusok:

- `trade`: tárgy, GP vagy szolgáltatás kölcsönös cseréje;
- `work`: díj ellenében vállalt termelés vagy más munka;
- `service`: nem feltétlenül tárgytermeléssel járó szolgáltatás.

Mindkét fél kötelezettsége külön tartalmazhat GP-t, legfeljebb húsz egyedi
item ID-t mennyiséggel és egy rövid szolgáltatásleírást. A szolgáltatás mellett
kötelező a bizonyító skill pontos `id@version` hivatkozása. Mindkét oldalon
legalább egy kötelezettség kötelező, ezért az MVP nem hoz létre üres vagy
egyoldalú „szerződést”.

## Életciklus és integritás

Az ajánlat `open`, majd `accepted`, `declined`, `withdrawn` vagy automatikusan
`expired` lehet. Csak a pontos címzett fogadhatja vagy utasíthatja el, és csak az
ajánlattevő vonhatja vissza. Minden módosítás optimista revíziót kér.

Az alap szerződés elfogadása egyetlen SQLite tranzakcióban:

1. ellenőrzi a címzettet, revíziót, nyitott állapotot és lejáratot;
2. lezárja az ajánlatot;
3. változatlan feltételekkel létrehozza az `active` szerződést.

A normalizált feltételek digestje az ajánlatban és a szerződésben azonos. Az
ismételt pontos elfogadás idempotensen ugyanazt a szerződést adja vissza.

Ha valamelyik fél avatar nélküli `business` vagy `faction` institution agent és
GP-t ígér egy exact avatarhoz kötött player agentnek, az elfogadási szolgáltatás
már az aktív szerződés létrehozása előtt lefoglalja a teljes összeget az
institution treasuryben. A contract-, reservation- és settlement-ID az ajánlatból
determinisztikusan származik, ezért egy folyamatmegszakítás utáni retry nem képez
új foglalást. Fedezet nélkül a szerződés nem jön létre.

Avatar nélküli institution itemet vagy fizikai szolgáltatást nem vállalhat ezen az
útvonalon. Institution→institution kifizetés még nincs az orchestrátorhoz kötve.

Player→player GP- vagy itemvállalásnál az elfogadás előtt a teljes eszközlista
engine-oldali inventory escrowba kerül. A stabil escrow ID a szerződésből és a
félből determinisztikusan származik; a szerződés külön főkönyve az exact payer és
payee agentet, avatárt, eszközöket és settlement állapotot is rögzíti.

## Cancellation és default

Az aktív szerződés két külön végállapotot támogat:

- `cancelled`: kizárólag teljesítés és bizonyíték nélküli szerződés rendezett,
  explicit admin-törlése;
- `defaulted`: részben teljesített vagy ténylegesen meghiúsult szerződés végleges
  lezárása, a már végrehajtott átadások visszafordítása nélkül.

A feloldás kétlépcsős. A szerződés előbb `cancelling` vagy `defaulting` állapotba
kerül, ami megállít minden új bizonyítást és settlementet. Ezután az orchestrátor
idempotensen release-eli a még nyitott treasury-foglalásokat és player-escrowkat,
majd csak minden receipt után írja a végállapotot. Engine-hibánál a köztes állapot
megmarad és ugyanazzal az indokkal újrapróbálható.

`settling` fedezet nem oldható fel, mert a külső engine-művelet kimenetele ilyenkor
bizonytalan lehet. Előbb az eredeti settlementet kell idempotensen újrapróbálni
vagy kézzel egyeztetni. Ez akadályozza meg, hogy már jóváírt pénzhez vagy tárgyhoz
a fizető fél fedezete is visszakerüljön.

## Adminfelület és biztonság

Az adminpanel `Kísérletek` füle új ajánlatot tud létrehozni, listázza a lejárt és
lezárt ajánlatokat, valamint az aktív szerződéseket. A gazdasági lista olvasása is
admin-hitelesítést igényel. Minden létrehozás és státuszváltás bekerül az admin
auditnaplóba.

Az admin szerződéskártya megmutatja az intézményi és player-fedezeteket, azok
payer/payee kötését, összegét és `funded/settling/committed/released` állapotát.
Átmeneti engine-hiba után ugyanitt külön auditált újrapróbálás érhető el. Az aktív
szerződésen külön teljesítés előtti törlés és meghiúsultként lezárás található;
a köztes feloldás szintén innen próbálható újra.

## Hiteles teljesítési bizonyíték

Egy fél csak a saját persistent agentjéhez exact módon kötött avatár completed
skill-runját adhatja bizonyítékként. A runnak a szerződés elfogadása után kell
kezdődnie. A rendszer nem fogad el kézi teljesítési pipát, hibás/partial eseményt,
idegen avatárt vagy másik szerződéshez már felhasznált run ID-t.

Az illesztés szabályai:

- az escrow nélküli vállalt GP csak az exact másik avatárral lezárt player-trade
  negatív coin-deltájából számít;
- az escrow nélküli vállalt tárgy csak ugyanennek a trade-nek az igazolt kimenő
  tételeiből számít;
- az escrowzott GP és tárgy kizárólag az exact payee részére commitolt engine-
  escrowból számít, ezért külön trade-run nem teljesítheti még egyszer;
- a szolgáltatás csak a feltételben rögzített exact skillverzió completed runjával
  igazolható;
- több saját run részleges mennyisége összeadható, de ugyanaz a run globálisan
  csak egy szerződéshez használható;
- egy fél naplója nem igazolja automatikusan a másik fél teljesítését.

Csak akkor lesz a szerződés `fulfilled`, amikor mindkét fél összes GP-, tárgy- és
szolgáltatásvállalása külön bizonyított. A journal digest és az eventazonosítók
megmaradnak, a pontos replay idempotens, a megváltozott journal elutasított.

Player escrow esetén a másik fél igazolt szolgáltatása vagy saját előre foglalt
fedezete nyitja meg a commitot. Két player tiszta eszközcseréje így nem kerül
holtpontra, de a szerződés csak mindkét exact jóváírás után lesz `fulfilled`.

Előre fedezett institution→player GP esetén a gateway ugyanazt az engine-tickes,
idempotens reward csatornát használja, mint a player-megbízások. Sikeres engine
receipt után commitolja a treasury-foglalást és csak ezután jelöli a settlementet
teljesítettnek. Hiba esetén a fedezet foglalva marad; retry ugyanazzal a stabil
settlement- vagy escrow ID-val nem fizethet kétszer.
