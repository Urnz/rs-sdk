# Aktív projektfeladatok

## Követési rend

Ez az egyetlen aktív roadmap. Elkészült részletek és bizonyítékok:
[0–14. fázis](old_TASKS.md), [15–21. fázis](TASKS_COMPLETED_15_21.md),
[22. fázis eredményei és teljes történeti baseline](PHASE22_PROGRESS.md).
A régi alternatív tervet a
[TASKS_PHASES_15_23_REPLACEMENT.md](TASKS_PHASES_15_23_REPLACEMENT.md) őrzi.
A [proto-society audit](AUTONOMOUS_PROTO_SOCIETY_AUDIT.md) továbbra is baseline.

Készültséget végig működő, ellenőrzött lánc alapján jelölünk, nem komponens-
vagy tesztszámból. Egy projection/kapu nem éles végrehajtás. Eredmény és exact
teszt-/run-azonosító a progress fájlba kerül, nem új checkboxként ide.
Új biztonsági/működési blokkoló a meglévő csomaghoz kerül indoklással;
nem blokkoló ötlet a [későbbi backlogba](TASKS_LATER.md).
Hatókörbővítés vagy vállalás elhagyása külön döntés. Kis feladatnál helyi
commit, fázisváltásnál push; titok, hitelesítő adat és mentés nem kerül Gitbe.

Ellenőrzés: az [érintett területre szabott rend](VERIFICATION_POLICY.md) az
alapértelmezés. Egy feladat/fázis lezárása önmagában nem indokol teljes regressziót;
a kiválasztott kör, indok, eredmény és időtartam kerül a progress fájlba.

## Korábbi nyitott követési feladat – 15.1

- [ ] Az audit megállapításait executable regression/acceptance tesztjegyzékké
  alakítani, és minden lezárt gaphez exact teszt- vagy run ID-t rögzíteni.

Ez megőrzött nyitott feladat, nem új Phase 22 követelmény. Az archiválás
nem jelent új elfogadást; a többi 15–21. fázisbeli eredmény az archívumban van.

## 22. Fázis – tulajdonvédelem, bűnözés és igazságszolgáltatás

Nyolc véges lezárási csomag; a 22.1–22.8 2026-09-29-én lezárva.
Az eredeti 23 fő követelmény és minden részlet a
[baseline-ban](PHASE22_PROGRESS.md) marad. Az eredetileg későbbi szervezeti
bővítés külön backlogban van. A többi vállalás nem került ki a hatókörből.

### 22.1 Verified lopás → discovery/evidence → feljelentés

- [x] Hiteles engine outcome → observer-észlelés → külön identification →
  ügy/bizonyíték → explicit feljelentés láncot végig bekötni és elfogadni.
  Pickpocket, lockpick, container theft és property burglary a meglévő
  Thieving skill része; actor/observer tudás nem keveredhet.
  Elfogadás: közös integrációs teszt és helyi élő esemény; észrevétlen eset,
  agent/player-only tanú, hibás forrás, restart és idempotens replay.
  Finding csak külön hatósági döntéssel jöhet létre.
  Elfogadva: mind a négy valódi helyi Thieving eljárás; agent/player-only
  felismerés és HTTP-feljelentés, észrevétlen eset, negatív forrás/auth tesztek,
  közös integráció, teljes engine/gateway restart és exact idempotens replay.
  A tiszta zárnyitás nem kap kitalált witness discovery-t; nincs automatikus finding.
  Exact események, run ID-k és ellenőrzések a progress fájlban.

### 22.2 Tárolóvédelem és konfigurált ellenőrzési pontok

- [x] Housing/Property security surface-t valódi engine storage-/Thieving
  művelethez kötni, pontos placement/entitlement mellett. Valós tanú/őr,
  nyom, checkpoint search és külön detection adhat bizonyítékot; belépés,
  inventory vagy heat önmagában nem. Elfogadás: lockbox/private room/
  protected property és checkpoint siker/hiba, új épület adatból felvehető,
  nincs mindentudó őr és a sikertelen észlelés nem dobható újra.

### 22.3 Bírság tényleges, restart-safe beszedése

