# SI-C07 – Külön natív eljárás-trial világ

**Aktuális,2026-10-31:** a három1.0.0 felhasználói jóváhagyás után
[publikálva](SI_C07_FOUNDER_PUBLICATION_RESULT.json), a közös katalógusban elérhető.
Az alábbi próbaterv és jóváhagyás előtti állapotok történeti bizonyítékok.

2026-10-30. A 3. baseline-csomag meglévő feltételének végrehajtása:
valódi útvonalas trial a már kész normál prepare/run/review/inspect úton.

## Futási terv

- Saját új `backups/si-c07-founder-trials-.../workspace`, sem meglévő világ,
  sem történeti eredmény nem resetelhető/adoptálható. A meglévő reduced trial
  másoló/bootstrap út változatlanul hash-köti a runtime-ot és packed contentet.
- Ugyanaz a négy trial-actor és finite food/GP; a kijelölt courier kezdeti,
  deklarált trial-pozíciója3280,3365, eszköze egy bronze pickaxe és hammer,
  olvasztási nyersanyaga két copper ore. Két tin az actual trialban keletkezik.
  Ez külön új fixture-digest, nem a C07 founder-javaslat módosítása.
- Külön0 treasury-s workshop Business, tényleges worker employment és natív
  Property-ownership. A furnace1 és anvil packed jelenléte bootstrapkor ellenőrzött;
  útvonalat csak az actual SDK/client futása igazolhat.
- Provider/autonomy/builder off,0 API-kérés/0 költség. A folyamatok saját
  loopback portokat, ideiglenes RSA/login-adatot kapnak; más szerver nem áll le.
- Előbb egyetlen tin run,90s teljes live-probe kerettel; native bootstrap90s.
  A végleges ón-trial gather60s; az eljárás120s limitje változatlan.
  A korábbi15s keret mért hibájának és a változtatásnak az indoka alább szerepel.
  Siker után két-két tin/smelt/repair run, legfeljebb480s live wall idővel.
  Minden bootstrap/start/run/stop/review fázis résznaplója folyamatosan kiíródik.
- Repairhez deklarált sérült trial-tool kell. Ez kizárólag saját, leállított,
  paused trial-világban, meglévő owned instance/revision ellenőrzéssel állítható elő;
  külön natív audit rögzíti, `qualifiesMinimum:false`. Nem Mining- vagy warmup-credit,
  nem új eszköz, nem inventory/bank refill. A két olvasztott bar fogy el a két repairben.
- Gateway quiescence→engine save/stop→paused clock. Forced stop vagy unresolved
  admission esetén nincs vak ismétlés vagy jóváhagyható eredmény. Minden hiba megmarad.
- A végén két független, teljes run/admission, canonical native source, tartós
  review és readonly újranyitás szükséges eljárásonként. Publikálás továbbra külön
  konkrét emberi review; a hosszú C07 próba és SI-M3/MVS nem indul ettől.

## Érintett komponens

Trial fixture-builder, új-stage-only natív tool/workshop opening, és saját
processzeket birtokló bounded trial runner. A minimumképlet, eredeti genesis,
clock/transaction alap és normál verified jogosultság nem változik.
Rollback: saját unpublished stage eldobható; publikált trial/evidence megőrzendő,
normál világot ezzel az eszközzel visszaállítani vagy feltölteni nem lehet.

## Valódi próba és feltárt hibák

Külön trial-stage készült; a következő világok nem C07 baseline-ok.
Az eredeti founder-jelölt és minimum nem változott.

- `backups/si-c07-founder-trials-20261030/workspace`: tényleges packed furnace/anvil,
  workshop/worker/property és natív owned tool opening. Első SDK-futás
  `51879958-1625-4401-89c6-99d6a03333f8` FAIL. A középre célzó útvonal
  a blokkolt kőnél idegen ajtót próbált; a readonly reconciliation szerint
  cancelled intent, nulla dispatch/kitermelés, durability100. Bizonyíték:
  `.local/verification/founder-a-reconciliation.json`; a világ és failed run megmarad.
