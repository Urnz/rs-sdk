# Társadalmi integráció – implementációs eredmények

## SI-B03 – Player-stratégia és tartós modellválasztás – 2026-10-23

**Kész; következő SI-B04, az még nem indult.**
[Szerződés, konzervatív preflight-lefedettség, migráció és ellenőrzési index](SI_B03_PLAYER_STRATEGY.md).
Legfeljebb 12, saját megfigyelésből és exact reviewed Skill[]/grantből
összeállított resource/acquisition/work lehetőség. A modell ID-t választ;
nem írhat hozzá eszközt, paramétert vagy authorityt. Az egyéni preferencia,
igény, költség és kockázat bounded contextben szerepel. A chat kimarad a
stratégiai trusted contextből; az eseményszöveg untrusted adat.

AgentState v27: saját stratégia-receipt. Trigger/context/policy, validated
model choice, parent revision, proposal, adott goal és run összekötött;
replay nem hív újra providert és nem indít még egy taskot. Tartós 60 s-os
cooldown, zero-option wait és tényleges procedure-hiányra idempotens gap.
Input pótlása után a régi skill friss precondition alapján újra választható.
Inference közben megváltozott source/grant/lease-owner vagy halál fail-closed.

`20261023-143925-685-si-b03-consumers-and-native`: **106 PASS / 1 új gateway
assertion FAIL**, 13,443 s. A javított közvetlen határok és natív SI-B02/B03:
`20261023-144305-800-si-b03-final-runtime-types`, **32 PASS + root/engine TS +
format**, 37,017 s. Utolsó lease/death védelmi pontosítás után:
`20261023-144529-990-si-b03-lease-state-final`, **29 PASS + root/engine TS +
format**, 36,875 s. A sikeres változatlan fogyasztók nem futottak mind újra;
a számsorok átfednek, a korábbi FAIL-ek logjai megmaradnak.

Két controlled executor út és valódi ended employment→gateway→model→dispatch
igazolt. A külön SDK/packed engine próba a modell által választott native
gather raw outputját és későbbi főzés/state-teljesülést igazolja; a második
shop opció ott preflight fixture, nem natív vásárlási bizonylat.
**Full nem futott**; élő világ/provider, új publication és SI-B06/SI-M1/SI-M2
autonóm eredmény nem következik ezekből a mechanikai próbákból.

## SI-B02 – Állapotcél és korlátos tervelfogadás – 2026-10-23

**Kész; következő SI-B03, az még nem indult.**
[Szerződés, migráció/rollback, teljes ellenőrzési index és korlátok](SI_B02_STATE_GOALS.md).
Natív food/cash/hunger predikátum, achieve/maintain horizon és explicit
admin/server objective; a legacy run-goal változatlan. Új immediate terv
csak a meglévő current objective, parent revision, learned skill és pontos
grant/GP-envelope keretén belül fogadható el. Sikeres skill és elégtelen natív
állapot után újratervezés kérhető; a régi lépés cseréje nem hamis completion.
Self-care a következő lezárt skillhatáron előzheti a munkát.

Valódi model→adoption→dispatch→SDK→packed engine út igazolta: raw output és
skill exit 0 nem cooked-food tartalék; natív főzés után a predicate teljesül.
Proposal/adoption/dispatch/outcome/evaluation után öt külön child process
close/finally nélkül kilép; reopen/WAL és idempotencia PASS. Tranzakción
belüli hiba esetén a goal/event/adoption/GP-reservation együtt gördül vissza.

Közvetlen fogyasztók `20261023-140209-272`: 93 PASS / 1 fixture FAIL, 8,721 s;
javított gateway/natív határ `20261023-140312-092`: 2 PASS + root TS, az engine
importhatár még FAIL. A pure modulkiemelés után `20261023-140640-900`: 31 PASS /
1 új HTTP-fixture státusz-elvárás FAIL, 4,514 s. Végső javított admin-route és
native eset `20261023-140703-390-si-b02-admin-native-types-final`: **2 PASS +
root TS + engine TS + format PASS, 31,186 s**. A számsorok átfednek; a korábbi
FAIL-ek megmaradnak. A hibás `./` nélküli Bun kijelölést is rögzíti a jelentés.

**Full nem futott:** saját additív goal/proposal komponens, célzott legacy/
consumer/határtesztek. Élő világ, fizetős provider és SI-B06 stratégiai
autonóm elfogadás nem indult; SI-M1/SI-M2 eredmény ebből nem következik.

## SI-A13 runner-diagnosztika és célzott ellenőrzési szabály – 2026-10-22

**A hibás közös SI-A13 wrapper-kapu javítva; mind a tíz belső próba célzottan
PASS. Ebben a munkában teljes regresszió nem futott.** SI-B02 nem indult.
[Részletes mérések és futtatási szerződés](SI_A13_RUNNER_DIAGNOSTICS.md).

Előbb változatlan 120 s-os külső limittel adtunk folyamatos pipe-továbbítást,
esetenkénti és copy/bootstrap/capture/restore/verify/cleanup időmérést.
`20261022-234138-335-si-a13-streaming-original-budget`: **13 PASS, 41,505 s**;
mind a tíz belső próba sikeres. A két eredményarchívum-próba 11,691 és 11,419 s,
a runtime-előkészítés 10 ms volt. A régi timeoutok pontos belső helye nem
visszaállítható, mert az akkori wrapper a teljes child-kimenetet visszatartotta.
Ez a mérés nem igazol visszamenőleg konkrét filesystem- vagy gazdasági hibát.

Utána a közös 120 s-os teszt helyét tíz külön névfilteres gateway-teszt vette át.
Közös manifest ellenőrzi a teljes, nem duplikált engine-regisztrációt; a kilenc
60 s-os és egy 5 s-os belső keret megmaradt. A processz/takarítás overheadje
külön, korlátos; watchdog/pipe-hiba esetén saját child kill+await és elkülönített
temp-cleanup történik. A shared helper már futás közben továbbítja a résznaplót.

`20261022-234648-617-si-a13-isolated-cases-and-runner`: **34 PASS, 99,950 s**:
tíz engine + tíz gateway-eset, öt runner-hibapróba, másik helper-fogyasztóként
nyolc native travel fare + egy wrapper. A tíz engine body változatlanul **90
assertiont** teljesített. Az új processzelrendezés/host I/O más; ebből nem
állítunk gyorsulást. A két eredményarchívum-próba itt 22,110 és 30,723 s volt.

Az érintett root TS sikeres a `20261022-234847-465-si-a13-affected-types-format`
körben; a teljes parancs az új időmérő generikus típusának engine hibája miatt
FAIL (**142,857 s**). A csak típusannotációt érintő javítás után kizárólag a
hibás engine TS és a format ismétlődött: `20261022-235222-734-si-a13-engine-types-final`,
**PASS, 41,116 s**. A sikeres natív és root köröket nem ismételtük.

Az SI-B01 korábbi full-döntése túl tág „közös perzisztencia” értelmezés volt.
`AGENTS.override.md`, a repo-local society skill és a
[verification policy](VERIFICATION_POLICY.md) pontosítva: komponens-tesztfájlok
és megváltozott fogyasztók az alap; saját additív tábla, közös DB/user_version,
lokális tesztbontás vagy taskzárás nem automatikus full-trigger. Full előtt
konkrét közös invariáns, fogyasztók, a célzott kör elégtelensége és mért költség
kell. Megszakadt full független maradékát sem futtatjuk automatikusan végig.

Ág: `codex/si-a13-native-test-diagnostics`; gazdasági authority, migration,
óra, receipt, játékmenet és globális tesztkonfiguráció nem változott.
A régi full FAIL történeti eredmény marad, új teljes-suite PASS nincs állítva.
Résznaplók/result JSON-ok és a két futás gépi összevetése:
`.local/verification/`, `si-a13-native-timings.json`.
DEV-I01 archívum-I/O optimalizálás továbbra külön nyitott munka.

## SI-B01 – observer-kontextus és tartós natív ébresztés – 2026-10-22

**SI-B01 kész, következő SI-B02.** SI-B02–SI-B06 implementációja nem indult.
[Részletes szerződés, migráció és rollback](SI_B01_OBSERVER_CONTEXT.md).
Ez context/admission U/I lezárás, nem önálló LLM-stratégia, SI-B06 E2E vagy
gazdasági/önfenntartási PASS. Az SI-A15 elfogadott technikai kapuja megmarad;
az eredeti D1/SI-M1 outcome nem lett utólag PASS.

### Változás és bizonyíték

- Natív/domain employment megszűnése → observer-specifikus readonly source →
  tartós inbox → friss context → scripted döntési callback. Külön valódi domain
  recovery próba is igazolja az egyszeri ébresztést; nincs második legacy
  ended-employment esemény. A tényleges gateway replan lease nélkül elutasít;
  a meglévő költség-/policy-/authorization kapuk megmaradnak.
- `si-b01.v1`: saját jövedelemforrás/bérfeltétel, observed cash és ismert rentre
  számított részleges runway, needs, saját munkakérés, ismert ajánlat/szerződés;
  stock/partner/treasury csak a kötött intézményi subjectnek. Magán peer-inventory
  nem forrás. Pending contract resolution cancelling/defaulting marad.
- Native needs exact clock head; gap/stale/future unknown. Az örökölt asset és
  operational pénzsorok sem minősítik frissnek a lejárt/jövőbeli megfigyelést.
  A snapshot account/avatar kötése és a hiányzó név fail-closed, nem TypeError.
  A friss asset-fixture rögzített `now`-t használ; a pénz-, tulajdon- és
  adósság-assertionjei megmaradtak, az új próba a stale unknown ágat igazolja.
- Additív inbox schema 3→4: cursor, latch, pending, cooldown és admission ID egy
  SQLite-tranzakció. Hiba esetén esemény és cursor együtt rollbackel; reopen
  nem duplikál. Source cursor regresszió/eltérő payload tiltott. A sok egyidejű
  ok egy, korlátos méretű értesítés; offer/work a meglévő domain wakeupot használja.
- Ág: `codex/si-b01-observer-context`. Korábbi munkafa megőrizve; commit/push,
  élő világindítás, valódi providerköltség vagy világparaméter-hangolás nem történt.
  Fő kód: `agent-state/economic-context.ts`, `context.ts`, gateway
  `economic-observer-source.ts`, `replan-inbox.ts`, `domain-event-recovery.ts`,
  `agent-state.ts`, `admin-decision-context.ts`, `replan-runtime.ts`, `gateway.ts`.

### Ellenőrzési scope és eredmény

A közös inbox perzisztenciasémája miatt egyszer teljes `verify:full` futott,
meglévő readonly helyi packed-cache helperrel. **Nem lett teljes-suite PASS.**
A további context/guard finomítások a közös sémát nem változtatták; ezekre az
érintett modulok, határok és root TS ismétlése futott, újabb teljes kör nem.
Az engine/webclient TS a teljes kör test előtti részében sikeres volt;
a későbbi gateway/domain változások érintett TS-projektje a root.

- `20261022-225140-936-si-b01-final-module-boundaries-types`: **PASS**, 200 teszt,
  root TS és format, **149,984 s**. Agent-state modul, observer/inbox/domain
  recovery, durable coordinator, replan runtime, needs és livelihood-source határ.
- `20261022-225837-334-si-b01-contract-boundary-final`: **PASS**, 19 teszt és root
  TS, **18,760 s**; pending contract context és valódi contract/recovery adapterek.
- `20261022-231023-979-si-b01-context-final-confirmation`: **PASS**, 18 teszt,
  root TS és format, **53,465 s**; végső frissességi/hiányos snapshot javítás,
  teljes admin agent-state/observer és asset határ. Az ezt megelőző szélesebb
  197 tesztből 196 sikeres volt; az egy hibás, régi snapshot-kezeléssel futó
  adminhatár itt újra sikeres. Runtime-kód ezután nem változott.
- `20261022-223247-306-full`: **FAIL**, **1636 PASS / 2 FAIL / 0 skip**,
  **1041,829 s**. Külső cache-wrapper:
  `20261022-223245-026-si-b01-full`, 1044,826 s; egymásba ágyazott idők.
  SI-A13 nagy bootstrap/restore 120 s timeout; standing purchase terms 5 s timeout,
  lejárt frissességi ablak/hiányzó routed food assertion. Az utóbbi a 200 tesztes
  célzott körben változatlan időlimittel PASS, 3458,25 ms.
- `20261022-225507-474-si-b01-bootstrap-timeout-diagnostic`: **FAIL**, az eredeti
  SI-A13 próba külön is 120 s timeout, **120,567 s**. Két drága bukás után kisebb
  diagnosztika következett, nem újabb nagy futás vagy időlimit-emelés.
- `20261022-225948-406-si-b01-native-prefix-and-remaining`: a változatlan valódi
  négyavatáros native genesis/seal/replay próba **PASS**, 1013,56 ms. Ezután az
  eredeti `check` el nem ért csomagjai az eredeti sorrendben futottak. Összesen
  **197 PASS / 1 FAIL**, **123,628 s**; a native fares metrics próba 5 s timeoutot
  ért el. Ez nem SI-B01 observer-hiba, és nem lett sikeresnek átminősítve.
- `20261022-230230-391-si-b01-fare-diagnostic-and-remaining`: **PASS**, **520 teszt**,
  **215,125 s**. Az eredeti viteldíjpróba külön sikeres, majd a teljes eredeti
  parancslánc minden további modulja lefutott. Ez nem írja át a full vagy a
  metrics modul korábbi FAIL-jét. A körök tesztszámai átfednek, nem összeadandók.

A teljes naplók és result JSON-ok `.local/verification/` alatt megmaradtak.
Korai hibák: Windows sandbox rename/symlink és Bun cwd jogosultság; az első
TS-kör tranzakció-visszatérés típusa; hibásan összeállított új contract-fixture
(exact skill és az accept eredményének alakja); a frissességpróba régi dátuma
és a hiányos player-name kezelés. A javítások után az érintett határok sikeresek.
Sem assertiont, sem időlimitet nem gyengítettünk. A dokumentációs záróellenőrzés
a roadmap/mező/függőség/link/formázás mellett a módosított source SHA-256-okat
és a `si-b01.v1` policy referenciáját is a saját logjába írja.

**Maradó korlát:** a nagy SI-A13 bootstrap/restore timeout megoldatlan,
későbbi közös integration/release baseline előtt külön diagnosztikát igényel.
A kisebb natív prefix és az SI-B01 célzott bizonyítéka ezt nem helyettesíti.
Élő E2E SI-B06; valódi stratégiai döntés és költségpróba továbbra nincs.

## SI-A fejezetzárás pontosítása és tartós fejlesztési munkarend – 2026-10-22

**SI-A technikai fejezet lezárva, SI-B01 elkezdhető; SI-B még nem indult.**
A feladatlista eleje, SI-A15 vége és SI-B belépése ezt egyértelműen jelzi;
a korábbi nyitott státuszok és a v1 D1 protokoll történeti jelölést kaptak.
Az eredeti D1/SI-M1 túlélési/gazdasági PASS továbbra sincs állítva.

Repo-local skill: `.agents/skills/rs-society-development/SKILL.md`, kötelező
belépőút az `AGENTS.override.md`-ben. A [rövid átadás](SOCIETY_DEVELOPMENT_HANDOFF.md)
és [munkarend](SOCIETY_DEVELOPMENT_WORKFLOW.md) új chatben is visszaadja a döntéseket.
Az új `scripts/get-society-work-brief.ps1` a kijelölt/következő taskot és
korlátozott számú korábbi ellenőrzés fejlécét olvassa; nem indít világot,
nem nyit adatbázist, nem olvas teljes logot, és nem cache-el sikeres tesztet.
A funkcionális próbák a meglévő PowerShell-körbe is bekerültek.

Célzott végső kör: `20261022-213118-694-society-workflow-final-check`,
**PASS, exit 0, 2,757 s**: helper funkcionális próbák, hivatalos skill-validator,
roadmap 45 task/450 mező/138 függőség és helyi linkek, új fájlok formázása.
Az első körben a PowerShell syntax/wrapper/helper részlépések sikerültek,
az összesített parancs a hiányzó PyYAML miatt FAIL lett; a függőség csak az
ignorált `.local/verification/skill-validation-deps` alá került. A Bun
sandboxos munkakönyvtár-hibája után a célzott végső kör normál emelt wrapperrel futott.
A sikertelen naplók megmaradtak. Runtime/TypeScript/gazdasági adatmodell nem
változott, ezért teljes regresszió és új natív világfutás nem volt indokolt.

DEV-I01 külön nyitott toolingfeladat a munkarendben: változatlan runtime-csomag
és világállapot szétválasztása, mért I/O-költség és restore-kompatibilitás.
A másolási architektúra ebben a körben nem változott; arra gyorsulást nem állítunk.

## SI-A15 – Technikai igazolás lezárva – 2026-10-22

**SI-A15 technikai része kész; az eredeti D1/SI-M1 gazdasági vagy túlélési
PASS nincs állítva.** A [végső bizonyítékcsomag](SI_A15_TECHNICAL_RESULT.md)
elválasztja a 16 tényleges natív mechanikai kaput, a normál autonóm eredményt
és annak archiválását. A későbbi SI-C09 nem indult; a világ paraméterei,
az egy-/hétnapos éhségszabály és az egynapos adag változatlanok.

Végső autonóm run `a08a3a67-2fe3-4772-8943-d22c552124e3`: három játéknap,
61 minta, 0 observer-read hiba, négy önálló bootstrap-étkezés, 0 pending food,
három sikeres utazás, két natív hajódíj és három rent-active befejezés.
A három gather `food-no-output`; új alapanyag vagy autonóm termelési kör nem
jött létre. Hiány miatti bounded policy-karanténok megmaradtak; replan-runtime
hiba nincs rögzítve. A provider valódi adatbázisában 0 foglalás/kérés/költség.
Másfél napnál a tervezett normál restart után mind a négy valódi kliens
visszatért. A külön held-inputos native-kitchen eset az erősebb in-flight proof.

`20261022-165730-105-si-a15-final-three-day-autonomous-observation`, PASS, 915,005 s;
`20261022-171351-403-si-a15-final-normal-stop-canonical-outcome-and-provider-audit`,
PASS, 1,043 s. A sikertelen régi delivery végső expiry/recovery állapota
failed/cancelled/unearned, 0 foglalás és változatlan 3740 GP:
`20261022-173816-640-si-a15-original-failed-delivery-normal-final-expiry`, PASS, 0,668 s.

Végső result-capture PASS, 608,330 s; normál restore a beépített native verify-jal
PASS, 1049,612 s. Exact jegyzőkönyv: [eredményarchívum](SI_A15_RESULT_ARCHIVE.md).
Manifest `498e6a79b08d5e8b68bf4a04997ee9a2535e5837543a8ba730b6beba992045ef`,
report `3791d96746ba81232c96469ff806a292ca2ab92910fb244977b234119886e792`.
A részleges natív mérés, az `inconclusive` teljes gazdasági minősítés és a
`not-established-by-archive` liveAcceptance megmaradt. Nincs utólag átírt PASS.

