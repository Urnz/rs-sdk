# 22. fázis – eredmények és történeti baseline

## Használat

A 2026-09-26-i, `2a17f4410` szerinti teljes részletes lista változatlan
történeti pillanatképe alább olvasható. A nyitott szülőfeladatok is megmaradnak;
nem veszítünk követelményt vagy bizonyítékot. Ez nem második aktív backlog:
az aktuális sorrend és státusz egyetlen forrása a [TASKS.md](TASKS.md).
Új eredményt a baseline fölé írunk; történeti checkboxot nem írunk át.

## 22. fázis lezárva – 22.8 közös elfogadás és operáció (2026-09-29)

A verziózott `config/fixtures/phase22-acceptance-v1.json` pontosan és sorrendben
köti össze a 22.1–22.7 csomagot 16 célzott tesztfájllal, a négy támogatott
Thieving eljárással, mindkét observer-osztállyal, a restart/replay elvárással,
valamint a worker-, switch-, policy-, source- és failure-injection leltárral.
Hiányzó csomag, teszt, live forrás, explicit report vagy hibás digest fail-closed;
nincs skipből képzett PASS.

A live completion csak valódi, elfogadott és restarttal igazolt pickpocket seed
bundle-ból indulhat. Indítás előtt ellenőrzi az acceptance, agent, procedure, case
és witness forrást; hiány esetén szolgáltatásindítás nélkül, pontos hibával áll
le. A dedikált thief ismételt próbáinál az auditált offline setup az inventory
felhalmozott tárgyait veszteség nélkül bankba teszi, egy lockpicket megtart, majd
az összes item-mennyiséget visszaellenőrzi. Az edit tranzakciós és rollback-
backupot készít. Így a live elfogadás ismételhető, miközben minden lopási eredmény
továbbra is valódi gameplay transfer, nem fixture vagy tárgyteremtés.

A végső élő futás a pickpocket, lockpick-door, container-theft és
property-burglary eljárást, a player-only és agent felismerést, az explicit
reportot, valamint az engine+gateway restart utáni exact replayt igazolta. A
normál, autentikált helyi stack a futás után egészségesen visszaállt. A korábbi
sztochasztikus „witness nem észlelte” próbát és az inventory-telítődés miatti
FAIL-t a wrapper külön hibás futásként őrzi; egyik sem lett PASS-ra átértelmezve.

A generált exact evidence bundle:
`.local/phase22-acceptance/phase22-final-20260929/evidence-bundle.json`.
Forrás-live bundle: `pickpocket-2026-09-26T22-24-44-293Z`; 7 csomag, 9 hash-elt
live artifact; kanonikus SHA-256 bundle digest:
`5a9b35574084ef9fa8fe39c5e9be8abde845c79eb5388176155c3d74234e1530`.
A bundle elkészítéskor és visszaolvasáskor is validált. Operáció és rollback:
[22.8 acceptance and operations](features/phase22-operations.md).

Ellenőrzés: seed/inventory/bundle unit **6 pass / 0 fail**
(`.local/verification/20260929-171702-065-phase22-8-inventory-unit.log`); közös
fixture **54 pass / 0 fail**, 16 fájl
(`.local/phase22-acceptance/phase22-final-20260929/focused-verification.log`);
végső live vertical PASS
(`.local/verification/20260929-171717-894-phase22-8-live-final3.log`); format és
root/engine/webclient TypeScript PASS
(`.local/verification/20260929-173832-698-phase22-8-quality-final.log`). A végső
teljes `bun run check`: **1448 pass / 0 fail / 0 skip**
(`.local/verification/20260929-173943-369-phase22-8-full.log`).

Ezzel a 22.1–22.8 mind bizonyítottan lezárt. Az agent valódi verified Thieving
eljárással lop/betör, a tulajdonváltozás megőrzött asset transfer, a jogsértésből
pedig forráskötött evidence-, joghatósági, döntési és végrehajtási lánc képezhető.
A nagy admin backend–frontend paritás továbbra is a 26. fázis feladata; nem lett
visszaemelve a 22. fázis Definition of Done-jába.

## 22.7 – átalakítási eredet és bűnözési metrikák kész (2026-09-28)

A shared Business/provenance SQLite adatbázisban a hiteles exact crafting receipt
egy `IMMEDIATE` tranzakcióban fogyasztja el a megnevezett, revision-kötött input
asseteket és készletet, hozza létre az exact output asseteket és készletet, majd
írja az összes input-output lineage élt és hash-láncolt auditját. Az output a
közös title claimet, theft historyt és transitive ancestryt megőrzi; eltérő
jogcímeket nem olvaszt össze. A consumed input nem használható újra, de történeti
eredete olvasható. Schema v3 additív és tranzakciós; régi asset aktívként migrál,
régi aggregált production runból pedig nem készül kitalált lineage. A rollback
az upgrade előtti teljes SQLite snapshot visszaállítása, nem lineage-törlés.

Az új read-only gazdasági projection csak teljesen committed fencing settlement,
hiteles engine trade payment és a kiválasztott lopott asset közvetlen vagy
crafting-ancestor kapcsolata esetén számol gross bevételt. A sértetti veszteség
exact tárgy/mennyiség, pénzbeli kár nem készül restitution claimből vagy becsült
árból. A megfigyelt discovery/identification, a helyi joghatósági időablakos
ismétlődés és a külön `prospective-estimate` kockázat explicit kohorsz- és
lefedettségi adatokkal marad szétválasztva. Nincs finding-, sanction- vagy wanted
írás.

Ellenőrzés: provenance/transformation/metrics/heat célzott regresszió **73 pass / 0 fail**
(`.local/verification/20260928-230343-557-phase22-7-targeted-post-review.log`); format, root
és webclient typecheck zöld
(`.local/verification/20260928-230400-806-phase22-7-quality-final.log`). A végső teljes
regresszió **1442 pass / 0 fail / 0 skip**
(`.local/verification/20260928-230520-619-phase22-7-full-post-review.log`).

## 22.6 – reputáció és reintegráció kész (2026-09-28)

A joghatósági criminal record változatlanul a legal-finding ledger belső nézete.
Ettől külön v1, hash-láncolt evidence ledger hitelesíti a restitution, kártérítés,
közösségi munka, letöltött büntetés, személyes megbocsátás és vallási vezeklés
teljesítési eseményeit, valamint az observer/community megismerési proofot. A
verziózott local-world policy csak a saját projectionjéhez enged pozitív változást.

A második v1 ledger observer-, community- vagy world-profile moral-standing
kulcson, eseményenként és közönségenként pontosan egyszer alkalmazza a javulást.
Nincs globális social-credit mező vagy összesített authorization score. Az agent
decision context csak a saját, auditált knowledge proofjából kap forrásazonosítós
`Known completed reform effort` leírást; más observer és a titokban maradt lopás
nem válik közismertté. Hiányos vagy sérült forrás fail-closed.

A reintegrációs állapotnak nincs write portja legal findinghoz, title/custodyhoz
vagy agent identityhez. Valódi store-okkal végzett acceptance teszt igazolja, hogy
a vezeklés javíthatja az opcionális moral standinget, de a felelősségi finding, a
sértett tulajdonjoga, a theft history és a `personalityTraits` változatlan marad.
Exact replay idempotens, restart után azonos standing és source chain olvasható.

Ellenőrzés: reintegrációs és agent-context acceptance **14 pass / 0 fail**
(`.local/verification/20260928-223131-013-phase22-6-acceptance.log`); format és root
TypeScript zöld (`.local/verification/20260928-223145-189-phase22-6-quality.log`).
Az érintett reintegrációs, crime-case, provenance és gateway suite **160 pass / 0 fail**
(`.local/verification/20260928-223359-748-phase22-6-affected.log`); a végső teljes
regresszió **1434 pass / 0 fail**
(`.local/verification/20260928-223446-041-phase22-6-full-final.log`).

## 22.5 – orgazdai megismerés és valós kereskedés kész (2026-09-28)

A player trade engine evidence csak a két `BOTH_MOVEINV` tényleges végrehajtása
után válik committed receiptté; a második fél ajánlata önmagában nem payment.
Az append-only, hash-láncolt SQLite rekord pontos agent/avatar-kötésen át hajtja
meg a fencing settlementet. A shop gate, a policy-döntés, a véges Business
treasury/storage és az item provenance ugyanahhoz az exact trade receipt/digesthez
kötött; a direct player trade megőrzi a jogcímet és a lopási eredetet.