- `backups/si-c07-founder-trials-20261030-b/workspace`: javított megközelítés,
  első run `186e4529-fb10-497f-a985-ed6c4a2fb635` FAIL47,225s teljes körben.
  Egy exact dispatch indult a75. ticken; a packed `p_oploc` folytatások új,
  kötetlen action ID-t kaptak. A demand a93. ticken cancelled, a99. ticken
  kötetlen late ore és100→99 wear keletkezett. Nem elfogadható siker és nem
  trial-credit; a failed run és `.local/verification/founder-b-native-diagnostic.json`
  megmarad. Nincs automatikus újrafuttatás vagy receipt-átcímkézés.
- `backups/si-c07-founder-trials-20261030-c/workspace`: run
  `8c751dff-9869-45eb-b542-23701688d5e5` FAIL43,612s. A valós
  command→processPlayers sorrend ugyanabban a tickben kétszer készít admissiont;
  a közben változó wall/simulation timestamp strict ledger-conflictet okozott.
  A természetes teszt korábban rögtön következő tickre lépett. A valós sorrend
  külön reprodukciója `212520-340` FAIL, majd `212614-620` PASS6,516s,
  öt natív eset +wrapper és hét változatlan strict ledger eset. Egy action
  azonos tick/revisionbeli első admission-időpontját a script folytatása viszi
  tovább; expiry továbbra az aktuális órával ellenőrzött. Nem óra- vagy sémaátírás,
  az audit append konfliktus-/immutability-ellenőrzése változatlan.

A javítás szomszédos mezőn pontos megérkezést kér a Mininghez, az eredetileg
kiválasztott követ tartja meg. A natív `p_oploc` csak saját exact target/op
folytatására adja át a dispatch ID-t; clear/replacement ezt törli. Minden
script-folytatás újraellenőrzi a pending intentet, az eredeti lejáratot és az
aktuális source cancellation/authorityt. Késleltetett output sem készülhet
cancelled/expired műveletből. A normál nyers kérés nem örökli a provenanciát.

A korábbi natív teszt közvetlenül a sikeres dobás tickjére állt, ezért ezt
a természetes tick-folytatást nem fedte le. Most öt külön natív eset vizsgálja
a valós packed `p_oploc`/`p_delay` utat, queued/suspended cancellationt,
expiryt és raw same-target replacementet. Nem seedelünk RNG-t az élő világban.
Az A–D próbák15s gather és120s eljáráslimittel futottak.

Az igazolt same-tick javítás új forrásmásolata:
`backups/si-c07-founder-trials-20261030-d/workspace`.
Input source digest `071a605bd7ae551784e48c32af7c38d9a1996dbe1fdd7ec140778541e98d7247`,
staged manifest `854375e2b5abee41520ac65f9c4c7fe0584914fbc86890e41e5c4a14b05cd3a0`.
Ezek dirty forrás/packed fájlok ellenőrzött hash-ei; a `sourceCommit` önmagában
nem azonosítja a javításokat. A trial-fixture világazonosítója determinisztikus,
ezért az egyes próbák közt workspace/manifest/tool opening kötést is meg kell őrizni.
Első tényleges run `c0e062e4-8ec3-48ec-87f0-54046dfbe2ef` PASS:
nem seedelt, Mining1, normál SDK/Lite út,2 művelet13,026s;
teljes startup/pathfinding/run/stop kör40,146s (`212735-304`).
A két-két eljárás összesített futása és a három tartós review külön bizonyítékot igényel.

A D-világ második ón-runja `910456d3-7f2c-4c38-9636-00f44e37e773`
FAIL (`212826-950`,41,952s teljes kör). A sikeres első run13,026s-ja után
a második15s deadline-ot ért; script-hiba nem volt. A packed
`mine.dbrow` tin128/400 és a `STAT_RANDOM` képlet Mining1-en129/256 esélyt
ad, gem side-roll nélkül; a bronze pickaxe `mining_rate=7`600ms-os ticknél
4,2s/dobás. Ebből legfeljebb három dobás is kb.12% teljes sikertelenséget
jelent15s alatt, a megközelítés/HTTP idejét még nem levonva. Ez működő
natív út mellett sem megfelelő trial-keret.