Ellenőrzési scope: az új gazdasági perzisztencia teljes regressziója PASS,
960,314 s; a későbbi behatárolt SDK-megérkezési javítás 17 célzott tesztje,
root TS és formázása PASS, 55,597 s, két valódi pontos kijutással.
Új alapozó kódváltozás nélkül a sikeres teljes kört nem ismételtük.
Az alábbi nyitott státuszok dátumozott történeti bejegyzések.

## SI-A15 – Teljes kontrollált natív étellánc és valódi in-flight restart – 2026-10-22 16:48

**SI-A15 nyitott; a friss autonóm eredmény és annak result-restore-ja hátravan.**
A [mechanikai jegyzőkönyv](SI_A15_CONTROLLED_NATIVE_PROOFS.md) új standard
utility-világában normál gather, 20 GP procurement, valódi held inputos
native waiting → teljes stack-stop → újraolvasás → egyszeri raw-return,
majd normál sikeres cook, 25 GP cook-bér, 40 GP sale és 2400 reliefet adó
consume igazolt. A külön normál kézbesítésért is 25 GP járt.
A pénzösszeg végig 3800 GP, a két canonical reward-checkpoint és az egyszeri
needs-alkalmazás újraolvasva. A négy- és nyolcdobásos sikertelen esetek,
a kezdeti bizonytalan CLI és annak explicit same-action egyeztetése is megmaradt.
Nincs újra sikeresre írt napló, RNG-állítás vagy rejtett készletpótlás.
Utolsó audit és rendezett stop:
`20261022-164734-013-si-a15-full-controlled-chain-canonical-wages-and-relief-audit`,
PASS, 1,232 s. Részletes ID-k, korlátok és a segédparancsok javításai a jegyzőkönyvben.

## SI-A15 – Natív mechanikai bizonyítékok – 2026-10-22 16:21

**SI-A15 nyitott.** A külön [kontrollált natív jegyzőkönyv](SI_A15_CONTROLLED_NATIVE_PROOFS.md)
őrzi az élő utazás, kétirányú díj, fizetett alvás, valódi logout/return,
fedezethiány és telt szoba bizonyítékait, valamint a megőrzött burnt,
no-output és kézbesítési kudarcot. A hét napot elért régi utility-világ
éhhalálait és az emiatt lezárt üzleti jogosultságot nem írjuk felül.

Az új pénzügyi perzisztencia miatt előírt teljes regresszió végül **PASS**:
`20261022-120530-305-si-a15-native-fare-and-profile-archives-full-retry`,
960,314 s; root/engine/webclient TS, formázás, fő csomag és 31 modulparancs.
A korábbi 872,690 s-os FAIL megmarad; a két profilos archive/restore teszt
külön, változatlan 60 s-os esetekre bontása után futott a sikeres kör.

A házból kijutásnál külön SDK-hiba volt: a végső lépés a kért 0/1 helyett
2 mező toleranciával zárult. A root javítást tényleges állapotfrissítések
és mozdulatlan ACK negatív esete teszteli; 17 PASS, root TS és formázás,
55,597 s. Két karakter valódi pontos kijutása is PASS, 30,815 s.
Ez behatárolt SDK-módosítás, ezért nem ismételtük a sikeres teljes kört.
Az új autonóm baseline és a hátralévő pozitív munkabérek/in-flight restart
továbbra is külön lezárási kapu; ezeket nem utaljuk SI-C09 kalibrációba.

## SI-A15 – Travel publication, negyedik diagnosztikai próba és natív díjnapló – 2026-10-22 12:03

A felhasználó külön jóváhagyása után a változatlan travel-jelölt normál
publication válasza **201**, a trial `published`. Audit:
`20261022-112744-478-si-a15-approved-travel-normal-publication`, PASS, 1,499 s.
Az új 1.3.0 fixture és technikai terve a jóváhagyott packetből készült;
mind az öt exact pin normál preflightja PASS. A publikációs próbastack
paused órával szabályosan leállt. A katalógus/fixture/terv határtesztjei:
`20261022-112949-800-si-a15-published-travel-catalog-fixture-boundaries`,
23 PASS, root TS és formázás PASS, 17,279 s.

Új, változatlan forrású diagnosztikai világ:
`backups/si-a15-technical-20261022-1131/workspace`, fixture
`2094c0b60bd99c4a416fb6e85d3f84d6bd7c1621cdc75a6ef1c6090050c1a92e`.
A négy eredeti natív állapot authenticated observe módban igazolt.
Run `5f7262cb-5337-4482-b333-47604ea53384`: három játéknap, 61 minta,
0 observer-read hiba, majd paused. Külön kanonikus végső audit:
`.local/verification/si-a15-fourth-technical-attempt-final.json`.
Önálló gather és egy 2400 reliefet adó étkezés, két rent, valamint
konyháig jutás igazolt; teljes autonóm lánc és in-flight restart nem.
A provider-budget valódi adatbázisában 0 kérés/költség; a hiányt nem nullának
feltételeztük. A stop és végső audit PASS, 1,156 s, a provider-audit PASS, 0,510 s.

A halász új utazási célja a meglévő egyedi életcéljával ütközött (`UNIQUE
constraint failed: agent_goal.agent_id`); a root most az eredeti aktív
gyökeret és a recurring supply ágat megőrizve illeszti be az utazási ágat.
A szakács és futár a housing keleti ágy/fióksoránál elakadt. A readonly
helyszíni megfigyelés alapján az út az északi ajtón át kapott megközelítést;
az új megközelítés élő próbája még szükséges. A régi világ nem kapott hotpatch-et,
karanténjai, függő intentjei és sikertelen útjai megmaradtak.

Új [natív hajódíjnapló](SI_A15_NATIVE_FARE_ACCOUNTING.md): a meglévő két
content-label 30 GP levonását a karakter checkpointjával és hash-láncos
bizonylattal egy tranzakcióba fogja. A readonly mérleg a bizonyított díjat
egyszer számolja outflow-ként; hiányzó/sérült díjforrást nem tekint nullának.
Új fixture-ben üres auditált head készül; régi díjak nem kerülnek visszatöltésre.
Az új séma migrációja/rollbackje a külön dokumentumban szerepel.

`20261022-114412-606-si-a15-fare-goal-and-entrance-boundaries`: 38 PASS,
root és engine TS, formázás PASS, 70,265 s. A wrapper/gyermek tesztszámok
összege nem egyedi tesztszám. A korábbi sikertelen teszt-előkészítések naplói
megmaradtak: engine import-sorrend, nem védett upstream inv-fixture,
hiányzó personality trait és az új köztes útvonalhoz tartozó késői állapot-mock
javult; termékbeli guard vagy gazdasági állítás nem gyengült.

Az új pénzügyi perzisztencia miatt teljes regresszió indult:
`20261022-114544-393-si-a15-native-fare-accounting-and-route-goals-full`,
**FAIL**, 872,690 s. A root fő csomagban 1440 PASS / 1 FAIL; a két profil
együttes archive/restore tesztje 62,242 s alatt túllépte a közös 60 s-os
keretet. A további modulcsomagok emiatt nem futottak ebben a körben.
A két független profil most külön teszteset, változatlan állításokkal,
egyenként változatlan 60 s korláttal. Célzott ismétlés:
`20261022-120236-410-si-a15-both-profile-archive-independent-boundaries`,
10 natív eset + wrapper PASS, formázás PASS, 43,169 s.
A teljes újraellenőrzés és a natív díj/új housing-megközelítés élő próbája
még hátravan. Az SI-A15 nyitott; ezek nem SI-C09 kalibrációs kérdések.

## SI-A15 – Végső közös napkeret-ellenőrzés és aktuális review-packet – 2026-10-22 11:14

Az új travel-profil előzetes 180 GP/day korlátja a valódi közös döntési
naplóban a korábban kifizetett 500 GP-s renttel együtt számítana, ezért
hibásan blokkolná a következő 30 GP-s utat. A profil most a meglévő actor-
napkerethez igazodik: 700 GP összes operatív költés, továbbra is 30 GP/run
utazási plafon. Nincs külön utazási pénz, emelt actor-budget vagy világparaméter.
A nap az ISO döntési idő UTC dátuma; a kontrollprofil egyedi limitje továbbra
is érvényes. A valódi AgentStateStore-ledger teszt 500 GP rent után sikeresen
foglal 30 GP utazást; nem mockolt összeg vagy könyvelési implementáció másolata.

`20261022-111313-832-si-a15-travel-rent-budget-final-boundary`: **8 PASS**,
root TypeScript és formázás PASS, 30,528 s. A legutóbbi teljes PASS az előző
profilérték állapotához tartozik; e korlátozott fixture-paraméter és teszt
utáni végső kör célzott. Közös ledger/DB/auth-alap nem változott, új teljes
regresszió ezért nem indult.

Az aktuális immutable emberi review-csomag:
`.local/verification/si-a15-travel-publication-review-1792660408043.json`,
SHA-256 `4057eea102b8c1e35870542ce74e22eca4cee2e1b81b07e15864071615c8ebe8`.
A korábbi `43616d…` csomag történeti, erre már nem kérünk jóváhagyást.
A candidate definition, a normál verifier és approval digest változatlan;
az új packet az autonóm profil korrekcióját és a trialtól külön kezelt
profilforrás-digestet is tartalmazza. A [review dokumentum](SI_A15_TRAVEL_PUBLICATION_REVIEW.md)
az aktuális csomagot mutatja. **SI-A15 és az új travel publication nyitott.**

## SI-A15 – Normál travel-verifikáció és teljes regresszió PASS – 2026-10-22 11:08

**SI-A15 nyitott; az új travel képesség külön emberi publikációs jóváhagyásra kész.**
[Exact review-csomag, bizonyítékok és keretek](SI_A15_TRAVEL_PUBLICATION_REVIEW.md).
A korábban jóváhagyott három food skill változatlanul publikált.

A friss, elkülönített utility világ a factory által visszaadott pontos helyen:
`backups/si-a15-travel-trials-20261022-0144/workspace/workspace`.
A published-food trial factory PASS (`20261022-105322-760-si-a15-fresh-utility-trial-offline-retry`,
18,911 s). Nincs autonomy enrollment, kézi autonóm cél, integration-receipt vagy
integration-seal; a normál trial backend az új travel draftot vizsgálta.
Trial `2501e090-1f45-4d7b-939b-42d3077aec03`; normál független runok
`b31662cd-6268-4a66-957c-00763f097f60` és `afd78151-8ef9-4e3d-8023-a8e3b7445453`,
köztük tényleges visszaút `249ac435-dba8-4e09-af69-f3d35e86aa2e`.
Verifier `802507a6-5012-4eaa-8fda-a8ae912643b9`, minden check PASS;
`20261022-110040-398-si-a15-normal-backend-travel-verification`, 0,748 s.

A javított nyugati konyha→housing út most már további kézi reposition nélkül
is végigfutott: `0d4d5071-c0ba-4b96-b2cc-9eba17575c8c`, 170,451 s,
köztes út, normál vám/párbeszéd, 30 GP megfigyelt díj, gangplank és exact
2972,3331,0 megérkezés. `20261022-110044-209-si-a15-corrected-west-kitchen-to-housing-live`.
A CLI-journal ezt is SDK-megfigyelésnek jelöli; nem kanonikus gazdasági receipt.

**Teljes regresszió PASS**, végig változatlan runtime- és tesztforrásból:
`20261022-105415-204-si-a15-final-travel-and-fixture-full`, 809,889 s.
Belső teljes `bun run check`: `20261022-105416-075-full`, 808,672 s;
format, root/engine/webclient TS, fő tesztcsomag és minden külön modulcsomag.
Wrapper/gyermek aggregáció 2336 PASS / 0 FAIL / 0 skip; nem egyedi tesztszám.
A travel jogosultság-/GP-envelope és az integrációs baseline-kód módosítása
indokolta az új teljes kört. A korábbi sikertelen teljes kör megmaradt.

A köztes célzott körben egy staging-cleanup EBUSY/timeout és a 0 darabos
travel-grant konfigurációja hibázott. A staging teszt külön ismétlése
419,68 ms alatt PASS; a profil szabályos 1-es mennyiséglimitet kapott
(a travel művelet nem vesz át tárgy-darabszámot). A teszt TS-optional
összehasonlítását is javítottuk. A végső teljes kör mindezeket lefedi.

A review immutable packet SHA-256:
`43616d4f0c7a2880819e8c71bb584ab877e134d003220ae8f3c42326a8e27054`;
approval digest `a39598180913cf38f38da543d4081dc58fedc7907a542b56c1fe691d623172f8`.
Proposed `1.3.0` fixture `2094c0b60bd99c4a416fb6e85d3f84d6bd7c1621cdc75a6ef1c6090050c1a92e`.
Még nem publikált, nincs új autonóm baseline vagy SI-A15 acceptance.
A teljes lánc/bérek, fizikai alvás/logout/return, negatív esetek, valódi
in-flight restart, végső restore és a hajódíjak kanonikus elszámolása
továbbra is mérnöki kapuk; nem SI-C09 kalibrációs munka.

A trial világóra paused, a runtime rendezett stopja PASS, 1,521 s.
A külön trial folytatási fiókja normál createAccount/setRole jogosultság-
ellenőrzéssel és audittal, egy érvényes tényleges tulajdonosi sessionből
készült; csak ennek a disposable világnak tulajdonosa. Jelszava OS-vaultban,
későbbi normál login megújítható, az eredeti fiók/session nem lett resetelve.
Nincs auth-megkerülés vagy jelszó/session kitolás, és nincs publication-jóváírás.

## SI-A15 – Hat sikeres útvonalpróba és verziózott utazási képesség – 2026-10-22

A külön trial világban mindhárom célhoz két sikeres, attribuált normál
skill-CLI futás gyűlt össze. A paraméterenkénti verifier-jelentések PASS;
csomag `.local/verification/si-a15-travel-live-evidence-1792626696247.json`,
SHA-256 `1fa531ac376180b26fa3b91ff99e627b2f246a0276f38eaa2fec1ccd582ad6ca`.
Konyha: `0b128a08-5ee0-4f72-9a6b-70fb53f0d756`, `e7c358b7-9cc9-4eed-8738-c651e1825601`;
móló: `e3c92303-b159-438c-bdfa-2f66730ace93`, `85c82990-a683-48cc-9f25-1cfac77caba5`;
housing: `59b1b990-6415-496c-99be-9f2942c9500b`, `b39ad43f-0b95-4d2b-8c9b-1b86ff4239a8`.
Mindkét hajóirány valóban bejárt, 30 GP megfigyelt díjjal. Az SDK megfigyelés
nem kanonikus pénzügyi sink-receipt; a teljes gazdasági acceptance ezt külön
nem tekintheti megoldottnak. A szakács utolsó sikere előtt külön normál séta
vitte ki a nyugati elakadásból az útra; ez nem önálló route-javítási bizonyíték.
A root route ezután megkapta ugyanezt a korlátozott köztes útszakaszt.

A `1.3.0` új fixture-típus az ötödik exact skill-pint és minden actor route-
knowledge-ét kezeli; az `1.2.0` és korábbi állapotok értelmezése megmaradt.
A runtime csak explicit travel-granttel engedi a három helyszínt, 30 GP/run,
180 GP/day felső határral. Nincs újrahangolt hunger, fatigue, induló pénz,
készlet vagy földrajz. Production create továbbra is valódi publikációt kér.
Új, végrehajtható travel fixture még nincs publikálva vagy elfogadva.

Migráció: nincs új DB-séma vagy meglévő világfrissítés; csak új fixture-verzió
és új világ használhatja az ötödik pint. Rollback: az új világ rendezett stopja,
majd a korábban megőrzött baseline/result külön könyvtáras visszaállítása;
folyamatban lévő journal, állomány vagy publication nem törlendő/írható át.
A friss utility-trial már megtarthatja a normál resolverrel ellenőrzött food
verziókat. Az elavult food-draft továbbra is tiltott, és trial világ nem kap
autonomy enrollmentet, integration-receiptet vagy natív integration-sealt.

Az új teljes kör `20261022-014402-713-si-a15-native-travel-authorization-full`
580,237 s után **FAIL**: 1436 root PASS, egy elavult draftlista-elvárás FAIL.
A teszt nem számolt az új travel-drafttal; az elvárás javítva. Format és mindhárom
TS-projekt a root csomag előtt sikerült. A további modulcsomagok ebben a
megszakadt teljes láncban nem futottak; ez nem teljes-suite PASS.
Új teljes kör a javítások utáni változatlan forrásból szükséges.

## SI-A15 – Harmadik autonóm próba, rendezett commerce és utazási draft – 2026-10-22 01:43

**Nyitott.** A harmadik sealed baseline (`backups/si-a15-technical-20261022-0058/workspace`)
megfigyelése befejeződött: run `49491980-96b9-4d7b-92f2-814ef92c0299`,
61 minta, három játéknap, 909,330 s, nulla observer-read hiba.
Két önálló étkezés és két bérlet mellett az autonóm gather is valódi natív
eredményt adott: `34e4c6b0-1733-4590-816d-b16b5c4ba134`, egy raw lobster,
31 megmaradt véges forrásegység. Külön kanonikus újraellenőrzés:
`20261022-010912-762-si-a15-autonomous-gather-canonical-source`, 0,624 s.
Az óra paused; a normál runtime wrapperének pontos ideje
`20261022-010443-626-si-a15-source-diagnostic-runtime`: 1389,023 s.
Ez a runtime-élettartam, nem acceptance-idő. `liveAcceptance:false`;
natív in-flight restart továbbra sincs igazolva.

A távoli kereskedési kísérletet a natív motor helyesen elutasította,
de az intenthez 20 GP domainfoglalás és a szakács peer-lease-e beragadt.
Az új source-adapter a találkozóhelyet és a két avatar távolságát még
foglalás előtt ellenőrzi. A függő intent rendezése csak a motor serializált
cancel/execute útján, a terminális kanonikus natív eredményből történik;
egy HTTP ACK nem pénzügyi bizonyíték. A már megőrzött harmadik világban
ugyanezen explicit-world szolgáltatással végzett operator forward-recovery
valóban felszabadította a 20 GP-t és a kölcsönvett szakácsot. Az összes
natív inventory, business stock és treasury balance változatlan maradt.
Bizonyíték: `20261022-012359-598-si-a15-real-explicit-world-native-cancellation`,
0,848 s; `.local/verification/si-a15-real-unadmitted-commerce-recovery.json`.
Az eredeti journal és karantén megmaradt; ez nem autonóm sikernek átírt futás.

Új, még **draft** képesség: `procedure.travel.native-sites@0.1.0`.
Rögzített natív célok: Brimhaven-konyha, Musa Point-móló, faladori ágyak;
legfeljebb egy normál 30 GP-s hajóút, exact site és külön runtime-grant.
Az autonóm adapter csak meglévő skill-knowledge, munkaviszony, beszerzési
igény vagy fizetett bérlet alapján választ útvonalat. A default rutin-grant
nem engedi az új műveletet; a run/day GP-envelope számolja a lehetséges díjat.
Sikertelen/megakasztott utazás SDK-journalja önmagában nem zár le gazdasági
bizonyítékot és nem indíthat automatikusan új utat ugyanarra az intentre.