- [x] Régi escrow/treasury rekordokat bizonyíték alapján rendezni, migrációs
  és visszaállítási tervvel; nincs adatvesztés/kitalált történeti audit.
  GE-független checkpoint-authority után auditált döntés → egyszeri player
  debit → treasury credit → tartós egyeztetés működjön.
  Elfogadás: valós engine checkpoint, félbeszakítás a pénzügyi határokon,
  restart/replay, elégtelen pénz, sérült forrás, nincs coin-duplikáció.
  Meglévő helyi mentéshez ellenőrzött backup és migráció szükséges.

### 22.4 Intézkedés, jóvátétel és egyszerű börtön/korlátozás

- [x] Policy/evidence-kötött elfogás, korlátozás/börtön, kártérítés és vagyon-
  visszaadás MVP működjön. LLM csak javasolhat; szankciót szűk, típusos,
  jogosultság-ellenőrzött kapu hajt végre.
  Elfogadás: jogos/jogosulatlan döntés, időzített feloldás, restart/idempotencia,
  vagyonmegmaradás és az agent valódi végrehajtási korlátozása.
  Halál nem új Phase 22 feature; a későbbi lifecycle sem LLM-hatáskör.

### 22.5 Orgazdai megismerés és valós kereskedés

- [x] Auditált engine encounter/trade alapján observer-specifikus,
  visszavonható partnerismeret kerüljön memóriába és agent-döntésbe, globális
  lookup nélkül. A véges pénz/storage/capability fencing saga kapjon éles
  trade/payment-forrást. Rendes shop inspection gate és player trade eredet-
  megőrzése együtt működjön; kieső orgazdát ne pótoljon automatikus NPC.
  Elfogadás: megismerés → döntés → valós transfer/payment → tartós eredet,
  kiesés/restart. Recorded request nem fizetési igazolás.

### 22.6 Reputáció és reintegráció

- [x] Joghatósági criminal record, observer/community reputáció és opcionális
  világprofilos moral standing külön maradjon. Forráskötött leírás az agent
  kontextusában; titkos lopás nem közismert. Hiteles restitution, kártérítés,
  közösségi munka, letöltött büntetés, megbocsátás vagy vezeklés a policy szerint
  auditált javulást okozhasson. Elfogadás: közönség/forráskötés, egyszeri
  alkalmazás, restart; ima nem törli a tulajdonjogot/jogi múltat,
  personalityTraits változatlan, nincs globális social-credit pontszám.

### 22.7 Átalakítási eredet és bűnözési metrikák

- [x] Valós crafting input–output asset lineage és atomi készlet/proveniencia
  átmenet működjön migrációval/visszaállítással; eredet nem törölhető.
  Hiteles bevétel, kár, megfigyelt lebukás és időablakos jogi történet/visszaesés
  legyen mérhető, pontos kohorsz/lefedettség mellett.
  Elfogadás: lopás → trade/crafting → payment/veszteség forráslánc; nincs
  kitalált bevétel, claimből bizonyítatlan kár vagy wanted pont. Jövőbeli
  kockázat külön jelölt becslés, nem megtörtént esemény.

### 22.8 Közös elfogadás és operáció

- [x] Az előző hét csomag közös fixture-rel, exact evidence bundle-lel,
  helyi élő vertikális próbával és restart/failure injectionnel legyen igazolt.
  Worker/policy/source bekötések és kapcsolók dokumentálva; célzott tesztek,
  teljes Bun suite, root/engine/webclient typecheck zöld.
  Hiányzó forrás nem csendes skip/kész funkció. Nagy admin redesign nincs:
  a backend–frontend paritás a 26. fázisban marad.

Elfogadási feltétel: egy agent képes betörni vagy lopni a Thieving skillre és
verified eljárásra támaszkodva, a tulajdonátruházás nem tárgyteremtés, és a
jogsértésből bizonyíték-, joghatósági és szankciós lánc képezhető.
A fázis a nyolc csomag bizonyított lezárásával kész.

## 23. Fázis – népességéletciklus, öregedés, egészség, halál és öröklés

