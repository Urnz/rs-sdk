# SI-A14 – Közös natív hiba- és restart-acceptance

Az SI-A13 négyavatáros fixture-jének közös, izolált adaptertesztje:
`server/gateway/admin/society-integration-acceptance.test.ts`. A child
`server/engine/src/mods/IntegrationSocietyAcceptance.test.ts`, a megnevezett
határok és a valódi adapterek összekötése az `IntegrationSocietyHarness.ts`.
A futási eredmények és exact naplóazonosítók a
[progress fájlban](SOCIETY_INTEGRATION_PROGRESS.md) szerepelnek.

## Authority és hatókör

Minden eset új folyamatban, ugyanannak a valódi SI-A13 baseline-nak a külön
tesztmásolatából indul. A restart-eseteknél a parent a megnevezett commit
utáni jelzésre ténylegesen megszakítja a childot; a következő folyamat
ugyanazokat a fájlokat nyitja újra. Az operátori világ nem változik.
Nem készül kézzel sikeres domainrekord vagy utólag előállított natív receipt.

A kanonikus Player-checkpoint, native food/kitchen/commerce/housing journal,
trade evidence, Business/WIP, institution treasury, AgentState/goal, replan,
SimulationClock/PlayerTime, death/health és needs-források valódiak. A
packed LostCity content és inventoryműveletek is valódiak. A forrásmásolat
technikai részhalmaz, külön SHA-jegyzékkel; nem teljes repository-archive.
A dependency junction csak kódot ad, meglévő világadatot nem. A teszt RSA
kulcsa átmeneti, nem kerül az evidence csomagba.

Öt névvel rögzített U/I határ:

- A három draft food procedure publikációjának elérhetősége memóriabeli
  resolver-port. A repositoryban ettől még draftok maradnak.
- A Player natív helyszínre érkezése teszt-előfeltétel. Nincs bizonyított
  Lumbridge–Karamja–Falador útvonal, hajóút vagy autonóm navigáció.
- A SDK/controller transport helyi WebSocket; a SkillExecutor és a typed
  food request utána valódi natív/domain kódot hív. Nem fut teljes gateway.
- A megfigyelt faliórát a teszt vezérli; a SimulationClock 1:1 marad.
- A bérteszt már megkezdett műszakot ad át a typed admission API-nak.
  A minimum egyperces munkapolicy változatlan; ez nem élő munkaidőmérés.

A sikerút gyűjtés → tényleges Business-beszerzés → főzés → egy 25 GP cook-bér
→ tényleges eladás → 500 GP bérleti díj → sleep/wake → két natív fogyasztás
és forrásból számolt hunger-relief. Mind a négy avatar részt vesz benne;
a GP-zárás 3800. A delivery-bér és a teljes autonóm SI-M1 nem ennek a bizonyítéka.

## Exact esetjegyzék és 15.1 regressziós kapcsolatok

A child teszt neve minden esetnél `SI-A14 <caseId>`. Az összes elvárt ID a
`society-integration/acceptance.ts` egyetlen jegyzékében található.

- `happy`: közös forrásalapú sikerlánc, két ételalkalmazás, négy actor,
  pénzmegmaradás és ismételt bérsettlement.
- `empty-input`, `empty-gp`: nincs output vagy fedezetlen beszerzés.
- `full-inventory`: issue/process tiltás, védett nyers input visszaadása.
- `burnt-batch`: valódi burnt output; nincs főtt készlet vagy megkeresett bér.
- `too-high-price`: a 20 GP beszerzési plafon felett nincs reservation.
- `wrong-partner`, `wrong-tenant`: a ténylegesen átadott idegen Player elutasítva.
- `receipt-replay-tamper`: natív eladás exact replay nem dupláz; módosított
  tartós source nem igazolhat domain-finalizálást.
- `missing-source`: a törölt natív eladásforrás mellett nincs hamis completed.
- `death-during-work`: natív death authority tiltja a munkát; nincs bér,
  a még fel nem használt input auditált visszaadása engedett.
- `engine-unavailable`: kieső transport mellett egy tartós submitted intent,
  bounded wait, nincs új skill-fallback vagy pénzmozgás.
- `gateway-unavailable`: a valódi natív gyűjtés után megszakított SDK
  WebSocket elveszíti az ACK-ot; új kapcsolat és ugyanaz a run source-ból
  egyeztetődik, második output nélkül. A megnevezett transport-határon a
  nyilvános SDK disconnect hívás bontja a kapcsolatot a natív commit után,
  a completion ACK elküldése előtt; ez nem valódi gateway-folyamatleállítás.
- `uncertain-trade`: külön trade journal commit után checkpoint-hiba; a
  megmaradt uncertainty látható, nincs vak újraküldés, refund vagy completed.
- `wage-checkpoint-rollback`: a checkpoint hibája együtt visszagörgeti a
  natív bizonylatot és az inventoryt; ugyanaz az ID később egyszer fizet.
- `wage-projection-failure`: a kanonikus pénz és receipt megmarad, az exact
  újrapróbálás csak a hiányzó projekciót javítja és a treasuryt egyezteti.
- `wage-source-missing`, `wage-receipt-tamper`: elveszett ACK után hiányzó
  vagy módosított kanonikus bérforrás explicit egyeztetési hiba; a hold marad.
- `crash-reservation`: a reservation/request után megszakítás, azonos munka
  folytatása új készlet vagy második bérhold nélkül.
- `crash-native-commit`: kész natív főzés után, domain-apply előtt kill;
  ugyanaz a run a tartós receiptből tér vissza, nem főz második adagot.