Külön disposable trial: két tényleges móló→konyha út és egy visszaút sikeres
(első két run: `0b128a08-5ee0-4f72-9a6b-70fb53f0d756`,
`e3c92303-b159-438c-bdfa-2f66730ace93`). A szárazföldre hajózás és pontos
30 GP díj is megfigyelt; a housing-próba `4cf0b88d-b323-492d-b082-14f7b4189352`
sikertelen journal maradt. A séta válasza a cél előtt két mezővel megakadt,
de az utána külön olvasott állapot már a pontos célt mutatta. A javítás
három másodpercig csak figyeli a megérkezést; sem ACK, sem timeout nem siker.
Új sikeres live housing-próbák és normál publication-review még szükségesek.

Célzott végső kör: `20261022-014208-906-si-a15-travel-recovery-final-focused`,
44 PASS, root TypeScript és formázás PASS, 21,449 s. Érintett: travel runtime,
food/travel draft-admission, forrásadapter, GP-envelope, failure binding és
LLM-config. A korábbi teljes regresszió a lenti változatlan forrásállapoté;
az új utazási kiegészítést nem minősíti utólag teljes-suite PASS-nak.

## SI-A15 – Publikáció, két autonóm próba és tényleges result-restore – 2026-10-22

**Teljes regresszió PASS**, változatlan runtime-/tesztforrásból:
`20261022-003906-617-si-a15-stable-source-foundations-full`, 1036,890 s.
A teljes `verify:full` lánc format, root/engine/webclient typecheck,
fő tesztcsomag és minden külön modulcsomag ellenőrzését tartalmazta.
A beágyazott wrapper/gyermek tesztszámok nem egyedi tesztszámként értendők.
A közös clock/persistence és a tesztfelderítés módosítása indokolta a teljes kört.
Mindkét tényleges autonóm világ kanonikus provider-budget táblája is kiolvasva:
`20261022-005321-651-si-a15-both-autonomous-provider-ledgers`, 0,674 s;
mindkettőben 0 reservation, 0 provider request ID, 0 actual cost, provider disabled.

Legújabb célzott kör: `20261022-003834-427-si-a15-latest-native-and-needs-boundaries`,
61 PASS, root/engine TypeScript PASS, 95,955 s. A publikált gather normál
CLI-futása a tényleges mólón sikeres:
`ca53b119-7ba5-4e92-a323-9436148e4f77`,
`20261022-004241-035-si-a15-normal-published-skill-cli-diagnostic`, 22,071 s.
A kanonikus forrás külön újraellenőrzése:
`20261022-004401-797-si-a15-published-cli-canonical-source`, 0,523 s.
Ez a külön trial világ natív bizonyítéka, nem autonóm integration acceptance.
Előtte a konyhánál indított próbát unreachable-source hiba blokkolta;
a visszasétálás első, túl szűk megérkezési toleranciájú próbája elakadt,
a tényleges mólóra vezető következő út sikerült. A köztes ismert no-output
és a lejárt operátori session miatti HTTP 401 is megőrzött eredmény;
a normál, bot-credentiallel hitelesített CLI nem módosított identityt/sessiont.

**A feladat nyitott.** A felhasználó külön jóváhagyása után mindhárom food
skill normál publication POST-ja 201 választ adott. A változatlan exact
`1.0.0` definíciók a reviewed katalógusban vannak; gather 8, cook és consume
2–2 független sikeres natív run. A sikertelen dobások/burnt/no-use eredmények
nem lettek átírva. [Publikációs csomag](SI_A15_FOOD_PUBLICATION_REVIEW.md).

Az első sealed production baseline
`backups/si-a15-technical-20261021-2004/workspace`. A normál autonóm próba
`e3019628-8637-4d82-8001-56c5c2a3ab97`: 61 minta, három játéknap,
15 perc 12,244 s, két `rent-active`, egy önálló natív fogyasztás,
`3411 → 1011`, pontosan 2400 relief. A stack tervezetten újraindult;
natív in-flight állapot akkor nem igazolt. A próba nem technikai PASS.

Az eredeti világ változatlan forrásával rendezett stop és paused záróhatár
után tényleges `capture-result` és új könyvtáras `restore-result` történt.
Capture: `20261021-202426-921-si-a15-first-technical-result-capture`,
329,265 s. Restore a verifierrel és kanonikus riport-újraolvasással:
`20261021-203022-878-si-a15-first-result-restore`, 631,228 s.
Bundle `backups/si-a15-technical-result-20261021-2024`, visszaállított világ
`backups/si-a15-technical-restored-20261021-2031/workspace`.
Manifest `5ac1a59ee6edff38a5190cc0cc5463f0b709607bf62e8b71d84d1baf740f4039`,
riport `1b223a323c6d497056b51750edb339728781fe802475a848fa37bfe36a6dac0a`.
Az archívum megőrzi a hiányos eredményt: `not-established-by-archive`.

A második sealed baseline
`backups/si-a15-technical-20261021-2030/workspace`; a clock-admission és
lease javításokkal a szereplők már nem ragadtak be tétlen running állapotba,
a konyha pedig `stock-input-required` várakozásban maradt. A megfigyelő első,
séma előtti readonly hibája megőrzött FAIL; explicit continuation után a
run `aec93467-1ab4-417d-a507-9dd6bb68ebd5` 50 mintát és három önálló
fogyasztást rögzített (`sicook`, `sicourier`, `silessor`). A megfigyelést
12 perc 39,967 s után SQLite lock szakította meg; a finally paused-ra állította
az órát. A 45 perces runtime később rendezetten leállt. Ez sem háromnapos PASS.

További root javítások, a már sealed világok módosítása nélkül:

- Admission időbélyeg a clock writer lock alatt; explicit történeti regresszió tiltott.
- Coordinatorhiba után csak a saját, tétlen lease szabadul fel; a durable intent megmarad.
- Due-listából korábban kölcsönzött peert a supervisor nem claimel újra.
- A konyha véges alapanyag-várakozása nem authority-hiba; készlet nélküli sale-ajánlat nincs.
- Atomi commerce-non-admission csak meglévő, ellenőrzött auditból bizonyítható.
- Első journal előtti readonly olvasás nem migrál; részleges séma továbbra is hiba.
- Kompakt terminal journalban a `food-uncertain` reason megmarad a besoroláskor.
- Sikertelen food process nem zárja le a bizonytalan natív intentet. Source-only
  egyeztetés történik, fizikai újraküldés nélkül. Auditált no-output sikertelen
  próbának számít, nem termelésnek és nem automatikus karanténnak.
- A food projection readonly kapcsolata az első lekérdezés előtt bounded busy-timeoutot kap.
- A Bun tesztparancsok explicit `./` útvonalakat használnak, így a mentett
  világok tesztmásolatai nem kerülnek bele a munkapéldány regressziójába.

Ellenőrzött részhatárok:

- `20261021-201434-208-si-a15-live-clock-admission-and-idle-lease`: 64 PASS,
  root typecheck, 48,319 s.
- `20261021-202311-435-si-a15-finite-quotes-and-peer-lease`: 40 PASS,
  root typecheck, 23,341 s.
- `20261021-203159-590-si-a15-readonly-initial-journal`: 18 PASS,
  root typecheck, 20,886 s.
- `20261021-203556-368-si-a15-uncertain-source-no-redispatch`: 37 PASS,
  root typecheck, 47,220 s.
- `20261021-203644-871-si-a15-real-failed-food-source-reconciliation`: két
  tényleges korábbi food-run kanonikus újraolvasása, nulla fizikai parancs,
  0,784 s. A no-output failed maradt, a bizonytalan kimenet pending maradt.
- `20261021-203908-440-si-a15-native-trial-catalog-and-recovery-final`:
  64 PASS, root/engine typecheck és format, 127,423 s.

A teljes regresszió `20261021-203022-187-full` hibás futás marad: 1422 root
PASS / 3 FAIL; a wrapper beágyazott teszteket is összesít, nem egyedi tesztszám.
A draft-trial izolált tesztkatalógusa javítva a valódi publikáció utáni
helyzethez; a másik két hibát futás közbeni forrásváltozás okozta (régi
modulcache/új teszt és a source hash ellenőrzés). A következő teljes futás
alatt a forráskód változatlan. Útvonal, teljes ellátási lánc, cook/delivery
bér, fizikai alvás, negatív mechanikák és valódi in-flight restart még hiányzik;
ezek nem kerülnek át az SI-C09 kalibrációs feladatba.

## SI-A15 – Valódi draft trial és runtime-javítások – 2026-10-21

A [normál runtime próbák jegyzőkönyve](SI_A15_LIVE_TRIALS.md) tartalmazza
az elkülönített próbavilágot, a tényleges packed helyszíneket, natív
run ID-ket és a megőrzött hibás kísérleteket. A gather két független,
forrásból újraellenőrzött sikerrel a normál verifierig eljutott. A futár
ténylegesen hajózott 30 GP-ért és elérte Brimhavent; két valódi, fizetett
felvásárlás, egy sikeres főzés, eladás és fogyasztás már megfigyelt.
Az első főzés megégett; a rossz fogyasztási slot `no-use`, nem siker.
**SI-A15 továbbra is nyitott**, a többi gate nincs automatikusan elfogadva.

Új opt-in fixture 1.2 natív helyszínprofillal, külön `create-food-trials`,
packed-site bootstrap guard és főzési draft 0.2. A readonly grant verifier
kiküszöböli a commerce saját writer lockjára váró manager-migrációját.
A livelihood a valódi exact skilltudást és a running kereskedő peert is
kezeli. Az engine a natív fishing előkészítést a pontos ticken folytatja;
elveszett előkészítés/sikertelen dobás tartós `food-no-output`.
Clock/needs/health forrásnyitás bounded lock-várással; az aktuális clock
megfigyelése writer-lock alatt időbélyegzett, a resume watermark-várás
nem talál ki új előrehaladást. Új domain séma és értékinjekció nincs.

Célzott ellenőrzések:

- `20261021-151647-134-si-a15-native-site-scope-fixed`: 48 PASS,
  root/engine TypeScript, 133,564 s.
- `20261021-151922-112-si-a15-actual-native-site-trial-world`: valódi
  packed-site/genesis trial provisioning PASS, 70,981 s.
- `20261021-153421-461-si-a15-atomic-clock-observation`: 47 PASS, 23,482 s.
- `20261021-154342-225-si-a15-gather-negative-recovery`: 18 PASS, 17,955 s.
- `20261021-155305-478-si-a15-readonly-source-contention`: 18 PASS, 2,823 s.
- `20261021-192240-968-si-a15-technical-plan-checked`: 32 PASS,
  root/engine TypeScript és format PASS, 85,184 s.
- `20261021-193026-474-si-a15-grant-and-skill-boundary-final`: 26 PASS,
  root TypeScript és format PASS, 23,506 s.

A fenti sikerek előtt bootstrap import/worker-leállási, útvonal-validációs,
SQLite-lock és új teszt/típusillesztési hibák is voltak. A teljes naplók
megmaradtak a `.local/verification` könyvtárban; a későbbi PASS nem írja át
őket. A shared persistence/clock és az integration baseline miatt kötelező
teljes regresszió `20261021-192305-370-full` néven lefutott: 1418 root
teszt PASS / 1 FAIL; a source katalógusteszt még csak egy cook draftot várt,
pedig a régi 0.1 és az új 0.2 is szándékosan megmarad. A teszt most mindkét
exact verzió jelenlétét ellenőrzi, produkciós viselkedés módosítása nélkül.
A külső wrapper `20261021-192304-452-si-a15-foundations-full`, 646,663 s;
format és root/engine/webclient typecheck PASS. A javított teljes tesztfájl
`20261021-193553-516-si-a15-updated-catalog-regression`: 18 PASS, 0,742 s.
Az összes kimaradt 31 parancs a package check láncából, ugyanazzal a helyi
packed cache-sel: `20261021-193540-569-si-a15-foundations-regression-tail`,
711 PASS / 0 FAIL, 146,221 s. A coverage-jegyzék
`si-a15-foundation-tail-coverage-1792604141168.json` rögzíti a package-hasht,
a tervezett és tényleges parancsokat. A full-FAIL megmarad; ez helyreállított
teljes ellenőrzési lefedettség, nem egyetlen full-PASS.

## SI-A15 – Result-archive és későbbi valósághű kalibráció – 2026-10-21

A felhasználó döntését a [technikai lezárás](SI_A15_TECHNICAL_CLOSURE.md)
és a későbbi [SI-C09 kalibráció](SOCIETY_REALISM_CALIBRATION.md) rögzíti.
Utóbbi célja a valós élet lényeges viszonyainak közelítése a részleges
szimulációban; nem a világ hozzáigazítása a jelenlegi karakterekhez.
A túlélési idő kimenet és diagnosztika, nem kizárólagos reward. Referenciák,
modellhiányok indokolt kompenzációja, időarányok, külön agentpolicy, több
kohorsz és bizonytalanság kerül a feladatba; optimizer/tanítás nem indult.

**A teljes élő SI-A15 továbbra is nyitott.** A most lezárt technikai részhatár
az [előrehaladt natív result-archive](SI_A15_RESULT_ARCHIVE.md): külön
capture/verify/restore protokoll, paused záróhatár, valódi DB-/riport-
újraolvasás más könyvtárban, genesis-provenance és változatlan source/cache.
A hiányos riport hiányos marad, az archívum nem ad élő acceptance-et.
Publication, valódi útvonal és normál izolált engine/gateway/autonomy futás
még bizonyítandó; ezeket nem toltuk át a kalibrációs feladatba.

- Első natív FAIL: `20261021-141328-386-si-a15-progressed-result-native`,
  6 PASS / 2 FAIL, 20,150 s. A teszt a már megfigyelt falióra helyett az
  eredeti szimulációs epochra próbált visszalépni; a clock helyesen tiltott.
- Második FAIL: `20261021-141431-910-si-a15-result-native-clock-fixed`,
  6 PASS / 2 FAIL, 13,515 s. Az admin DB-k WAL/SHM oldalfájljai kimaradtak
  az inventoryból. Az inventory javítva; lezárt archívum DB-jét a verifier
  eldobható saját másolatban nyitja, nem módosítja SHM-olvasással a payloadot.
- `20261021-141717-015-si-a15-result-native-immutable`: 8 PASS / 0 FAIL,
  57,514 s, root/engine typecheckkel. Mindkét napalapú profilban valódi packed
  fogyasztás, 2400 relief, result→új helyre restore→egyező natív riport.
- `20261021-141908-533-si-a15-result-native-guards`: 43 PASS / 0 FAIL,
  35,476 s. Genesis/result protokollkeverés, meglévő cél, writer, másolás
  alatti treasury-drift, újrahash-elt hamis riport és sérült payload elutasítva;
  a régi baseline- és teljes society-integration célzott tesztek is PASS.
- `20261021-142200-987-si-a15-closure-docs`: PASS, 0,509 s; 45 egyedi task,
  450 kötelező mező, 138 egyedi függőségi él, 75 létező helyi link/anchor,
  kör és előrefüggés nélkül. SI-C09 későbbi P2 ág, nem technikai előfeltétel.

Nincs domain-DB migráció vagy aktív világ átírása. Új result-protokoll,
új CLI-műveletek és a kísérőfájlok teljesebb baseline-inventoryja kerültek be.
Az új resultot új olvasó kezeli, a régi baseline-olvasó helyesen elutasítja;
hiba esetén nincs részleges publish. A full regresszió indoka a több
kanonikus adatbázist érintő archive/restore és a közös baseline-határ változása.

**A teljes ellenőrzési lefedettség helyreállítva, nem egyetlen full-PASS.**
Az első `20261021-142149-033-full` futás 613,848 s után FAIL:
1579 PASS / 1 FAIL / 0 skip. Egyetlen hiba a
`sdk/test/gateway-http-chat.test.ts` névtelen indító hookjának 5006 ms-os
timeoutja; a fájl 15 esete emiatt nem futott le, a `check` további moduljai
pedig még nem indultak. A fájl és a timeout változtatása nélkül a célzott
`20261021-143237-966-si-a15-sdk-chat-hook-retry` **15 PASS / 0 FAIL**,
15,468 s. A `package.json` tényleges `check` láncának valamennyi kimaradt
parancsa utána lefutott: `20261021-143438-850-si-a15-result-regression-tail`,
**709 PASS / 0 FAIL / 0 skip**, 140,134 s. A coverage-jegyzék
`si-a15-regression-tail-coverage-1792586218951.json` rögzíti a teljes tervezett
és végrehajtott maradék parancssort, package-hasht és exitkódokat.
Összesen **2303 sikeres ellenőrzés**; az eredeti full-FAIL megmarad.
Formázás és root/engine/webclient typecheck a teljes kísérletben PASS;
nem ismételtük meg a már sikeres teszteket a hook helyreállítása után.

## SI-A15 – Végleges napalapú túlélés – 2026-10-20

[Szabály, profilok, migráció/rollback és megmaradt D1 kapuk](SI_A15_DAY_SURVIVAL.md).
Egy nap után autonóm ételkeresés, hét nap teljes hiánynál végleges natív
éhhalál, egy adag egy napot pótol. Élő nap/óra; gyorsított nap/öt perc.
Azonos élettan és adag; a teszt nem etet ütemezésből. A korábbi scheduled-meal
javaslatot és új világokra az 1:1 korlátot a felhasználó döntése felváltotta.

- A Needs-admission és natív food-journal közös forrás: a még nem projektált
  tényleges fogyasztás is véd az indokolatlan haláltól; a no-use nem.
- A gateway recovery natív tesztje feltárta a természetes halálra korlátozott
  rekonstrukciót. Javítva a starvation envelope ellenőrzése, tartós terminal
  lifecycle és idempotens újraolvasás. A FAIL napló megmarad:
  `20261020-093937-752-survival-native` (6 PASS / 2 FAIL, 13,332 s).
- `20261020-093808-538-survival-policy`: 9 PASS / 0 FAIL, 57,259 s,
  benne engine typecheck; `20261020-094137-896-survival-native-recovery`:
  8 PASS / 0 FAIL, 34,868 s, benne root/engine typecheck.
- `20261020-094321-483-survival-profile-plans`: 51 PASS / 0 FAIL,
  14,782 s; tartalmazza a két új profil valódi négyavatáros natív
  provisioning/baseline seal ellenőrzését. Publication availability továbbra
  is megnevezett technikai teszthatár, nincs valódi draft-promotion.
- Az SI-A15 és SI-M1 checkbox nyitott: a 90 perces élő ablak két étkezéshez
  rövid, a gyorsított teljes ablak véges készlete elégtelen; publication,
  natív utazás és élő runner/result kapuk változatlanul igazolandók.
- A gateway célzott tesztjében az üres natív watermark először engineTick
  nélkül készült, amit a valódi validator elutasított; a fixture javítva,
  a FAIL megőrizve: `20261020-094421-633-survival-gateway-threshold`.
  Újrafuttatás `20261020-094440-989-survival-gateway-threshold-fixed`:
  8 PASS / 0 FAIL, root/engine typecheck, 33,667 s. A tényleges gateway
  source adapter mindkét profilban a 2400-as küszöb és tartós Needs alapján
  választja a meglévő consume skillt, időzített etetés nélkül.
- Readonly source/preflight audit:
  `20261020-094834-944-survival-readonly-source-audit`, PASS, 0,933 s;
  32 forrás és 48 helyi Markdown-link. A két új jelölt valódi CLI-je exit 2,
  `not-run` verdict, 51 változatlan natív forrás; a wrapper sikere a helyes
  blokkolás ellenőrzése. Artifactok a `.local/verification/` alatt:
  `si-a15-day-live-1792482515369.json` és
  `si-a15-day-accelerated-test-1792482515369.json`.