A sikeres trade-ből kizárólag a seller saját memóriájában keletkezik közvetlen
episode, semantic knowledge és forrás-attestált, visszavonható partner-claim.
Csak az observer aktuális attested contextjében látható candidate jut el az agent
fencing-döntéshez; globális lookup és automatikus NPC-pótlás nincs. Inaktív partner
fail-closed eltűnik a projectionből és explicit revokálható. A settlement, claim,
memory, provenance, stock, treasury és engine evidence restart után exact replayre
idempotens. Részletek és rollback: [22.5 trade evidence](features/phase22-trade-evidence.md).

Ellenőrzés: live-pipeline E2E **2 pass / 0 fail**
(`.local/verification/20260928-220751-206-phase22-5-live-pipeline.log`); az érintett
engine-evidence, sale-channel és fencing suite **38 pass / 0 fail**
(`.local/verification/20260928-221334-963-phase22-5-affected.log`); format és root
TypeScript zöld (`.local/verification/20260928-221424-950-phase22-5-quality-commitpoint.log`).
A végső teljes regresszió **1430 pass / 0 fail**
(`.local/verification/20260928-221623-808-phase22-5-full-final.log`).

## 22.4 – intézkedés, jóvátétel és időzített custody lezárva (2026-09-28)

Elkészült a finding → jogosultság- és policy-kötött hatósági döntés → tartós
végrehajtás különválasztott lánca. A capability-specifikus adjudicator grant
auditált és visszavonható; a döntés `responsible` findinghoz, joghatósághoz,
policy digesthez, explicit action evidence-hez, pontos subject playerhez és
kedvezményezetthez kötött. Elutasított vagy hiányos jogosultságú döntés nem
végrehajtható. Az LLM tiltott szankciós műveletei és a death/lifecycle határ
változatlan maradt.

A jóvátétel a meglévő shared escrow/checkpoint authorityn halad át, GP-t és
konkrét item/count tételeket ugyanabban a csomagban tartva. A hash-láncolt
`planned → held → restricted → settled` saga determinisztikus azonosítókkal
újrajátszható; a gateway startup/periodikus recovery csak befagyasztott döntést
folytat. A crash-boundary teszt a hold, custody és commit utáni leállást,
restartot, egyetlen escrow/custody rekordot és pontos vagyonmegmaradást igazol.

Az engine custody ledger restart-stabil és időzítetten old fel. Aktív rekordnál
az engine nemcsak státuszt vetít: törli az actiont/waypointot, a jail tile-on
tart, blokkolja a user/restricted packet handlereket, valamint kihagyja a
queue/timer/interaction/movement/GE végrehajtást. Protocol heartbeat továbbra
is leolvasható. Részletes authority, lifecycle és rollback:
[22.4 justice remedies](features/phase22-justice-remedies.md).

Ellenőrzés: a célzott döntés/custody/replay csomag **6 pass / 0 fail**, typecheck
zöld (`.local/verification/20260928-175533-301-phase22-4-authority.log`); a
quality gate-ben format, fő typecheck és webclient typecheck zöld
(`.local/verification/20260928-175705-129-phase22-4-quality.log`). Az érintett
crime/gateway/engine/LLM regresszió **476 pass / 0 fail**
(`.local/verification/20260928-175810-067-phase22-4-affected.log`). A végleges
teljes `bun run check`: **1426 pass / 0 fail / 0 skip**, exit 0, 3 perc 11 mp
(`.local/verification/20260928-175939-953-phase22-4-full-final.log`).

## 22.3 – restart-safe bírságbeszedés lezárva (2026-09-28)

Az auditált fine intent és a tényleges pénzmozgás közé tartós, hash-láncolt
settlement journal került. Az exact lifecycle `planned → held → credited →
settled`: az engine shared escrow/checkpoint tranzakció egyszer terheli a
playert, az external treasury settlement egyszer jóváírja a frakciót, majd az
escrow terminális consume-ja lezárja a láncot. A gateway a már engedélyezett,
félkész terveket startupkor és periodikusan ugyanazokkal a determinisztikus
azonosítókkal folytatja. A settlement journal nem authority: csak auditált
intentből, nem exportált capabilityvel tervezhető.

A player-checkpoint külön `PLAYER_CHECKPOINT_DATABASE` authorityt kapott, így
GE kikapcsolása mellett is működik. A helyi indító a kompatibilitás miatt az
eddigi `data/market.sqlite` fájlt jelöli ki explicit checkpoint-fájlként; az
authority többé nem a GE konfigurációjából származik.

A stack leállítása mellett két ellenőrzött helyi migráció futott:

- player escrow: 1 terminális legacy consume rekord külön, `unverified`
  történeti archívumba került; 0 élő shared escrow rekord, forrás változatlan;
- treasury: 1 audit nélküli external credit külön, `unverified` történeti
  archívumba került; egyenlegváltozás 0, az új auditált credit lánc 0 rekordról
  indul.

Mindkettő előtt integritás-ellenőrzött SQLite backup és géppel olvasható
rollback manifest készült a `.local/migrations/` alatt. Sem történeti
atomicitást, sem auditot nem talált ki a migráció. Részletes lifecycle és
rollback: [restart-safe fine collection](features/phase22-fine-collection.md).

Ellenőrzés: settlement/migráció fókusz **20 pass / 0 fail**
(`.local/verification/20260928-171752-855-phase22-3-treasury-tests-2.log`);
teljes érintett crime/gateway/engine csomag **499 pass / 0 fail**
(`.local/verification/20260928-171953-866-phase22-3-affected.log`); valós engine
checkpoint + quality gate **8 pass / 0 fail**, format és mindkét typecheck zöld
(`.local/verification/20260928-172327-203-phase22-3-quality-fix.log`). A
még szűkebb végső authority/preflight regresszió **30 pass / 0 fail**, format és
mindkét typecheck zöld
(`.local/verification/20260928-173006-404-phase22-3-authority-final.log`). A
végleges teljes `bun run check`: **1420 pass / 0 fail / 0 skip**, exit 0,
3 perc 35 mp
(`.local/verification/20260928-173109-674-phase22-3-full-final.log`). A
migrált authority readback `ok: true`, 0 élő escrow rekord. A két migrációs run:
`.local/verification/20260928-171300-413-phase22-3-local-migration.log` és
`.local/verification/20260928-171818-701-phase22-3-treasury-migration.log`.
A kezelt stack a migrációk után egészségesen újraindult (gateway PID 14816,
engine PID 7116, Thieving processor PID 19480), bot nélkül.

## 22.2 – engine storage és konfigurált checkpoint lezárva (2026-09-27)

A Housing storage security most exact engine loc → auditált aktív placement →
HousingUnit/surface → eseménykori Property entitlement láncon jut el a valódi
container-Thieving művelethez. Jogos tulajdonosi hozzáférés nem theft; a
jogosulatlan próbálkozásnál a konfigurált Housing lock level a reward előtt
érvényesül. A sikeres transfer placement/property/security snapshotot kap, a
meglévő valós sight-candidate út tanút/őrt adhat, a külön tartós, szerveroldali
one-shot dobás pedig anonim fizikai nyomot. Miss után exact replay van, új dobás
nincs. Az új épület továbbra is Property/HousingUnit/slot/binding/loc adatból
vehető fel, nincs épület-ID kivétel.

A korábbi üres checkpoint engine adapter helyett append-only, hash-láncolt
engine journal és két külön world-tick művelet készült. Az explicit search a
konfigurált checkpointon álló valódi player inventoryját pillanatképezi; a
belépés önmagában nem ír eseményt. A külön detection csak a keresésben ténylegesen
látott itemre hivatkozhat. A pozitív és negatív döntés is tartós, és az
`inspection + asset` kulcs egyszeri, ezért a sikertelen felismerés másik
detection ID-val sem dobható újra. A független checkpoint ledger csak a
chain-verified engine forrásból exact módon visszaolvasott search/detection
tényeket veszi át. Csak engedélyezett search + pozitív detection fed fel assetet;
puszta hely, inventory vagy heat nem.

Részletes lifecycle, biztonsági határ, additív migráció és rollback:
[protected storage and checkpoint evidence](features/phase22-storage-checkpoints.md).
Authority finding, szankció és pénzmozgás nem került ide; ezek a későbbi 22.3+
feladatokban maradnak.

Ellenőrzés: storage/checkpoint fókusz **12 pass / 0 fail**
(`.local/verification/20260927-225545-511-phase22-2-focused.log`); teljes érintett
Housing/checkpoint/engine-evidence csomag **82 pass / 0 fail**
(`.local/verification/20260927-225906-482-phase22-2-modules.log`); format + root és
webclient typecheck sikeres
(`.local/verification/20260927-225917-786-phase22-2-quality.log`). Az egyszeri
teljes `bun run check`: **1411 pass / 0 fail / 0 skip**, exit 0, 3 perc 6 mp
(`.local/verification/20260927-230050-937-phase22-2-full.log`).
A kezelt engine ezután kontrolláltan újraindult (PID 22804 → 34000); engine,
webclient és gateway HTTP health zöld, a Thieving processor fut, bot nincs.
Auditált result: `.local/admin/engine-restarts/phase22-2-runtime.json`.