- [x] A társadalomszimulációs world profile-ban a karaktert véges életű
  `PopulationMember` lifecycle-hoz kötni; klasszikus respawn csak külön
  kompatibilitási/kísérleti policy legyen.
- [x] Születési időből számolt életkort és konfigurálható életkori szakaszokat
  bevezetni; az öregedés ne csak UI-adat legyen, hanem később módosíthassa például
  regenerációt, munkaterhelést vagy kockázatot.
- [x] Seedelt, korlátozott egyéni élettartam-/halálozási hajlamot készíteni úgy,
  hogy a halál ne egyetlen fix életkorban történjen.
- [x] Sérülés- és health domain-MVP-t készíteni hiteles állapottal, gyógyulással,
  kezelés- és pihenésigénnyel; a medicine első változata lehet meglévő Herblore +
  facility + verified treatment, nem szükséges rögtön új személyes skill.
- [x] Hiteles haláleseményt és lezárt avatar/player-agent lifecycle-t készíteni,
  amely után az agent nem hajthat végre új fizikai műveletet.
- [x] A halálkor nyitott szerződéseket, munkaviszonyt, Business-szerepet,
  treasury-jogosultságot, hitelt, tartozást és Propertyt rendező estate folyamatot
  készíteni fail-closed módon.
- [x] Hagyaték- és öröklési policyt adni faction/jurisdiction szabályhoz köthetően;
  első MVP-ben adminnal vagy egyszerű előre kijelölt örökössel is működhessen.
- [x] Az agent episodic/social memóriáját archiválni; semantic vagy szervezeti tudás
  csak explicit tanulási/öröklési szabály alapján kerülhessen másik agenthez.
- [x] Új népességi belépők generálásának absztrakcióját elkészíteni, hogy a véges
  populáció ne csak kihalni tudjon. Az első változat lehet seedelt új NPC-belépés;
  tényleges család/reprodukció külön későbbi modul maradhat.
- [x] Demográfiai metrikákat adni: korstruktúra, születés/belépés, halál,
  szakembervesztés, vagyonöröklés és munkaerő-utánpótlás.

Elfogadási feltétel: a társadalomszimulációs profil karakterei öregszenek és
végleg meghalhatnak, a halál nem hagy árva gazdasági állapotot, és a populáció
utánpótlásának legalább egy determinisztikus mechanizmusa létezik.

## 24. Fázis – önfenntartó társadalom és hosszú távú kísérletek

Munkasorrend (2026-10-16, felhasználói döntés): előbb a tervezett funkciók
elkészítése célzott technikai tesztekkel, utána a teljes társadalomszimuláció
működési ellenőrzése és a feltárt hibák javítása. A 24.8 élő paraméterkísérletei
csak ezt követik; nyitottak, de nem blokkolják a funkciófejlesztést.

- [x] Definiálni az „önfenntartó társadalom” mérhető minimumát: a bootstrap után
  a populáció meghatározott ideig képes legyen legalább élelmet, alvást/lakhatást,
  alapvető eszközpótlást és munkamegosztást fenntartani indokolatlan gazdasági
  injekció nélkül.
- [x] A társadalomszimulációs profilban minden bootstrap pénzt/tárgyat külön
  genesis eseményként kezelni; futás közbeni admin- vagy fallback-injekciót
  automatikusan jelölni és a tiszta kísérletet opcionálisan érvényteleníteni.
- [x] Self-sufficiency mutatókat készíteni legalább food, tool/maintenance,
  housing és fő inputkategóriák szerint.
- [x] Ha egy world profile explicit külső kereskedelmet enged, azt külön
  import/export domainként mérni; ne végtelen NPC shop legyen a külső gazdaság.
- [x] Gazdasági függőségi gráfot képezni hiteles tranzakciókból és termelési
  eseményekből agent-, Business- és termékszinten.
- [x] Mérni a kritikus szereplőket, single-point-of-failure termékeket,
  supply-chain mélységet, termelési koncentrációt és egy Business/agent kiesésének
  tovagyűrűző hatását.