- A használati példa hozzáadása utáni végleges source audit:
  `20261020-100031-865-survival-final-source-audit`, PASS, 0,898 s;
  manifest `si-a15-day-survival-source-1792483232312.json`, digest
  `6962c61ec2b594c7a426bf1ba8d8cc03da5ac098753bd7b3dd9524960f0383dc`.
  Az új CLI-artifactok `si-a15-day-live-1792483232312.json` és
  `si-a15-day-accelerated-test-1792483232312.json`; mindkettő változatlan
  natív forrásokat és BLOCKED / not-run eredményt igazol.
- **Teljes regresszió: PASS, 2302 PASS / 0 FAIL / 0 skip.**
  `20261020-094641-256-full`, `bun run check`, **1103,914 s**; root,
  engine és webclient typecheck, formázás és a teljes modul-/határtesztlánc.
  Indoka a közös óra, tartós Needs és a végleges halál authority változása.
  A readonly packed-cache driver külső wrapperje
  `20261020-094640-416-survival-full`, exit 0, 1105,363 s;
  a fenti darabszám a belső részletes eredményből származik.
  Nincs élő D1 indítás, draft-promotion vagy meglévő világ migrációja.

## SI-A15 – D1 előkészítés, élő kapu BLOCKED – 2026-10-19

**Nem elkészült SI-A15 és nem élő futási eredmény.** A konkrét terv,
feltárt akadályok és használható readonly parancs:
[D1 preflight](SI_A15_D1_PREFLIGHT.md). A roadmap-checkbox nyitott maradt.

- Új digesthez kötött jelölt terv: 90 perc 1:1, restart 45. perc, recovery
  legfeljebb öt perc, snapshot 60 s, 0 provider, előre rögzített supply-szünet
  és nem átfedő bérleti ablakok. A fogyasztási/demand-követelmény változatlan.
- Futtatható `scripts/society-integration-live.ts preflight`: a valódi
  procedure-reader és needs-policy alapján blokkol, nincs publication fake.
  Natív DB-t nem nyit meg/migrál; 51 ismert DB/WAL/SHM/receipt/save útvonal
  byte-hash/hiányállapotát hasonlítja össze. A kimenet és a terv hash-elt,
  új artifact írható, felülírás nem. Nincs runtime-start vagy automatikus
  skill-publikáció az eszközben.
- Bizonyított lehetetlenség a jelenlegi rutinban: 0 kezdeti hunger,
  legfeljebb 300/óra → 450/90 perc; a 6000-es küszöb legkorábban 1200 perc.
  A két fogyasztás/avatar és 95% belső satisfied-demand így nem teljesülhet.
  Ezt nem lehet az SI-A14 relief-teszttel vagy bootstrap étellel pótolni.
- A három food draft változatlan. A native travel, költség/sink, bed/role,
  actual account/controller/restart/shortage kötés és az előrehaladt D1
  result új helyen történő újraolvasása még igazolandó. A hatavatáros régi
  soak és a változatlan nyitóállapotot kérő SI-A13 capture nem D1 runner/result.

### Ellenőrzés

- Első célzott szerződéskör: `20261019-231553-500-si-a15-preflight-contracts`,
  **33 PASS / 0 FAIL / 0 skip, 2,612 s**. Plan/fixture/acceptance/capacitás,
  pontos hunger-boundary, tényleges readonly CLI és tiltott start/output.
- Első root TypeScript: `20261019-231554-166-si-a15-root-types`,
  **PASS, 47,700 s**.
- A tényleges archivált preflight elvárt blokkolásának auditja:
  `20261019-231758-436-si-a15-actual-preflight-audit`, **PASS, 0,815 s**.
  Maga a production CLI **exit 2 / BLOCKED**, `liveRunStarted: false`,
  `liveVerdict: not-run`. 51 natív útvonal változatlan; mindkét digest
  újraellenőrizve; ugyanazon output ismételt írása exit 1 és nem módosítja
  az artifactot. Történeti példa:
  `.local/verification/si-a15-d1-preflight-1792444678863.json`,
  digest `6450f07b46a2ac012a0e1e23fc16d7149b1cd2a2d4d021aada7dcf7fd6d0be5a`.
- Végső szerződéskör és friss production preflight-audit:
  `20261019-231919-739-si-a15-final-contracts`, **34 PASS / 0 FAIL /
  0 skip, 2,894 s**, changed-line format PASS. A szigorú tervazonosító
  típusa is külön negatív eset. Friss BLOCKED artifact:
  `.local/verification/si-a15-d1-preflight-1792444761684.json`,
  digest `5bfb549f4a6eda666ab61b4dd90769c2af1807811881c013fb6a19de162fad2a`.
- Végső root TypeScript: `20261019-231919-738-si-a15-final-root-types`,
  **PASS, 15,464 s**. A hét érintett terv/tool/test/dokumentum külön
  source/whitespace/link auditja:
  `.local/verification/si-a15-preflight-source-manifest-v1.json`.

Teljes regresszió nem szükséges: kizárólag új readonly előellenőrzés, jelölt
terv és dokumentáció változik; nincs közös persistence/auth/óra/gazdasági
alap vagy dependency/discovery módosítás. Az érintett meglévő
society-integration csomag és root TypeScript a kiválasztott kör. Az SI-A14
teljes kapuját és történeti artifactjait nem nevezzük át SI-A15 élő bizonyítékká.

## SI-A14 – Közös natív hiba- és restart-acceptance – 2026-10-19

Implementáció, exact 26 esetes jegyzék, named U/I határok, migráció/rollback:
[SI-A14](SI_A14_NATIVE_RESTART_ACCEPTANCE.md). A meglévő
[15.1 audit–teszt mapping](AUTONOMOUS_PROTO_SOCIETY_AUDIT.md) bővült;
a teljes audit követési checkboxa nyitott marad.

- Új managed teszt-workspace valódi SI-A13 baseline-nal, packed contenttel,
  kanonikus Player- és domain-adatbázisokkal. Nyolc megnevezett process-kill
  pont, hideg újranyitás és exact receiptből egyeztetés. Külön negatív
  uncertainty marad látható, nincs kézzel létrehozott sikeres domainrekord.
- Atomi natív bérreceipt + Player-checkpoint; a mod-fájl projekcióját
  ugyanaz a settlement-ID javítja. Hiányzó/módosított kanonikus forrás nem
  enged újrafizetést. Additív marker és inbox v3 migráció dokumentálva.
- Késői terminal source nem tekeri vissza az inbox óráját. Az alvási
  admission és wake friss clock observationt használ az identity guard után.
- Managed bootstrap opening before-image és átmeneti offline login-key
  javítás. Aktuális fixture **1.0.1**, nyers nyitókészlet **0** a tényleges
  első beszerzéshez; a Property-backed facility-jog állandó. A véges
  3800 GP, 32 output quota, normál óra és 90 perces protokoll megmarad.

### Ellenőrzés és megőrzött hibák

- **Végső SI-A14 kapu:** `20261019-230659-931-si-a14-gateway-transport-final`,
  **28 PASS / 0 FAIL / 0 skip, 184,221 s**, exit 0: valódi natív baseline,
  mind a **26** közös eset és parent. A gateway ACK-loss eset **2,399 s**, az
  összes nyolc process-kill recovery sikeres. A külön audit **987 fájlt és
  407 SQLite-adatbázist** ellenőrzött: hash-ek, quick-check, fixture/source/
  seal kötés és a kanonikus Player-végállapotok digestje egyezik.
  Végső evidence:
  `.local/verification/si-a14-native-1792444042211/manifest.json`,
  digest `410784632fad1bc430060e2e43545d3b7026db1aadbab786c9ce413f6c7b50a0`;
  audit `.local/verification/si-a14-evidence-audit.json`, valamint digesthez
  kötött történeti auditpéldány. Ez izolált adapter-acceptance, nem élő SI-M1.
- Lezárási forrás/whitespace/Markdown-link audit és changed-line format:
  a 25 érintett kód/config/dokumentum hash-jegyzéke
  `.local/verification/si-a14-final-source-manifest-v1.json`.
- `20261019-224426-046-si-a14-progressing-clock-native`: **53 PASS / 0 FAIL /
  0 skip, 175,245 s**. A 25 közös eset, valódi native baseline, 24 natív
  housing-próba és a gateway belépők sikeresek. A korábbi targeted körök
  több egymásra épülő adapterhibát tártak fel; ezek nem törölt eredmények.
- `20261019-224618-492-si-a14-final-types-and-inbox`: **24 PASS / 0 FAIL /
  0 skip, 69,721 s**; root és engine TypeScript is PASS, inbox v1→v3 és
  tartós késleltetett bélyeg, régi fixture-validáció és bundle-határok.
- `20261019-224346-850-si-a14-actual-preflight`: **PASS az elvárt blokkolás
  auditjára, 0,603 s**. A valódi CLI exit **2**, három draft food procedure,
  tíz natív forrás hash/hiányállapota változatlan, baseline nincs létrehozva.
  Eredmény `.local/verification/si-a14-actual-preflight.json`.
- Teljes regresszió indoka: a kanonikus gazdasági commit és a tartós inbox
  sémája/közös clock-kötése változott. Az actual packed cache-t kizárólag
  olvasó localhost driverrel indított `verify:full`:
  `20261019-224211-342-full`, **2265 PASS / 0 FAIL / 0 skip, 945,292 s**,
  exit 0. Changed-line format, mindhárom TypeScript-projekt, széles
  alapcsomag és minden eredeti domaincsomag a Phase22 acceptance végéig PASS.
  A zöld teljes kör a 25 esetes registryt futtatta; az utolsó, külön gateway
  ACK-loss tesztbővítéshez új közös natív kör és érintett typecheck tartozik.
- A végső tesztharness-bővítés után:
  `20261019-225746-410-si-a14-final-contract-types`, **24 PASS / 0 FAIL /
  0 skip, 74,149 s**, root és engine TypeScript PASS. Ez kizárólag új
  negatív teszt/harness-határ, ezért nem indokol újabb teljes regressziót.
- A külön gateway-próba első köre:
  `20261019-225733-680-si-a14-final-gateway-recovery`, **26 PASS / 2 FAIL /
  0 skip, 282,119 s**. Csak az új gateway-case és emiatt a parent FAIL;
  mind a nyolc valódi process-kill recovery PASS. A kapcsolat az első,
  még nem terminal válasznál szakadt meg; a gracefully zárt tesztsocket
  után a child 120 s időkorlátba futott. A javítás csak a valós completion
  ACK-ját veszíti el. A külön socket-diagnózis szerveroldali terminationnél
  is beragadó Bun `server.stop()` hívást mutatott:
  `20261019-230602-334-si-a14-socket-diagnose`, **FAIL, 5,850 s**;
  a public SDK disconnect határ ugyanezzel a valós transporttal sikeres:
  `20261019-230647-027-si-a14-socket-close-boundary`, **PASS, 0,741 s**.
  Az assertionök és az időkorlátok változatlanok, az eredeti FAIL megmarad.
  A completion-határhoz kötött, még szerveroldali terminationt használó
  `20261019-230312-761-si-a14-gateway-commit-recovery` szintén **26 PASS /
  2 FAIL, 289,315 s**; ugyanaz a lokális Bun cleanup-várakozás. A végső
  public SDK disconnect előtti ACK-visszatartás mindkét bizonytalanságot
  megőrzi a vizsgált gazdasági oldalon, de rendesen lezárja a teszttransportot.
- A végső public SDK transport-határ engine typecheckje:
  `20261019-230712-056-si-a14-harness-engine-types`, **PASS, 35,007 s**.
- Független evidence-audit első kör:
  `20261019-224737-109-si-a14-evidence-integrity`, **FAIL, 0,721 s**.
  A readonly `quick_check` átépítette az SQLite WAL shared-memory indexét,
  a korábbi hash így nem fedte a végleges byte-okat. A parent most az összes
  integrity-handle lezárása után hash-el; az audit külön másolatot olvas.
  Az eredeti hibás csomag és FAIL megmarad, nem kap utólag új manifestet.
- Javított lezárás és független evidenciaellenőrzés:
  `20261019-224811-586-si-a14-sealed-native-evidence`, **27 PASS / 0 FAIL /
  0 skip, 171,741 s**, exit 0. Új baseline + 25 közös eset + parent;
  mind a 25 fájljegyzék, source/fixture/seal kötés, SQLite quick-check és a
  mentett kanonikus Player-végállapot digestje sikeresen újraellenőrizve.
  Evidence: `.local/verification/si-a14-native-1792442917786/manifest.json`,
  digest `174316ea43da2119a388c6c879714e7cf6d8c551cf862ce6bf03d5f0bc4a7b87`;
  részletes audit
  `.local/verification/si-a14-evidence-audit-174316ea43da2119a388c6c879714e7cf6d8c551cf862ce6bf03d5f0bc4a7b87.json`.

A korábbi hibás körök: `20261019-222815-920-si-a14-common-cases`
**10 PASS / 14 FAIL, 135,046 s**; `20261019-223349-583-si-a14-native-recovery-cases`
**19 PASS / 6 FAIL, 161,332 s**; `20261019-224026-572-si-a14-rent-and-restart-fix`
**23 PASS / 2 FAIL, 140,038 s**. Ezekben a work-minimum tesztelőfeltétele,
rent-admission óraolvasása és housing guard közbeni időelőrelépés javult.
A `20261019-223714-153-si-a14-root-contracts` **60 PASS / 1 FAIL, 46,279 s**;
a failing inbox-bélyegre adott v3 javítás külön körben PASS. Korai source-copy,
kulcsenv, before-image és executor-suspension hibakereső naplók is megmaradnak.

Az első, saját tesztcopy közben megszakított folyamat (`20261019-220806-028`)
exit 255, **123,067 s**, nem PASS. Hátramaradt saját stagingje pontos
path és ownership-marker ellenőrzésével eltávolítva; operátori állapot nem.

Az SI-A15 élő demonstráció külön kapu. Nincs automatikus skill-publikáció,
live apply/reset/enrollment vagy providerhívás; a route/travel, kétágyas
ütemezés és normál needs/controller SI-M1 kimenet továbbra is bizonyítandó.

## SI-A13 – Négyavatáros fixture és offline baseline – 2026-10-19

Implementáció, konkrét indulóértékek, replay/rollback, archive/runtime kötés
és CLI: [SI-A13](SI_A13_INTEGRATION_BASELINE.md).

- Külön digestelt `society-lobster-four@1.0.0`, négy avatar és egy avatar
  nélküli konyha. Az eredeti hatavatáros Varrock fixture változatlan.
  Véges cash/treasury, személyes natív XP/tool, bootstrap food, Property,
  két entitlement, alkalmazások/bérek és két valódi szállásférőhely.
- Új stagingben meglévő genesis/provenance/fixture journal; valódi Player
  mentés és checkpoint. Exact clock/lifecycle/needs, natív nyitóvagyon és
  SQLite-tábla/receipt seal. Replay readonly, drift esetén nincs refill.
- Új offline archívumprotokoll a meglévő biztonságos path/staging/SQLite
  primitívekkel; source/config/cache/runtime hash-ek, credential-kizárás,
  rollback publish előtt, restore kizárólag új könyvtárba és natív újraolvasás.
  A hosszú benchmark időminimuma nem változott.
- A valódi v8 save-reader kompatibilitási rés javítva. Pending recovery
  asset esetén explicit hiba, így az összeg nem válik hiányos vagyonképpé.
  A konyhai tartalék auditált bootstrap eredetű, nem belső termelési siker.

### Ellenőrzés

- Célzott kör: `20261019-180432-951-si-a13-final-targeted`, **78 PASS / 0 FAIL /
  0 skip**, **45,019 s**. Fixture/reference/kapacitás, production CLI gate,
  staging rollback, valódi natív bootstrap/replay/drift/capture/restore,
  save-reader, meglévő archive/genesis adapter és SI-A12 riport határai.
  A natív suite actual packed cache-t használ; csak a publication elérhetősége
  szimulált, megnevezett resolver porton. A capture teszt source inventoryja
  megnevezett technikai részhalmaz, az összes natív adatbázis/cache valódi.
- Root és engine TypeScript: `20261019-180358-151-si-a13-final-types`,
  **PASS, 69,326 s**. Az utólag hozzáadott CLI-teszt opcionális stderr-típusa
  miatt az első teljes kör később hibát jelzett; ez javítva.
- Teljes regresszió indoka: az új modul bekerült a `check` tesztfelderítésébe
  és a root buildkonfigurációba; integrációs baseline-határ is változott.
  `20261019-180545-535-si-a13-full-local-cache`: **FAIL, exit 2, 57,805 s**;
  a belső `20261019-180546-351-full` formázás után root TypeScripten megállt.
  Az új teszt `create.stderr` opcionális volt; a javítás után a hibás lépéstől
  az eredeti teljes `check` sorrendben folytattuk. Az első FAIL megmarad.
- Az első folytatás `20261019-180808-353-si-a13-full-remaining`: **FAIL,
  exit 2, 69,895 s**. A Bun overload az alapértelmezett stderr-t `never`-ként
  típusozta; a teszt most explicit `stdout/stderr: pipe` beállítást használ.
  A következő folytatás ugyanattól a root TypeScript lépéstől indult.
- `20261019-181004-459-si-a13-check-continuation`: **1543 PASS / 2 FAIL /
  0 skip**, **549,579 s**, exit 1. Mindhárom TypeScript-projekt PASS;
  a széles alapcsomag 1399 PASS / 2 FAIL mellett a natív child suite-ok
  további 144 sikeres próbát adtak. Az SI-A13 végső natív seal/lineage és
  capture/restore útja is PASS. A két hiba a korábbi SI-A12 GET riport és
  evidence útvonalainak hiányzó capability-jegyzéke volt, nem runtime-hiba.
- Jegyzékjavítás: `20261019-182022-340-si-a13-capability-repair`,
  **8 PASS / 0 FAIL, 4,229 s**. A négy tényleges forrásdeklaráció két új
  GET műveletként bekerült a meglévő society dashboard képességébe;
  összesen 173 művelet, változatlan 155 available és egy infrastructure kártya.
  A source-discovery/orphan/method-change, jogosultsági és browser-próbák
  sikeresek. Authorization gate, frontend kérés és UI-belépő nem változott.
  Az eredeti FAIL megmarad; a teljes alapcsomagot nem ismételjük meg.
- Az alapcsomag után kimaradt összes eredeti modul, az új fixture-csomaggal
  együtt: `20261019-182047-986-si-a13-domain-continuation`, **689 PASS /
  0 FAIL / 0 skip, 219,212 s**, exit 0. Az eredeti `check` sorrendben a
  `test:population-lifecycle` lépéstől a `test:phase22-acceptance` végéig
  minden parancs lefutott, köztük a society-experiments és az új
  society-integration tesztcsomag. Nincs kihagyott hátralévő ellenőrzés.
  A korábbi FAIL-eket nem nevezzük át full-suite PASS-nak; az észlelt hibák
  javított, célzott körei és a teljes fennmaradó lánc sikeresek.