## 22.1 – teljes lánc lezárva, helyi élő elfogadással (2026-09-27)

A külön engine inspection → audited recognition → observerhez kötött
identification → case/evidence → explicit HTTP-report lánc bekötve. A tanú
látható entitást választ, az engine önállóan mintavételezi; a theft rejtett
actor-mezője nem személyfelismerési forrás. Session/appearance/LOS folytonosság,
valódi kliens-láthatóság és bounded policy kell. Lejárat, kiesés, slotcsere,
hiányzó/sérült upstream forrás fail-closed. Finding/bűnösség nem keletkezik.
Részletes API, additív migráció és rollback:
[witness recognition](features/phase22-witness-recognition.md).

Elfogadási bundle: `pickpocket-2026-09-26T22-24-44-293Z` a Gitből kizárt
`.local/phase22-live/` alatt. A régi `acceptance.json` változatlan; új teljes
eredmény `completion-live.json`. A következők valódi localhost engine-események,
nem fixture-szimulációk:

- Player-only pickpocket: `3979402f-5418-4039-9ad7-a76c5bf7c4e1`, inspection
  `55705d1f-9f76-4b7b-af52-ed37e95d9eb3`, report
  `report-0e138e742e47da18bbc75a230554eede`.
- Agent tanú pickpocket: `08992f2f-9183-4bda-9e4f-ab6e31f83ce6`, inspection
  `10acf86e-e339-4fb9-a555-5b55757d1d90`, report
  `report-fc3297f2bf8579f09086d6c349c82714`.
- Lockpick run `43e3879c-c3dd-4af1-b465-f7a223c1c239`, event
  `3ba79dba-ea2f-4428-b71f-54a20d0ec92f`: pontos Door/XP/lock-opened receipt,
  nincs sight snapshot vagy witness discovery; store-reopen exact outcome replay.
- Tea-stall run `727c2dc2-97bf-492e-b9b3-f3d66cd6b6c8`, event
  `f4fc7e04-4489-4ef4-96ff-950926e2c234`, inspection
  `ea185f9d-81ab-4450-8d50-ddfcea55d851`, report
  `report-2ce15a51e9742e3c8cf3c71fdf62ae61`.
- Védett Property-burglary run `21ada3aa-e7d0-4cfe-9bcc-2fb84ab76741`, event
  `c5b8103a-e787-4783-9533-c52037e7a7f7`, inspection
  `0664c124-e4c8-4070-9977-2fc7f75caa47`, report
  `report-b1fe0f7c10bb85da6f2601e33da88778`.
- Valós Property észlelési miss: `36635bfa-85ea-4c16-ad79-f438aed545b4`;
  külön wall/LOS miatt tanú nélküli behatolás:
  `8313756f-0184-436e-9f5f-723b3684e413`. Nincs miss-reroll vagy kitalált
  tanú. Új próbálkozás új tényleges engine-esemény, nem ugyanaz új dobással.

Mindkét pickpocket tanú, valamint a container/property recognition és report
teljes engine/gateway process restart után változatlan exact parancs- és
reportazonosítóval visszajátszva. Egy identification, egy direct-identification
evidence, nulla finding. A player-only tanú későbbi agent-kötése a történeti
észlelést nem írhatja át; külön regresszió igazolja.
Élő HTTP-negatívok: bearer nélkül, hibás jelszóval, hamisított identity-mezővel
és téves target slottal elutasított. Sérült/missing proof és continuity-
megszakadás külön integrációs/engine regresszióban elutasított.

A tényleges próba két helyi hibát is feltárt és javított: deferred RuneScript
commit előtt túl korán olvasott az acceptance runner (bounded hat tick várás,
változatlan exact egyeztetés); loc-lopásnál az engine bent maradt NPC-pointert
választott (procedure-kind szerinti kötelező NPC/loc, regresszióval). A régi
hibás targetű `4c2b5b83-a91b-4582-a1de-a7bd7d838ac9` naplóbejegyzés nem lett
átírva, és nem számít elfogadásnak.

Operáció: három dedikált tesztavatar, auditált backup/offline-edit előkészítés;
normál atomi tesztingatlan-vásárlás izolált `engine-properties.sqlite` fájlban.
A fő Property-adatbázis érintetlen. A gateway login-auth és az engine helyi
save-authority külön startup-beállítás; friss klienspacket és tényleges login-
csatlakozás a readiness feltétel. A normál bot/worker nélküli stack visszaállt.
Credentials, tokenek, save-ek, DB-k és részletes live logok nem kerülnek Gitbe.
Nincs új autonóm draft-publikáció vagy thieve-permission ebben a lezárásban.

Ellenőrzések: közös `witness-chain-acceptance`, gateway/SDK negatívok,
engine inspection/continuity és target-selection regresszió; root/engine/
webclient és a négy live script strict typecheck sikeres, SDK API `--check`
sikeres, PowerShell segédteszt sikeres. A teljes `bun run check` sikeres
(1397 sikeres tesztfuttatás, 0 hibás; a csomagok között lehet átfedés).
A végső, filter nélküli `bun test`: **1462 pass, 0 fail, 0 skip**,
`.local/verification/20260927-180149-988-phase22-all-tests-final.log`, exit 0.
Végső strict live-script typecheck és SDK API `--check`: exit 0,
`.local/verification/20260927-180338-950-phase22-final-script-api.log`.
Élő záró futás: `.local/verification/20260927-175651-879-phase22-live-unseen-entry.log`,
exit 0, 4 perc 36 másodperc; exact loc restart eredmények a bundle
`container-theft-restart.json` és `property-burglary-restart.json` fájljaiban.

Ez a 22.1 véges vállalását zárja, nem a teljes 22. fázist: a 22.2–22.8
változatlanul nyitott, új roadmap-checkbox nem keletkezett.

## 22.1 – tartós recognition-forrásnapló és report-kapu (2026-09-27)

Külön v1 SQLite `WitnessRecognitionStore` készült, kanonikus source digesttel,
atomi source+audit írással és kötelező szerveres verifierrel pontos replaynél is.
Újranyitás után változatlan proof és identification; sérült/missing source audit
esetén olvasás, írás és identification replay elutasítva. A közös witness-chain
fixture már ezt a valódi tartós naplót használja, nem memóriában tartott portot;
a pozitív szerver-verifier továbbra is explicit tesztfixture, nem élő felismerés.

A gateway minden `recognition:` case-source-ot a routing/replay előtt elutasít,
amíg nincs bekötve a független recognition-forrás ellenőrzése. Ez a korábban
belső trusted porttal tárolt report replayjére is igaz; meglévő tény nem törlődik.
Az anonim agent/player-only `witness:` feljelentési út változatlan.

A read-only engine-vizsgálat szerint jelenleg nincs önálló person-recognition
forrás. A konkrét következő bekötés: event-time observer-visible session/visual
continuity és explicit bounded server person-inspection, valós client visibility,
LOS, észlelés és policy-időablak mellett. A teljes appearance buffer ne legyen
anonim fingerprint: username-t tartalmaz. Slot reuse/logout/restart és legacy
esemény continuity nélkül nem azonosíthat. A feature-leírás rögzíti ezt, illetve
a külön napló migrációs/visszaállítási tervét. Nincs új roadmap-checkbox,
production recognition, HTTP/LLM azonosítási endpoint vagy autonóm engedély.

Célzott Bun 1.3.14 store+közös chain+gateway: **20 pass / 0 fail**, 209 assertion,
3 fájl, 6.17 s. Root/engine/webclient TypeScript: exit 0. A Bun transaction API
void return típusát a store a meglévő decision-store mintájával kezeli.
Az első teljes suite **1420 pass / 6 fail**: mind a hat hiba a nem futó helyi
`localhost:8888` cache/collision szolgáltatás ConnectionRefused hibája volt,
nem recognition regresszió. A kezelt stack `start-local.ps1 -NoBot` indítással
visszaállt: `20260927-115706`, engine/webclient/gateway HTTP 200, nincs bot vagy
Thieving worker. Teljes suite újrafuttatva ezen a normál helyi infrastruktúrán.
Eredmény: **1442 pass / 0 fail**, 6928 assertion, 262 fájl, 112.10 s.
Diff-format rendben; helyi commit, nincs push vagy fáziszárás.

## 22.1 – külön recognition adapter, production fail-closed (2026-09-27)

