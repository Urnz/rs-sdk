# SI-A11 – Determinisztikus megélhetési rutin

A `society-livelihood@1.0.0` névfüggetlen, explicit enrollmenttel választható
policy. A gateway meglévő autonomy supervisorát, due/lease állapotát, replan
inboxát, decision ledgerét és skill-futtatóját használja. Nem indít második
ütemezőt, institution LLM-loopot, providert vagy actoronkénti scriptet.
A korábbi `private-local-default` enrollmentek változatlan policyt használnak;
ez a feladat nem aktivál élő avatárokat és nem publikál draft skilleket.

## Rögzített sorrend és források

1. Terminális lifecycle, szüneteltetett clock és hiányzó/eltérő needs-forrás
   megállítja az új fizikai műveleteket. Beküldött szándékot először egyeztetünk;
   halál esetén a függő custody látható marad, gameplay nem indul újra.
   A SI-A03 állapot a lezárt engine tickig hiteles: a világclockhoz képesti,
   legfeljebb 30 wall-másodperces lag csak egyező clock/profile, friss closed
   watermark és hiánytalan, már alkalmazott food receipt-sor mellett fogadható
   el. A függő receipt új fogyasztást és munkát is blokkol; a rutin nem lépteti
   előre a fiziológiát. Friss genesisnél az első native DB előtt csak a pontos
   kezdeti clock enged bootstrapet, meglévő sérült forrás nem.
2. Alváskor a rutin vár, amíg a fatigue legfeljebb 2500, vagy a hunger legalább
   6000. Ekkor kizárólag wake döntés engedélyezett. A supervisor szűk alvási
   kivétele nem jogosít skillre, offline delegálásra vagy léptetésre.
3. Hunger >= 6000: saját friss inventory pontos lobster-slotjából egy
   `procedure.food.consume-lobster@0.1.0` invocation. Ennek hiányában meglévő,
   kötött SI-A09 sale, vagy jóváhagyott Business és stock catalog állandó árából
   egyetlen darabos sale-szándék választható. Más avatar inventoryja nem adatforrás.
4. Fatigue >= 7000: meglévő fizetett bérlet és katalógusbeli, tényleges közeli
   ágy esetén natív sleep. Hiányzó bérletnél a Property tényleges player
   tulajdonosa, szabad bed-slot és unit catalog adja a fix fizetési feltételeket.
   Hiányzó útvonal/emelet vagy entitlement esetén `paid-bed-or-route-required`.
5. Esedékes player-action munka/delivery pontos request-paraméterei, a meglévő
   SI-A08 delegálás, one-use authorization és natív completion/wage egyeztetés.
6. Saját tényleges raw lobster meglévő procurement stock policyhoz adható el,
   vagy már jóváhagyott, kötött immediate supply-goal futtatható. A supply
   goal progress/cooldown az eredeti goalhoz tartozik. Paraméterforrása
   `approved-policy`, source ID-ja `society-livelihood:1.0.0`.
7. Esedékes bérleti teendő, egyébként tartós várakozási ok.

Business institution esetén a saját stock catalog cooked-lobster célkészlete,
tényleges raw készlete, jóváhagyott Business policyja, aktív cook employmentje,
facility entitlementje és a dolgozó pontos skill-ismerete adja az egyetlen
determinista cook-order jelöltet. Meglévő nyitott shift esetén nincs új order.
Az alapanyag a SI-A06 WIP-foglalásba kerül, a bér a SI-A08 treasury-foglalásba;
a rutin sem itemet, sem pénzt, sem jogosultságot nem hoz létre.
A már megfelelő készlet és a folyamatban lévő stock shift normál várakozás;
ezek nem növelik a hibaszámlálót és nem indítanak duplikált rendelést.

## Végrehajtás és helyreállítás