- [x] A meglévő Phase 12 kísérleti infrastruktúrára hosszabb futásokat építeni
  azonos genesis seed, attribute-eloszlás, populáció és world policy mellett.
- [ ] **24.8 – kontrollált összehasonlítások.** Összehasonlítani legalább:
  - [ ] eltérő attribute/potential eloszlásokat;
  - [ ] diminishing XP be/ki állapotot;
  - [ ] eltérő facility-előnyt;
  - [ ] blank-slate, seeded és historical-burn-in világkezdetet;
  - [ ] eltérő housing/need szigorúságot;
  - [ ] mortalitással és kontrollként mortalitás nélkül futó profilt.

  **Elkészült előkészítő részfeladatok:** az alábbi bontást az implementáció
  során a fejlesztőügynök vezette le a fenti összehasonlítási követelményből;
  nem külön eredeti roadmap-követelmények. A pipákat utólag, a követés
  pontosításakor rögzítettük.

  - [x] Natív hosszú futások összehasonlító eszköze és bizonyítékellenőrzése:
    [megvalósítás és korlátok](features/phase24-8-controlled-comparisons.md).
  - [x] Natív XP-baseline snapshot/reset/restore és az első hullám digest-kapuja:
    [megvalósítás és ellenőrzés](features/phase24-8-xp-baseline.md).
  - [x] A baseline kötése az első arm utáni natív XP-számításhoz:
    [megvalósítás és ellenőrzés](features/phase24-8-xp-execution.md).

  **Későbbre ütemezve:** az élő kontroll- és kezelési futások, valamint
  eredményeik és korlátaik dokumentálása a funkciók elkészülte és a társadalom
  működési ellenőrzése után következik. A tesztfixture nem teljesíti ezt a
  követelményt.
  A 24.8 és a hat eredeti összehasonlítás ezért továbbra is nyitott.
  A Player-stat commit, az exact dispatch-állapot és az RNG bizonyítékának
  hiánya dokumentált korlát; ezekből nem következik automatikusan újabb,
  külön infrastruktúra-feladat.