Az auditált figyelmi döntés és anonim discovery után külön, független
szerveres recognition-forrás kell. Új `recordWitnessIdentification` adapter:
pontos event/observer/attention/engine digest és player–agent azonosság,
nem visszadátumozott idő, sértetlen forrás és write-boundary újraellenőrzés.
Nem kapcsolati memóriából vagy hidden actorból találja ki az identitást.
Új recognition-discoveryt rögzít; az eredeti tanúvallomás nem változik.
Normál case cursor → külön suspect-identification → direct-identification
evidence, guilt/finding nélkül. Más tanú privát tudása nem bővül.

A közös acceptance fixture bizonyítja a pontos replayt teljes store-újranyitás
után, a változatlan anonim sorokat, a rossz observer/actor/digest/idő és audit
elutasítását, illetve hogy figyelmi miss nem alakítható azonosítássá.
A recognition-forrás itt explicit tesztfixture, **nem élő engine recognition**.
A production port jelenleg nem szolgáltat bizonyítékot, ezért zárva marad.
A valódi recognition-journal/action és downstream report source-revalidation
még a meglévő 22.1 követelmény része; nem keletkezett új lezárási csomag.
Nincs schema-váltás, HTTP/LLM azonosítási endpoint vagy watcher-autopromotion.
Migration/rollback a verified-thieving feature-leírásban.

Ellenőrzés: Bun 1.3.14 célzott witness-chain acceptance: **14 pass / 0 fail**,
152 assertion. Teljes `bun test`: **1436 pass / 0 fail**, 6870 assertion,
260 fájl, 146.90 s. Root, engine és webclient TypeScript: exit 0.
Helyi commit; nincs push, élő recognition-bekapcsolás vagy autonóm engedély.

## 22.1 – valódi login/HTTP-tanúfeljelentés és process-restart (2026-09-27)

Az előző élő bundle (`pickpocket-2026-09-26T22-24-44-293Z`) valódi észlelt
eseményéből, két saját elkülönített tesztavatárral, a normál gateway HTTP-route
és `BotSDK.fileWitnessReport` út futott. Nem hívtuk közvetlenül az intake
függvényt, nem helyettesítettük a loginserver-authot callbackkel. Report:
`report-06dc36690e712371f939b7951e6ea1b3`, case:
`case:c4f1ceaedee18a7602ce49f6b8d50c8647c8bde73569b0a86bbce2ff297e397b`.

Igazolt: hiányzó bearer és rossz jelszó 401; másik élő, helyesen hitelesített
avatár és hamisított bejelentőmező 409; helyes tanúreport és pontos replay;
egyetlen report, érvényes auditok, automatikus identification/finding nélkül.
Gateway ÉS engine teljes leállítása/újraindítása után változatlan report ID.
Kijelentkeztetett avatar helyes jelszóval: pontos live-session gate 409,
`Matching live avatar is required`, nem más domain-hiba.

Az első próbában kiderült: az alap helyi gatewayn a login-auth ki volt kapcsolva.
A report route helyesen 503-mal zárt; a teszt csak valódi `LOGIN_SERVER=true`
mellett fogadott el eredményt. Az új, operator-only acceptance-bundle kapcsoló
kizárólag az intake ledger-pathjait izolálja; main admin/autonomy/economy/agent
pathok nem változnak, és HTTP nem választhat adatbázist. Érvénytelen/missing
bundle, traversal, junction és kikapcsolt login esetén startup fail-closed.
Sem fő crime-adatbázisba másolt report, sem társadalmi testidentity nem készült.

Executable és rollback: [phase22-live-witness-http.md](features/phase22-live-witness-http.md).
Ellenőrzés: Bun 1.3.14 teljes `bun test`: **1434 pass / 0 fail**, 6847 assertion,
260 fájl, 134.73 s. Célzott paths/report regresszió: **11 pass / 0 fail**,
62 assertion. Root + új HTTP runner explicit TypeScript, engine és webclient:
exit 0; diff-format ellenőrzés rendben.
Mindkét tesztkliens leállítva, acceptance-mód megszüntetve; normál bot nélküli
stack visszaállítva. Nincs schema-váltás, publikálás vagy autonóm engedély.
A külön identification, élő agent report és többi procedure acceptance hátravan;
22.1 nyitott, új lezárási csomag nem keletkezett.

## 22.1 – item-theft tanúbekötés és élő észlelés/miss (2026-09-27)

A pickpocket és container/stall item-transfer most a Property-behatoláséhoz
hasonló, bounded engine LOS snapshotot készít. A normál Thieving processor,
figyelmi döntés, discovery, case cursor és mindkét explicit report-ledger
kezeli ezeket. A Property-only API megőrizte szűk szerződését; authorized
access, hiányzó legacy snapshot és puszta lock-open nem lesz lopási tanújel.
Nincs automatikus suspect/identification, Property-jogsértés vagy legal finding.
A meglévő figyelmi policy változatlan ID/version/digest mellett újrahasznált.

Élő bundle: `pickpocket-2026-09-26T22-24-44-293Z` (UTC; helyben már szeptember 27).
Két új, külön tesztbot; két sikertelen és két sikeres lopási próbálkozás.
A két sikeres esemény: `dc40f08a-6689-484e-95ec-84c314be00fb` és
`f48c85fe-4bbb-44a5-bd16-cc850cc757f9`. Mindkettő szerveres snapshotja tartalmazta
a konkrét player-only tanút. Az elsőnél észlelés→anonim discovery→case,
a másodiknál figyelmi miss, discovery nélkül. Mindkét döntés újranyitási
replaye változatlan; `passed: true`, `restartVerified: true`. A normál
production policyval történt, nem 100%-ra állított test policyval.

A teljes engine→processor→agent/player-only notice lánc integrációs tesztje
pickpocketre és container theftre is fut, teljes store-újranyitással és
idempotens report replayjel; rossz avatar elutasítva, hidden actor nem szivárog.
Ez a report-intake függvényt használja, nem valódi HTTP-login teszt.
Az élő bundle csak engine→attention→anonim case; a HTTP-feljelentés és a
külön identification élő elfogadása továbbra is hátravan. Container theft
élő játékmenetét ebben a szeletben nem futtattam. 22.1 nyitott marad,
nem keletkezett új lezárási csomag.

Ellenőrzés: Bun 1.3.14 teljes `bun test`: **1431 pass / 0 fail**, 6830 assertion,
259 fájl, 197.83 s. Célzott witness/acceptance/capture: **32 pass / 0 fail**,
251 assertion. Root + új runner explicit TypeScript, engine és webclient:
exit 0. Az engine-gate mind a 12 procedure/effect kombinációja ellenőrzött.
Állapotmentés: `backups/phase22-before-witness-20260927`; engine újraindítva,
mindkét tesztkliens leállítva, engine/gateway egészségesen megmaradt.
Nincs production séma-váltás, régi bizonyíték átírása, publikálás vagy autonóm
engedélyezés. Migration/rollback: a feature-leírásban.

## 22.1 – valódi pickpocket outcome és restart/replay (2026-09-26)

Az új `scripts/run-phase22-pickpocket-live.ts` külön, generált helyi tesztboton
futott. Elfogadott bundle: `pickpocket-2026-09-26T19-14-07-087Z`;
2 siker / 1 sikertelen próbálkozás, `passed: true`, `restartVerified: true`.
Sikeres runok: `35e0a37d-3a9c-442f-9103-d995be92f6f3` és
`b4a7c1d2-f537-4477-9307-0c17568e3fc7`. Valódi engine események:
`72b9282f-6220-4e1d-8cd2-7a6c8db9d28e` és
`b30b039e-a90b-412b-be68-f44c15f186c8`; receiptjeik `outcome:<eventId>`.
Pontos NPC type/instance és inventory delta, ellenőrzött engine hash-lánc,
explicit avatar–agent kötés, normál outcome bridge, store-újranyitás és
változatlan idempotens replay bizonyított. A sikertelen próba nem kap receiptet.
Korábban ugyanebben a szeletben egy másik két sikeres élő run is lefutott;
a fenti bundle a végleges, restartot is ellenőrző futtató eredménye.

Az első élő futás feltárta, hogy a futó szerver szeptember 20-i packot használt:
SDK-siker mellett nem keletkezett engine evidence, így a runner elutasította.
Leállítás és `backups/phase22-before-live-pack-20260926` helyi mentés után a
packot újraépítettem. A saját loc-módosítások vanilla checksum-eltérését
csak a build processében `BUILD_VERIFY=false` kezeli; nem tartós beállítás.
Az új packkal a privát stack egészséges. Tesztbot leállítva, engine/gateway
megmaradt, autonóm Thieving worker továbbra is kikapcsolva.

