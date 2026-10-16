# Phase 24.8 – natív diminishing-XP baseline

Dátum: 2026-10-15. A véges részfeladat elkészült: natív cohort-pillanatkép,
auditált offline reset/restore, Phase 12 perzisztencia és az első hosszú
hullám előtti digest-kapu. A hat élő kezeléspár és a benchmark továbbra is nyitott.

Folytatás: [első natív XP-számítás](phase24-8-xp-execution.md). Az új
kísérleteknél a dispatch előtti snapshot mellett már a számítási ponton is
ellenőrzött a player előállapota; a későbbi Player-stat commit továbbra is
külön bizonyítékot igényel.

## Bizonyíték és mérési határ

A `DiminishingXpStore.snapshot` az engine tényleges, memóriában használt és a
lemezes fájllal egyező állapotából olvas. Ha másik runtime vagy külső folyamat
megváltoztatta a fájlt, nem ad frissnek látszó pillanatképet: restartot kér.
Hiányzó fájl üres állapotként olvasható, létrehozás nélkül.

A közös `society-experiments/xp-state.ts` szerződés ellenőrzi a snapshot pontos
mezőit, cohortját, countereit, konfigurációs hashét és tartalmi digestjét.
Az authority `engine-diminishing-xp-store`; a snapshot a canonical playerlistát,
nyers activity-state-et, ürességet, megfigyelési wall időt, cohort digestet,
teljes store digestet és konfigurációs digestet őrzi. A hiányzó player és az
üres activity-map az XP-kezdőállapot szempontjából egyenértékű; a restore
előképe az eredeti rekordhiányt is megőrzi.

A Phase 12 natív preflight az avatar/cél/környezet ellenőrzése után közvetlenül
az engine-től kér snapshotot. Ellenőrzi az exact avatar-cohortot és az aktív
XP-mod konfigurációját. A kliens csak a helyi HTTP engine-t érheti el, kötelező
engine admin tokennel, redirect nélkül. Nem fogad snapshotot vagy forrásútvonalat
HTTP-bemenetként.

Az új Phase 12 rekord nullable `xp_initial_state_json` oszlopa őrzi a snapshotot.
A hosszú program a tényleges start preflightjának snapshotját a változtathatatlan
definitionhöz köti, majd az első hullámnál `expectedXpCohortDigest` értékkel
ellenőrzi. Eltérés esetén nincs skill-dispatch. A közben commitolt claim megőrzi
azonosságát; nem indul helyette új kísérlet. Ez a start és első hullám közti
cohort-változást detektálja; a korábbi `prepare` tervsémája változatlan.

A hosszú összehasonlító új `xpRepetitionState` mezője:

- `matching-empty-native-snapshots`: mindkét első natív hullám snapshotja
  ellenőrzött, üres, azonos cohort digesttel. A hosszú definitionben lévő
  snapshot kötésével is egyezik, ha az rendelkezésre áll.
- `legacy-unattested`: egyik régi futásban sincs snapshot; nem találunk ki
  visszamenőleges bizonyítékot.
- `not-matching-empty`: részleges vagy nem üres bizonyíték. Ez nem üres
  kezdőállapot-attesztáció.

A snapshot **végrehajtás előtt megfigyelt állapot**. Az engine-tick és az első
XP-művelet közötti időt nem zárja le végrehajtási zár. Ezért
`attestsExactDispatchState=false`, `causalEffectEstablished=false` és
`engineRandomStreamSeeded=false` marad. A további rejtett engine-állapot,
replikáció, társadalmi önfenntartás és a másik öt kezelés nincs igazolva.

## Admin felület szerződése

Gateway, admin hitelesítés mögött:

```text
GET /api/admin/society/xp-baseline?player=ada&player=bea
POST /api/admin/society/xp-baseline
```

Az engine megfelelő belső végpontja `/api/internal/admin/xp-baseline`, kötelező
`X-Engine-Admin-Token` fejléccel. A gateway GET-hez a szokásos
`X-Admin-Request: rs-sdk-admin` és konfigurált admin token szükséges.

A POST pontos törzse resethez:

```json
{
  "kind": "reset",
  "commandId": "10000000-0000-4000-8000-000000000001",
  "expectedStoreDigest": "<az aktuális GET storeDigest értéke>",
  "reason": "XP-kontrollpár kezdeti előzményeinek előkészítése.",
  "cohort": ["ada", "bea"],
  "sourceCommandId": null
}
```

Csak offline, a World natív offline-save readiness ellenőrzésében szerkeszthető
player engedett. A cohort minden tagjára lefut a kapu. Aktív bootstrapping vagy
observing society-integrity run mellett a művelet elutasított: előbb a világ
genesisét kell szabályosan resetelni. A guard a régi alkalmazott genesisek
integritási megfigyelőjét is figyelembe veszi. A kérés feldolgozása után a
readiness/aktív-run ellenőrzés és a módosítás szinkron; tick/login nem ékelődik
közéjük. A resetet az új genesis előtt kell előkészíteni.

Restore esetén `kind=restore`, új `commandId`, friss `expectedStoreDigest`,
ugyanaz a cohort és az eredeti reset azonosítója a `sourceCommandId`. A restore
kizárólag az engine saját, perzisztens reset-auditjának előképét használja;
feltöltött snapshot nem helyettesítheti. Az XP-konfigurációnak egyeznie kell.
A cohorton kívüli playerek változatlanok.

A restore az eredeti countereket és timestampokat állítja vissza; nem datálja
át őket. Az eltelt wall idő miatti decay továbbra is érvényes. Nem üres
állapot restore-ja ezért nem bizonyít időfüggetlenül azonos kezelési kezdetet.