- `crash-suspended-cook`: natív waiting fázisban kill; az auditált pending
  művelet új executorral, azonos runon fejeződik be.
- `crash-domain-apply`: earned munka/request után kill, eredeti bérsettlement.
- `crash-wage-commit`: kanonikus pénz/receipt commit után, treasury előtt
  kill; újranyitás után egyszeri treasury-kivezetés és változatlan Player GP.
- `crash-rent-commit`: natív díjfizetés után, domain-finalizálás előtt kill;
  az újranyitott rent aktív lesz, ismételt pay nem von le újabb díjat.
- `crash-goal-update`: valódi terminal skill után SQL-triggerrel megszakított
  goal/outcome tranzakció, majd process kill; recovery kétszer futtatva is
  egy sikeres goal-run, egy natív gyűjtési output.
- `crash-routine-update`: rent source commit után, routine journal completed
  előtt kill; recovery source-reconciliationnel zár, új natív pay nélkül.

Az uncertainty egy sikeres negatív tesztben is maradhat rendezetlen.
Ez nem jogosít automatikus kompenzációra. Az exact natív commit utáni domain
recovery megőrizheti a termelési forrást időbélyeg nélküliként, ha a régi
source időpontja megelőzi a clock headet; ez explicit coverage-hiány, nem
visszadátumozott vagy kitalált simulation proof.

## Javított közös perzisztenciahatárok

A `NativePlayerReward` a bér receiptjét és az elkölthető Player-save-et
egyetlen kanonikus SQLite immediate tranzakcióban írja. A korábbi mod-fájl
előremutató projekció; exact-ID retry javíthatja, új wallet credit nélkül.
A gateway a kanonikus bizonylatot is ellenőrzi. A projekció új
`player_action_reward_checkpoint(settlement_id, receipt_digest)` táblája
megkülönbözteti ezt a forrást a legacy receiptektől. Meglévő legacy receiptet
nem kreditálunk újra bizonyíték nélkül. A régi, checkpoint nélküli U fixture
kompatibilitása nem bizonyít atomi natív mentést.

Migráció: a natív reward-tábla additív a kanonikus checkpointban; a marker
additív a mod-projekcióban. Nincs régi receipt utólagos sikeresre írása.
Rollback: rendezett írók után mindkét adatbázist és journalokat együtt kell
megőrizni; bináris visszaállítás előtt a pending/committed settlementeket
egyeztetni kell. Marker vagy receipt törlése, illetve vak újrakreditálás nem
rollback. A commit előtti tetszőleges gépleállás minden integrity-permit
állapotának automatikus feloldása nincs ezzel bizonyítva.

Az inbox v3 migráció külön `simulation_wall_time` mezőt ad. A késve érkezett
source `occurredAt` értéke megmarad; a kézbesítés a megfigyelt clock headnél
kap bélyeget. A v2 történeti reprezentációját a `created_at` másolata őrzi,
nem keletkezik visszamenőleges új forrásbizonyíték. A strict clock-regression
védelem változatlan. Rollback előtt inbox/clock konzisztens snapshot szükséges;
a régi v2 bináris elutasítja a v3-at. Egyeztetés nélkül ne csökkentsünk verziót.

A natív housing az identity-ellenőrzés után friss clock observationt használ
az alvás witnesséhez és PlayerTime-admissionhöz, illetve új megfigyelést az
érvénytelen alvásjog miatti wake-hoz. A guard közben előrelépő közös óra így
nem vezet visszafelé történő PlayerTime-íráshoz. A külön progressing-clock
regresszió valós housing adapterrel ellenőrzi mindkét átmenetet.

A managed bootstrap a módosítás előtti Playert a checkpoint közzététele
előtt olvassa ki, így az opening lineage tényleges before-image-et használ.
Az offline loader átmeneti login-kulcsa envben is elérhető, majd törlődik.

## Fixture-revízió és evidence

Az aktuális fixture `society-lobster-four@1.0.1`: a nyers nyitókészlet nulla,
így a meglévő minimum-zero stock policy az első valódi beszerzést engedi.
A régi 1.0.0/raw=2 definíciók történeti archive-validációja megmarad.
A Property-backed facility-jogok állandó jogok, `validUntil: null`; ez
elválasztja a jogosultságot a 90 perces futási protokolltól és a műszak
falióra-intervallumától. A 32 outputos quota, véges pénz és importtilalom marad.

A parent `.local/verification/si-a14-native-<timestamp>/manifest.json` fájlt
ír, minden esethez valódi DB-ket és hash-elt `files.json` listát tart meg.
A végleges hash-ek a SQLite integrity-ellenőrzés és a handle-ek lezárása
után készülnek: readonly nyitás is átépítheti a WAL shared-memory indexét.
A külön evidence-audit a hash-eket az eredetin, a SQLite- és checkpoint-
ellenőrzéseket eldobható másolaton végzi, így az archív byte-ok megmaradnak.
A manifest ezeket a fájljegyzékeket, a forrásjegyzéket, baseline-sealt,
fixture/world kötést és pontos esetkészletet is digesteli. A meglévő
acceptance-bundle hash-primitívet használja; a live multi-agent verdictet
nem alakítja át teszt-summaryvá. A protokoll külön
`society-integration-regression-v1`, `eligibleForLiveAcceptance: false`.

Az [SI-A15](TASKS_SOCIETY_INTEGRATION.md) élő kapuja külön feladat. A valódi
draft-publication, travel, kétágyas ütemezés és normál needs/controller
küszöbök ellenőrzése megmarad; nincs automatikus publikáció vagy világapply.
