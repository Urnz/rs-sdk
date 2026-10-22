# SI-A02 – Natív homárgyűjtés és főzés

2026-10-18. Csak a helyi/private rs-sdk/LostCity emulatorhoz.
Előfeltétel: [SI-A01](SI_A01_NATIVE_FOOD.md). Az ellenőrzési eredmények és a
korábbi regressziós hiba javítása a [progressben](SOCIETY_INTEGRATION_PROGRESS.md)
követhetők. Ugyanazon feature branch folytatása; commit/push nem történt.

## Natív út és tartós határ

A támogatott food-chain változatlanul **lobster: raw 377 → cooked 379**, az
égetés kimenete **381**. A `production-workflows.json` új, verziózott
`food.cook-lobster@1.0.0` receptje és `food.cooked-lobster@1.0.0` workflowja
ehhez igazodik; a shrimp és a többi meglévő recept megmarad. A Cooking minimum
40, a normál Fishing minimum 40 és a lobster pot követelmény a valódi
contentből is érvényesül. Az RNG és a siker/égetés szabálya változatlan.

Az engine `INV_ADD`/`INV_DEL` handlerei kizárólag az ismert food-chain és
contenthelyek esetén hívják a typed natív adaptert:

- `[proc,fish_roll]` és raw lobster hozzáadása: a valódi sikeres halászati
  roll után egy raw unit, forráskvóta és Player-checkpoint együtt commitol.
  Sikertelen roll, hiányzó eszköz, alacsony skill vagy helyhiány nem válik
  sikeres gathering receiptté.
- `[label,cook_item]`: az eredeti cooking content előfeltételei és `p_delay`
  lefutnak. A késleltetés utáni raw törlési szándék tartós action ID-t kap,
  az input tényleges levonása pedig a közvetlenül következő natív cooked/burnt
  outputtal együtt, egyetlen SQLite tranzakcióban történik. A kettő között
  nincs yield vagy más játékhatás; a runner ezt a szinkron határt külön
  ellenőrzi. Váratlan script/opcode, extra mutáció vagy megszakítás pending
  intentet hagy, el nem költött inputtal; nem gyárt outputot.

A hook a meglévő protected inventory-opcode ellenőrzései után fut. Az actor
identity/lifecycle és a meglévő SimulationClock authority ismét ellenőrzött.
Idegen actor/world/lifecycle, halott karakter, álló óra, nem megfelelő vagy
túl távoli forrás és eltérő recipe/input/output fail-closed. A production
út az SI-A01-gyel közös canonical Player-save connectiont és az existing
shared-escrow migration preflightot használja. Más inventoryműveletből nincs
automatikus production receipt.

A konzisztenciahatár a fizikai inventoryra, a forráskvótára és a receiptre
vonatkozik. A későbbi content XP-award végső Player-stat commitját ez a receipt
nem tanúsítja. Ugyanazon action ID replaye a már commitolt eredményt olvassa,
és a következő XP-awardot sem ismétli meg.

## Véges forrás és műveletazonosítás

Az [engine policy](../../config/native-food-production.json) explicit,
verziózott induló run ID-t tartalmaz: `si-lobster-bootstrap-v1`.
Az egy támogatott forrás a Musa Point `0_45_49_rarefish` NPC-típusa, a
megadott 64×64 tile régióban, level 0-n. A régióban található megfelelő
spotok egyetlen **32 unitos közös keretet** használnak. Nincs timeres refill.

A kvóta kulcsa world ID + run ID + source ID. A kezdeti quantity és policy
digest az első commitnál rögzül; minden következő levonás ellenőrzi a megmaradt
keretet a commitolt native gathering receiptek számával szemben. Restart,
újranyitás, állományáthelyezés vagy quantity/policy módosítása nem töltheti
vissza ugyanazon run keretét. Kimerülésnél nincs további raw gain. Más run ID
új, explicit erőforrás-admissiont jelent, ezért az acceptance runban nem
változtatható csendesen.

A hook az aktív population membershippel rendelkező avatarokat kezeli.
A nem bevont karakterek vanilla gameplaye változatlan, de abból nem állítunk
SI-bizonyítékot vagy véges társadalmi forrásfelhasználást. A későbbi SI-A15
izolált run a bevont actorokat és a megengedett külső értékmozgást is rögzíti;
ez nem általános ökológiamotor vagy minden játékosra kiterjesztett új halászat.

Actionmezők: UUID, kind (`gather`/`cook`), world, worker actor, username,
lifecycle, run ID, batch ID, natív forrás (kind/type/coord/source ID), recipe
ID/version, catalog/policy digest és clock binding. A batch ID egy natív
műveletegységet jelöl: `<runId>:<actionId>`. A forrást és a kimenetet az engine
állítja elő; a gateway és a modell nem tölthet fel hitelesnek mondott receipteket.
A fogyasztás és production ID-névtere közös: ugyanazon ID két eltérő
művelettartalommal a két író határán is tiltott.