## Atomikusság és újraindítás

A reset és restore állapota, előképe és hash-láncos auditja egyetlen atomikus
fájlcserével kerül a store-ba. Az audit tartalmazza a teljes pontos kérést,
sequence/head kötést, előképet és az utólagos cohort digestet.

- Az aktuális teljes store digest compare-and-set kapu; más player közben
  történt XP-változása is új preflightot igényel egy módosításhoz.
- Azonos command ID és azonos kérés csak a korábbi receiptet adja vissza.
  A resetet nem alkalmazza újra akkor sem, ha azóta már XP keletkezett.
  A válasz snapshotja ilyenkor az aktuális állapot, nem a régi üresség.
- Azonos ID eltérő kéréshez konfliktus. Ismeretlen resetből nincs restore.
- `.lock` fájl kizárja az együttműködő írókat; a lemezes fingerprint ellenőrzi
  a stale runtime-ot. Ideiglenes fájl, fájlflush és rename után frissül a memória.
  Sikertelen mentés nem növeli meg a memóriában maradó countert.
- A normál XP-képlet, tier és decay szabály változatlan. Az award perzisztencia
  ugyanazt az atomikus, stale-írót kizáró mentést használja.
- Újrainduláskor a natív audit lánca és sequence/head/tail kötése ellenőrzött.
  Sérült állapot vagy ismeretlen séma hibát ad; nincs csendes üres pótlás.

## Migráció és rollback

A `.local/admin/diminishing-xp-state.json` v1 továbbra is olvasható. A normál
award v1 marad; az első explicit baseline-módosítás vált v2-re, megőrizve az
összes többi player counterét. Újraindítástól függetlenül megmarad az audit.
A v2 legfeljebb 10 000 baseline-receiptet enged, automatikus törlés nélkül.
A validált counterállapot legfeljebb 10 000 playert és összesen 100 000
activityt tartalmazhat; nagyobb vagy hibás régi állapot nem kap üres pótlást.
A mod registry az új képességet `1.1.0` verzióval, `dataSchemaVersion=2`
értékkel jelzi. Régi, még futó engine-re a registry hot reloadja migrációs
igényt jelez; az új kód betöltéséhez tervezett engine-restart kell. A friss
engine v1 fájlból is elindul, az explicit resetig fájlátírás nélkül.

Frissítés előtt, leállított engine és gateway mellett mentsd a teljes XP-fájlt,
Phase 12 SQLite-t, hosszú programnaplót, clockot és összetartozó világforrásokat.
Az üres fájlt nem kell mesterségesen létrehozni. Ebben a fejlesztésben élő
adatbázist vagy XP-fájlt nem módosítottunk.

A Phase 12 oszlop additív, nullable; az írható store a meglévő add-column
migrációjával veszi fel. A read-only adapter régi, oszlop nélküli forrást is
olvas, módosítás nélkül. Null/hiányzó snapshotnál az `xpInitialState` JSON-mező
teljesen kimarad, így a történeti natív run digestje nem változik.

Rollback:

1. Állítsd le az összes írót, és őrizd meg a friss v2 fájlt és az új auditokat.
2. A régi engine a v2 fájlt elutasítja. Teljes rollbackhez az összetartozó
   frissítés előtti világmentést állítsd vissza, ne csak a counterfájlt.
3. Ha kizárólag kompatibilis counter-export szükséges, validált v2 másolatból
   készíthető külön `{schemaVersion:1, players:<aktuális players>}` fájl. Ez nem
   auditált benchmark-restore; a v2 eredeti kötelezően megőrzendő, az új
   baseline-bizonyítékokhoz továbbra is a friss olvasó kell.
4. Az additív Phase 12 oszlop maradhat. Az XP-snapshotot tartalmazó új receipt
   ellenőrzéséhez a friss olvasó szükséges; a mező eltávolítása átírná a digestet.
5. Crash után megmaradt `.lock` kizárólag az összes író leállítása és az állapot
   ellenőrzése után távolítható el. Élő runtime alól nem szabad elvenni.

## Ellenőrzési kör

A natív tesztek bizonyítják a scoped resetet, exact replayt, előkép-restore-t,
timestamp-megőrzést, restartot, audit-sérülés elutasítását, stale írót,
fájlírási hiba utáni állapotmegőrzést és az online/aktív-run kaput. A hosszú
futás tesztje a natív XP-store snapshotját a Phase 12 és a program definitionjén
át a két egynapos összehasonlításig viszi; közbeni history-drift előtt nincs
skill-dispatch. Régi, oszlop nélküli Phase 12 forrást külön ellenőriz.

A teljes regresszió első próbája a régi egynapos lemezes fixture 5,095 másodperces
futásánál érte el a Bun alapértelmezett 5 másodperces tesztlimitjét. A WAL
önmagában nem stabilizálta minden futásban a környezetfüggő lemez-I/O-t.
Ez a teszt a többi hosszú natív fixture-höz hasonlóan explicit 15 másodperces
végrehajtási keretet kapott. A 24 ablak, 96 terminális rekord, valamennyi
állítás és a termékoldali véges wall/megfigyelési deadline-kapu megmaradt;
az 5 másodperc nem termékoldali teljesítménykövetelmény.

Végleges teljes `bun run verify:full` / `bun run check`:
**1789 pass / 0 fail / 0 skip**, exit 0, root/engine/webclient TypeScript és
format PASS (`.local/verification/20261015-225320-750-full.log`). Az egynapos
fixture a végső futásban 1,17 másodperc alatt sikeresen végigért.

Élő engine, bot vagy benchmark nem indult, és `.canvas.tsx` nem készült.