Ellenőrzés: Bun 1.3.14 teljes `bun test`: **1426 pass / 0 fail**, 6761 assertion,
259 fájl, 144.82 s. Új korrelációs regressziók: hibás actor/target/instance,
eltérő item delta/effect, hiányzó vagy többértelmű esemény, failed/missing SDK
evidence. Root + az új scripts explicit TypeScript ellenőrzése: exit 0.
Engine és webclient TypeScript ellenőrzése: exit 0.
A szerver újraindítása közben indított korábbi suite hat cache/oracle
elérhetőségi hibát adott; a fenti teljes újrafuttatás már stabil stacken ment.

A [futtatási és rollback leírás](features/phase22-live-pickpocket.md) rögzíti
a korlátokat. Nincs production séma-/mentésmódosítás és nincs publikálás.
A tanú/identification/report élő lánc és a másik három Thieving művelet még
hátravan; 22.1 nem lezárt, új lezárási csomag nem keletkezett.

## A korábbi követelmények helye

- 22.1: verified Thieving, discovery, identification, evidence, tanú és report.
- 22.2: lock/storage security végrehajtás és checkpoint search/detection.
- 22.3: régi escrow/treasury rendezés, engine checkpoint és bírságbeszedés.
- 22.4: elfogás, korlátozás/börtön, kártérítés és vagyon-visszaadás.
- 22.5: orgazdai megismerés, agent-döntés, shop gate és valós trade/payment.
- 22.6: criminal record, reputáció, opcionális karma és reintegráció.
- 22.7: crafting input–output eredet és gazdasági/jogi metrikák.
- 22.8: közös acceptance fixture, élő próba és hibából visszaállás.

A gang/cartel/általános organization fejlesztés eredetileg is „később”
megjelölésű; követése a [TASKS_LATER.md](TASKS_LATER.md) fájlban marad.
A tulajdon/proveniencia, heat, emergens piac és crime-policy kész alapjait
22.1/22.2/22.5/22.7 használja újra; nem írjuk újra és nem hagyjuk el őket.

## Ellenőrzött kiinduló állapot

Bun 1.3.14: 1413 sikeres / 0 hibás, 6660 assertion, 257 fájl.
Root, engine, webclient TypeScript: exit 0. Helyi collision-oracle:
20 régió–szint pár egyezik, nincs rejtett skip.
Ez nem a hiányzó éles bekötések elfogadása és nem a fázis lezárása.

## 22.1 – közös tanú–ügy–feljelentés acceptance szelet (2026-09-26)

Az executable fixture: `crime-cases/test/witness-chain-acceptance.test.ts`.
A valódi engine evidence SQLite store-ból indul, majd a normál Thieving
event processort, mindkét tartós cursort, a tanúdöntés-, case-, evidence- és
report-store-okat használja; nem helyettesíti ezeket sikeres mock callbackkel.
A szerverjáték eseményét a teszt adja az engine journalnak; a gateway intake
porthoz az előzetesen hitelesített avatart a fixture adja. Ez tehát nem élő
RuneScript/HTTP-login végponttól induló próba és nem a teljes 22.1 elfogadása.

Bizonyított: agent és player-only tanú, sikertelen észlelés, rejtett actor
megőrzése, feljelentés külön jogi döntés nélkül, teljes store-újranyitás és
pontos ismétlés, valamint case/evidence írás utáni, cursor commit előtti
félbeszakítás ismétlésbiztonsága. Az adatbázisok kizárólag OS-temp fixture-k.

A közös teszt valódi runtime eltérést talált: sérült engine journalnál a
player-only report lezárt, de az agent report még elfogadható volt.
A gateway most a `witness:` névtérben rögzített engine-tanú agent ágán is
újraellenőrzi az engine/witness auditot, pontos observer/outcome/digest/idő
kötéseket és pozitív észlelést. Hiányzó forrásnál nem ír reportot.
A többi, nem ebből a witness producerből származó report út változatlan.
Nincs új séma/migráció, inventory/pénzmozgás vagy szankció. Visszaállítás:
kód revert, meglévő naplók megtartásával; a szigorúbb forráskapu ekkor gyengül.

Célzott futás: az új fixture és négy kapcsolódó fájl együtt 22 sikeres /
0 hibás teszt, 167 assertion, közvetlen Windows Bun 1.3.14.
A reprodukáló teszt a fix előtt az agent reporton bukott, utána zöld.
Végső teljes `bun test`: 1418 sikeres / 0 hibás teszt, 6708 assertion,
258 fájl, 154,72 másodperc. A helyi collision-oracle ténylegesen lefutott.
Root, engine és webclient TypeScript ellenőrzés: exit 0; format/diff check zöld.
A lezárási csomag nyitva marad: az élő próba és a többi procedure végig
ellenőrzött bekötése szükséges; új lezárási checkbox nem keletkezett.

## 22.1 – Property-jogsértés bekötése a folyamatos feldolgozóba (2026-09-26)

Az eddigi `projectPropertyEntryViolation` adaptert a normál engine event
processor most minden owned/denied, sikeres Property-belépés után meghívja,
a cursor commit előtt. A rights store kötelező függőség. Player tulajdonosnál
pontos avatar–agent kötés kell; hiányánál a feldolgozott prefix megáll, nem
keletkezik kitalált owner vagy ügy. Business/faction owner a történeti
Property snapshotból származik. A jogsértés world truth, nem observer-tudás.

A watcher a `.local/crime/rights-violations.sqlite` meglévő v1 rights sémáját
használja. Induláskor auditált engine-cursor prefixére korlátozott, 100 eseményes
lapokban pótolja a korábbi worker által kihagyott rights facts-ot, a mai
recordedAt idővel és az eredeti incident/digest alapján. Stabil event/evidence
ID mellett restart/replay nem duplikál. Cursoron túli, receipt nélküli esemény
nem kerül a történeti pótlásba. Sérült/hiányos auditot nem regenerálunk.
A rights audit most az összes materializált esemény audit-lefedettségét is
ellenőrzi: egy törölt auditbejegyzés nem látszhat ép láncnak.

Nincs sémaváltás vagy játékosmentés/pénz/készlet-módosítás. Első megnyitáskor
üres fájlból a már létező v1 rights táblák jönnek létre. Bekapcsolás előtt
a crime/source adatbázisokat a szokásos, megállított írók melletti konzisztens
backupban kell megőrizni. Visszaállítás: watcher leállítása és kód revert;
a rights adatbázist/auditot meg kell tartani. A régi worker újra kihagyhat
jogsértést; visszakapcsoláskor az idempotens prefixpótlás újra lefuttatható.
Tulajdonoskötés hiánya vagy eltérő korábbi rekord blokkoló, nem migrációs engedély.

A közös acceptance fixture már a rights láncot is végigviszi. Ellenőrzött a
hiányzó owner, rights-írás utáni cursor előtti teljes restart, történeti pótlás
és hiányos audit. A másik három eljárás pontos engine→procedure receiptje
és észlelési forrás nélküli csendes kimenete is külön ellenőrzött.
Célzott futás: 17 sikeres / 0 hibás, 132 assertion, négy fájl, Bun 1.3.14.
Teljes `bun test`: 1423 sikeres / 0 hibás, 6750 assertion, 258 fájl,
147,68 másodperc; a helyi collision-oracle ténylegesen lefutott.
Root/engine/webclient TypeScript: exit 0; külön watcher-inclusive program:
0 diagnosztika. `watch.ts --help`: exit 0, adatírás nélkül. Format/diff check zöld.
A 22.1 teljes lezárása továbbra is élő gameplay/skill próbát és a hiányzó
megfigyelési/identification források éles bekötését igényli; nincs új checkbox.

## Történeti részletes lista (változatlan)

## 22. Fázis – tulajdonvédelem, bűnözés és igazságszolgáltatás

- [x] Auditálni a meglévő Thieving, ownership, item-state, Business,
  Faction/Jurisdiction, agent-memory, trade, lifecycle és organization alapokat;
  az újrahasználási és refaktorhatárokat a Phase 22 auditban rögzíteni.
- [x] Az item-, storage- és Property-tulajdon, valamint a belépési entitlement
  megsértéséből egységes, hiteles jogsértési eseményt képezni.
- [x] A pickpocket, lockpick-door, container-theft és property-burglary
  exact-target, bounded procedure-draftját és SDK-observation evidence-ét
  elkészíteni; jogi/world-truth receiptként még ne legyen elfogadható.
- [x] A verified szerver-outcome és az observer-facing discovery számára külön,
  verifier-kötött, idempotens és auditláncolt perzisztens receipt-réteget adni;
  discovery ne örökölje automatikusan a world-truth actort.
