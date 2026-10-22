# SI-A07 – Bounded food skilladapterek

Az implementáció a meglévő declarative executor, SDK-session, natív food
authority és WIP-custody útját használja. Az új procedure-k verziózott, közös
`0.1.0` draftok; izolált teszteredmény nem lett élő publikálási bizonyítékként
beírva a workspace-be vagy `1.0.0` katalógusverzióként kiadva.

## Typed műveletek és valódi eredmény

- [gather-lobster](../../agent-skills/catalog/procedure.food.gather-lobster@0.1.0.skill.json):
  egy 377-es raw lobster, a konfigurált Musa Point source-nál, legfeljebb egy
  natív attempt. A Fishing/tool, közelség, szabad hely, aktív avatar/clock és
  a meglévő véges source-quota valódi engine/content feltétel.
- [cook-lobster](../../agent-skills/catalog/procedure.food.cook-lobster@0.1.0.skill.json):
  meglévő walk-to a konfigurált heat mellé, majd exact WIP run/batch/worker,
  protected input/output custody, valódi natív főzés és Business-finalize.
  Egy raw egységet dolgoz fel; burnt 381 és félmunka nem sikeres skill.
- [consume-lobster](../../agent-skills/catalog/procedure.food.consume-lobster@0.1.0.skill.json):
  egy 379-es lobster az exact inventory slotból, a normál natív consume contenttel.
  Teljes HP mellett is a tényleges fogyasztás a bizonyíték. A relief továbbra is
  az SI-A04 meglévő outbox/NeedsStore/receipt-lock útján alkalmazódik.

A [runtime](../../agent-skills/rs-sdk-runtime.ts) a meglévő
[SDK](../../sdk/index.ts) societyFood műveletét hívja. A gateway a már hitelesített
controller session targetjét használja; observe session nem cselekedhet,
posted másik username nem választ dolgozót. Az engine admin token a backendben
marad, nem kerül a skillfolyamat környezetébe vagy a böngészőbe.

A [gateway adapter](../../server/gateway/admin/native-food-skills.ts) dispatch
előtt tartósan rögzíti az exact run/step/version/parameters-digest és a population
world/actor/player/lifecycle/clock kötését. A stabil action UUID a run és a lépés
azonosítójából származik. A source DB útvonala az engine shared checkpoint
authority explicit PLAYER_CHECKPOINT_DATABASE → GE_DATABASE → player-checkpoints
sorrendjét követi; az első gyűjtés előtt még hiányzó food delivery séma nem blokkolja
a láncot. World/path/junction eltérés és hiányzó authority fail-closed.

A [natív adapter](../../server/engine/src/mods/NativeFoodSkill.ts) a valódi
packed OPNPC4 vagy OPHELD1 contentet használja. A gyűjtés admissionje a dispatch
előtt tartós. A hideg kattintás a content öt tickes előkészítését végzi;
ennek waiting/wakeTick/checkpoint állapota külön auditált execution-journalban
él a kanonikus checkpoint DB-ben. Ugyanaz az előkészítés folytatható az eredeti
action ID-val és változatlan natív action_delay mellett. A tényleges fogási dobás
csak egyszer végezhető el; attempted állapotból nincs új dobás. Sikertelen roll
és restartkor elveszett vagy megváltozott előkészítés esetén egyeztetés kell.
Egy eredmény nélküli, megszakadt vagy hibás attempt nem indítható
vakon újra ugyanazzal az ID-val. A runtime az engine ACK után a kanonikus SQLite
forrást olvassa újra; elveszett ACK mellett is megtalálható a valódi receipt,
puszta HTTP-/SDK-/process-sikerből viszont nem keletkezik eredmény.

A gyűjtés és főzés újonnan létrehozott content-folytatásai az egybatch határán
leállnak; nincs új, szabadon futó auto-gather/auto-cook queue. A checkpoint-hiba
az inventory, XP, base level, var és delay állapotot is visszaállítja.
Főzésnél csak a meglévő idempotens custody-adapter biztonságos waiting/process/
return útja folytatható, programban rögzített poll-, timeout- és operation-limittel.

## Jogosultság, delivery és megszakítás

Az új food opok nincsenek az alap routine allowlisten: külön exact-item,
operation és egyegységes runtime grant kell. Főzéskor raw és cooked item-jog is
kell, az eredeti WIP role/facility jogosultság pedig natív commitkor ismét ellenőrzött.
A paraméterek és a hőforrás/sourceroute korlátozottak. A futtató waiting közben
is újraellenőrzi saját grantját. Az automatikus planner továbbra is csak exact
verified, az agent által ismert/preferred verziót és engedélyezett paraméterkötést
indíthat; az új draftok nem kapnak automatikus kivételt.

A meglévő receive/give/travel és bank műveletek maradtak közösek. Nincs gatherer,
cook, consumer vagy landlord nevére másolt skill. Az ismert
trade.lumbridge.give-item@1.0.0, illetve a meglévő receive és travel procedure
saját változatlan verzió-/verifier kapujukkal használhatók. A delivery a normál
SDK trade- és inventory-megfigyelést használja, nem gyárt új natív receiptet.
Az exact partner/item/quantity és meglévő ár-/GP-grant ellenőrzése megmarad.
Részleges vagy possiblyDropped átvétel és bizonytalan trade false eredmény,
nem retry és nem onFailure=continue út. A kétoldali gazdasági/native reconciliation
az SI-A09 feladata marad.

