# SI-C07 – Natív eszközhasználati kérések megfigyelése

2026-10-25. Részlépés; SI-C07 nyitott,27/45, SI-M3/MVS nem PASS.

**Későbbi bővítés:** [tartós igény, expiry/cancel/fulfillment és időintervallumok](SI_C07_STANDING_TOOL_DEMAND.md).
Az alábbi leírás az egyszeri attempt-csatorna határa; a teljes cohort coverage
továbbra hiányzik. A tartós kérés külön natív admissiont igényel, nem születik
egy elutasított kattintásból.

A tényleges packed Mining befogadott, elutasított és committed kimeneti
megfigyelése most tartósan megmarad. A natív script törött eszköz esetén azonnal
ABORTED állapotba kerül; nincs mögötte automatikusan fennmaradó várakozási igény.
Ezért két elutasított kattintás közötti teljes idő nem nevezhető eszközhiány
miatti igényidőnek. A teljes minimumhoz tartós, forráshoz kötött requested-use
intervallum, lezárási/cancel esemény és lefedettségi watermark még szükséges.

## Natív határ és olvasás

- A `NativeMiningTool.prepareNativeMining` a meglévő managed bronze-tool ágon
  rögzíti az `admitted` vagy `blocked` mintát. Okok: `unusable-tool`,
  `unavailable-position`, `invalid-evidence`. Utóbbi nem bizonyított eszközhiány.
  Az ismételt/resumed befogadás ugyanahhoz a requesthez tartozik.
- A `committed` megfigyelés a tényleges réz/ón kimenettel, durability-wearrel,
  lifecycle receipttel és Player checkpointtal közös, meglévő tranzakcióba kerül.
  A naplóírás hibája sem hagyhat meg naplózatlan ércet vagy kopást.
- A rekord a natív owner/world/clock/profile/lifecycle, engine tick és simulation
  time mellett az eszköz akkori állapotát, binding digestjét és lelőhelyét köti.
  A régi siker-receipt replay nem készít új igényt, ércet vagy kopást.
- Az új ledger számozott hash-láncot, immutability triggereket és külön tail-headet
  használ. A readonly reader teljes láncot és headet ellenőriz; ez helyi integritás,
  nem külső tanúsítás vagy teljes mérési lefedettség. Hot-path append tail-checkje
  állandó költségű; nem olvassa újra a teljes történetet minden swingnél.
- A `reportNativeOutcomes.sources.toolDemand` a meglévő backend actor- és
  útvonalkorláton keresztül exportálja a kiválasztott cohort próbálkozásait.
  Világ/óra/profil/lifecycle eltérés vagy visszafelé haladó óra invalid; a hibás
  forrás tartalma nem kerül a publikus hibaüzenetbe. A forrás readonly DB snapshot.

A riport külön számlálja a requesteket és a mintákat. A három fázis nem három
igény. Ablak `(from,to]`. Hiányzó ledger `source-absent`, létező ledger
`attempt-observations-only`; `unusableDemandSimulationMilliseconds:null` és
`minimumVerdict:inconclusive` mindkét esetben. Nincs implicit nulla vagy PASS.
Offline/idle, teljes inventory, eredménytelen mining roll, előzetes történet,
hiányzó identity/unbound legacy ág és megszakított script nem tölti ki a nevezőt.
A C05 available-and-willing unemployment mérésével sincs automatikus megfeleltetés.

## Saját séma, migráció és rollback

Komponens: `item-lifecycle/native-mining-demand.ts`. A séma verziója1, táblái:
`native_mining_demand_schema`, `native_mining_demand_event`,
`native_mining_demand_head`. Az explicit eszköznyitás meglévő checkpoint-
tranzakciója létrehozza az üres sémát a baseline pin előtt. Ez nem használati
előzmény és nem coverage-watermark. Már meglévő binding mellett az első
naplózható managed kérés is inicializálhat; ilyen régi világban a komponenst
baseline készítése előtt kell migrálni, nem a futás közben. Readonly report
nem inicializál. A natív teszt igazolja, hogy a nyitáskor üres séma az első
bányászat során nem változik.

A migráció additív, DDL+version+üres head egyetlen tranzakcióban; nem írja át a
DB `user_version` értékét vagy a más komponensek állapotát. Régi receiptből nincs
visszatöltés és nincs visszamenőleges coverage-állítás. Ismeretlen verzió vagy
verzió nélküli korábbi demand-adat fail-closed, a sikertelen DDL rollbackel.

Rollbackkor állítsd le az írót és állítsd vissza a kódot; a három új táblát és
triggereket tartsd meg a bizonyíték megőrzéséhez. A korábbi kód figyelmen kívül
hagyja őket, más séma visszamigrálása nem kell. A visszaállított kóddal keletkező
időszak demand coverage-e hiányos, később sem tölthető ki feltételezéssel.
Hosszú C07 baseline kiválasztásakor e táblák/head kötelező source-pinje és
új könyvtáras restore utáni natív újraolvasása még bekötendő.

## Maradó munka

1. A később elkészült tartós komponenshez production source-backed gather-loc
   admission/start/cancel és teljes cohort coverage szükséges; a részleteket
   a fenti bővítési link tartalmazza. Session/identity gap nem igazolt nulla.
2. A17 eredeti minimum requirement és8 integrity gate teljes assessment bridge-e;
   hiányzó coverage inconclusive, bizonyított gazdasági sértés FAIL.
3. Teljes founder tool/food/housing baseline, ratio-próba, kötelező source-pinek,
   SI-A14 és ezután konkrét hosszú futási terv/jóváhagyás.

Nincs shared clock, gazdasági alaptranzakció vagy közös migrátor átírás. Az új
megfigyelés a meglévő Mining-tranzakció része, ezért a célzott natív checkpoint/
hiba/replay/custody és repair/outcome fogyasztók szükségesek; a teljes regresszió
nem automatikus követelmény ettől a komponens-sémától. Nincs élő világ, provider,
új erőforrásimport vagy minimumküszöb-módosítás.

Ellenőrzés: a `si-c07-demand-consumers` kör68 ellenőrzése és root/engine TS
PASS153,683 s, runtime18,85 s. A végső explicit nyitási határ után a
`si-c07-demand-opening-boundary`20 ellenőrzése +engine TS PASS40,022 s.
`si-c07-demand-benchmark-restore`:1 kiválasztott benchmark/result/restore próba
és friss NO-GO hash/link ellenőrzés PASS16,617 s. A korai thin kör13 PASS10,985 s.
Nested wrapperteszteket és átfedő köröket tartalmaznak; nem összeadandók.
Teljes logok/resultok `.local/verification/20261025-*-si-c07-demand-*.log/.result.json`.