- [ ] A meglévő Thieving RuneScape skillt kiterjeszteni több verified eljárásra,
  például pickpocket, lockpick, property burglary és container theft
  folyamatokra; ne készüljön külön „Burglary” személyes skill.
  - [x] A vanilla pickpocket, stall/chest és lockpick sikereket engine-oldali
    inventory/XP/target snapshotból auditláncolt evidence eseménnyé tenni, majd
    explicit avatar-agent bindinggel idempotens procedure receiptbe emelni.
  - [x] A property-burglary tényleges belépési sikerét a Property entry-point és
    entitlement állapotával összekötni, majd a hiteles outcome-ból rights
    violationt képezni.
- [x] A tulajdonjogot, a pillanatnyi birtokost és az item-provenienciát külön
  kezelni, a meglévő `stack/batch/instance` policyt újrahasználva. Olcsó fungible
  javaknál a theft event és value restitution legyen elég; provenance-lot csak
  kereskedelmileg indokolt tételnél, konkrét title/holder pedig értékes, tartós vagy
  azonosítható instance-nál kelljen. Player trade ne tisztítsa meg automatikusan a
  már létező történeti provenienciát.
  - Bizonyíték: szigorú, cross-validated provenance policy; verifier-kötött,
    idempotens és auditláncolt title/custody/theft ledger; fungible restitution
    claim; a custody-only player trade után is megmaradó title és theft history.
  - [x] A fungible restitution claim v2 teljes rekordját külön auditláncba
    kötni az eseménnyel azonos tranzakcióban; a migrált v1 összeget történeti
    hitelesítés hiányában elutasítani.
- [x] Eladási csatornapolicyt készíteni: rendes NPC/Business shop ne vegyen át
  olyan árut, amelyet a saját információja és inspectionje alapján felismert;
  közvetlen player trade továbbadhassa a rendelkezésre álló provenienciát.
  - Bizonyíték: observer- és offer-scoped inspection decision; a finite Business
    procurement előtti kötelező eligibility gate; más bolt tudásának elutasítása;
    player trade `preserve` provenance-disposition.
- [x] Az orgazdaságot emergens agent-tevékenységként modellezni, ne NPC-típusként,
  garantált service-ként vagy külön személyes skillként. A résztvevő agent vagy
  Business saját véges pénzét, készletét, storage-át, kapcsolatait és meglévő
  képességeit használja; halál, börtön, csőd vagy kilépés után a helyi piac akár
  teljesen megszűnhessen, a jövedelmezőség pedig új belépőket vonzhasson.
  - [x] Determinisztikus participation/market projectiont adni, amely kizárólag
    aktív agent/Business jelöltek véges pénz-, storage-, kapcsolat- és capability
    snapshotjából dolgozik; kieséskor ne hozzon létre automatikus pótlást.
  - [x] A pozitív participation decision végrehajtását a normál trade, treasury,
    Business inventory/storage és provenance settlementekkel összekötni:
    ledgerenként atomi, cross-ledger restart-safe, auditláncolt sagaként.
- [x] A lopott instance/provenance-lot vagy crime számára value-, egyediség-,
  tanú-, report-, publicity-, idő-, jurisdiction- és location-függő
  heat/traceability vetületet készíteni. Ez ne legyen globális wanted pont és ne
  jelentsen automatikus merchant/guard tudást.
  - Bizonyíték: verziózott, digest-ellenőrzött policy; Thieving/provenance
    auditláncból feloldott, observer-eseményeket külön kezelő read-only vetület;
    szimulációs idejű lecsengés és helyi joghatósági szorzó.
- [ ] A crime discovery, suspect identification, evidence és legal finding külön
  állapot és esemény legyen; lopott tárgy birtoklása önmagában ne bizonyítsa, hogy
  a birtokos követte el a lopást vagy tudott annak eredetéről.
  - [x] Első case-szelet: a szerver által ellenőrzött Thieving observationből
    külön, auditált discovery és suspect-identification esemény keletkezzen;
    az ismeretlen elkövető ne szivárogjon át a case-állapotba.
  - [x] Önálló bizonyítékesemények és joghatósági legal finding kapu: a
    közvetlen azonosítás, fizikai nyom és hitelesített birtoklási észlelés külön
    auditnaplóba kerül; felelősség puszta birtoklásból nem állapítható meg.
- [ ] Zár- és storage-biztonsági szinteket adni, amelyek a lakhatási hierarchiával
  együtt működnek: utcán alvó személy, közös lockbox, privát szoba és védett
  ingatlan eltérő támadási felület legyen.
  - [x] Verziózott, hierarchy/effect digesthez kötött security-policy és
    hitelesített támadásifelület-vetület; az új épületet a HousingUnit/Property
    konfigurációból oldja fel, nem beégetett épületazonosítóból.
  - [ ] A vetület tényleges storage-/Thieving-végrehajtási bekötése és a
    megfigyelési/evidence események létrehozása.
    - [x] Az elhelyezett bútorok és storage-kapacitás materializált állapotát
      a hash-láncolt elhelyezési naplóból visszaellenőrizni; a jövőbeli
      katalógusmódosításhoz a kapacitássnapshotot az új auditbejegyzésbe írni.
    - [x] A konkrét, aktív tároló-elhelyezést konfigurált HousingUnit és
      security surface pároshoz kötni; csak auditált placementből lehessen
      read-only storage-biztonsági vetületet készíteni.
    - [x] Jogosulatlan Property-belépés és hitelesített észlelési dobás esetén
      fizikai nyom discoveryt írni a Thieving naplóba; onnan külön case-evidence
      esemény vezethető le, az elkövető automatikus megnevezése nélkül.
    - [x] A nyomkeletkezési dobást szerveroldali, auditált SQLite-naplóban
      egyszer kiadni, a Thieving outcome-hoz, megfigyeléshez és security-vetülethez
      kötni; sikertelen észlelés után sem legyen újradobás.
    - [x] A már létező engine Property-belépési eseményt ellenőrzött adapterrel
      összekötni a Housing nyom-döntéssel; az esemény, receipt, bejárat és
      HousingUnit egyezését a dobás előtt vizsgálni.
    - [x] Az eseménykori Property-zárszintet a szerver Thieving bizonyítékába
      menteni; a régi, snapshot nélküli eseményből új Housing nyom ne készülhessen.
    - [ ] Engine storage-hozzáférés és tényleges tanú/őr észlelés hiteles forrása.
      - [x] A mai vanilla láda-/standesemények fail-closed Housing-forráskapuja:
        auditált placement és tényleges storage-művelet nélkül nem keletkezhet
        lakhatási tárolólopás-bizonyíték.
      - [x] A sikeres Property-betörés pillanatában a szerver az aktív,
        látóvonalban álló játékosok jelöltlistáját a Thieving engine-eseménybe
        menti; ez még nem tanúvallomás és nem azonosítás.
      - [x] Verziózott, konfigurálható figyelem-policy és csak olvasható,
        auditált eseményhez kötött jelölt-vetület; a puszta látóvonalból nem
        keletkezik automatikusan discovery vagy gyanúsított.
      - [x] Esemény–megfigyelő páronként egyszeri, auditált észlelési dobás;
        siker esetén observerhez kötött, de elkövetőt nem azonosító discovery,
        sikertelen dobás után nincs újrapróbálás.
      - [x] Kötegelt, idempotens engine-esemény feldolgozó a meglévő
        avatar–agent kontrollprofilhoz kötve; az ismeretlen elkövetőnél megáll,
        az ismeretlen megfigyelőt külön jelzi, nem kreál agentazonosságot.
      - [x] Auditált, tartós cursor és külön indítható, ismétlődő helyi
        feldolgozó; hiba/újraindítás után csak idempotens prefixet játszik újra.
      - [x] A helyi stack indítójába opt-in bekötés és egészségjelzés.
      - [x] Az agenthez nem kötött, de engine snapshotban hitelesített játékos
        szemtanút önálló player-azonossággal kezelni; a tanúdöntés v2
        migrációja után a cursor ne akadjon el miatta, és későbbi agent-kötés
        se írja át az egyszeri döntést.
- [ ] Tanú-, észlelés-, tárgyi nyom- és evidence-ledger eseményeket készíteni úgy,
  hogy a bűncselekmény ténye és annak bizonyítottsága külön állapot legyen.
  - [x] A már auditált Thieving tanú- és fizikai nyom megfigyeléseket külön,
    tartós cursorral backfill-elni a case/evidence naplóba; ismeretlen tanúból
    ne legyen gyanúsított vagy automatikus jogi döntés.
  - [x] Az evidence/finding közvetlen és listás olvasási API-ja is zárjon
    sérült auditláncnál; nyers rekord ne jelenhessen meg hiteles jogi tényként.
