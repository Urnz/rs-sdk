# Tanúhoz kötött, külön személyfelismerés

A felismerés explicit megfigyelői művelet. Nem következik automatikusan abból,
hogy egy tanú észrevette a lopást; nem olvasunk identitást LLM-emlékből,
kapcsolati ismerősségből vagy a lopási esemény rejtett elkövetőmezőjéből.
A jelen dokumentum a bekötést írja le, nem állít élő elfogadást. Az exact
elfogadási eredmények a `PHASE22_PROGRESS.md` fájlba kerülnek.

## API és bizonyítási lánc

Az SDK `recognizeWitness(eventId, targetPlayerSlot, commandId?)` hívása a
`POST /crime/recognize/{username}` útvonalat használja. A kérés pontos mezői:
`commandId`, `eventId`, `targetPlayerSlot`. A kiválasztott slot a kliens számára
látható személy explicit kijelölése, nem állított identitás.
Ugyanazt a command ID-t kell megőrizni retry/restart-replay során.

A gateway login-hitelesítést és friss, csatlakozott, azonos avatar-sessiont
követel. Az observer nevét a hitelesített sessionből származtatja; a kliens nem
adhat `recognizedPlayerUsername`, `recognizedAgentId` vagy bizonyíték-digestet.
Nincs bearer nélküli, body/query-jelszavas vagy CORS-os kerülőút.
A tanú figyelmi döntését a tényleges engine/Thieving auditforrásból ellenőrzi:
észlelési missből nem lehet felismerést kérni.

A gateway ezután a tokenvédett engine
`POST /api/internal/admin/witness-inspection` kaput hívja. Ennek pontos mezői:
`commandId`, `eventId`, `observerUsername`, `targetPlayerSlot`;
az `x-engine-admin-token` fejléc csak belső csatornára való.
A sor legfeljebb 50 kérést fogad, a függő kérés két másodperc alatt lejár,
és csak a következő world-tick határon hajtódik végre.

Az engine a kijelölt élő entitást önállóan mintavételezi. Ellenőrzi az aktív,
csatlakozott, normál láthatóságú feleket, az observer valódi rsbuf-láthatósági
listáját, a látóvonalat, szintet, távolságot, időablakot és az eseménykori
vizuális/session folytonosságot. A célpontot nem az engine theft
`playerUsername` mezőjéből keresi ki. Ez a rejtett adat később kizárólag
konzisztencia-ellenőrzés lehet.

Az engine receipt önálló auditnaplóba kerül. A gateway nem a HTTP-válasz JSON-ját
tekinti igazolásnak, hanem újraolvassa ezt a naplót, ellenőrzi a forrásláncokat,
az exact figyelmi döntést és a tényleges avatar–agent kontrollprofil-kötést.
A meglévő `WitnessRecognitionStore` külön recognition-forrást rögzít, majd új
`recognition:` discovery, külön suspect-identification és tárgyi
bizonyítékhivatkozás készül. Az eredeti anonim `witness:` discovery változatlan.
Nincs finding, bűnösség, bírság vagy inventory-módosítás ezen az útvonalon.

A feljelentés továbbra is külön explicit művelet. A recognition-forrású
feljelentés az engine inspection, recognition, figyelmi, Thieving és case
forrásokat replay esetén is újraellenőrzi. A tudás a felismerő observerhez kötött.

## Folytonosság és policy

Új lopási esemény opcionális `sightSnapshot.continuity` adatai:

- `actorSessionToken`: véletlen, engine-objektumhoz kötött opaque token;
- `visualDigest`: a megjelenés név és stat címkék nélküli digestje;
- `observers`: exact observer-username és observer-session token párok.

A megjelenéspacket végén álló 8 byte username37, 1 byte combat és 2 byte skill
label nem része a vizuális digestnek. A production sight candidate-lista csak
valóban látható, csatlakozott megfigyelőket tartalmazhat; rejtett elkövető vagy
a kliens láthatósági kapacitásából kimaradt személy nem ad automatikus észlelést.

A bounded memóriabeli tracker observer–személy páronként figyeli a folytonosságot,
minden tickben a kliens-láthatósági listák frissítése után. Látóvonal/láthatóság
elvesztése, megjelenésváltozás, disconnect, logout, kihagyott frissítés vagy
eviction megszünteti a régi folytonosságot. A visszatérés vagy újracapture csak
új kezdő tickkel nyit párt: régebbi anonim eseményhez nem használható.
Legfeljebb 4096 pár marad legfeljebb egy óráig; kiesés fail-closed, nem új
azonosítási lehetőség. Logout/relogin és process restart új objektumtokent ad.