- Changed-line formázás és a húsz lezárt fájl whitespace/hivatkozás auditja;
  friss digestjegyzék: `.local/verification/si-a13-final-source-manifest-v1.json`.
  Az SI-A12 történeti manifestje változatlan maradt.
- Tényleges repository readonly preflight:
  `20261019-180634-997-si-a13-actual-preflight`, **PASS az elvárt blokkolás
  auditjára, 0,585 s**. A CLI exit **2**, három draft food procedure és egy
  verified trade skill. Tíz meglévő/hiányzó natív forrás hash/állapota változatlan,
  `baseline: null`; eredmény `.local/verification/si-a13-actual-preflight.json`.
  Ez nem élő acceptance vagy létrehozott operátori baseline.

A korai hibakeresési körök FAIL eredményei megmaradnak: native v8/reader
eltérés, kanonikus objektumkulcs-sorrend az összehasonlításban, a technikai
archive teszt hiányzó pack-jegyzéke, valamint az új natív suite túl rövid
alapértelmezett async tesztideje. Az új, több adatbázist és packed cache-t
kezelő négy natív teszt explicit 60 s határt kapott; meglévő assertion,
domain-check vagy történeti tesztlimit nem változott.

Az operátori create továbbra is fail-closed a még draft food procedure-öknél.
Nincs automatikus publikáció, live apply/reset/enrollment vagy providerhívás.
A Lumbridge/Karamja/Falador útvonal és utazás, kétágyas ütemezés, valamint a
normál needs/controller küszöbök melletti SI-M1 fogyasztási/demand-kimenet
SI-A15 előtt külön kapu. A fixture/bootstrap nem bizonyítja a demonstrációt.
Következő feladat: **SI-A14**, a közös negatív és restart harness.

## SI-A12 – Natív mérési és egyeztetési riport – 2026-10-19

Implementáció, képletek, forrás- és időhatárok, API, export és rollback:
[SI-A12](SI_A12_NATIVE_INTEGRATION_REPORT.md).

- Readonly SI-A01–A10 adapter; saját audit/source digest és watermark,
  pontos négytagú needs-demand/relief, eredethez kötött egyszeri final use.
  A telítettség nem tünteti el a demandet; fatigue recovery replay a záró
  állapot/remainder ellen. Unknown/mixed, hiányzó vagy levágott forrás
  nem lesz sikeres nulla.
- Külön intent/native/domain egyeztetés; natív work-completion és
  reward/treasury/work-binding join, rent és fizikai sleep/PlayerTime.
  A szimulációs stamp nélküli bér unplaced, nem időablakbeli GP-forgalom.
- Natív before/after pénz- és itemegyenletek, inter-actor függőségek,
  custody/WIP/in-transit helyek és a kettős számlálás kizárása.
  Opcionális, backend által kiválasztott befagyasztott natív nyitó/záró DB-k:
  pontos paused clock, négy needs-kötés, zárt tick és alkalmazott food-receiptek.
  A jelenlegi vagyon nem helyettesít történelmi határt; egyenletzárás nem
  bizonyít teljes gazdasági mutációs lefedettséget.
- Meglévő authenticated dashboard/evaluation + GET riport és digesthez kötött
  drilldown; natív JSON-letöltés. Két gyűjtés eltérése vagy stale detail 409.
  Nincs writer, migráció, providerhívás, fixture apply vagy élő enrollment.

### Ellenőrzés

- `20261019-173048-303-si-a12-final-source`: **154 PASS / 0 FAIL / 0 skip**,
  root TypeScript, engine TypeScript és changed-line format **PASS**,
  **174,820 s**. A 108 gyökértesztben 15 új adapterteszt szerepel; a két
  izolált natív child suite további 23 housing és 23 commerce próbát futtat.
  A wrapper és child számokat a repository verification helper így összesíti.
- Scope: `society-metrics/test`, admin society-metrics HTTP-határ,
  save-reader, native-housing, native-food-commerce és business-work-runtime.
  A natív tesztek a meglévő, valódi helyi packed cache readonly localhost
  kiszolgálójával futottak. Hivatalos szolgáltatáshoz nincs integráció.
- Az adaptertesztek a valódi needs/clock/food/lineage és frozen native
  vagyonolvasókat is használják: négytagú nevező, no-use és nulla demand,
  határidők, saturáció és sleep expiry, CRC-mentés, bank/GP, sourcegap,
  PlayerTime truncation, row limit, snapshot drift, két világ és read-only
  adatbázis-hash-egyezés. A natív housing teszt actual rent→domain pending→
  activate→physical sleep utat, a commerce teszt a valódi BOTH_MOVEINV
  bizonylat hiányzó órakötését, a bérteszt a két dolgozó egyszeri kifizetését
  olvassa vissza az adapteren keresztül.
- Teljes regressziót nem ismételtünk: az SI-A11 full baseline után ez a
  változás kizárólag readonly olvasók/projekciók, meglévő GET/UI bekötések,
  tiszta byte-parser kiemelése és tesztek. Nem változott perzisztenciaséma,
  clock/transaction alap, közös authorization, dependency vagy test discovery.
  A célzott PASS nem full-suite PASS; a webclient projekt nem érintett.
- A végső fájllenyomatok:
  `.local/verification/si-a12-final-source-manifest-v1.json`.
  A dokumentumlinkek/formátum és a dashboard böngészőre fordításának
  külön ellenőrzése: `si-a12-final-artifact-audit`.

A society-minimum verdict továbbra is inconclusive; az SI-A13 fixture és
az SI-A15 közös élő capture/elfogadás nem történt meg mellékesen.

## SI-A11 – Determinisztikus megélhetés – 2026-10-19

Az SI-A01–A10 és a korábbi munkák megőrizve. Implementáció, exact policy és
paraméterforrások, migráció/rollback, aktiválási és élő elfogadási határ:
[SI-A11](SI_A11_DETERMINISTIC_LIVELIHOOD.md).

### Implementáció

- Névfüggetlen `society-livelihood@1.0.0` az existing supervisor és durable
  inbox útvonalán, a generikus player/institution tervezés előtt. Nincs
  provider vagy második scheduler. Self-care → due work/delivery → supply/rent;
  Business csak meglévő készletből és jóváhagyott feltételekkel indít cook-ordert.
- Additív agent-DB intent/progress journal, immutable binding, CAS és auditlánc;
  restartkor canonical receipt-egyeztetés. Bizonytalan fizikai parancs nem
  indul újra, a partner meglévő lease-e foglalható, controller/run nem duplikálódik.
- A skill-publication, known-skill, allowlist, envelope, operational budget,
  Business employment/facility, finite WIP és treasury határok megmaradtak.
  A food skillek draftok maradnak, aktiválás/publikáció nem történt.
- Tartós okkódok és progress admin agent-state nézet; queued esemény sem
  kerüli meg a bounded retryt, karantént vagy a partner backoffját. Alváskor
  csak a policy szerinti kontroll-replan engedett, fizikai skill nem.

### Ellenőrzések

A körök átfednek; a wrapper a natív child teszteket is számolja.
Minden log/result: `.local/verification/`.

- `20261019-130322-865-si-a11-focused-second`: **34 PASS / 0 FAIL / 0 skip**,
  root TypeScript PASS, **23,268 s**.
- `20261019-130748-496-si-a11-focused-final`: **63 PASS / 0 FAIL / 0 skip**,
  root/engine TypeScript és format PASS, **47,301 s**. Ebben a 22 natív
  housing child próba már az actual supervisor→rent escrow→lost ACK→reopen
  receipt→sleep→wake láncot is tartalmazza, duplikált fizetés nélkül.
- `20261019-130957-530-si-a11-final-boundaries`: **39 PASS / 0 FAIL / 0 skip**,
  root/engine TypeScript és format PASS, **108,220 s**; exact player-time
  revision és esedékes munkák kiválasztása is ellenőrizve.
- `20261019-131249-126-si-a11-final-admission`: **16 PASS / 0 FAIL / 0 skip**,
  **2,781 s**; partner-backoff és known, de nem publikált food draft tiltása.
- `20261019-132122-442-si-a11-final-liveness`: **24 PASS / 0 FAIL / 0 skip**,
  root TypeScript PASS, **49,394 s**. A végső, behatárolt policy/readonly-join
  javítás a lezárt tick és a továbbhaladó clock eltérését kezeli, és pending
  food receipt mellett továbbra is tiltja az új döntést. Megfelelő stock és
  meglévő stock shift normál várakozás, nem karanténindító inputhiba.
- Teljes regresszió indoka: shared agent perzisztencia és cross-actor lease
  authorization bővítése. A `si-a11-full-local-cache` futás elindítva a
  meglévő readonly local packed-cache helperrel: **2193 PASS / 0 FAIL / 0 skip**,
  root/engine/webclient TypeScript és format PASS. Belső wrapper:
  `20261019-131306-784-full`, **732,958 s**; külső wrapper:
  `20261019-131305-960-si-a11-full-local-cache`, **733,934 s**. A két idő
  egymásba ágyazott, nem összeadandó. Az outer wrapper nem számolja újra a
  belső logba irányított teszteket; a 2193 a belső result JSON számlálója.

A teljes kör kezdő forráshash-listája
`.local/verification/si-a11-full-source-manifest-v1.json` (15 fájl).
A fenti utolsó policy/readonly-join javítás a teljes kör indítása után került
be; a megosztott perzisztencia, migráció és lease-authorization változatlan.
A végleges eltérő forrásokat a külön célzott liveness-kör ellenőrizte; a teljes
kört nem állítjuk a későbbi változtatások egyidejű teljes ellenőrzésének.

Korai hibák megőrizve: journal tranzakció visszatérési típus / scalar binding
és request timestamp mező / hiányzó commerce path mezők; source ID nem
fogadhat `@` jelet (külön `society-livelihood:1.0.0` binding source került be);
az új teszt az existing 5 perces cadence-t és inbox API-t figyelembe veszi;
test needs initial value a critical threshold alatt marad, owner nem employee.
A natív teszt static gateway-importja engine NodeNext-függőségeket húzott be;
a két projekt közti runtime-import kifejezett dinamikus URL-t kapott, a
produkciós buildhatár nem szélesedett. Egyik hiba sem számít PASS-nak,
assertiont, időlimitet vagy termékbeli védelmet nem gyengítettünk.

## SI-A10 – Fizetett bérlet és fizikai alvás – 2026-10-19

Az SI-A01–A09 és minden korábbi munka megőrizve. Állapotok, belépők,
perzisztencia, migráció/rollback és élő elfogadási határ:
[SI-A10](SI_A10_NATIVE_HOUSING.md).

### Implementáció

- Meglévő, két BedSlotos Falador housing unit, exact tenant/landlord population
  actor/lifecycle/clock és valódi, verziózott Property-title. A fizetendő 500 GP
  és az egyperiódusos időablak a meglévő housing unit katalógusból származik.
- Auditált Housing admission és véges slot-reservation; a legacy tenancy író
  sem foglalhatja el a pending natív helyet. Három külön folyamat slot race-e:
  egy sikeres foglalás, két visszautasítás.
- Meglévő shared player escrow hold/commit, valódi kétoldali GP-változás,
  mindkét kanonikus Player-save és paid receipt egy Market tranzakcióban.
  A readonly source ellenőrzése után prepaid tenancy/payment/active projekció
  egy Housing tranzakció; paid/entitlement-pending recovery nem kér újabb bért.
- Fizikai BedSlot/floor, életciklus, title és entitlement alapján sleep admission;
  auditált engine-helytanú és checkpoint előzi meg a PlayerTime sleep historyt.
  Mozgás/script/saját műveleti tick blokkolt alváskor, logout továbbra is működhet.
- Property visitor belépés csak a konkrét paid tenancyre, tulajdonosi jog nélkül.
  Lease end/expiry, death, title/policy változás és hiányzó source után nincs
  megmaradó engine-alvás/belépés. A régi sleep state nem natív housing-tanú.
- Housing effect → tartós PlayerTime → SI-A03 fatigue replay; explicit offline
  alvás megőrzött, puszta logout awake marad. Világclock nem gyorsul, pause alatt
  az alvó állapot megmarad és a fiziológiai idő áll. Az entitlement határa akkor
  is korlátozza a recoveryt, ha az avatár offline.
- Clock 5→6 nullable effect mező, korábbi history JSON/digest változatlan;
  additív Housing prepaid/audit-head, natív rent és sleep witness journal.
  Nincs automatikus refund, modelleknek publikált fizetés vagy élő aktiválás.

### Ellenőrzések és megőrzött hibák

Logok/result JSON-ok: `.local/verification/`. A külön körök átfednek,
az összesítő a wrapperben futó natív child teszteket is számolja.

- `20261019-122029-672-si-a10-initial-types`: FAIL, 31,048 s;
  a canonical receipt reader Database paramétere túl szűk OwnedDatabase típusú
  volt. A kölcsönzött Market DB-határ Database típust kapott.
- `20261019-122219-397-si-a10-first-boundaries`: PASS, 113 teszt, 7,935 s;
  15 natív próba és housing/clock/needs alapok. Ezután még race, migration és
  admission/audit-védelmek készültek.
- `20261019-122346-230-si-a10-types-and-legacy`: PASS, 143 teszt, 60,065 s;
  root/engine TypeScript, formázás, Property és SI-A09 kompatibilitás.
- `20261019-122559-126-si-a10-final-boundaries`: FAIL, 163 PASS / 1 FAIL,
  32,834 s; a friss gateway admission fixture feltárta a housing DB szülőmappa
  hiányát. A coordinator már a kiválasztott domainen belül létrehozza a mappát;
  assertion és termékviselkedés nem lett lazítva.
- `20261019-122731-096-si-a10-final-source`: PASS, 165 teszt, 111,194 s;
  native housing, housing, clock/needs, PropertyRuntime, SI-A09 és needs-runtime;
  root/engine TypeScript és changed-line formázás PASS.
- `20261019-122904-973-si-a10-last-native`: PASS, 23 teszt, 8,338 s;
  a végleges **21 packed engine child**, gateway wrapper és trusted population
  admission. Az utolsó védelem a legacy sleep-authority átvételét tiltja.
- `20261019-123137-326-si-a10-docs-manifest`: PASS, 0,850 s;
  dokumentumlinkek, formázás és a végleges 22 forrás SHA-256 digestje.
  Manifest: `.local/verification/si-a10-source-manifest-v1.json`.
- **Az előírt egyszeri `verify:full`: PASS, 2171 teszt / 0 FAIL / 0 SKIP.**
  Indok: közös clock séma és gazdasági perzisztencia változása. Readonly
  localhost packed-cache helper; külső wrapper
  `20261019-123032-488-si-a10-full-local-cache`, 808,830 s; belső wrapper
  `20261019-123033-186-full`, 807,798 s. Az idők egymásba ágyazottak.
  Root/engine/webclient TypeScript, format és a teljes eredeti `check` lánc
  minden modulcsomagja sikeres. A teljes futás a végleges 21 housing childot
  és az admission próbát is tartalmazza; a források közben nem változtak.

**SI-A10 implementáció és izolált natív integráció lezárva, teljes regresszió PASS.**

Az izolált natív próba valódi Player/save/escrow/Property/clock/needs store-t
használ. Élő hálózati többavatáros alvás/logout/return és útvonal-elfogadás
nem futott; SI-A15 nyitott, a rutinba bekötés SI-A11 marad.

## SI-A09 – Véges natív food kereskedelem – 2026-10-19

Branch `codex/si-a01-native-consume`; az SI-A01–A08 és minden korábbi munka
megőrizve. Működés, exact custody, helyreállítás, migráció/rollback és élő
elfogadási határ: [SI-A09](SI_A09_FINITE_FOOD_COMMERCE.md).

### Implementáció

- Raw procurement / cooked sale: rögzített policy és ár, exact két population
  actor/lifecycle/clock/partner, role, storage grant, készlet- és pénzfoglalás.
- A valódi két `BOTH_MOVEINV` opcode cseréli a terméket és GP-t; három protected
  escrow, a két végső Player-checkpoint és a natív auditált receipt közös
  Market-tranzakcióban készül. A worker személyes készlete/pénze változatlan.
- Readonly natív trade/custody proof után a meglévő AgentOperatedShopLifecycle
  stock/treasury sagája véglegesít. Eredeti determinista receipt ID-k, nincs
  második készletlevonás vagy GP-jóváírás. Policy-váltás után a már megtörtént
  csere az admissionkori katalógussal befejezhető.
- ACK/timeout nem siker. Ledger commit utáni checkpoint-hiba egyeztetendő;
  nincs vak redispatch vagy refund. Bizonyított natív no-trade cancellation
  egyszer oldhatja vissza a foglalást, a későn befutó execute terminal marad.
- Bounded recovery, unfunded outbox újranyitása és két egyidejű foglalás
  ütközése tesztelt. A belső tokenes HTTP-végpont csak operation ID-t fogad
  és státuszt ad vissza; nincs hidden-inventory market knowledge út.
- Additív Business/native schema v1, audit/head/projekció és protected escrow
  ellenőrzés. Új skill-publikálás, élő szereplőaktiválás vagy NPC fallback nincs.

### Ellenőrzések és megőrzött hibák

A részletes logok és result JSON-ok `.local/verification/` alatt vannak.
A wrapper a child natív teszteket is összesíti; a külön körök átfednek.

- `20261019-115238-474-si-a09-types-initial`: FAIL, 0,672 s;
  sandboxos Bun `CouldntReadCurrentDirectory`. Nem teszt-PASS.
- `20261019-115249-683-si-a09-types-initial`: PASS, 62,549 s;
  az akkor elkészült core root/engine TS-ellenőrzése engedélyezett runtime-mal.
- `20261019-115430-313-si-a09-adapter-types`: FAIL, 16,908 s;
  a gateway type import behúzta a World típusgráfját a root projektbe.
  A keskeny command/response típusok közös, engine-független helyre kerültek.
- `20261019-115610-776-si-a09-native-first`: FAIL, 19,079 s,
  összesítve 2 PASS / 17 FAIL; az izolált facility fixture-ből hiányzott a
  `properties.json`. A fixture javítva, assertion és termékviselkedés nem lazult.
- `20261019-115703-040-si-a09-native-second`: PASS, 29,526 s;
  18 natív child + 1 gateway wrapper. Ezután még recovery/identity/expiry
  határtesztek készültek.
- `20261019-115714-639-si-a09-types-second`: PASS, 68,968 s;
  root és engine TypeScript.
- `20261019-115959-341-si-a09-final-boundaries`: FAIL, 32,412 s;
  73 PASS / 0 FAIL után a Bun SQLite transaction visszatérési típusára jelzett
  a fordító. A bounded recovery explicit eredményváltozót kapott.
- `20261019-120108-619-si-a09-final-source`: PASS, 43,933 s;
  **74 PASS / 0 FAIL / 0 SKIP**: 22 valódi packed engine child és 52 root teszt.
  Food admission/HTTP, treasury, WorkStore recovery, legacy shop, stock policy,
  sale-channel; root/engine TypeScript és changed-line formázás is PASS.
- `20261019-120359-476-si-a09-docs`: PASS, 0,975 s;
  dokumentumlinkek, formázás és 18 végleges forrás SHA-256 digestje.
  Manifest: `.local/verification/si-a09-source-manifest-v1.json`.