**Indokolt tervkorrekció:** kizárólag az exact ón-draft gather-kerete60s;
a normál Mining default15s és az egész eljárás120s marad. Ez névleg13–14 dobás
és kb.0,006–0,012% sikertelenség, nem sikerígéret vagy seeded RNG.
Az exact trial-grant csak az új60000ms alakot fogadja el;15000/60001 elutasított.
Új checksumhoz új E-forrásmásolat és új két run kell. A régi siker/failure
nem címkézhető át új definition bizonyítékává. `213031-305`:17 PASS7,375s,
trial admission/gather, prepare és tényleges native tin review fogyasztók.

Az E-világ új60s draftján mindkét ón-run sikeres: `3b80a7c8-48ac-457e-8203-5908dad89a98`
és `5486eda6-ea8b-487a-9e11-7ee6474688d6`. Az első teljes kör42,862s,
a második tényleges eljárás56,801s. Utóbbi nem igazolja a névleges dobásritmust;
a közös clock/content arány validálása az eredeti4. csomag feladata marad.
Az összesített kör `213234-581` FAIL158,563s: a smelt-run
`8cea2245-a38b-4335-9953-4677d4df4a15` ténylegesen eljutott3225,3255-re,
majd a gateway `Native tool run/actor/policy binding differs` miatt leállt.
A population reader a natív hat tulajdonosi mező mellé profile/policy mezőket
is visszaadott, amelyeket a gateway tévesen az engine exact ownerjével vetett össze.
Az execute-határ most a hat natív custody mezőt választja ki; a natív actor,
lifecycle/world/clock és policy ellenőrzés változatlan. A failed smelt nem
ismételhető vakon: a már elindult natív munkát/escrowt külön vissza kell olvasni.

Másik bootstrap-hiba: két non-stackable copper ore két1-es slotból tér vissza.
A natív OfflineSaveSummary immár id/quantity összesítést ad; a roundtrip pontos
item-mennyiséget hasonlít, hiány/extra/idegen/érvénytelen tételt elutasít.
A generic genesis/reset save-összehasonlítás változatlanul szigorú.

## Célzott bizonyíték

- `20261030-205953-322-si-c07-p3-native-summary-contract`:12 PASS2,751s,
  tényleges save/reload és genesis adapter fogyasztó; utána bootstrap PASS33,844s.
- `211431-602-si-c07-p3-founder-stage-b`: külön natív stage PASS24,501s.
- `211422-966-si-c07-p3-reconcile-founder-a`: readonly failed-run reconciliation PASS0,757s.
- `211649-446-si-c07-p3-founder-b-native-diagnostic`: readonly late-output diagnózis PASS0,697s.
- `211858-970-si-c07-p3-mining-native-boundaries`:17 natív eset +3 wrapper,
  PASS18,322s; természetes folytatás, admission/cancel/replay/coverage és exact tin review.
- `212054-771-si-c07-p3-mining-neighbour-final`:26 PASS2,686s,
  exact neighbour arrival, target identity, abort és közvetlen gather fogyasztók.
- Root TS a runnerrel `212000-028` PASS84,734s; engine `212141-572`
  PASS66,199s. A root indítás első sandboxos próbája `211933-906` FAIL0,606s
  Bun `CouldntReadCurrentDirectory`; ugyanaz natív fájljogosultsággal futott.

Az első bootstrap-hibák megőrzöttek: `205305-523` CLR offline-probe indítás,
`205348-899` non-stackable roundtrip, `205728-282` per-slot summary szerződés.
Utóbbi kettő után szűk save/reload teszt és szerződésjavítás előzte meg az új
stage-et. Runtime-start diagnosztika: `210127-832`, `210254-340` hiányzó
ideiglenes public key; `210349-020` túl hosszú ideiglenes login-jelszó.
Mindkettő a saját runnerben javítva; kulcs/jelszó nem kerül verziókezelésbe.