- [ ] A lebukást explicit megfigyelési felületekhez kötni: helyszíni tanú/őr,
  zár- vagy riasztási nyom, normál bolti eredetvizsgálat, orgazdai információ
  és policyvel engedélyezett biztonsági ellenőrzés. Várba vagy hivatalba
  belépéskor csak konfigurált checkpoint/search és sikeres detection fedhesse fel
  a lopott árut; az őrök és agentek ne kapjanak mindentudó inventory-ismeretet.
  - [x] Első, csak olvasható, verziózott checkpoint-policy kapu: kizárólag
    külön hitelesített ellenőrzés és pozitív detection esetén fed fel
    azonosított tárgyat; a helyszínre belépés önmagában nem bizonyíték.
  - [x] Külön auditláncolt checkpoint inspection/detection bizonyítéknapló;
    a tényleges eseményeket továbbra is független szerverforrásnak kell igazolnia.
  - [ ] A checkpoint események hiteles engine-forrása és auditált bekötése.
    - [x] Exact-match adapter és zárt alapforrás; a jelenlegi quest-keresések
      nem adnak általános, auditált search és külön recognition eseményt.
  - [x] Agentenként elkülönített, csak olvasható kontakt-/evidence-nézet;
    szabad szöveg vagy címke nem igazolhat orgazdai szerepet.
  - [ ] Típusos, ellenőrizhető és visszavonható orgazdai attestation forrása.
- [x] A már meglévő Faction/Jurisdiction szabályaihoz verziózott crime policyt
  kapcsolni joghatóságonként eltérő szabályokkal.
  - [x] Első kapu: immutable, digestelt policy-verzió a hiteles incidens helyén
    érvényes legszűkebb joghatósághoz; külön hatósági igazolás és
    policy-specifikus bizonyítékfeltétel a legal finding előtt.
  - [x] Policy-katalógus tartós, auditált létrehozása, aktiválása,
    leváltása és visszavonása a Governance adatbázisban; eseménykori
    historikus feloldás és típusos helyi adminisztrációs API.
- [ ] Feljelentés, elfogás, bírság, kártérítés, vagyon-visszaadás és egyszerű
  börtön/korlátozás MVP-t készíteni auditált, idempotens állapotátmenetekkel.
  - [x] Első feljelentés-napló: csak hitelesített, konkrét case discoveryhez
    kötött megfigyelő explicit akciója írhat auditált notice rekordot;
    ez önmagában nem jogi döntés vagy szankció.
    - [x] Az egyedi feljelentéslekérés is auditlánc-ellenőrzött; sérült naplóból
      sem listázással, sem ID szerinti olvasással nem ad vissza hitelesnek tűnő adatot.
  - [ ] Hiteles játékos/agent feljelentési belépési pont és a későbbi
    intézkedések külön, policy- és evidence-kötött átmenetei.
    - [x] Belső, típusos avatar–agent feljelentési port: egyedi player-kötés,
      tényleges case-tanú és külön explicit-akció igazolás. A játékbeli
      session-hitelesítés és akcióforrás hiányában még nincs publikus/admin route.
    - [x] Szűk HTTP feljelentési művelet csak bekapcsolt login-szerver és friss,
      azonos online avatar mellett. A szerver képezi az action attestationt és
      a stabil report ID-t; kikapcsolt hitelesítésnél az útvonal zárt.
    - [x] Típusos SDK kliens a hitelesített feljelentési művelethez, jelszó
      URL-be vagy JSON törzsbe írása nélkül; a gateway változatlanul dönt.
    - [x] A player-only tanú külön, csak olvasható igazolási kapuja: a
      hitelesített játékosnevet a történeti tanúdöntéshez, az észlelt
      megfigyeléshez és a case discoveryhez köti. Agentet nem talál ki, és
      feljelentést még nem ír; ehhez külön tartós report-séma kell.
    - [x] Külön, auditláncolt player-only feljelentési napló v1 sémával,
      explicit szerver-akció igazolással, forráslánc-ellenőrzéssel és
      idempotens újrajátszással.
    - [x] A már hitelesített HTTP gateway útvonal player-only ága: csak friss,
      azonos avatar és auditált tanúdöntés mellett ír a külön naplóba;
      agenthez kötött esetben a meglévő report-út változatlan.
    - [x] Külön verziózott bírság-limit policy és csak olvasható javaslatkapu:
      auditált `responsible` finding, incidenskori szabály, aktív joghatóság,
      összegplafon és külön hatósági igazolás kell; pénzmozgás még nincs.
    - [x] A bírság-limit policy külön, tartós Governance-v10 katalógusa:
      auditált draft/aktiválás/leváltás/visszavonás, incidenskori historikus
      feloldás és a javaslatkapu hiteles policy-forráshoz kötése.
    - [x] Auditláncolt, append-only bírságjavaslat-napló: hiteles policy- és
      finding-kapu után egy javaslat/finding, pontos idempotens ismétlés;
      sem tartozást, sem pénzmozgást nem hoz létre.
    - [x] Külön, auditláncolt hatósági döntési napló: a javaslat csak független
      döntéshozói igazolással fogadható el vagy utasítható el; az elfogadás még
      nem játékos-vagyonterhelés vagy behajtható tartozás.
    - [x] A bírságjavaslat a legal finding forrását is újraellenőrzi: a
      hivatkozott evidence-et, az incidenskori crime policyt és a finding
      önálló hatósági igazolását; puszta auditlánc nem jogosít szankcióra.
    - [x] Joghatóság-specifikus, auditált és visszavonható döntéshozói
      felhatalmazás: történeti grant azonosított agenthez, külön igazolt
      kinevezés/visszavonás, majd önálló explicit döntési akció kell.
    - [x] A döntésnapló normál konstruktora kötelezően a történeti grant
      forráshoz kötött, így önálló callbackkel nem hagyható ki a felhatalmazás.
    - [x] A tartós bírságjavaslat is kizárólag auditált crime- és fine-policy
      katalógusból hozható létre; statikus policy csak a read-only kapu tesztjéhez.
    - [x] Csak olvasható beszedési előellenőrzés: a döntési láncot újraolvassa,
      az incidenskori player-nevet a jelenlegi pontos avatar-kötéssel veti össze,
      és a frakció kincstári címzettjét mutatja. A kettős főkönyves, auditált
      elszámolás hiányát kötelező blokkolóként jelzi; vagyonmozgást nem enged.
    - [x] Külön, még végrehajtás nélküli bírság-beszedési szándéknapló: egy
      determinisztikus terv/döntés, auditlánc, forrás-újraellenőrzés és zárt
      olvasás sérült vagy megváltozott jogi láncnál. Nem törli a kötelező
      kétfőkönyves elszámolási blokkolót, és nem mozgat vagyont.
    - [x] A treasury külső jóváírásának külön, append-only auditlánca: a
      receipt, audit és egyenlegváltozás egy SQLite-tranzakció; pontos ismétlés
      nem ír új sort, hiányos/sérült auditnál csak ez az út zár. Nem kapcsolja
      be a bírságbeszedést; a meglévő audit nélküli rekord külön egyeztetendő.
      - [x] Teljes, auditált külső-jóváírási olvasás, amely nem csonkolja el az
        azonos forráshoz tartozó esetleges további bizonylatokat.
      - [x] Csak olvasható kétfőkönyves diagnózis: a bírságszándék, közös escrow
        és teljes treasury-receipt lista auditját ellenőrzi, az eltéréseket és
        félkész állapotokat elkülöníti. Az egyező receipt-alak sem fizetési
        bizonyíték vagy beszedési engedély; minden kimenet zárt.
      - [x] Külön v1, auditláncolt diagnózisnapló: explicit megfigyelésazonosítóval
        idempotens történeti eredmény, új azonosítóval friss ellenőrzés;
        a régi diagnózis nem élő státusz vagy fizetési bizonylat. A forrásfőkönyvek
        változatlanok, beszedési és „kifizetett” jogosultság továbbra sincs.
      - [x] Az egyeztetés külön visszaolvassa a vizsgált forrásértékeket:
        auditált, de közben megváltozott intent/escrow/receipt esetén
        `unverifiable` diagnózis. Ez nem közös atomi snapshot vagy fizetési igazolás.
    - [x] Opt-in, közös SQLite-kapcsolatú escrow–játékos-checkpoint műveleti
      határ, rollback- és restart-teszttel; az élő `World` útvonalon alapból
      kikapcsolt opt-in bekötése van, de a régi rekord miatt a jelenlegi világban
      nem aktiválható, és önmagában nem oldja fel a beszedési blokkolót.
    - [ ] Régi escrow állapotok ellenőrzött migrációja, GE-től független
      checkpoint-authority, élő engine-bekötés és két főkönyves egyeztetés.
      - [x] Csak olvasható, adatot nem másoló migrációs előellenőrzés: régi és
        céloldali escrow-sorok, feloldatlan állapotok és checkpoint-tábla
        ellenőrzése; meglévő rekordnál friss automatikus indulás tiltása.
      - [x] Külön opt-in checkpoint-megnyitás és újranyitási teszt kikapcsolt
        Grand Exchange mellett; az élő World-bekötés még zárva marad.
      - [x] Friss világra korlátozott, tartós közös escrow-authority jelölő
        és újraindítási kapu; régi vagy jelöletlen rekordnál zárt állapot.
      - [x] Alapból kikapcsolt, friss világra korlátozott világ-tick bekötés:
        escrow és player-checkpoint egy SQLite tranzakcióban, memóriabeli
        inventory rollbackkal; a jelenlegi régi rekord miatt nem aktiválható.
      - [x] Az új közös escrow-út láncolt, tartós állapotváltozás-auditja ugyanabban
        a tranzakcióban; sérült/hiányzó auditnál zárt olvasás és írás. A régi
        külön fájl története ettől még egyeztetést igényel.
      - [x] Csak olvasható, személyes adatot nem kiíró régi escrow-bizonyítékjelentés:
        terminális `consume`, feloldatlan és ambivalens rekordok, valamint a
        checkpoint jelenlétének aggregált számai. Atomikus történeti kapcsolatot
        nem bizonyít, migrációt nem engedélyez.
