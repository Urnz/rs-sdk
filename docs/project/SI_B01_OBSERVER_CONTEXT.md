# SI-B01 – Natív változás és observer-specifikus kontextus

2026-10-22. Kizárólag helyi/private rs-sdk/LostCity emulator.
Feladat: [SI-B01](TASKS_SOCIETY_INTEGRATION.md#si-b01--natív-körülményváltozás-és-observer-specifikus-context).
Az ellenőrzési eredményeket és a megőrzött FAIL-eket a
[progress](SOCIETY_INTEGRATION_PROGRESS.md) és a
[rövid átadás](SOCIETY_DEVELOPMENT_HANDOFF.md) indexeli.
Későbbi [SI-A13 runner-javítás](SI_A13_RUNNER_DIAGNOSTICS.md): tíz külön kapuzott,
sikeres natív próba; a régi full FAIL megmarad. A pontosított
[ellenőrzési policy](VERIFICATION_POLICY.md) szerint az SI-B01 saját additív
inbox-táblája nem indokolta önmagában az összes független modul regresszióját.

## Implementáció és hitelességi határ

- [Economic context](../../agent-state/economic-context.ts): verziózott küszöbök,
  forrásfrissesség, hysteresis és observerenkénti cooldown. A saját employment
  állapota és bérfeltétele, lezárt typed munkakérés, ismert ajánlat/szerződés,
  saját megfigyelt GP, needs és natív tenancy kerülhet a kontextusba.
- [Forrásadapter](../../server/gateway/admin/economic-observer-source.ts):
  Business/contract/treasury olvasások readonly, SQLite snapshotban; nincs
  mellékhatásként végrehajtott ajánlatlejáratás vagy gazdasági írás.
  Business-készletet csak az exact subjectre kötött intézményi controller lát;
  a dolgozó a saját employment-feltételeit látja. Más avatar inventoryját a
  forrásolvasó nem használja. A saját gateway account/avatar kötése ellenőrzött.
- A population world/lifecycle/clock/profile kötése része az observer
  azonosítójának. Inaktív vagy halott member, illetve eltérő óra/profil esetén
  nincs gazdasági állítás vagy új ébresztés. Estate hold alatt az érintett
  jövedelem/stock/treasury elérhetősége unknown.
- A személyes GP inventory-megfigyelés, nem engine receipt vagy teljes vagyon.
  A bérfeltétel elérhető jövedelemforrást jelez, nem igazolja a bér kifizetését.
  A rent-alapú runway csak az ismert bérleti periódus fedezetét becsüli;
  nem állít teljes megélhetési költséget, jövőbeni bevételt vagy önfenntartást.
  A gazdasági outcome authority továbbra is az SI-A12 natív forrása.
- A needs csak a közös óra exact headjével egyezve friss; hiányzó vagy
  lemaradt állapot unknown. Rent csak exact native tenant/lifecycle/world/clock
  binding és aktív tenancy mellett olvasható. Hiányzó forrás nem nulla igény,
  nulla költség vagy elfogyott idegen készlet.
- A source/cursor/megfigyelési idő/frissesség és native/observed minősítés
  bekerül a döntési kontextusba. Elavult vagy jövőbeli megfigyelés értéke
  unknown; ez az örökölt asset/operational pénzsorokra is érvényes.
  Függő szerződésmegszüntetés cancelling/defaulting marad, nem lezárt szerződés.
  Nincs új memory-ingestion út, amely observed adatot receiptté vagy
  hiteles semantic factté emelne. A legfeljebb 24 factos kontextus a lényeges
  needs/rent/cash adatokat veszi előre; további soroknál explicit partial.

## Ébresztés és meglévő kapuk

Policy: `si-b01.v1`. Hunger/fatigue belépés 7000, visszaállás 5000 alatt;
stock-hiány belépés 0, visszaállás 1 fölött; ismert rentre számított runway
belépés legfeljebb 1 periódus, visszaállás 2 fölött. A forrásmegfigyelés
maximum 30 másodperces; saját gateway cash mintavételéhez maximum 5 másodperces
állapot kell. A cooldown observerenként 15 perc falióra; needs/rent esedékesség
a meglévő SimulationClockhoz kötött, új szimulációs időforrás nincs.

Employment megszűnése, partner megszűnése, needs/stock/runway/rent küszöb
egyszer ad `significant-economic-change` eseményt az adott aktív állapothoz.
Unknown nem oldja a latch-et. Cooldown alatt az új ok pending marad, és csak
friss forrás mellett küldhető. Ajánlatok és munkakérések a meglévő domain
eseményüket használják, nem keletkezik második observer-ébresztés.
A sok egyidejű ok egy, az inbox méretkorlátjába férő admissionné vonódik össze.

A [domain recovery](../../server/gateway/admin/domain-event-recovery.ts)
a natív/domain változásból állítja elő a megfigyelést. Az inbox frissítése,
source cursor, latch, pending ok, cooldown és admission sequence egyetlen
SQLite-tranzakcióban commitol. Az esemény exact UUID/source key azonosítóval
tartós; újraindításkor a meglévő durable coordinator olvassa vissza.
A korábbi ended-employment wakeup helyét az observer veszi át.

A végrehajtás továbbra is a meglévő replan-runtime útja: live supervisor lease,
exact avatar, friss online state, controller-ütközés, policy, authorization,
inference-queue és költségkeret. Az új observer nem hív providert, nem ad
végrehajtási grantet és nem vezérel tickeket. A jelenlegi SI-A livelihood policy
továbbra is determinisztikus; önálló LLM-stratégia nem része az SI-B01-nek.

## Perzisztencia, migráció, rollback

Az existing replan inbox `user_version` 3→4 migrációja additív:
`economic_observer_cursor(agent_id,binding,policy,state_json)`.
A régi inbox rekordok, claim-ek és SimulationClock-stampok megmaradnak;
régebbi verziók a meglévő migrációs láncon jutnak 4-re. Hiányzó régi observer
állapotból az első aktuális source snapshot indul; történeti receipt nem készül.
Jövőbeli inbox-séma elutasított. Regresszáló source cursor, azonos cursorhoz
eltérő tartalom és visszafelé érkező observation fail-closed.

Nem keletkezik új elkölthető vagyon vagy külön avatar-ledger. A cursor a
kezelt világ meglévő `.local/admin/replan-inbox.sqlite` fájljában van;
a teljes inbox-DB mentése ezt is tartalmazza. A readonly domainforrásokat a
backend választja, nem requestből vagy model-válaszból érkező útvonal.

Rollback: gateway/összes érintett író megállítása, együtt mentett DB/WAL/SHM
és a hozzá kötött óra/domain állapot megőrzése. Régi v3 bináris nem nyithat
v4 inboxot; támogatott visszaállítás koherens, migráció előtti világmentésből
elkülönített workspace-be, az új történet megőrzésével. Commitolt gazdasági
történetet nem szabad egyoldalúan visszamásolni; ilyen működő világ javítása
előre kompatibilis javítást/egyeztetést igényel, nem `user_version` átírást.

## Bizonyíték és maradó scope

Az új U/I próbák valódi Business employment megszüntetését, domain recoveryt,
inbox reopen/retryt, contextet és scripted döntési callbacket kapcsolnak össze.
Külön valódi gateway-replan próba ellenőrzi a lease hiányának elutasítását.
Natív needs authority próbában exact head → source gap → felzárkózás történik.
Hibainjektálás igazolja az admission és a cursor közös rollbackjét; további
próbák: hysteresis/cooldown, stale/future/source gap, idegen és hibásan routolt
avatar, intézményi stock privacy, sok egyidejű változás, cursor-integritás,
v3 migráció és future-schema elutasítás.

Ez technikai context/admission integráció. Élő E2E: SI-B06; saját stratégiai
választás: SI-B03/B04. Valódi providerhívás, gazdasági paraméterhangolás és
SI-M2/SI-M1 outcome-PASS ebből nem következik. A következő feladat SI-B02.