## 2026-10-31 – Kész élő publikálási előnézet

Az F-világ: `backups/si-c07-founder-trials-20261031-f/workspace`.
Input source digest `ccd97a63779779d25a52dafa8e9bcf5560ec2d69d11de0b805e0185c44a443e6`,
stage manifest `a9c158b35a069c1536406ce87ada742d4b4ce4e9e5524fe3f7a24c5a94855f25`.
Új tool instance `251610d5-6f56-4a8c-86b5-174ed8e3c64b`; nincs E-állapot/
WIP/érc átmásolás vagy régi run átnevezés. E readonly reconciliation:
`20261031-011844-561` PASS0,737s; a hibás smelt paused, progress0/workTicks0,
az input escrow megmaradt. A failed run nem lett sikernek átminősítve.

`20261031-012020-892-si-c07-p3-founder-chain-f`: **6 valódi normál run +3 tartós
review PASS247,132s** teljes külső időben, az eredeti480s maximumon belül.
Valódi Lite klient, packed map, nem seedelt dobások, normál SDK/SkillExecutor,
valódi aktív population/Business/Property és exact acknowledged draft-grant.

- Tin:13,254s és11,130s, két source-bound output, ugyanazon tool100→99→98.
- Smelt:40,159s és1,938s; valódi út3225,3255-ig, két tényleges bronze bar,
  két input-escrow fogyasztás, egyenként120000 simulation ms/3 natív tick.
- Repair:55,166s és2,918s; valódi út3245,3404-ig, ugyanazon sérült instance,
  két bronze bar elfogyott, egyenként600000 simulation ms/6 natív tick.
  Két deklarált sérülési előfeltétel külön auditált, `qualifiesMinimum:false`.
  Zárás: használható durability50, revision7; nem virgin replacement/refill.

A natív work mind a négy nyugtája completed. Gateway quiescence→engine save/stop,
paused clock, ideiglenes kulcsok és saját dependency-junctionök eltávolítva.
A [verziózott review-előnézet](SI_C07_FOUNDER_TRIAL_RESULT.json) a teljes proposed
definitiont, exact draft-checksumot, hat run digestjét, három report/approval
digestet és a natív állapotot tartalmazza. Új readonly inspect után a canonical
DB file SHA azonos: `012454-521` PASS0,990s. A runtime diagnosztikával kiegészített
export `012618-466` PASS0,977s. Ez nem új review és nem verified-skill mentés.
[Rövid emberi jóváhagyási lap](SI_C07_FOUNDER_PUBLICATION_REVIEW.md).

Megőrzött runtime-diagnosztika: az utolsó repair közben egy `[timer,poison]`
protected script a meglévő `Worker is occupied by native tool work` guardon
elutasult. A repair és canonical effect sikerült; ezt az előnézet külön listázza,
nem állítunk tiszta hosszú gazdasági működést vagy validated clock-ratiot.

A két további, szűken reprodukált javítás:

- Gateway native owner: pontosan hat custody mező, population-extra mezők nélkül.
  `011705-097-si-c07-p3-tool-owner-boundary`:15 PASS13,575s, teljes négy
  smelt/repair run/review és közvetlen natív gateway/work fogyasztók.
- Belső `p_oploc`/`p_delay` nem új executor-ingress. Cohorttal egy ingress helyett9
  reprodukció: `011802-959` FAIL6,189s. A javítás a strict coverage/demand store
  megváltoztatása nélkül csak az első typed belépést figyeli. `011821-011`:
  29 natív eset +3 wrapper PASS17,939s; same-tick/cancel/expiry/cohort/source,
  legacy native tool/custody/trade/replay fogyasztók is.