A [run journal](../../agent-skills/journal.ts) első művelet előtt külön admissiont
őriz, a tényleges UUID-val, exact verzió/checksummal és resolved paraméterdigesttel.
Admission nem completed eredmény. Már lezárt run nem fut újra; régi eredmény
identity/paraméter eltérése tiltott. Megszakadt általános skill nem indítható vakon
ugyanazzal az ID-val. A szűk food recovery kizárólag ugyanazt a natív eredményt
olvashatja vagy a már foglalt idempotens WIP-félmunkát folytathatja.
Bizonytalan food/trade kimenet az autonóm failure-routerben egyeztetést igényel;
nem új runra váltó automatikus retry. Burnt után input acquisition szükséges.

## Két független próba és publikálás

A meglévő trial → verifier → emberi publication approval rend megmaradt.
A kifejezetten jóváhagyott draft-trial csak a draftban szereplő szűk food grantot
kapja. A verifier food esetén minden run kanonikus forrását újranyitja, ellenőrzi
az intentet, a tényleges natív action-ID-t, receipt-digestet és WIP completiont.
Ugyanaz a fizikai receipt nem számít két független trialnak. Publikálás előtt a
backend ismét ellenőrzi a food forrásokat és a korábbi approval digestet.

A cook `kitchen-run` és `batch-id` paramétere `verification=native-invocation`:
két független főzés két külön WIP-inputot és receiptet használ. Csak ezek az exact
string bindingek változhatnak a próbák között; functional paraméter és route nem.
Ez a jelölés kizárólag a megfelelő food-cook argumentumra használható, nem
loop/precondition vagy más művelet irányítására. A második trial-run API-ban
`nativeBindings` adhatja az új run/batch kötést; a schema és source verifier ismét
ellenőrzi. Nincs általános paramétereltérés alóli felmentés.

14 izolált natív teszt valós packed contenttel, Player/save/inventoryval,
SQLite source-okkal és valódi BotSDK WebSocket protokollal ellenőrzi a teljes
executor → SDK → adapter → receipt korrelációt. Mindhárom új procedure-höz két
külön natív eredményes fixture run és readonly verifier tartozik. A socket harness
nem élő population-acceptance; precondition/state és walking tesztportja izolált.
A korábbi publikálási browser/approval tesztek is futnak. Élő, kiválasztott worldön
végzett trial és emberi publikálás nem történt; a négyavatáros SI-A15 acceptance
és az új skillek tényleges automatikus aktiválása ezt a kaput nem kerülheti meg.

## Perzisztencia és rollback

Additive JSON admission v1: `.local/agent-skills/runs/*.admission.json` és
`.local/agent-skills/food-operations/*.json`. Exclusive create, exact binding és
digest ellenőrzés; félbeírt/hiányos rekord nem jogosít új dispatchre. Az eredeti
native action/receipt/quota/outbox és run-result azonosítók megmaradnak.

Additive engine execution schema v1: native_food_skill_schema/attempt/audit/head.
A meglévő production actionhez kötött waiting vagy attempted rekord, checkpoint
digest, audit-chain/head és teljes projection coverage őrzi az előkészítést.
Nem item-, quota- vagy receiptledger. A waiting állapot csak olyan tranzakcióból
származhat, amelyben a natív content még nem végzett fogási dobást; a dobás utáni
receipt/XP/save és attempted állapot közösen commitol. Hiányzó/félkész/újabb séma,
truncation vagy request-digest eltérés nem enged ismételt dobást.

A meglévő native WIP row opcionális, auditált `skillInvocation` kötést kap.
Régi sor nincs automatikusan új trialként adoptálva; új kötés csak prepared runon
írható. Ugyanaz az invocation nem köthet két WIP-inputot; a binding nem cserélhető
vagy távolítható el az auditíró API-val. Settlement a kötést is megőrzi. Az intent
JSON elvesztése nem szabadítja fel a WIP-t egy másik skillrun számára.
Nincs második készlet-, bér- vagy gazdasági receiptledger és nincs schema/user_version
visszaállítás. A régi audit-sorok hash-e változatlan marad.

Az engine TypeScript-projekt resolveJsonModule beállítása engedi a valódi SDK
collision-data importját az integrációs tesztben; a strict ellenőrzés megmarad.

Downgrade előtt állítsd le a világot és fejezd be/egyeztesd az outstanding food/WIP
műveleteket. A teljes workspace, run/operation admissionok és az összetartozó
checkpoint/Business/needs adatbázisok + WAL/SHM közös mentése szükséges.
Csak a JSON intentek vagy receipt-lockok törlése nem rollback; az eredmény nélkül
félbeszakadt runból nem készíthető completed journal és raw refund.

Ellenőrzési körök, negatív futások, időtartamok és a teljes regresszió:
[progress napló](SOCIETY_INTEGRATION_PROGRESS.md).