- [x] **24.9 – többcélú társadalmi értékelés.** A „jó társadalom”
  értékelését többcélú metrikaként kezelni: túlélés,
  önfenntartás, specializáció, mobilitás, vagyoneloszlás, árstabilitás,
  munkanélküliség, innováció/beruházás, bűnözés és rendszerkockázat.

  Elkészült: a tíz dimenzió mérési szerződése és számítása,
  forráshivatkozásokat és adathiányt megőrző riport, csak olvasó admin/CLI
  elérés. Érintett technikai tesztek: 89/89 PASS. A natív facade jelenleg két
  dimenziót számszerűsít; a további történeti adathiány explicit marad.
  Ez nem tíz teljes natív adatgyűjtő vagy működő társadalom igazolása.
  Részletek és ellenőrzési korlátok:
  [24.9 megvalósítás](features/phase24-9-society-evaluation.md),
  [ellenőrzési napló](PHASE24_PROGRESS.md#249--többcélú-társadalmi-értékelés-2026-10-16).
- [x] **24.10 – eseményekig lefúrható dashboard.**
  Az aggregált metrikából exact eseményekig lefúrható dashboardot készíteni
  agent-, Business-, termék-, régió- és idődimenzióval.

  Elkészült a Társadalom adminfül: 24.9 mutatók, natív eseménylista és
  eredeti bizonylat/clock-kötés, dimenziószűrés, időeloszlás, snapshothoz kötött
  lapozás és részlet. A régió nélküli rekord ismeretlen marad. Végső érintett
  API/böngészős és natív integráció: 111/111 PASS, mindhárom typecheck és format
  PASS. A teljes regressziós kör is sikeres volt (1830 teszt); az utolsó
  holtversenyes kiesési pontosítást ezután a végső érintett kör ellenőrizte.
  [24.10 megvalósítás és korlátok](features/phase24-10-society-dashboard.md),
  [ellenőrzési napló](PHASE24_PROGRESS.md#2410--eseményekig-lefúrható-dashboard-2026-10-16).
- [x] **24.11 – benchmark és reprodukció támogatása.** Elkészült a 24.7 véges
  vezérlőjére épülő protokoll és a `society:benchmark` eszköz: offline,
  hash-ellenőrzött forrás/config/cache/mentés/társadalmi állapotcsomag;
  kizárólag új könyvtárba történő restore; natív Phase12/clock/XP eredmény
  újraolvasása; baseline pause/resume és dokumentált újrafuttatás.

  Új technikai esetek: 21/21 PASS. A teljes kör és a megszakadt parancslánc
  külön lefuttatott folytatása összesen 1851 PASS / 1 régi XP-teszt-timeout /
  0 skip; a teljes parancs ezért nem zöld. Az assertionök/időlimitek változatlanok.
  Hosszú élő benchmark és 24.8 paraméterkísérlet nem indult; a társadalmi
  működés alábbi elfogadási feltétele továbbra is ellenőrizendő.
  [Protokoll és korlátok](features/phase24-11-society-benchmark.md),
  [ellenőrzési napló](PHASE24_PROGRESS.md#2411--benchmark-és-reprodukció-támogatása-2026-10-16).

Elfogadási feltétel: legalább egy seedelt agentpopuláció hosszabb, reprodukálható
futásban képes alapvető szükségleteit és termelőeszközeit belső gazdasági
kapcsolatokkal fenntartani, és a rendszer megmutatja, hol és miért válik függővé,
instabillá vagy önfenntartóvá.

## 25. Fázis – több-szerveres admin vezérlőközpont

- [x] Az adminfelületet a játékszerver-folyamattól független control plane
  szolgáltatásként futtatni, hogy leállított engine mellett is elérhető maradjon.
  **25.1 – elkészült:** külön loopback HTTP-folyamat és 7781-es port, saját
  `admin:start`/`admin:stop`; meglévő adminnézetek, szűk gateway API-közvetítés,
  engine/gateway állapot és automatikus újracsatlakozás. Valódi HTTP-, OS-folyamat-
  és Chrome-próba leállított backendekkel; teljes regresszió 1861/1861 PASS.
  A teljes kör utáni Windows indító-csatorna javítást külön folyamatpróba igazolja.
  [25.1 működés és korlátok](features/phase25-1-admin-control-plane.md),
  [ellenőrzési napló](PHASE25_PROGRESS.md).
  Felhasználói fiókok, szerverregiszter és több világ felügyelete a következő
  külön feladatok; ezek e véges lépésnek nem részei.
- [x] Bejelentkezést, felhasználói fiókot és tulajdonosi jogosultságokat készíteni.
  **25.2 – elkészült:** külön fióktár, helyi bootstrap, login/logout,
  lejáró session, jelszócsere és auditált tulajdonjog-kezelés; a control plane
  és a gateway HTTP-belépési pontja egyaránt ellenőrzi a jogosultságot.
  Teljes regresszió 1871/1871 PASS; az utolsó szűk bemenet-/HTTP-kapu-
  szigorítás külön 12/12 teszt és root typecheck PASS.
  [Működés és állapotkezelés](features/phase25-2-accounts.md),
  [ellenőrzések](PHASE25_PROGRESS.md).
- [x] Szerverregisztert és „Saját szervereim” kezdőoldalt létrehozni.
  **25.3 – elkészült:** külön metaadattár, meglévő ownership alapján
  szűrt lista/részlet, üres és hibás állapot, bekötött helyi szerver megnyitása.
  Célzott control-plane/Chrome/Windows/admin-safety **36/36 PASS**;
  root TypeScript, PowerShell syntax/helper és format PASS.
  [Működés és állapotkezelés](features/phase25-3-server-registry.md),
  [ellenőrzések](PHASE25_PROGRESS.md).
- [x] Új szerver létrehozása, verzió-/világsablon-választás, indítás, leállítás,
  újraindítás és archiválás felületről.
  **25.4 – elkészült:** tartós műveletnapló, idempotens kérésazonosító,
  szerverenkénti ownership, verzióhoz kötött munkakönyvtár és felületi lifecycle.
  Célzott store/HTTP/Chrome/Windows kör 34/34 PASS, valódi kétvilágos
  engine/gateway próba PASS. A migráció/jogosultság miatt teljes regresszió
  is futott: a régi XP-timeout külön ellenőrzése és a hátramaradt kör után
  1885 sikeres teszt; az egybefüggő `check` exitje hibás maradt, dokumentálva.
  A helyi admin privát backup után registry v2-re állt, readiness PASS.
  [Működés és állapotkezelés](features/phase25-4-server-lifecycle.md),
  [ellenőrzések](PHASE25_PROGRESS.md).
- [x] Minden szerverhez elkülönített portokat, folyamatokat, adatbázist, mentéseket,
  botokat, modokat, LLM-konfigurációt, titkokat és auditnaplót biztosítani.
  **25.5 – elkészült a kezelt világokhoz:** példánykötés, saját bot-/skill-végpontok és cache,
  külön login-kulcs és kliens, titokszűrt gyermekkörnyezet, saját folyamatok
  leállítása, idegen PID és fájlrendszer-alias elutasítása.
  Izolációs 16/16, érintett határok 101/101 és végső marker-kapu 8/8 PASS;
  root/engine/webclient typecheck és valódi kétvilágos bot-/állapotpróba PASS.
  A régi prepared formátum indítás előtt kifejezett offline migrációt igényel;
  a hagyományos local-default kompatibilitási backend marad. OS-sandbox és
  OS-titoktár nincs késznek állítva. A helyi admin frissítve, readiness PASS.
  [Működés és migrációs határ](features/phase25-5-server-isolation.md),
  [ellenőrzések](PHASE25_PROGRESS.md).
- [x] A jelenlegi bot-, world-, property-, gazdasági és AI-admin nézeteket
  kötelező szerverkontextus alá helyezni.
  **25.6 – elkészült:** rögzített lapkontextus, kötelező API-fejléc,
  szerverenkénti proxy és health cache, gateway oldali egyezésvizsgálat,
  látható szervernév/ID, kétlapos mentési és stale-kontextus Chrome-próba.
  Célzott útválasztás, mindhárom typecheck, kétlapos Chrome és valódi
  kétvilágos engine/gateway proxypróba PASS. A jogosultsági változás miatt
  teljes regresszió futott: egy elavult tesztkérés javítása és a hátralévő
  csomagok után mind az 1892 külön teszteset sikeres eredményt adott;
  az eredeti egybefüggő kapu hibás exitje külön dokumentálva.
  A helyi admin frissítve, privát backup és readiness PASS.
  [Működés és kérésprotokoll](features/phase25-6-admin-server-context.md),
  [ellenőrzések](PHASE25_PROGRESS.md).
- [x] Titkokat operációsrendszer- vagy szolgáltatói titoktárban tárolni; az admin
  csak állapotot lásson, a kulcsok visszaolvasását ne engedje.
  **25.7 – elkészült Windows / kompatibilis workspace esetén:** Windows Credential Manager providerkulcshoz,
  megjegyzett botjelszóhoz és új kezelt világok login-/worker-kulcsaihoz;
  write-only admin, ellenőrzött és ismételhető migráció, plaintext fallback nélkül.
  SDK/MCP/Lite és botlétrehozás is támogatott. Mind az 1902 külön tesztesethez
  van PASS az egyszeri teljes és célzott/pótló futásokból; az eredeti kapuk
  timeout miatti hibás exitje dokumentálva. Két valódi világ vault-/restart-
  próbája PASS, csak olvasó readiness-várással, módosításismétlés nélkül.
  Helyben 14 botjelszó migrálva, admin readiness és plaintext-utóellenőrzés PASS.
  Más OS backendje és régi pinnelt világ forrásmigrációja nincs késznek állítva.
  [Működés és migráció](features/phase25-7-os-secret-store.md),
  [ellenőrzések](PHASE25_PROGRESS.md). A forrásmigráció a 25.8-ban készült el.
- [x] Folyamatfelügyeletet, health checket, ütközésmentes portfoglalást,
  migrációt, backupot és hibából visszaállást készíteni.
  **25.8 – elkészült helyi Windows / izolációs v1 világokhoz:** hitelesített
  folyamatfelügyelet, kizárólagos admin-lease, biztonságos port-/processindítás,
  tartós karbantartási intent, ellenőrzött offline mentés, forrásmigráció és rollback.
  A 25.6→25.8 natív migráció, vault-/SQLite-megőrzés, restore, engine-hiba utáni
  újraindítás és archiválás PASS; a helyi admin registry v3-on egészséges.
  Az egyszeri teljes kapu régi Windows temp-teardown EBUSY hibáját és a célzott
  sikeres pótlást külön dokumentáltuk. Ismeretlen árva gyermek automatikus
  kilövése, más gépre titokexport és nem izolált régi világ migrációja nem támogatott.
  [Működés és helyreállítási határok](features/phase25-8-runtime-recovery.md).
  [Ellenőrzések és mért idők](PHASE25_PROGRESS.md).
- [x] Későbbi távoli eléréshez TLS-t, CSRF-védelmet, rate limitet, session-kezelést
  és szerepköralapú engedélyezést bevezetni.
  **25.9 elkészült (2026-10-17):** privát HTTPS/OS-vault, session-visszavonás,
  szerverenkénti viewer/operator/owner és közös proxy/gateway kapu elkészült;
  1925 root/domain esethez PASS-bizonyíték, 6 Windows-eset PASS. Az egyszeri
  full két régi időkorlátos hibája külön és a 21 megmaradt csomagban pótolva,
  nem zöld full exitként feltüntetve. Az alapmód továbbra is loopback HTTP.
  [Használat, migráció és rollback](features/phase25-9-remote-admin-security.md).
  [Ellenőrzések és mért idők](PHASE25_PROGRESS.md). Következő feladat: 26.1.

Elfogadási feltétel: egy bejelentkezett felhasználó két, egymástól teljesen
elkülönített szervert létrehoz, külön beállít, elindít és leállít úgy, hogy az
admin control plane mindkét engine leállítása közben is elérhető marad.

## 26. Fázis – admin UX és backend–frontend képességparitás

- [ ] A teljes adminfelület információs architektúráját felhasználói célok és
  végrehajtható workflowk szerint átszervezni; a belső backend-domainnevek ne
  legyenek a felület megértésének előfeltételei.
- [ ] Verziózott capability-mátrixban minden támogatott backend-művelethez
  felületi belépési pontot, jogosultságot, előfeltételt, állapotot, eredményt és
  hibamegjelenítést rendelni; az árva backend- és frontend-képességeket teszttel
  kimutatni.
- [ ] A veszélyes vagy emberi jóváhagyást igénylő műveleteknél pontosan leírni,
  mi változik, milyen bizonyíték alapján, mi nem történik meg, és hogyan lehet
  visszaállni vagy újrapróbálni.
- [ ] Minden hosszabb művelethez látható indítási visszaigazolást, futási
  állapotot, befejezést és diagnosztizálható hibát adni. Külön regresszióként
  lefedni a Kísérletek néma indítását: a megerősítés után jelenjen meg a futás,
  vagy egy konkrét, teendőt is tartalmazó hiba.
- [ ] Beépített, rövid ellenőrzési útmutatót és kontextusos magyarázatot adni a
  ritkán használt workflowkhoz, hogy a felhasználónak ne kelljen a backend
  felépítését ismernie egy funkció kipróbálásához.
- [ ] A kritikus admin-workflowkat böngészős end-to-end és API/UI contract
  tesztekkel lefedni, beleértve az üres, betöltési, siker-, részleges és
  hibaállapotokat.
- [ ] Az egységesítés végén használhatósági, hozzáférhetőségi, reszponzív és
  capability-paritási auditot futtatni, majd minden feltárt hiányt lezárni.

Elfogadási feltétel: a backend minden támogatott admin-képessége megtalálható és
érthetően használható a felületen, minden felületi művelet látható eredménnyel
vagy teendőt adó hibával zárul, és egy új felhasználó külön fejlesztői segítség
nélkül végre tudja hajtani a dokumentált alap-workflowkat.