- A skillág pontos, known/preferred és independently verified/published skillt,
  meglévő autonomous allowlistet, paraméter-envelope-ot és GP-keretet követel.
  A skill-goal névfüggetlen, az agent ID digestjéből származó fix hierarchiába
  kerül; egy invocation egy one-shot immediate goal. A supply meglévő goalját
  használja tovább. Skill-végrehajtás előtt immutable intent, majd dispatch
  kerül lemezre. Ismeretlen processzeredménynél nincs új startSkill.
- A natív commerce és rent a SI-A09/A10 adaptereket használja. Fizetés/kereskedés
  előtt mindkét résztvevő friss, controller és aktív skill nélküli, azonos
  policyra enrolled avatar. A partner az existing enrollment CAS-lease-ét kapja
  meg; paused/quarantined/busy partner és aktív backoff nem kerülhető meg.
- A fizetési korlát a decision operational budgetjébe is bekerül. A Business
  bére, a vásárló food ára és a tenant rentje saját meglévő keretéből fogy.
- ACK és process exit önmagában nem bizonyíték: commerce native/trade proof,
  rent escrow/native digest, sleep/wake player-time, illetve a meglévő hiteles
  skill terminal reconciliation igazolja az eredményt. Függő natív parancsot
  restart nem küld újra. A stock domain-outbox ugyanazokkal az ID-kkal javítható;
  nem ismétel fizikai műveletet.
- Missing input/grant/route/capability esetén stabil okkód, bounded backoff és
  az existing supervisor három azonos hibánál tartós quarantine. A queued
  események sem a backoffot, sem a karantént nem kerülik meg. Normál alvás,
  üres due-lista és paused clock várakozás, nem hibaszámláló.
- A legutóbbi tíz bejegyzés `livelihoodProgress` mezőként az admin agent-state
  nézetben is elérhető; a teljes történet a meglévő agent DB-ben marad.

## Migráció és rollback

Az agent DB-ben lazy, tranzakciós, additive `agent_livelihood_schema` v1
kiegészítés hozza létre az `agent_livelihood_action` és
`agent_livelihood_audit` táblákat. A shared `user_version` és meglévő adatok
nem változnak. Agentenként legfeljebb egy prepared/submitted action lehet;
CAS revision, immutable binding és SHA-256 auditlánc védi a progresszt.
Az inbox terminal outcome-ja a várakozási/hibaokot akkor is tárolja, ha a
snapshot már az admission előtt elérhetetlen.

Rollback előtt emergency stop, majd az érintett enrollmentek pause szükséges.
A beküldött fizikai műveletek és native/domain bizonyítékok egyeztetendők;
ismeretlen custody vagy fizetés esetén nincs refund/újraküldés. A korábbi
gateway-verzió ezeket az enrollmenteket unsupported policyként kihagyja.
A kiegészítő táblák megtartandók auditként; nem kell és nem szabad élő pending
intentet vagy domain-foglalást törölni a visszaállításhoz.

## Ellenőrzés és korlátok

A policy-, journal-, CAS-, négyavatáros supervisor/inbox-, timeout/restart-,
halál-, cooldown/quarantine-, sleeping/wake- és SDK-dispatch tesztek backend
fixture-ökkel futnak, providerhívás nélkül. A readonly forrásteszt valódi
needs-, clock-, Property-, Business- és entitlement-tárolókat használ.
Az izolált engine housing teszt a valódi kétoldali GP-mozgást, elveszett ACK
utáni receipt-egyeztetést, natív sleepet és wake-et köti a supervisorhoz.

A food skillek továbbra is draftok; publikáció nélkül a rutin bounded stopot
ad. Hiányzó fizikai útvonalat nem helyettesít teleport vagy tick-script.
Az élő négyavatáros lánc és a teljesen feltöltött capability/grant környezet
elfogadása továbbra is **SI-A15**; az izolált teszt nem élő elfogadás.
A konkrét teszteredmények és futásidők a
[progress naplóban](SOCIETY_INTEGRATION_PROGRESS.md) szerepelnek.