- A közös gazdasági perzisztencia/migráció miatt előírt egyszeri teljes
  `verify:full`: **FAIL, exit 1, összesítve 1473 PASS / 1 FAIL / 0 SKIP**.
  Külső wrapper: `20261019-120254-113-si-a09-full-local-cache`, 389,376 s;
  belső wrapper: `20261019-120254-948-full`, 388,382 s. Az idők egymásba
  ágyazottak, nem összeadandók. A root/engine/webclient TS és format PASS;
  minden új SI-A09 próba ebben a körben is PASS. A fő root futás
  1358 PASS / 1 FAIL, 251 fájl; az összesítő ezen felül a natív childokat is számolja.
  A `sdk/test/gateway-http-chat.test.ts` előkészítő hookja az alapértelmezett
  5000 ms keretben nem fejeződött be (`unnamed`, 5003,69 ms), ezért a `check`
  a root suite után megállt. Nincs assertionhiba vagy új commerce teszthiba.
- `20261019-121005-179-si-a09-chat-hook-isolation`: **PASS, 15 teszt, 15,322 s**;
  a hibás SDK-csomag változatlanul, eredeti timeoutokkal izoláltan átment.
  A történeti teljes kör FAIL eredménye megmarad; **full-suite PASS nem állítható**.
- `20261019-121019-200-si-a09-remaining-regression`: **PASS, 659 teszt,
  115,978 s**. A root leállása miatt kimaradt mind a 30 modulcsomag az eredeti
  `check` sorrendjében, eredeti assertionökkel és időkorlátokkal lefutott;
  a society-experiments, Business/work/stock, provenance és crime csomagok is.
  A külön részellenőrzések nem írják felül az eredeti teljes kör FAIL eredményét.

**SI-A09 implementáció és izolált natív integráció lezárva.** A célzott források
ellenőrzöttek; az egyszeri teljes kör SDK-hook timeoutja dokumentált marad.

A natív gyermektesztek valódi Player/TradeEvidenceStore/checkpoint store-t és
opcode-ot futtatnak. Élő, külön hálózati SDK/browser sessionben végzett
közös többavatáros vásárlás nem történt; az SI-A15 elfogadása továbbra is nyitott.

## SI-A08 – Egy műszak, egy igazolt bér – 2026-10-18

Branch `codex/si-a01-native-consume`; SI-A01–A07 és minden korábbi munka megőrizve.
Működés, state mapping, migráció/rollback és élő elfogadási határ:
[SI-A08](SI_A08_SINGLE_WAGE.md).

### Implementáció

- Cook és delivery worker role, exact employment/skill/wage és facility policy;
  nincs új agentosztály vagy második bérledger. A cook draft verified kapuja megmarad.
- Auditált WorkOrder → egyetlen determinista request/settlement binding-outbox;
  induláskor egyetlen run. Meglévő accept/approve/start, Business-policy és treasury.
- Cook earned csak a konkrét WIP/SDK/packed native cooked receiptből;
  delivery earned csak auditált natív trade, exact partner/item/quantity/időablak után.
  Egy receipt nem szerezhet két átfedő műszaknak két bérjogosultságot.
- Paid kizárólag reopened engine reward receipt után, treasury commit és
  WorkStore/request projekcióval. ACK/exit code/fallback success önmagában nem elég.
- Outbox-, earned-, receipt- és paid-határ utáni forward recovery; eredeti settlement
  reuse. Bizonytalan payout nem oldható fel általános treasury release hívással.
- Elutasított queue ugyanazt a műszakot törli; lejárt vagy részleges munka nem fizet.
  A korábbi nem-food player-action kompatibilitás megmarad. Az admin port az
  új fizetett food munkákhoz WorkOrder-kötést kér.
- Additív Business binding v1 + anchor + teljes audit/head/projekcióellenőrzés;
  nincs közös user_version átállítás. A rollback rend az SI-A08 leírásban szerepel.
- Izolált packed cook/custody és valódi reward store tesztelt; delivery fixture
  a valódi engine trade store producerét használja. Élő többavatáros bér/próba,
  food-publikálás és automatikus population-aktiválás továbbra is SI-A15 kapu.

### Ellenőrzések és megőrzött negatív eredmények

A külön körök átfednek; a wrapper a child natív próbák számait is összesíti.
A hibák és teljes logok/result JSON-ok megmaradtak `.local/verification/` alatt.

- `20261018-224317-133-si-a08-types-first`: FAIL, 15,471 s;
  az OwnedDatabase SQL-binding és Bun transaction return típusait javítani kellett.
- `20261018-224509-960-si-a08-focused-first`: FAIL, 22,038 s,
  31 PASS / 1 FAIL; sérült binding auditot helyesen elutasító konstruktor
  nyitva hagyta a DB-t. A constructor hibaág már lezárja az OwnedDatabase-t.
- `20261018-224604-569-si-a08-native-types`: FAIL, 48,265 s,
  17 PASS / 0 FAIL; a két új packed cook bérteszt is PASS, utána TS hibás
  rewarder tesztargumentumot jelzett. A szignatúra javítva.
- `20261018-224739-616-si-a08-focused-retry`: FAIL, 109,984 s,
  52 PASS / 0 FAIL; engine NodeNext checkbe statikusan bekerült a root gateway UI
  típusgráfja, illetve e kör közben még változott egy recovery metódus.
  Az izolált engine teszt runtime tölti a gateway határt; a végleges forrás külön ellenőrzött.
- `20261018-225035-835-si-a08-final-boundaries`: PASS, 107,682 s,
  73 PASS / 0 FAIL / 0 SKIP; WorkStore, roles, két worker/recovery,
  treasury, admin queue és packed native cook határok; root/engine TS és formázás.
  Ezután a rejected→cancelled mapping, a paid utáni elveszett receipt és a
  megváltozott Business-subject védelme még három külön tesztet kapott.
- `20261018-225535-575-si-a08-final-source-boundaries`: PASS, 92,053 s,
  76 PASS / 0 FAIL / 0 SKIP; a végleges 16 forrás SHA-256 manifesttel,
  az előbbi összes integrációs határ és három utolsó negatív teszt,
  root/engine TypeScript és changed-line formázás is PASS.
- `20261018-225254-915-full`: FAIL, 442,737 s,
  1461 PASS / 1 FAIL / 0 SKIP; a szigorú globális bound-reservation release tiltás
  megtörte a még nem teljesített funded contract szabályos visszavonását.
  A védelem a WorkStore tulajdonú `shift.` namespace-re szűkült; a contract
  meglévő funded/settling cancellation kapuja maradt az authority. A négy
  TypeScript/formázási projektellenőrzés e körben már PASS volt.
  Outer cache-wrapper: `20261018-225254-073-si-a08-full-local-cache`, FAIL, 443,978 s.
- `20261018-230132-157-si-a08-contract-release-repair`: PASS, 24,337 s,
  37 PASS / 0 FAIL / 0 SKIP: mind a 26 új shift/wage teszt és a 11 contract
  funding/settlement teszt. A végleges v2 manifest mind a 16 forrása egyezik.
- `20261018-230622-969-si-a08-final-recovery`: PASS, 94,648 s,
  52 PASS / 0 FAIL / 0 SKIP; a recovery kiválasztása a 100-as batch előtt
  szűri a lezárt történetet, és cancelled/failed request után az orphan holdot
  is felszabadítja. A két további teszttel összesen 28 új shift/wage teszt;
  admin queue, terminal recovery és a 11 contract teszt is PASS, root TS és
  changed-line formázás PASS. Ez a teljes futás közben véglegesített, szűk
  recovery-finomság külön ellenőrzése a végleges v3 forrásmanifesten.
- `20261018-230109-182-full`: FAIL, 673,966 s,
  1764 PASS / 2 FAIL / 0 SKIP. A korábbi contract-hiba javítva, a root,
  engine és webclient TS/formázás PASS; a futás a society-experiments csomagban
  két meglévő lemezes benchmark 5 s / 15 s timeoutján állt meg.
  Outer wrapper: `20261018-230108-238-si-a08-full-final-local-cache`, FAIL, 675,456 s.
- `20261018-231343-674-si-a08-benchmark-timeout-retry`: FAIL, 23,331 s,
  1 PASS / 1 FAIL; változatlan limitekkel az archive/restore benchmark PASS,
  a 192 dispatch-es nap-pár benchmark önállóan is 19,511 s-ig futott a 15 s keretben.
- `20261018-231417-264-si-a08-remaining-packages`: PASS, 49,960 s,
  355 PASS / 0 FAIL / 0 SKIP. A check-parancs timeout miatt még nem futott
  21 csomagellenőrzése az eredeti sorrendben/parancsokkal; végül phase22 acceptance is PASS.
- `20261018-231604-923-si-a08-benchmark-io-budget`: PASS, 74,839 s,
  mind a 60 society-experiments teszt, 0 FAIL / 0 SKIP; formázás PASS.
  Csak a két valódi lemezes integrációs teszt véges timeoutja lett 30 s;
  a FULL/WAL tartósság, valós native dispatch, assertionök és tamper-próbák
  változatlanok. A v4 manifest 17 forrást tartalmaz, köztük ezt a tesztfájlt.

A shared Business migráció, közös treasury-release védelem és gateway dispatch/
settlement határ módosítása miatt az `AGENTS.override.md` szerinti teljes
regresszió szükséges. A végleges forrásmanifest a
`.local/verification/si-a08-source-manifest-v4.json` fájlban van; az első,
v2/v3 SI-A08 manifest, illetve a korábbi SI-A06/A07 történeti manifestjei is megmaradtak.

**Lezárási értelmezés:** a két teljes, egyparancsos futás FAIL eredménye megmarad;
nem állítunk egyetlen zöld full run-t. Az utolsó recovery-változat külön 52 tesztes
kapuja, a javított 60 tesztes benchmarkcsomag és a kimaradt 355 teszt mind PASS;
az előzőleg sikeres, változatlan TS-/SDK-/native-/domainhatárokat nem futtattuk
harmadszor újra. Az érintett források és a teljes check minden szakasza így
ellenőrzött, az átfedő körök számai nem összeadott egyedi tesztszámok.

## SI-A07 – Bounded food skilladapterek – 2026-10-18

Az SI-A06 után ugyanebben a felhasználó által engedélyezett folytatásban.
Branch `codex/si-a01-native-consume`; korábbi munka megőrizve.
Működés, recovery, migráció/rollback és élő publikálási határ:
[SI-A07](SI_A07_BOUNDED_FOOD_SKILLS.md).

### Implementáció

- Három közös, bounded 0.1.0 draft: egy raw gyűjtése, exact Business WIP-batch
  főzése és exact slotból egy cooked fogyasztása. Nincs szereplőnévre másolt skill.
- Normál SkillExecutor → RsSdkSkillRuntime → valódi SDK societyFood protokoll →
  hitelesített gateway-controller → szűk tokenes engine queue → packed content.
  A token nem kerül a skill childhoz; a worker a session és population kötéséből jön.
- Tartós run/step/version/paraméterdigest admission dispatch előtt; stabil natív
  action-ID, readonly canonical source-ból igazolt kimenet. Friss food history
  mellett is az explicit shared Player-checkpoint az authority. ACK/process-exit
  nem receipt; pending, burn, részleges vagy possiblyDropped eredmény nem success.
- A konyhai skill-claim a meglévő WIP auditált row-jában él; két skillrun nem
  használhatja ugyanazt a receiptet két independent trialként. A fizikai
  stock/escrow/receipt továbbra is az SI-A06 és SI-A01/A02 authorityja.
- Generic receive/give/travel reuse; exact item/partner/quantity és meglévő
  ár-/GP-grant megmarad. Bizonytalan trade vagy food nem újrapróbálható és nem
  continue-olható false successbe; autonóm új run előtt reconciliation kell.
- Két független native source minden új procedure-höz, verifierben és publikálás
  előtt readonly újraellenőrzés. Csak a kitchen-run/batch-id invocation binding
  változhat a két főzési trial között; minden functional paraméter egyezik.
- A régi trial/verifier/emberi approval rend megmaradt. Nincs publikált 1.0.0
  food skill és nincs élő SI-A15 acceptance-állítás. Az izolált socket harness
  walking/precondition portjai tesztportok; nem élő population-próba.

### Ellenőrzések és megőrzött negatív eredmények

A natív wrapper saját és child tesztszámai egy körön belül összeadódnak;
az egymást átfedő külön körök nem egyedi tesztszámok. Logok/result JSON-ok:
`.local/verification/`.

- `20261018-213737-503-si-a07-first-types`: FAIL, 16,469 s;
  root típusgráfba húzott engine #alias és rossz arrayként olvasott kitchen source.
  A command típus pure SDK-szerződésbe került, az olvasó pontos runra szűr.
- `20261018-213827-475-si-a07-types-boundaries`: FAIL, 21,440 s;
  engine NPC iterator üres slotjának explicit szűkítése kellett.
- `20261018-214112-361-si-a07-native-first`: FAIL, 4,175 s,
  8 PASS / 3 FAIL; fixture action_delay és 401 helyetti téves 403 elvárás.
- `20261018-214229-178-si-a07-native-repair`: FAIL, 4,291 s,
  7 PASS / 4 FAIL; nem létező resetInteraction helyett az engine clearInteraction
  API-ja kellett a bounded folytatás-leállításhoz. A rollback assertion megmaradt.
- `20261018-214244-689-si-a07-bounded-native`: FAIL, 25,177 s,
  a 10 natív próba + wrapper mind PASS (11/0), de engine TS még hibás:
  NodeNext dinamikus .js import és a valódi SDK collision-data JSON importja.
- `20261018-214551-323-si-a07-source-verifier`: PASS, 32,685 s,
  50 PASS / 0 FAIL / 0 SKIP; native SDK, framework, trial és envelope;
  root/engine TypeScript is PASS.
- `20261018-214919-431-si-a07-final-boundaries`: PASS, 46,659 s,
  152 PASS / 0 FAIL / 0 SKIP; skills, LLM-runtime, WIP, A06/A07 natív határok,
  root/engine TypeScript és changed-line formázás.
- `20261018-215035-539-si-a07-independent-native-trials`: PASS, 19,781 s,
  22 PASS / 0 FAIL / 0 SKIP; végleges 13 natív próba + wrapper és az akkori
  8 food-schema/grant próba, engine TypeScript. Minden új procedure két külön
  natív eredményét és source-verifierét valóban végrehajtja az izolált harness.
- `20261018-215404-620-si-a07-quality-final`: PASS, 46,995 s,
  129 PASS / 0 FAIL / 0 SKIP; skills, grant/failure-router, WIP és natív határok,
  root/engine TypeScript és formázás. A commandban elírt
  skill-trial-publication.test.ts nem létezett és nem számított futott tesztnek;
  a tényleges publikálási fájl a következő körben külön futott.
- `20261018-215537-160-si-a07-fresh-authority-publication`: PASS, 32,482 s,
  22 PASS / 0 FAIL / 0 SKIP; natív SDK, valódi skill-publication-approval és
  admin-workflow-contract-browser próbák, root TypeScript és formázás.
- `20261018-220009-026-si-a07-gather-content-inspect`: PASS, 0,822 s,
  offline packed-opcode diagnosztika, nem tesztsuite. Megmutatta a hideg horgászat
  öt tickes előkészítését: az addigi fixture közvetlenül a rollra kész állapotot
  fedte le. Emiatt tartós waiting/attempted audit és valódi hidegindítási próba került be.
- `20261018-220309-245-si-a07-cold-gather-recovery`: FAIL, 6,667 s,
  21 PASS / 5 FAIL; az execution rekord az admit által kanonizált action helyett
  az eredeti konstrukciós sorrend digestjét használta. A store saját kanonikus
  admissionjének digestjére javítva, a binding assertion változatlan.
- `20261018-220341-682-si-a07-cold-gather-digest`: FAIL, 34,606 s,
  26 PASS / 0 FAIL / 0 SKIP; a 14 natív + wrapper és 11 food unit próba átment,
  engine TS az int/string var típus explicit ellenőrzését még igényelte.
- `20261018-220510-641-si-a07-cold-gather-quality`: PASS, 35,908 s,
  47 PASS / 0 FAIL / 0 SKIP; végleges hideg native gathering, SDK, unit,
  generált API-dokumentáció és admin draftkatalógus; root/engine TypeScript és
  changed-line formázás. A docs:api a valódi generátorral frissült; a katalógus
  teszt három új, tényleges draftot vár, nem hagyja ki őket.

A közös WIP-persistence, cross-cutting jogosultság/verifier és az engine
JSON-import buildbeállítása miatt a végleges SI-A06/A07 állapoton teljes
regresszió indult. Eredményét az alábbiakban rögzítjük.

A `20261018-215652-390-full` kör FAIL, 274,295 s, 1431 PASS / 2 FAIL / 0 SKIP:
a generált SDK API-referencia még nem tartalmazta az új metódust, a draftkatalógus
teszt pedig a régi exact listát várta. Külső wrapper
`20261018-215651-549-si-a06-a07-full-final-local-cache`, FAIL, 275,307 s.
A hideg horgászat hiányát eközben az offline content-inspection külön feltárta;
ez a kör ezért a végleges execution-séma validálásának sem minősül.
Mindkét regressziós hiba javítása és a cold quality PASS után új teljes kör indult.

### Végleges közös SI-A06/SI-A07 kapu

- `20261018-220642-963-full`: **PASS**, exit 0, **403,995 s**,
  **2093 PASS / 0 FAIL / 0 SKIP**. A teljes `bun run check`: root/engine/webclient
  TypeScript, changed-line formázás és minden meglévő csomag tesztjei.
- Külső localhost-only cache-wrapper:
  `20261018-220642-134-si-a06-a07-full-cold-final-local-cache`, **PASS**,
  **404,984 s**. A két idő nem adódik össze; a tesztszám a belső teljes köré.
  A cold gathering runtime-séma és a generált SDK-referencia javítása már benne van.
- `20261018-220753-930-si-a06-a07-source-manifests`: **PASS**, **0,849 s**;
  SI-A06 23 source SHA-256 / 21 natív eset, SI-A07 36 source SHA-256 /
  14 natív eset / 3 draft, 3 dokumentum 22 meglévő helyi linkje.
  A source manifestek a végleges közös workspace állapotát rögzítik.
- `20261018-221407-339-si-a06-a07-docs-final`: FAIL, 0,716 s;
  a Bun sandboxos indítása CouldntReadCurrentDirectory hibát adott, nem futott
  le dokumentum- vagy runtime-ellenőrzés és nem minősült PASS-nak.
- `20261018-221420-089-si-a06-a07-docs-final-retry`: **PASS**, **0,960 s**;
  ugyanaz a readonly link/source-hash és changed-line format ellenőrzés az
  engedélyezett környezetben. 22 helyi link és mind az 59 manifest source-bejegyzés
  egyezik; runtime nem változott a teljes PASS óta, új teljes kör nem indokolt.

Az SI-A06 és SI-A07 implementáció készre jelölve. A következő nyitott
implementációs feladat SI-A08; ebben a körben nem indult el. Az új food skillek
draftok: élő population-trial és emberi publikálás nem történt; ezek aktiválási
kapuk maradnak, az SI-A15 négyavatáros acceptance és SI-A12 összesített mérés
pedig külön feladat. Új tartós játék-/LLM-szolgáltatás nem indult, hivatalos
RuneScape/OSRS-szolgáltatáshoz nem kapcsolódtunk.