- [ ] Az LLM legfeljebb javaslatot vagy intézményi döntés-előkészítést adhasson;
  vagyonelvonás, bebörtönzés vagy halál kizárólag validált policy és hiteles
  evidence alapján történhessen.
  - [x] Az autonóm skill-műveletek jelenlegi zárt listája nem tartalmaz
    bírságolást, elkobzást, bebörtönzést vagy halált; regressziós teszt
    biztosítja, hogy konfigurációval se lehessen ezeket hozzáadni.
  - [ ] A jövőbeli szankció-végrehajtási API-kat külön, policy- és
    evidence-kötött jogosultsági kapun át kell bevezetni.
- [ ] Külön kezelni a joghatósági criminal recordot, a szereplőnkként vagy
  közösségenként eltérő reputációt és az opcionális világprofil-függő
  `moral standing`/karma értéket. Ne legyen globális „social credit” pontszám,
  és a rendszer ne írja át automatikusan az alap `personalityTraits` mezőt.
  - [x] Első, csak belső és olvasható, auditált legal findingből származtatott
    joghatósági criminal-record nézet; `not-proven` kizárva, reputáció és
    moral standing továbbra is külön, későbbi mechanizmus.
- [ ] Bizonyítékalapú dinamikus viselkedési/reputációs leírásokat adni az agent
  kontextusához, például `known thief`, `unreliable` vagy `reformed offender`.
  Titokban maradt lopásból más agent ne tanuljon reputációt, és egy lopás ne
  bizonyítsa automatikusan a rosszindulatú személyiséget.
  - [x] Első, csak belső tanú-specifikus leíró vetület: kizárólag a saját,
    közvetlenül azonosított gyanúsítotthoz köt forráseseményt; anonim,
    következtetett vagy más tanú által ismert esetből nem készül címke.
  - [x] A tanúhoz kötött leírás meglévő helyi crime-forrásból az agent saját
    döntési kontextusába kerül; sérült vagy hiányos auditforrásnál nincs
    leírás, csak látható blocker. Nincs automatikus reputáció-/trait-változás.
- [ ] Megváltási/reintegrációs policyt készíteni: restitution, kártérítés,
  közösségi munka, letöltött büntetés, megbocsátás és vallási vezeklés
  javíthasson megfelelő reputáción vagy moral standingen. Ima önmagában ne
  törölje a sértett tulajdonjogát, a bizonyítékot vagy a criminal recordot.
  - [x] Első, verziózott, világprofilhoz és konkrét megfigyelőhöz/közösséghez
    kötött, csak olvasható javaslatpolicy; esemény és tudás külön hitelesítendő,
    jogi/tulajdoni állapotot nem módosít.
  - [ ] Hiteles teljesítési és megismerési források, majd külön auditált
    reputáció-/moral-standing állapotátmenet.
- [ ] Az underworld counterpartyk ismeretét episodic/semantic memoryből és
  relationshipből levezetni; ne legyen minden agent számára látható globális
  orgazda-lookup.
  - [x] Megfigyelőhöz kötött kontakt- és bizonyítékazonosító-nézet, amely
    szabad szöveget és címkét nem fogad el orgazdai igazolásként.
  - [x] Külön, auditált, forrás-ellenőrzött és visszavonható lehetséges
    partner-állításnapló; az éles forrásadapter és agent-döntési bekötés még hiányzik.
  - [x] A visszavonható állítás és a saját, közvetlen kontaktmemória külön
    ellenőrzött, olvasható metszete; nem kereskedési jogosultság.
  - [x] Éles forrásleltár és fail-closed alapadapter: a mai fencing snapshot,
    settlement, szöveg és telemetria nem bizonyít megfigyelő-specifikus
    megismerést; auditált engine-encounter esemény még hiányzik.
- [ ] A fizikai/gazdasági átalakítást külön, valós input-output crafting
  folyamatként kezelni: az eredeti instance megszűnhet és az új tárgy kevésbé
  felismerhető lehet, de a történeti input-proveniencia ne törlődjön.
  - [x] Verziózott recipe és provenance policy alapján csak olvasható
    forrásképesség-vetület; a mai termelési receipt nem tartalmaz pontos
    felhasznált/létrejött assetazonosságot, így clean title nem állítható.
  - [x] Hiteles, pontos input–output asset lineage és atomi provenance-/készlet-
    átmenet, tranzakciós v3 migrációval, snapshot-visszaállítási tervvel és
    az eredetet megőrző transitive ancestry olvasattal.
- [ ] A ganget, cartelt és thieves' guild-szerű hálózatot később általános
  organization/member/role infrastruktúrából levezetni. Ne készüljön
  `CriminalFaction`; a Business, Faction/Jurisdiction és jövőbeli organization
  modulok kapcsolódjanak, a bűnöző jelleg pedig valós tevékenységből és
  tranzakciókból legyen származtatott.
- [ ] A bűnözői stratégia jövedelmét, lebukási kockázatát, károkozását és
  visszaesését mérhetővé tenni.
  - [x] Első, explicit receipt-kohorszra szűkített, auditált Thieving
    outcome/discovery vetület; a tényleges bevétel, kár, jövőbeli kockázat és
    visszaesés forrás hiányában kifejezetten nem elérhető.
  - [x] Exact Thieving receipt–provenance lopásesemény lefedettségi nézet;
    nem téveszti össze az auditált restitution igényt a bizonyított kárral.
  - [x] Auditált, explicit Thieving receipt-kohorszhoz kötött case/finding
    lefedettségi nézet; a megnyitott ügy nem bűnösség, a hiányzó finding nem
    felmentés, és részleges kohorszból nem számol visszaesést.
  - [x] Hiteles gazdasági, sértetti és időablakos jogi forrásokkal bővíteni a
    hiányzó dimenziókat, torzító globális „wanted” pontszám nélkül.
    - [x] Teljes helyi joghatósági felelősségi ledgerből időablakos,
      distinct outcome-történet: incidensidő és finding-rögzítési cutoff
      külön, pontos case/outcome-kötés és forrás-visszaellenőrzés.
      Az elsőn túli incidensszám nem globális vagy büntetőjogi visszaesési arány.
    - [x] Auditált orgazdai settlement-kérés pontos, immutable visszaolvasása:
      requesthash, metadata-azonosság és audit request-digest kötés együtt.
      Ez önmagában rögzített kérésforrás, nem az eladó hiteles GP-jóváírása; az
      alábbi projection ezért külön tartós engine payment-bizonylattal köti össze.
    - [x] A committed fencing settlementet a tartós engine trade verifierrel és
      a közvetlen vagy crafting-ancestor lopott assettel kötött gross payment
      metrika; exact tárgy-/mennyiségveszteség külön, pénzbeli kár claimből nem
      készül. Megfigyelt lebukás, helyi időablakos ismétlődés és a külön jelölt,
      nem-esemény prospective estimate pontos kohorsz/lefedettséggel olvasható.

Elfogadási feltétel: egy agent képes betörni vagy lopni a Thieving skillre és
verified eljárásra támaszkodva, a tulajdonátruházás nem tárgyteremtés, és a
jogsértésből bizonyíték-, joghatósági és szankciós lánc képezhető.