**A trial lezárásakor a következő lépés konkrét emberi publication-approval volt** a három1.0.0 javaslatra.
A meglévő [admin-kapu](../../server/gateway/admin/routes.ts) követelménye:
„A publikáláshoz külön emberi jóváhagyás szükséges.” Ez az alkalmazás explicit
követelménye; a fejlesztési skill nem adott általános publication-jogot.
Nincs még FileSkillStore-save, új learned verified tudás vagy közös founder-stage.
Jóváhagyáskor ismét `readSkillTrialReview` kell az itt rögzített három digesthez.

A3. nagy csomag ettől még nyitott: publication után közös applied genesis,
four-slot overlay és mind4 housing/sleep út, native tool/worker/knowledge kell.
Nincs új P2-pont, a3–7. öt nagy csomag marad. Az eredeti minimum/policy/food/GP,
51 valódi warmup use és tényleges repair→reuse követelménye változatlan.
Provider0 kérés/0 költség; SI-C08, hosszú C07 run és SI-M3/MVS nem PASS.

Végső ellenőrzés: root TS a runnerrel `20261031-012509-794` PASS20,632s;
engine `012641-707` PASS17,783s. A runner kimerült keret utáni gyermekfolyamat-
takarításának apró őrfeltétel-javítása után csak root TS ismétlődött:
`013054-895` PASS18,135s. A sikeres, kereten belüli élő lánc nem ismétlődött.
`012728-719`:10 közvetlen preflight/baseline teszt +source/hash/link/formázás
PASS5,486s. **Nincs teljes regresszió:** az owned trial/bootstrap, SDK Mining,
exact native continuation és tool gateway módosult; közös adatbázisséma,
transaction/clock/economic alap vagy globális role/auth szabály nem változott.
A közvetlen fogyasztók és natív határok külön lefedettek.

## Jóváhagyás és tényleges publication

A felhasználó válasza2026-10-31: **„Jóváhagyom mindhárom publikálását”.**
Az engedély az eredeti `f9087161e5e7cb6d59bc152f296c0df5f9d281272c5dee5f28c6f5d6993e34a8`
előnézet három exact approval digestjére szólt; a történeti előnézet nem lett átírva.

Offline F-világ és új readonly review: `20261031-013919-506` PASS2,901s.
Ezután a meglévő F admin `POST /api/admin/skill-trials/:id/publish` handlerje
mindhárom approval digest +`confirmHumanApproval:true` mellett201-et adott:
`013953-522-si-c07-p3-approved-publication` PASS1,235s. Normál FileSkillStore
shared save, published trial, verified gap és három `skill-trial.publish` audit.
Az exact kiírt definíciók a közös verziózott `agent-skills/catalog/` alá kerültek.
[Teljes végrehajtási nyugta](SI_C07_FOUNDER_PUBLICATION_RESULT.json).

Nem volt új világindítás, providerhívás, új run vagy native SQLite módosítás;
a canonical native DB SHA a jóváhagyott előnézettel azonos. Az E paused WIP-je
és az összes korábbi sikertelen bizonyíték megmaradt.

A közös jelölt most `definition-ready`, definitionComplete true,0 procedure blocker;
installationImplemented false, selectedWorldId/baselineDigest null. A teljes C07
preflight továbbra NO-GO. `014110-017`:11 közvetlen baseline/preflight teszt és root TS
PASS23,960s; draft-only katalógus másolatán a negatív kapu változatlanul zár.
Nem teljes regresszió, nem új engine-ellenőrzés; termékkód vagy közös séma nem változott.

Post-publication readback `014519-440` PASS0,773s: az összes approved/published/
catalog definition azonos, három published trial/verified gap és egy-egy normál
publish audit van. A teljes auditlánc valid; entry/head hashek a nyugtában.
Az eredeti előnézet és hat run/report változatlan, native DB SHA azonos, clock paused.
`014358-451`:friss definition-ready/specifikáció és teljes NO-GO preflight,
eredeti policy/P2/source SHA, link/formázás PASS2,105s.