## SI-A06 – Fizikai konyhai WIP és Business–avatar custody – 2026-10-18

Az SI-A05 utáni folytatás; a felhasználó a limit után az SI-A07-et is engedélyezte.
Branch továbbra is `codex/si-a01-native-consume`; a korábbi munka megmaradt.
Működés, migráció és szigorú downgrade-feltételek:
[SI-A06](SI_A06_NATIVE_KITCHEN.md).

### Implementáció

- Egy lobster batch: atomic Business reservation + exact recipe/run/worker intent,
  meglévő protected escrow, valódi packed főzés, output escrow és readonly native
  forrásból egyszeri WIP-finalize. Az eredeti run anchorja truncation után is tiltja
  a generic refundot; a WIP mennyiség nem második elkölthető készlet.
- Role/facility/clock újbóli ellenőrzése commitkor; ordinary worker storage-jog,
  full inventory, halál/expiry/revoke utáni valós visszavétel és forward recovery.
- Burnt 381 külön eredmény; nem cooked stock és nem raw cancellation.
  A native receipt custody-bindingje a transformation readerben is megmarad.
- Additive Business/engine séma v1, visszafelé megőrzött escrow audit hash;
  közös OwnedDatabase és explicit ESM-jelölés a NodeNext által importált modulokon.

### Ellenőrzések és megőrzött negatív eredmények

A wrapper a natív child és parent teszteket is számolja; az átfedő körök
tesztszámai nem adhatók össze. Teljes logok: `.local/verification/`.

- `20261018-181011-689-si-a06-native-inspect`: PASS, 1,680 s, 2 teszt;
  első packed-content diagnosztika, később a végleges teszt váltotta fel.
- `20261018-181924-976-si-a06-first-physical`: FAIL, 1,290 s; hiányzó explicit
  facility-loader export, a meglévő default loader delegáló refaktorjával javítva.
- `20261018-182005-678-si-a06-physical-loader-repair`: FAIL, 60,267 s;
  2 natív próba átment, root TS: Bun transaction void típus és engine alias-határ.
- `20261018-182324-861-si-a06-types-boundaries`: FAIL, 44,979 s;
  NodeNext CJS/import.meta TS1470; az érintett három domain explicit ESM lett.
- `20261018-182440-735-si-a06-native-recovery`: FAIL, 1,355 s;
  World import initialization-cycle; az új runtime-import a meglévő importok mögé került.
- `20261018-182522-817-si-a06-native-cycle-repair`: FAIL, 2,853 s,
  8 PASS / 3 FAIL; a teszt-RNG seedet a natív suspension elé kellett tenni.
- `20261018-182642-675-si-a06-native-and-types`: PASS, 60,843 s,
  12 PASS; első 11 natív próba + wrapper, root és engine TypeScript.
- `20261018-183023-304-si-a06-force-kill`: FAIL, 10,748 s,
  49 PASS / 9 FAIL; crash worker fixture-ből hiányzó food-loops.json, ENOENT.
- `20261018-183231-299-si-a06-force-kill-repair`: FAIL, 10,831 s,
  46 PASS / 9 FAIL; szigorú audit a settlement köztes prepared/üres raw állapotát
  észlelte. A terminal phase + receipt lock a lot-módosítás elé került, ugyanabban
  a Business-tranzakcióban; assertion nem lett gyengítve.
- `20261018-183348-676-si-a06-recovery-stable`: PASS, 73,700 s,
  57 PASS / 0 FAIL / 0 SKIP; 19 natív próba és a WIP/facility/assets/escrow
  határok, root/engine TypeScript és changed-line formázás.
- A következő ellenőrzést az automatikus approval reviewer használati limit miatt
  nem indította el; ez nem végrehajtott teszt és nem veszélyességi elutasítás.
- `20261018-212538-324-si-a06-final-native`: PASS, 126,134 s,
  22 PASS / 0 FAIL / 0 SKIP; végleges 21 natív próba + wrapper, benne két valódi
  konkurens reservation process és ordinary worker storage-jog. Root/engine
  TypeScript és changed-line formázás is PASS.

A közös WIP/escrow persistence és migráció miatt előre megnevezett indokkal
teljes regresszió indult; eredménye és a javítás az alábbiakban szerepel.

- Első teljes kör: `20261018-212821-473-full`, FAIL, 299,669 s,
  1407 PASS / 1 FAIL / 0 SKIP. A meglévő world-director browser contract
  két kapcsolata között a migráció előtti PRAGMA user_version SQLite BUSY-t kapott.
  Külső wrapper `20261018-212820-500-si-a06-full-local-cache`, FAIL, 300,839 s.
- A WorldDirectorStore 5 s busy_timeoutot kapott a migráció elé, a már meglévő
  IMMEDIATE migráció és assertionök megmaradtak. Nincs új séma vagy üzleti viselkedés.
- `20261018-213358-642-si-a06-director-lock-repair`: PASS, 13,631 s,
  16 PASS / 0 FAIL / 0 SKIP; world-director és valódi workflow browser tesztek,
  changed-line formázás. A végleges közös teljes regresszió az SI-A07 alatt szerepel.

## SI-A05 – Natív élelmiszer-eredet actorváltásokon át – 2026-10-18

Az SI-A04 utáni külön felhasználói folytatás. Branch változatlanul
`codex/si-a01-native-consume`; a korábbi módosítások megmaradtak.
Működés, forráskorlát, migráció és rollback:
[SI-A05](SI_A05_NATIVE_LINEAGE.md).

### Implementáció

- Additive engine lineage schema v1: append-only, source UUID/head/digest-chain,
  unique production/consumption/trade source-key a kanonikus Player-checkpoint DB-ben.
- Production és consume tanú az eredeti lokális checkpoint-tranzakcióban;
  BOTH_MOVEINV előtt inventory+offer custody snapshot, csak a második mozgás után
  natív trade-bizonylat és a két Player checkpointjához kötött transfer-tanú.
- Mennyiségi ancestry megőrzi a külön gyűjtő/szakács/fogyasztó szerepeit és az
  őssource-okat. Split/merge, részbatch, burn, részfogyasztás és továbbadás zár;
  az átadás nem termelés és nem új fogyasztás. Az SI-A04 receipt-lock adja a
  változatlanul egyetlen reliefet, kizárólag a fogyasztó needs állapotának.
- Unknown/mixed pool és hiányzó régi natív tanú nem válik belső eredetté.
  Bootstrap csak exact, elhasznált genesis permitből; import commitolt integrity
  interventionből vagy populationön kívüli natív transferből. A forrás auditja
  readonly újraellenőrzött. Nincs FIFO-val megtisztított kevert eredet.
- A meglévő item-provenance stolen-history/transform gate megmarad; a source-ID/
  digesthez kötött lopott input/output nem kap belsőellátás-igazolást.
  Exact asset/slot lineage és clean-title felmentés nem állított.
- Backend readonly consumer/application join: physiology és internal supply
  külön státusz. A trade ledger, offline-save/integrity és checkpoint közötti
  sourcegap explicit; nincs kitalált distributed ACID vagy item-visszateremtés.
- A production regresszióval reprodukált strict SQLite-close hibát a food/needs
  már meglévő statement-owner mintájának közös `OwnedDatabase` osztálya javítja
  a MarketStore-ban is. A szigorú close és minden assertion megmaradt.

### Ellenőrzések és megőrzött negatív eredmények

A wrapper a natív child tesztjeit és a parent-wrapper tesztet is számolja.
A külön körök egymással átfednek; a számok nem adhatók össze egyedi tesztszámmá.
Minden teljes stdout/stderr és exit-code a `.local/verification/` könyvtárban maradt.

- `20261018-174613-581-si-a05-types-first`: **PASS**, **63,500 s**,
  az első integráció root + engine TypeScript-ellenőrzése.
- `20261018-174810-387-si-a05-native-first`: **FAIL**, **3,016 s**,
  4 PASS / 3 FAIL; rossz teszt-admission mezők, production-only fixture hiányzó
  consumption sémája és a Bun temp könyvtárhoz tartozó EPERM hiba.
- `20261018-174839-104-si-a05-native-repair`: **FAIL**, **2,227 s**,
  3 PASS / 4 FAIL; teszt-world policy/path guard és SQLite strict-close erőforrások.
- `20261018-174912-415-si-a05-native-path-repair`: **FAIL**, **2,346 s**,
  4 PASS / 3 FAIL; a path javult, strict-close/EBUSY még reprodukálható.
- `20261018-175138-210-si-a05-native-statements`: **PASS**, **2,266 s**,
  az első 6 natív teszt + wrapper (7 PASS); a fixture saját statementeket zárt.
  Ez még nem volt a korábbi production suite-ra igazolt termékjavítás.
- `20261018-175313-940-si-a05-types-expanded`: **FAIL**, **57,071 s**,
  a proof `origin` union típusának explicit szűkítése kellett; nem gyengítettük
  a TypeScript-beállítást.
- `20261018-175413-437-si-a05-origin-tests`: **PASS**, **4,903 s**,
  43 PASS / 0 FAIL / 0 SKIP; az első bootstrap/import/stolen integráció és
  a meglévő integrity/provenance/transformation tesztek.
- `20261018-175506-843-si-a05-boundary-final`: **FAIL**, **29,858 s**,
  134 PASS / 3 FAIL; az SI-A02 változatlan gather→cook→eat regressziója is
  reprodukálta a strict-close/cache-evicted statement-hibát. Ez indokolta a
  termékoldali közös OwnedDatabase használatát, a fixture workaround kikerült.
- `20261018-175537-958-si-a05-types-final`: **FAIL**, **57,513 s**,
  Bun Windows `CouldntReadCurrentDirectory`; nem minősült sikeres quality checknek.
- `20261018-175649-038-si-a05-boundary-repair`: **PASS**, **27,987 s**,
  **158 PASS / 0 FAIL / 0 SKIP**; SI-A01–A05 natív határok, food/needs,
  integrity/provenance/transformation/trade és MarketStore ellenőrzések.
- `20261018-175738-088-si-a05-quality-native`: **PASS**, **48,141 s**,
  **12 PASS / 0 FAIL / 0 SKIP** (11 végleges natív próba + wrapper),
  root + engine TypeScript és changed-line formázás.
- `20261018-175952-971-si-a05-source-manifest`: **PASS**, **0,694 s**,
  21 végleges source SHA-256 a `si-a05-source-manifest.json` fájlban;
  lineage schema v1, scope és 11 natív teszteset. Nem új runtime suite.

A közös checkpoint-perzisztencia és új journal migrációja miatt egyszer
teljes regresszió indult, előre megnevezett indokkal:
- `20261018-175805-334-full`: **PASS**, exit 0, **494,616 s**,
  **2045 PASS / 0 FAIL / 0 SKIP**. Teljes `bun run check`: root/engine/webclient
  TypeScript, formázás és az összes meglévő csomag tesztjei. Külső localhost-only
  cache-wrapper: `20261018-175804-549-si-a05-full-local-cache`, **PASS**,
  **495,561 s**; a belső/külső idők nem adódnak össze. Nincs új játék-/LLM-
  szolgáltatásindítás vagy hivatalos szolgáltatáshoz kapcsolódás.

Az SI-A05 készre jelölve; az SI-A06 továbbra is nyitott következő feladat.
Az SI-A15 élő acceptance és az SI-A12 összesített mérés külön feladat marad.

## SI-A04 – Native consume → egyszeri tartós relief – 2026-10-18

Az SI-A03 utáni külön felhasználói folytatás. Branch továbbra is
`codex/si-a01-native-consume`; a korábbi munka megmaradt. Működés,
migráció/rollback és scope: [SI-A04](SI_A04_NATIVE_RELIEF.md).

### Implementáció

- Kanonikus Player-checkpointba commitolt append-only food delivery outbox,
  exact action-ID/clock/source digesttel, truncation-guarddal és source UUID-val.
- Engine end-of-tick watermark; a gateway a health/death és food authority
  közös igazolt idejéig dolgozik. Minden earlier native delivery reconciliation
  megelőzi a normál needs advance-et; pending inputot nem ugorhat át.
- Egy helyi food/needs tranzakció: időre frissített needs + clampelt relief +
  needs audit + consumption application + receipt-use lock + recovery cursor.
  `no-use` nulla fogyasztás/relief; nincs item-visszateremtés projection hibánál.
- Teljes HP mellett valódi packed content, Player/save/inventory és full hunger
  smoke. A nulla HP-heal nincs összekeverve a fiziológiai relief mértékével.
- A needs saját auditja `lastFoodReceipt` horgonyt is őriz: a projection vagy
  lock törlése nem enged másodszori reliefet. Actor/player/lifecycle/world/
  clock/policy/catalog eltérés, sourcegap és out-of-order event fail-closed.
- Read-only application/status és natív nutrition metrika source/needs audit
  bindinggel. Native physical units/relief mérhető; internal origin `unknown`.
  Nincs kitalált gather/cook/trade closure és nincs SI-A05/SI-A12 completion.
- Additive engine delivery schema v1 és domain apply schema v1. A meglévő
  natív action-, needs-, food-táblák megmaradtak. Régi completed eredmény legacy
  delivery: nincs automatikus retroaktív relief; explicit reconciliation kell.
- Két tényleges párhuzamos worker és öt force-kill boundary/reopen/retry próba.
  A közös kapcsolat minden saját prepared statementjét finalizálja strict
  close előtt; a busy timeout már a migrációs writer tranzakció előtt aktív.

### Ellenőrzések és megőrzött negatív eredmény

- `20261018-171016-455-si-a04-initial-types`: **PASS**, exit 0,
  **21,011 s**, root + engine TypeScript az első integráción.
- `20261018-171232-343-si-a04-native-source-boundary`: **PASS**, exit 0,
  **4,811 s**, az SI-A01 változatlan 13 natív tesztje + wrapper (14 PASS).
- `20261018-171424-113-si-a04-native-nutrition`: **PASS**, exit 0,
  **9,160 s**, az első 17 SI-A04 natív teszt + wrapper (18 PASS).
- `20261018-171538-835-si-a04-gateway-and-types`: **PASS**, exit 0,
  **28,419 s**, 67 needs/food/clock/gateway teszt, root + engine TypeScript.
- `20261018-171832-711-si-a04-final-affected`: **FAIL**, exit 1,
  **28,095 s**, a wrapper összesítése 105 PASS / 8 FAIL. A natív child- és
  parent-wrapper eredményei is szerepelnek az összesítésben; ez nem nyolc
  külön termékhiba. Strict close-nál nyitott SQLite statement handle és két
  worker egyidejű constructor writer lockja okozta. A tesztek/assertionök
  megmaradtak; nem close-hiba elnyelésével vagy timeout-emeléssel javult.
- `20261018-172140-720-si-a04-owned-sqlite-fix`: **PASS**, exit 0,
  **31,619 s**, 21 natív nutrition teszt + wrapper (22 PASS), root + engine TS.
- `20261018-172338-611-si-a04-stable-boundaries`: **PASS**, exit 0,
  **41,213 s**, **114 PASS / 0 FAIL / 0 SKIP**, a végleges natív nutrition,
  változatlan SI-A01 consume, needs/food/clock, gateway reconciliation és
  control-plane maintenance; root + engine TypeScript és formázás PASS.
- `20261018-172734-245-si-a04-source-manifest`: **PASS**, exit 0,
  **0,772 s**, policy/source evidence generálás (nem új teszt-suite).
  `.local/verification/si-a04-source-manifest.json`: 16 forrás SHA-256,
  scope és config-digests. Needs policy `default-character-needs@1.0.0`:
  `d901c84d4d0b47f6fb00654c9500bc4ed84d759632f649378451365b8994940a`;
  dynamics `default-needs-dynamics@1.0.0`:
  `bda798c029e0b65acadc041b6ff51a7f02d7465ef2dd495d4b347576bd56db4e`;
  food catalog:
  `60ebec6572e38c6f8b12bc77c8223dbb48fd6709a100abee2dacfea0ba65beb6`.
  Lobster relief: 1800, a meglévő config változtatása nélkül.

Közös Player-checkpoint/outbox és needs–food gazdasági persistence változása
miatt egyszer teljes regresszió indult, előre megnevezett indokkal.
- `20261018-172541-612-full`: **PASS**, exit 0, **375,059 s**,
  **2033 PASS / 0 FAIL / 0 SKIP**, teljes `bun run check`: a meglévő összes
  csomag, root/engine/webclient TypeScript és formázás. Külső helyi cache-wrapper:
  `20261018-172540-819-si-a04-full-local-cache`, **PASS**, **376,051 s**.
  A belső/külső idő nem adódik össze.

A teljes kör után a natív metrika lefedettsége pontosult: az első igazolt
application előtti időablak `inconclusive`, nem korábbi ismert nulla történet.
- `20261018-173259-426-si-a04-metric-coverage-final`: **PASS**, exit 0,
  **88,570 s**, **22 PASS / 0 FAIL / 0 SKIP** (21 valós natív nutrition teszt
  + wrapper), root/engine TypeScript, formázás és a végleges source manifest.
  Ez a kis metrika- és assertion-pontosítás célzott utóellenőrzése; a teljes
  csomag nem ismétlődött. A manifest aktuális 16 SHA-256 értéke ehhez a végső
  forráshoz tartozik; a needs/dynamics/food policy digest változatlan.

**SI-A04 lezárva.** Az elvégzett ellenőrzésekben nincs fennmaradó teszthiba.

Dokumentáció/source-manifest zárókapu:
`20261018-173520-197-si-a04-docs-final`, **PASS**, exit 0, **1,320 s**;
44 egyedi task, kizárólag SI-A01–A04 kész, létező helyi hivatkozások,
tiszta tracked/untracked formázás és 16 egyező végleges forrás-SHA.

SI-A05/SI-A15 nyitott; nincs külön élő hálózati acceptance, LLM/providerhívás,
éles migráció, save-edit, szolgáltatás-restart, commit vagy push.

## SI-A03 – Tartós needs authority – 2026-10-18

Az SI-A02 utáni külön felhasználói folytatás scope-ja az SI-A03.
Branch: `codex/si-a01-native-consume`; az SI-A01/A02 munkája megmaradt.
Működés, API, migráció és rollback:
[SI-A03](SI_A03_DURABLE_NEEDS.md).

### Implementáció és bizonyított határok

- Egyetlen needs authority world/actor/player/lifecycle/clock/profile/policy
  kötéssel, optimistic revisionnel, lokálisan atomi state+audit írással.
- Explicit genesis/admission inicializálás; legacy hiány `unknown`.
  Read-only API nem gyárt DB-t vagy hiányzó needs táblákat.
- Clock v5 módváltás-history, a player-time tranzakcióban rögzítve;
  pontos online/offline/sleep replay és lejáró sleep access.
- Fractional carry megmarad reopen után. A nulla/max boundnál kifelé mutató
  törtmaradék hibája javítva; kis/nagy időlépések egyeznek.
- Engine snapshot + confirmed-through watermark: nincs előreszámítás
  a még nem igazolt életbenléti időre. Exact halál/reset után nincs új
  fiziológiai munka; későn érkező múltbeli halál blokkolt reconciliation.