A `THIEVING_WITNESS_RECOGNITION_POLICY` konfiguráció JSON-alakja
`{ "version": 1, "maxDistance": 8, "maxEventAgeMs": 300000 }`; ez az alapérték.
Távolság 1–15 tile, időablak 1–3600000 ms lehet; ismeretlen mező vagy verzió
elutasított. Az engine receipt a policy digestjét is megőrzi.

## Naplók, migráció és visszaállítás

Az új `EngineWitnessInspectionStore` v1 adatbázis alapértelmezett engine-cwd
útvonala `data/mods/witness-inspections.sqlite`, repositoryban
`server/engine/data/mods/witness-inspections.sqlite`.
A `THIEVING_WITNESS_INSPECTION_DB` operátori override-nak engine/gateway oldalon
ugyanarra az abszolút fájlra kell mutatnia. Nem HTTP-kérésből választott útvonal.
A derived recognition production fájl `.local/crime/witness-recognition.sqlite`.
Adatbázis, credentials, token és live save nem kerül Gitbe.

Az inspection receipt immutable mezői: recognition/command ID, esemény és
observer, önállóan mintavett recognized username, engine source digest,
idő/tick, folytonosság- és policy-digest, kijelölt target slot.
Receipt-digest és sorszámozott hash-lánc igazolja a materializált tartalmat;
azonos command ID más event/observer/slot mellett elutasított.
Sikeres exact replay újraindítás után az eredeti receiptet adja, nem új
mintavételt. Ez nem ad új felismerési lehetőséget lejárt vagy offline eseményre.

Migráció: az inspection journal új, verziózott v1 store; újabb schema verziót
régi olvasó nem nyit meg. A Thieving engine snapshot kiegészítés opcionális és
additív: korábbi JSON/digestek változatlanok, nincs történeti átírás vagy kitalált
folytonosság-backfill. Régi snapshotból személyazonosítás nem készülhet.
A derived discovery/case/evidence meglévő sémáiban új append-only sorok jelennek
meg. Telepítés előtt meg kell őrizni a meglévő forrásadatbázisok backupját.

Rollback: először le kell állítani az új recognition írókat és gateway kaput,
majd megőrizni az engine inspection, engine theft, recognition, figyelmi,
Thieving, case/evidence és report adatbázisokat, valamint WAL/SHM fájljaikat.
Régi kód nem törölheti és nem rehash-elheti az új forrásokat, nem írhatja át az
anonim tanúvallomást, és nem használhat korábbi command ID-t más felismerésre.
Ha régi runtime nem tudja a teljes upstream forrást ellenőrizni, a recognition
feljelentési útvonalnak zárva kell maradnia.

## Helyi élő elfogadás

A `scripts/run-phase22-completion-live.ts` kizárólag a három dedikált teszt-
avatarra korlátozott orchestrator. Korábban elfogadott, operátor által kijelölt
bundle-t használ; HTTP-kliens nem választhat adatbázist. Az avatárok előkészítése
a meglévő backup/audit/offline-edit kapun történik, nem közvetlen save-írással.
Az előkészített szint, lockpick, tesztpénz és helyzet nem elfogadási bizonyíték:
a sikeres Thieving műveletnek új valódi engine-eseményt kell létrehoznia.
Az ingatlanvásárlás normál atomi művelet, külön `PROPERTY_STATE_DB` fájlban;
a fő Property-adatbázis nem változik. Végül a normál bot/worker nélküli stack
visszaáll, a tesztmentések és backupok a helyi, Gitből kizárt fájlokban maradnak.

A `-GatewayLoginAuthentication` startup kapcsoló a gateway valódi login-
hitelesítését engedélyezi, az engine remote save-authority beállítását nem írja
felül. A próba megvárja a hitelesítési csatorna tényleges csatlakozását is.
Az opcionális `--resume-procedures` csak korábban sikeres élő pickpocket
artifactokkal folytat; mindkét tanú recognition/report forrását ismét végig
ellenőrzi a hitelesített HTTP-kapun, majd teljes process-restart után is.
Nem fogad el sikerjelző fájlt önálló bizonyítékként, és nem dobja újra a miss-t.

Az SDK loc-success és az engine receipt között a RuneScript halasztott commitja
miatt lehet tick-eltérés. Az elfogadás legfeljebb hat tickig vár a naplóra, de az
avatar, target, effect, XP és inventory egyezését nem lazítja. Téves vagy
többértelmű forrás nem válik elfogadottá. Az engine targetet a procedure kind
választja: pickpocket NPC, a másik három loc; bent maradt NPC-pointer nem lehet
egy stand vagy ajtó helyettesítője. Korábbi hibás targetű eseményt nem írunk át.

A tiszta zárnyitásnak nincs witness discovery-je. Az item-transfer és a védett
ingatlanba történő behatolás tanúja anonim észleléstől külön explicit
felismerésig/feljelentésig halad. A már rögzített parancs és report exact replayje
teljes engine/gateway restart után is azonos; a restart nem új észlelési dobás.