Receiptmezők: exact request és digest, outcome (`raw-gained`, `cooked`,
`burnt`), tényleges input/output mennyiségek, raw/cooked/burnt inventory
before/after, gatheringnél quota before/after, meglévő SimulationClock
observation, checkpoint ID és save digest. A cooked és burnt kimenet külön
bizonylat; burnt nem minősül a sikeres cooking recept késztermékének.

## Olvasás, transformation és provenance scope

A `readNativeFoodProductionSource` readonly exact-ID olvasó egy SQLite
snapshotban ellenőrzi a sémát, requestet és receiptet. Az eredmény
`unavailable`, `missing`, `pending` vagy `completed`. Hiányzó fájl/séma nem
hoz létre adatbázist. A közös managed-source path guard a kiválasztott
világ engine adatkönyvtárához és server ID-jához köti az olvasást.

Az `item-transformation/readNativeFoodTransformation` valódi natív
quantity-bizonylatot és a hozzá kötött receptkatalógust kapcsolja össze.
Worker, source, batch, input/output, native evidence digest és a sikeres
recipe-output külön jelzője olvasható. Nem ír Business/WIP vagy provenance
belső táblát, nem talál ki pontos assetazonosítókat vagy tiszta tulajdonjogot.
Az actor-közi pontos lineage továbbra is SI-A05, a custody/WIP integráció
SI-A06. Ezeket nem jelöli készként egy sikeres engine cooking receipt.

A receptvalidátor tiszta része `production-workflow/catalog-definition.ts`
modulba került, változatlan publikus exportokkal. Így a motor és a root
domain ugyanazt a validációt/digestet használja anélkül, hogy a root loader
`import.meta`-alapú alapértelmezett útvonalát bevonná az engine NodeNext
projektjébe. A meglévő cycle/unknown-recipe teszt a konkrét workflow ID-kat
választja; minden eredeti assertion megmarad.

## Migráció, hibák és rollback

Additív, lokális **schema 1**: `native_food_production_schema`,
`native_food_production_actions`, `native_food_source_quota`, ugyanabban a
canonical checkpoint DB-ben. Az SI-A01 sémája, a globális `user_version`,
régi Player-save-ek és escrow adatok nem íródnak át. Régi gyűjtés/főzés nem
kap visszamenőleg natív receipteket. Ismeretlen séma nem migrálódik csendesen.

A pending intent a fizikai mutáció előtt tartós. Írási hibánál a raw input,
a cooked/burnt output, a kvóta és a checkpoint együtt visszagörget, a live
inventory is visszaáll. Commit utáni bizonytalan válasznál exact-ID lookup
kell; receipt birtokában nincs új mutáció. Pending esetben a kanonikus
Player-save-ből folytatható az eredeti intent, újabb indokolatlan inputlevonás
nélkül. Egy új kliensinterakció új action; a magasabb szintű verified retry
bekötése SI-A07 feladata marad.

A managed backup meglévő `server/engine/data` fája az új táblákat is viszi.
Rollback: minden író megállítása, pending intentek egyeztetése, a kapcsolódó
világ/domain állapot és DB/WAL/SHM együttes mentése. Receipt vagy quota
egyoldalú törlése/visszaállítása és a keret újranyitással való resetje tilos.
Az additive táblák code-rollbackkor megőrzendők; régi kóddal futó későbbi
vanilla művelet nem nevezhető SI-A02-attested eseménynek. Új avatar-egyenleg,
költhető estate-vagyon vagy külön custody-authority nem keletkezik.

## Ellenőrzési scope

Az izolált helyi Player-smoke a valódi packed fishing és cooking entry
scripteket, JavaRandom rollt, `p_delay`/resume-t, inventoryt, save serializert,
SQLite checkpointot és readonly adaptert használja. A natív RNG tesztseedjei
4096 és 0; a game chance formula és outcome ág nem helyettesített.
Identity/clock/policy és indulókészlet temp fixture, optional host XP-mod
journal nélkül; a base Player XP-módszer megmarad. A generated login key,
login/checkpoint DB-k és a két force-kill saját temp könyvtárban vannak.
Hálózati SDK/böngésző session, meglévő karakter átírása és LLM-hívás nincs.

Tényleges gather → cook → consume és canonical inventory reopen is lefut.
Külön siker/burn, több input, részleges delay, quota exhaustion/reopen/drift,
ID-replay, wrong source/actor/recipe, death, hiányzó readonly source,
quota-tamper, checkpoint/receiptírás-hiba, valamint commit előtti/utáni
process kill és ugyanazon ID egyszeri folytatása szerepel a próbákban.
Ez az SI-A02 bounded local smoke-ja; a közös SI-A14/SI-A15 acceptance nyitott.