- Kezelt világ saját útvonala, valódi path/junction ellenőrzés és tartós
  world-kötés; az engine finite-avatar/death source is exact identityhez kötött.
- FoodConsumptionStore táblái megmaradtak, a FoodNeedsPersistence közös
  kapcsolaton és typed tranzakcióban képes needs+receipt-use írásra.
  Nem nulla relief a közös adapteren tiltott az SI-A04 natív integrációjáig.
- Valódi gateway genesis és entry adapter; belépés utáni needs-írási hiba
  azonos entry-ID-val helyreállítható új identitás felvétele nélkül.
- Stopped-world backup/restore valós needs/food és clock DB-vel,
  eredeti/retired workspace ellenőrzéssel. Needs nem estate-vagyon;
  története nem íródik át az örökös életciklusába.

### Ellenőrzési naplók

A korai hibás eredményeket megőriztük. Az `initial-types` egy TypeScript
szintaxishibánál, a `types-core` a Bun SQLite void transaction típusánál állt
meg; javítva. A `needs-core` 48 PASS / 1 FAIL eredménye egy teszthelper null
revision-kezelése volt; javítva. A `needs-core-fixed` 49 tesztje PASS, az utána
futó typecheck receipt-fixture típusa FAIL; javítva. A `runtime-boundaries`
65 PASS / 1 FAIL eredményében a sandbox tiltott junction-létrehozása szerepel;
a próba assertionje megmaradt, engedélyezett normál Windows futtatásban PASS.
Az `affected` 65 PASS / 5 FAIL natív binding-eltérése az engine canonical
healthDigest és a sima JSON-digest különbsége volt; az engine authority
digestjének újrahasználatával javítva. Az `affected-fixed` 81 tesztje PASS,
az utána futó typecheck callback-resource narrowing hibája javítva.

- `20261018-163603-039-si-a03-final-affected`: **PASS**, exit 0,
  **31,289 s**, 82 teszt; needs/food/clock, gateway needs/genesis és
  control-plane maintenance; root + engine TypeScript PASS.
- `20261018-163705-485-si-a03-admission-recovery`: **PASS**, exit 0,
  **1,184 s**, az új entry→needs domain-pending/retry próba.
- `20261018-163822-775-si-a03-schema-final`: **PASS**, exit 0,
  **20,401 s**, 17 tartós store teszt + root TypeScript; sérült world-séma
  nem épül vissza automatikusan.

A közös SimulationClock perzisztencia/migráció és food transaction connection
változása miatt egyszer teljes regresszió indult a repository policy szerint:
`20261018-163717-486-si-a03-full-local-cache`, belső
`20261018-163718-299-full`. Helyi packed-cache HTTP-forrás, nincs külső játék-
vagy providerhívás. A teljes futás közben véglegesített needs-séma és nulla-relief
kapu külön végső boundary körben is ellenőrzésre kerül; ez nem második teljes kör.

- `20261018-163718-299-full`: **PASS**, exit 0, **396,949 s**,
  **2009 PASS / 0 FAIL / 0 SKIP**. Teljes `bun run check`: a meglévő összes
  csomag, root/engine/webclient TypeScript és formázás. A külső cache-wrapper
  `20261018-163717-486-si-a03-full-local-cache`: PASS, **397,946 s**;
  ezeket az egymásba ágyazott időket nem adjuk össze.
- `20261018-164105-433-si-a03-final-boundaries`: **PASS**, exit 0,
  **51,202 s**, **83 PASS / 0 FAIL / 0 SKIP**, root + engine TypeScript
  és changed-line formatting. Ez a teljes futás közben véglegesített
  sérült-séma kaput és nulla-relief gate-et is lefedi.
- `20261018-164340-927-si-a03-policy-actor-final`: **PASS**, exit 0,
  **17,845 s**, a külön pontosított policy-drift/másik player-time forrás
  guard teszt + root TypeScript. A többi sikeres runtime-kör nem ismétlődött.
- `20261018-164505-597-si-a03-docs-final`: **PASS**, exit 0,
  **1,342 s**, 44 egyedi task, csak SI-A01/A02/A03 kész, helyi linkek és
  módosított/untracked szövegfájlok formázása rendben.

**SI-A03 lezárva.** Az elvégzett körökben nincs fennmaradó teszthiba.
Az eredeti hibás naplók a `.local/verification/` könyvtárban megmaradtak:
`20261018-162557-128-si-a03-initial-types`,
`20261018-162639-174-si-a03-types-core`,
`20261018-162831-739-si-a03-needs-core`,
`20261018-162844-053-si-a03-needs-core-fixed`,
`20261018-163031-443-si-a03-runtime-boundaries`,
`20261018-163317-470-si-a03-affected`,
`20261018-163409-359-si-a03-affected-fixed`.

Külön élő E2E nem szükséges ehhez a taskhoz; SI-A04 és SI-A15 nyitva marad.
Commit/push, éles migráció, save-edit vagy futó szolgáltatás restart nem történt.

## Regressziós javítás és SI-A02 – 2026-10-18

Az SI-A01 utáni kérés szerinti folytatás, ugyanazon
`codex/si-a01-native-consume` feature branchen. Az alábbi SI-A01 szakasz
történeti FAIL-jait nem töröljük; az új ellenőrzések eredménye ebben a részben
követhető. Következő implementált task: SI-A02; SI-A03 nem indult el.

### Korábbi timeout javítása

A long-experiment összehasonlítás előbb ellenőrizte az összes natív Phase12
hullámot, majd ugyanazokat újra beolvasta a számításhoz. A
`verifyLongExperimentBacking` most visszaadja az adott hívásban frissen
ellenőrzött forrásobjektumokat; az összehasonlítás ezeket használja.
Nincs tartós memoizálás vagy ellenőrzéskihagyás: a következő comparison újra
olvassa a native/XP/stamp backinget, a megváltozott vagy törölt valódi forrás
továbbra is FAIL. A 24+24 hullámú próba pontosan 48 native olvasást ellenőriz,
a korábbi 96 helyett. Minden korábbi assertion és az 5/15 másodperces timeout
megmaradt.

**A controller teljes fájlja: 40 PASS / 0 FAIL, exit 0, 21,410 s.**
Wrapper: `20261018-145729-759-si-controller-timeout-fix`.
Parancs: `bun test society-experiments/test/controller.test.ts`.
A korábban hibás benchmark restore 2,342 s, a native day-pair 6,648 s alatt
futott le. A mérés gépterhelésfüggő; a determinisztikus javítás bizonyítéka
a duplikált forrásolvasás megszűnése és a megőrzött tamper-ellenőrzések.

### SI-A02 működési scope és célzott ellenőrzés

Elkészült a valódi lobster fishing/cooking inventory-opcode hook, az exact-ID
natív receipt, a közös Player-checkpoint tranzakció, a runhoz kötött véges
forráskvóta, a readonly source reader és a natív transformation projection.
A sikeres/burnt output külön állapot; a cookbook és a food-chain ugyanazt a
377→379 itempárt és `food.cook-lobster@1.0.0` verziót használja. A részletes
source/ID/clock/migration/rollback szerződés:
[SI-A02 működés](SI_A02_NATIVE_PRODUCTION.md).

**Végső érintett kör: 58 PASS / 0 FAIL / 0 skip, exit 0, 29,228 s.**
Wrapper: `20261018-151117-148-si-a02-final-boundaries`.
Parancs: `bun test server/gateway/admin/native-food-source.test.ts server/gateway/admin/native-food-production-source.test.ts production-workflow/test item-transformation/test item-provenance/test server/engine/src/mods/SharedPlayerEscrowAuthority.test.ts server/engine/src/mods/PlayerEscrowWorldAdapter.test.ts && bun node_modules/typescript/lib/tsc.js --noEmit && bun node_modules/typescript/lib/tsc.js --noEmit -p server/engine/tsconfig.json --rootDir .`.
A 58 összesített PASS-ban 34 külső teszt, 13 izolált SI-A01 és 11 izolált
SI-A02 natív próba szerepel. Root és engine TypeScript is PASS.

Az új natív próbák: fishing gain/readonly/retry; kvótakimerülés/reopen/drift;
valós delayed cooking cooked/burnt; delay megszakítása; checkpoint-hiba;
gather→cook→consume+canonical reopen; actor/recipe/source/death guard;
missing readonly/quota-tamper; receiptírás-hiba; process kill commit előtt és
után, eredeti ID egyszeri folytatásával. A smoke temp identity/clock/policy
fixture-t, valódi packed contentet, RNG-t, inventoryt és Player-save-et használ.
Külön hálózati vagy meglévő világon végzett session nem indult.

A korai új hibák megőrizve: az engine NodeNext projekt nem tölthette be a
root default loader `import.meta` útvonalát; a tiszta, közös validátor külön
modulba emelése ezt oldja meg. A cycle-teszt workflowtömb-index helyett a
szándékolt konkrét ID-t választja az új lobster bejegyzés mellett. A negatív
scriptkimenetek valódi font-cache inicializálást kaptak. Assertiont és
timeoutot ezekhez sem gyengítettünk.

### SI-A02 migráció és teljes kör

Az új evidence/quota schema 1 additív migráció a már kanonikus checkpoint
DB-ben, kizárólag temp DB-ken kipróbálva; meglévő világot nem migráltunk vagy
indítottunk újra. Az új táblákra az engine-data backupfa és a death/lifecycle
guard is kiterjed. Rollbackkor íróstop és DB/WAL/SHM + kapcsolódó világállapot
együttes kezelése kell; kvóta/receipt önálló visszamásolása vagy törlése nem
támogatott. Régi gathering/cooking adat nem kap visszamenőleges bizonylatot.

A teljes regresszió indoka az új gazdasági persistence/quota és a native
inventory commit-határ. **Az első teljes lánc: 1560 PASS / 3 FAIL, exit 1,
278,897 s.** Belső wrapper: `20261018-151148-456-full`; külső cache-wrapper:
`20261018-151147-663-si-a02-full-local-cache`, 279,845 s. A két idő egymásba
ágyazott, nem összeadandó. Format és root/engine/webclient TypeScript PASS.
A lánc az `economic-dependency` három próbájánál állt meg: az új lobster
recept/workflow eredetileg a katalógus elejére került, a régi fixture-ök
pedig a korábbi sorszámokat használták. Ez az SI-A02 által feltárt
kompatibilitási hiba volt; a régi bejegyzéssorrend megtartásával és az új
bejegyzések végére helyezésével javítva. A hibás napló megmaradt.

- **Javított katalógus/érintett határok: 61 PASS / 0 FAIL / 0 skip,
  exit 0, 34,931 s.** Wrapper: `20261018-151928-054-si-a02-catalog-compatibility`.
  Parancs: `bun test economic-dependency/test production-workflow/test server/gateway/admin/native-food-production-source.test.ts && bun node_modules/typescript/lib/tsc.js --noEmit && bun node_modules/typescript/lib/tsc.js --noEmit -p server/engine/tsconfig.json --rootDir .`.
  A három korábban hibás economic-dependency próba változatlan assertionökkel
  sikeres; root és engine TypeScript is PASS.
- **Közös action-ID határ: 26 PASS / 0 FAIL / 0 skip, exit 0, 30,608 s.**
  Wrapper: `20261018-151711-328-si-a02-shared-action-id`.
  Parancs: `bun test server/gateway/admin/native-food-source.test.ts server/gateway/admin/native-food-production-source.test.ts && bun node_modules/typescript/lib/tsc.js --noEmit && bun node_modules/typescript/lib/tsc.js --noEmit -p server/engine/tsconfig.json --rootDir .`.
  Az SI-A01 és SI-A02 közös ID-névterét mindkét irányban ellenőriztük:
  fogyasztási ID nem indíthat productiont, production ID nem indíthat új
  fogyasztást. A két író ugyanazon DB-tranzakcióban utasítja el az ütközést.
- **A megállt lánc teljes hátralévő része: 415 PASS / 0 FAIL / 0 skip,
  exit 0, 59,560 s.** Wrapper: `20261018-151939-978-si-a02-remaining-regression`.
  Az eredeti `check` sorrendjében `test:society-experiments`, majd az
  SI-A01-nél is felsorolt 21 Business/production/facility/logistics/provenance/
  crime csomag futott le. Ebből a kísérleti csomag **60 PASS**, benne a két
  korábban időtúllépő próba; további 355 változatlan modulteszt PASS.

A megállt teljes láncot a repository policy szerint nem ismételtük pusztán
zöld exitért: a hibás/érintett és az addig kimaradt körök külön sikeresek.
**Nincs fennmaradó teszthiba az elvégzett ellenőrzésekben**, de az első teljes
parancs FAIL eredményét nem nevezzük át full-suite PASS-nak.
Az SI-A02 a dokumentált natív, izolált local-smoke scope-ban lezárva.
SI-A03/SI-A05/SI-A06/SI-A14/SI-A15 munkája nem öröklődik DONE-ként.

## SI-A01 – 2026-10-18

Forrásbaseline: `2df0daad86c6568a3e1f0e62f58f09aa3cd955de`; fejlesztési ág:
`codex/si-a01-native-consume`. A változások nincsenek commitolva/pusholva.
A [részletes működési és migrációs szerződés](SI_A01_NATIVE_FOOD.md) az
SI-A01 scope-ját és a megőrzött korlátokat tartalmazza.

Implementálva: natív homárfogyasztási witness, exact-ID intent/result journal,
közös Player-checkpoint/receipt commit, tartós `no-use`, readonly source lookup,
population/lifecycle/clock/managed-world guardok, legacy escrow preflight.
Az inventory item 379 tényleges −1 változását a content igazolja, nem HP-heal
vagy caller által küldött receipt. Needs-state/hunger-relief nem része ennek.

### Ellenőrzési eredmények

- **Végső érintett kör: PASS, exit 0, 55,146 s.**
  Wrapper: `20261018-143133-543-si-a01-acceptance-final`.
  Parancs: `bun test server/gateway/admin/native-food-source.test.ts server/engine/src/mods/SharedPlayerEscrowAuthority.test.ts server/engine/src/mods/PlayerEscrowWorldAdapter.test.ts server/engine/src/mods/PlayerInventoryEscrowStore.test.ts population-lifecycle/test/death.test.ts && bun node_modules/typescript/lib/tsc.js --noEmit && bun node_modules/typescript/lib/tsc.js --noEmit -p server/engine/tsconfig.json --rootDir .`.
  **35 külső teszt és 13 izolált natív próba**, 0 FAIL / 0 skip; root és engine
  TypeScript PASS. A natív részletes gyermekfolyamat-kimenet ugyanebben a logban
  megmaradt; az összesítő 48 PASS-t mutat.
  A contentforrás, az opcode-kiosztás/ABI és a kliensprotokoll nem változott:
  a witness a meglévő opcode handler motoroldali megfigyelése. A valódi packed
  content újrafordítás nélkül tesztelhető; a forrásdigestek rögzítve vannak.
- A 13 natív próba: valódi consume + eredeti inventory + reopen/retry;
  teljes HP; eat-delay; üres slot; checkpoint-hiba; receiptírás-hiba;
  ID/actor/item/lifecycle/world ütközés és death guard; hiányzó/legacy readonly
  forrás és ID-validáció; receipt-tamper/future-schema; kezelt világ/path;
  force-kill commit előtt; force-kill commit után; valódi közös
  `World.checkpointPlayers` callback.
- **Teljes regresszió indoka:** közös gazdasági perzisztenciahatár bővítése.
  A teljes `verify:full` futás a meglévő readonly local packed-cache helperrel
  indult. **FAIL, exit 1: 1609 PASS / 2 FAIL / 0 skip, 547,667 s.**
  Belső wrapper: `20261018-142846-788-full`; külső cache-wrapper:
  `20261018-142845-940-si-a01-full-local-cache`, 548,847 s. A két idő egymásba
  ágyazott, nem összeadandó. A root/engine/webclient TypeScript és a format
  sikeres; a lánc `test:society-experiments` részén megállt.
  Hibák: `benchmark result restores native Phase12, clock and XP evidence into
  an isolated workspace` (5000 ms timeout) és `native completed day pairs yield
  bounded, traceable descriptive XP comparisons and reject confounded evidence`
  (15000 ms timeout). Ugyanezek a nevek a változtatás előtti
  `20261017-160018-280-phase25-9-full-local-cache` naplóban is FAIL-ként szerepelnek.
  Az új fogyasztási teszt és minden előtte futó runtime-csomag PASS.
  A hibás exit megmarad; **teljes regressziós PASS nem állítható**.
- **A lánc hátralévő 21 modulcsomagja: PASS, 355 teszt, exit 0, 42,326 s.**
  Wrapper: `20261018-143909-164-si-a01-remaining-regression`.
  A Business/production/facility/logistics, thieving/provenance és crime
  suite-ok az eredeti `check` sorrendjében, assertion- és scriptváltoztatás
  nélkül külön lefutottak. A teljes kört nem ismételtük.
- **A két timeout célzott ismétlése: 1 PASS / 1 FAIL, exit 1, 20,322 s.**
  Wrapper: `20261018-143856-717-si-a01-existing-timeouts`.
  Parancs: `bun test society-experiments/test/controller.test.ts -t "benchmark result restores native Phase12|native completed day pairs"`.
  A benchmark restore külön futtatva PASS; a native completed day pairs
  továbbra is a változatlan 15000 ms limiten túlfutott. Ez meglévő
  controller/XP teljesítménykorlát, nem az új food receipt út hibája.

**SI-A01 lezárva a fenti implementációs és izolált natív scope-ban.**
A teljes regresszió ismert hibája megmaradt, nincs full-suite PASS állítás.
Az SI-A02/SI-A03 implementációja ebben a munkamenetben nem kezdődött el.

Korai sikertelen próbák megőrizve: az izolált engine importhoz szükséges
indítási sorrend/CWD, a tényleges lobster-category (58), egy új teszt hiányzó
TypeScript non-null jelölése, és az izolált cache előfeltétele javítva.
A sandboxos `bun run`/extensionless tsc/helper indítások
`CouldntReadCurrentDirectory` hibája nem PASS; a kötelező teljes kör az
engedélyezett sandboxon kívüli futásban indult. Assertiont és időlimitet
nem gyengítettünk. A kifejezett `typescript/lib/tsc.js` hívás a sandboxban is
elvégzi ugyanazt a root/engine fordítóellenőrzést.

### Perzisztencia és működési korlát

Schema 1 additív migráció az engine kanonikus checkpoint DB-jében; globális
user_version és régi account/escrow adat nem íródik át. Az új táblák a meglévő
kezelt backupfában vannak. Rollback: íróstop, exact-ID egyeztetés, együtt
mentett DB/WAL/SHM és kapcsolódó világ/domain állapot; történettörlés vagy
egyoldalú inventory-visszamásolás nem támogatott. Új költhető estate/custody
állapot nincs; a halott/lifecycle-inaktív actor írása tiltott.

Az egyavatáros bounded local smoke valódi Player/content/checkpoint útvonal,
izolált identity/clock fixture-rel. Külön hálózati SDK/böngésző session és
meglévő világon futó smoke nem történt; SI-A14/SI-A15 közös élő elfogadása
továbbra is nyitott. A packetenként új UUID és a typed belső retry eltérő
jelentése a működési leírásban explicit. Providerhívás és kézi világmódosítás
nem történt.
