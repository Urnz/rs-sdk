# Phase 25 – több-szerveres admin vezérlőközpont

## 25.8 – felügyelet, mentés és helyreállítás (2026-10-17)

**Elkészült a helyi Windows / izolációs v1 támogatott körben; TASKS 25.8 `[x]`.**

Elkészült a hitelesített engine/gateway felügyelet, három egymást követő
hiba után auditált hibastátusszal, explicit újraindítási úttal. Windows
named-pipe lease zárja ki a kettős adminfelügyeletet. A logikai portfoglalást
indítás előtti OS-portellenőrzés egészíti ki; idegen folyamatot nem öl meg.

A tulajdonosi adminfelületen elérhető a világmentés, mentésválasztás és
visszaállítás, valamint az aktuális pinnelt forrásra migráció. Ezek szabályos
offline műveletek, idempotens request key-jel és revízióval. A mentés teljes
fájlleltárral/hash-ekkel ellenőrzött, titkot nem exportál. A forráscsere külön
stagingben készül, tartós naplóval és SQL-eredményből eldöntött rollbackkel.
Registry v3 additív karbantartási intent, változatlan identity v1/domain-sémák.

A natív próbák két valódi Windows-hibát tártak fel: a gyermekben örökölt
portfoglalás beragasztotta a gateway portját, az örökölt admin HTTP-listener
pedig akadályozta volna az admin újraindulását. Az új indító explicit natív
handle-engedélylistája csak standard I/O-t ad át. Hibánál a launcher saját
Process-handle-t állít le; sikeres hitelesített readiness után átad és kilép.
Mindkét worker újraindítása és az admin portjának élő workerek melletti
újrakötése regressziós tesztet kapott. Ismeretlen/árva gyermekfolyamatot a
rendszer nem adoptál PID alapján; hiányzó gateway-lezárási igazolásnál zárt
helyreállítási hibát ad.

[Használat, mentési/migrációs korlát és rollback](features/phase25-8-runtime-recovery.md).
A 25.9 távoli TLS/RBAC külön feladat marad.

Ellenőrzések és költség:

- Első célzott kapu **30 PASS, 53,564 s**, admin böngészős backup/restore/
  migráció, életciklus, secret-migráció, root típus és formázás:
  `20261017-113736-693-phase25-8-focused-gate.log`.
- Az új registry és közös migrációs határ indokolta az **egyszeri** teljes
  regressziót. Format + root/engine/webclient típus **PASS**; a root kör
  **1252 PASS / 1 FAIL / 0 skip**, **204,942 s**. A régi account-böngészőteszt
  lezárásakor tempkönyvtár-törlés `EBUSY`, nem funkcionális assertion hibája:
  `20261017-114119-647-full.log`. Ezt nem nevezzük zöld teljes kapunak.
- Az érintett account-eset célzott pótlása és a meg nem futott **30 csomag
  659 tesztje PASS**, majd a korábbi három Windows-folyamateset is PASS;
  együtt **663 PASS / 0 FAIL / 0 skip, 159,499 s**:
  `20261017-114814-590-phase25-8-remaining-and-windows.log`.
- Végső érintett control-plane kör **51 PASS / 1 FAIL, 47,013 s**:
  ugyanaz az intermittáló account-teardown `EBUSY`. A HTTP-kiszolgáló leállása
  megvárt; a második hibát is megőrizzük. Az account-eset külön ismét PASS a
  `20261017-115717-529-phase25-8-final-windows-and-typecheck.log` elején.
  Az új/módosított modulok funkcionális tesztjei mind sikeresek; a teljes
  regressziót és a változatlan sikeres domaincsomagokat nem ismételtük.
- Snapshot-leltár: **15 349 bejegyzés**, korlátozott 16-os I/O, azonos teljes
  integritási tartalommal. Helyi mérések: könyvtárankénti soros bejárással
  **32,117 s**, globálisan korlátozott párhuzamos I/O-val **0,650 s**. A mérés
  cache-/terhelésfüggő, nem általános sebességígéret. A 9 akkori mentési teszt
  és root típus **PASS, 21,566 s**:
  `20261017-114933-215-phase25-8-snapshot-parallel.log`.
- Későbbi két új runtime-eset (elődverzió és hiányzó child-lezárási igazolás)
  **PASS** az összesen **17 sikeres** maintenance/runtime teszt között:
  `20261017-114750-525-phase25-8-snapshot-timing-fixed.log`.
  A hiányzó workspace-et helyreállító új crash-határ esete a végső érintett
  körben szintén PASS.
- A javított Windows indító / élő kétworkeres admin-port újrakötés **PASS**,
  root típus, teljes PowerShell segéd/szintaxis és format **PASS, 34,875 s**:
  `20261017-120253-545-phase25-8-explicit-handles.log`.
  A launcher saját gyermekének abortja és szóközös útvonal külön **PASS**, root
  típussal **16,906 s**: `20261017-120416-466-phase25-8-launch-abort.log`.
- Korábbi natív kísérletek megőrizve: a lassú leltár miatt offline állapotban
  megszakított próba **195,872 s**, majd a migráción átjutó, portöröklésnél
  elbukó próba **119,274 s**. A Windows-hibákhoz a kis reprodukció és a
  regressziós próbák szolgáltatták a javítás bizonyítékát; nincs timeoutemelés
  vagy funkcionális assertion gyengítése.
- Publikáció előtti audit **PASS, 3,463 s**: **744 változott szövegfájl,
  0 változott bináris, 0 blokkoló jelölt, 0 új személyes commit-metaadat**.
  `20261017-120529-585-phase25-8-publication-audit.log`. A repo nyilvános marad
  a felhasználó korábbi döntése szerint; régi elfogadott commit-email változatlan.
- **Végső natív elfogadás PASS, 258,832 s** az `9815bea16` forráscommitból:
  valódi 25.6→25.8 migráció, legacy jelszó/login-kulcs ellenőrzött OS-importja,
  változatlan kulcs és világkötés, valódi engine/gateway indítás, új vezérlőpéldány
  csatlakozása változatlan engine PID/generációhoz, szabályos offline backup,
  SQLite-adat **42→99→visszaállított 42**, újraindítás, csak az azonosított
  próbavilág engine-ének leállítása, három sikertelen health check, explicit
  restart és archiválás. Három ellenőrzött mentés maradt, majd minden próba-
  folyamat leállt és a próba vault-bejegyzései törlődtek.
  `20261017-120437-591-phase25-8-native-verified-launcher.log`.
- Összesen **1915 külön root/domain tesztesethez** van PASS-bizonyíték a teljes
  és célzott/pótló futásokból; az egyszeri full hibás exitje továbbra is látható.
  A **5 külön Windows-folyamateset** is PASS-bizonyítékot kapott. A későbbi,
  behatárolt Windows-launcher/snapshot javításokhoz csak az érintett kört és
  natív próbát futtattuk újra, teljes regressziót nem.
- **Helyi aktiválás PASS, 4,045 s**: nulla aktív production kezelt világ,
  privát konzisztens identity/registry/WAL backup után registry **v3**,
  identity **v1**, admin readiness és védett API-k. A **14 megjegyzett bot**
  metadata megmaradt, plaintext titok **0**, provider nincs konfigurálva.
  `20261017-120938-926-phase25-8-local-activation.log`.
- Próbaállomány-takarítás **PASS, 86,393 s**: a három szintetikus világ,
  staging/retired/snapshot másolatai és az abortált próba vault-slotjai eltűntek;
  a közös függőség-junctionök külön, rekurzió nélkül kerültek lecsatolásra.
  A wrapper- és workerdiagnosztika privát helyi naplóban megmaradt.
  `20261017-121117-087-phase25-8-fixture-cleanup.log`.
  Végső publikációs audit és format **PASS, 1,586 s**:
  `20261017-121253-685-phase25-8-final-publish-gate.log`.

A teljes kör EBUSY temp-teardown instabilitása külön infrastruktúra-follow-up;
nem a világmentésből való visszaállítás hibája. Sem assertiont, sem timeoutot
nem gyengítettünk. Nincs `.canvas.tsx` artifact és nem indult hangolási kísérlet.

## 25.7 – Windows OS-titoktár (2026-10-17)

A providerkulcs, megjegyzett botjelszó és az új kezelt világ login privát
kulcsa/worker-tokenje Windows Credential Managerbe kerül, a kanonikus
workspace külön névterében. Az admin csak állapotot kap, nincs titokolvasó
HTTP-művelet. Régi fájlos/környezeti providerkulcs nem runtime fallback;
a migrátor csak igazolt vault-írás után változtatja meg a régi forrást.
Az új bot.env és runtime.json nem tartalmaz jelszót/tokent. A bot/skill
gyermekek engedélylistás környezetet kapnak és nem töltenek automatikus .env-t.

[Működés, migráció és rollback](features/phase25-7-os-secret-store.md).
Régi pinnelt világ ellenőrzött forrásmigrációja 25.8; ugyanazon OS-fiókon
belüli tetszőleges kód ellen külön OS-sandbox nincs késznek állítva.
A nyilvános upstream demonstrációs RSA-fixture kompatibilitási szerepe megmarad.

Ellenőrzések:

- Valódi Windows vault, két ideiglenes névtér, új instance-ból visszaolvasás,
  csere/törlés és LLM write-only adapter: **4/4 PASS**, root typecheck PASS,
  **23,751 s**. `20261017-105052-610-phase25-7-native-vault-first.log`.
- Migráció, konfliktus/hiba utáni forrásmegőrzés, bot/runtime és státusz
  értékmentesség: **19/19 PASS**, root/engine typecheck és format PASS,
  **35,803 s**. `20261017-105427-928-phase25-7-focused-boundaries.log`.
- Első valódi kétvilágos futás **FAIL, exit 1, 82,385 s**:
  `20261017-105859-804-phase25-7-native-world-vault.log`. Mindkét világ
  elindult és bot/provider/agent/mod beállítást kapott. A vault- és
  plaintext-mentességi assertionök sikeresek; egy későbbi agents-válasz
  nem tartalmazott listát. A diagnosztika státuszkód-ellenőrzést kapott;
  a futás nem elfogadott működési próba.
- Két diagnosztikai natív futás szintén FAIL: **54,826 s** és **59,813 s**,
  `20261017-110930-514-phase25-7-native-vault-final.log`,
  `20261017-111213-461-phase25-7-native-control-diagnostic.log`.
  A központ átmeneti `SERVER_GATEWAY_UNAVAILABLE` választ adott; közvetlenül
  utána mindkét worker azonosítottan ready volt, a vault és memória tokenje
  egyezett. A token-feloldás generációnként memóriában deduplikált; új generáció
  új OS-feloldást kap, külön teszt igazolja a váltást.
- Végső kétvilágos elfogadás **PASS, exit 0, 69,938 s**:
  `20261017-111335-900-phase25-7-native-readiness-acceptance.log`.
  A próba a dokumentált átmeneti offline állapotnál csak olvasó GET-et
  ismétel legfeljebb 30 s-ig; módosítást nem ismétel, minden izolációs,
  kulcsegyezési és fail-closed assertion megmaradt. E nélkül a korábbi
  futások hibás exitjeit nem minősítjük sikeresnek.
  Forrás-checkpoint: `53cb62d8ca4c128b40acccc60c82cc30d5597afd`.
  Két engine/gateway, külön bot/provider/login/worker titok, plaintext-mentes
  állományok, azonos botnév, saját adatok, stop/restart/archive és testvérvilág
  túlélése PASS. Restart után a bot vaultból feloldott, újra meg nem adott
  jelszóval belépett; host állományok hash-e változatlan, LLM-hívás 0.
- Egyszeri teljes regresszió **1223 pass / 1 hook fail / 0 skip**,
  **408,473 s**, exit 1. A régi `gateway-http-chat` beforeAll 5 s-os
  kapujába futott, így a fájl 15 esete ekkor nem futott. Format és mindhárom
  typecheck PASS. `20261017-105648-994-phase25-7-full-gate.log`, részletek:
  `20261017-105653-056-full.log`.
  Indok: tartós hitelesítő adatok, bot-/worker-hitelesítés és indítási határ
  változik; a fáziszárás önmagában nem indok.
- Pótlás: a gateway chat 15 esete és a végleges migráció/worker-generáció
  határok együtt **26/26 PASS**. Az utána maradó 30 domaincsomagból 29 PASS;
  a society-experiments két régi benchmark/XP-esete timeoutolt. Összesen
  **683 pass / 2 fail / 0 skip**, **268,792 s**, exit 1:
  `20261017-110412-073-phase25-7-focused-and-remainder.log`.
  Root/engine typecheck és format PASS. Külön a két időkorlátos eset
  **2/2 PASS**, **9,015 s**, változatlan assertion/timeout mellett:
  `20261017-110910-888-phase25-7-existing-xp-timeouts.log`.
  A futások együtt mind az **1899 külön tesztesethez sikeres eredményt**
  adtak. Az eredeti egybefüggő kapuk hibás exitje megmaradt; sikeres csomagok
  tömeges ismétlése nem történt. A két új alias/generáció eset a pótlásban futott.
- Kézi indítási kompatibilitás utólagos ellenőrzése: SDK-suite **184/184 PASS**,
  root/webclient typecheck és format PASS, **110,830 s**:
  `20261017-111715-479-phase25-7-sdk-vault-compatibility.log`.
  Natív CLI-vault/scope teszt **2/2 PASS**, **4,709 s**:
  `20261017-111920-093-phase25-7-manual-cli-vault.log`.
  Új bot generálásával együtt **3/3 PASS**, hálózati hibakimenetben nincs titok,
  generált jelszó sem template-ben, sem bot.env-ben nincs. Az első típusindítás
  PowerShell lib-argumentum hibával állt le (a 3 teszt sikeres maradt), majd
  JSON-tsconfiggal típus/format **PASS, 13,467 s**:
  `20261017-112034-822-phase25-7-entrypoint-closeout.log`,
  `20261017-112102-139-phase25-7-entrypoint-types.log`.
  A kézi runner/CLI, Lite és MCP adaptere azonos névhez kötött feloldót használ.
  Ezekkel az összesített külön tesztesetek száma **1902**, mindhez van PASS.
- Helyi migráció és aktiválás **PASS, 44,663 s**: **14 botjelszó** átkerült
  az OS-vaultba, nincs régi aktív managed világ, identity v1/registry v2 maradt,
  admin readiness PASS. Utóellenőrzés **PASS, 1,022 s**: 14 vault-jelölt bot,
  0 korábbi plaintext titok, providerkulcs nincs beállítva.
  `20261017-110958-469-phase25-7-local-migration-ready.log`,
  `20261017-111424-499-phase25-7-local-vault-postcheck.log`.
- Helyi aktiválási preflight **PASS, 0,526 s**: nincs aktív kezelt világ.
  `20261017-110138-023-phase25-7-activation-preflight.log`.

GitHub/adatvédelem:

- A repó nyilvános fork; a private PATCH GitHub 422-vel elutasult.
  A felhasználó ezután kifejezetten a nyilvános állapot megtartását kérte,
  ha nincs feltöltött érzékeny adat. Leválasztás vagy metaadattörlés nem történt.
- A teljes aktuális követett fájlkészletből **7804 szöveges / 6306 bináris**
  állomány került leltárba; a fork saját publikált előzményeiből **12 379 809
  bájt diff** vizsgálata készült. **Valódi saját titok a fájltartalomban nem került
  elő.** A két szöveges találattípus: ismert szintetikus tesztkulcs, illetve
  a nyilvános upstream demonstrációs privát login-kulcs. Utóbbi Git-blobja
  byte-ra egyezik upstream/main megfelelő fájljával; a saját változások
  között bináris nincs. Értékeket nem másoltunk auditkimenetbe.
  Audit **PASS, 183,193 s**: `20261017-105256-876-phase25-7-repository-audit-bounded.log`.
- Külön commit-metaadatellenőrzés személyes Gmail-címet talált **128 korábbi
  commitnál**. Ez nem API-kulcs, de személyes adat; a felhasználó külön döntését
  kértük a nyilvános állapotról; a felhasználó kifejezetten elfogadta a meglévő
  commitemailt és a nyilvános repót. Az e-mail-címet nem másoltuk dokumentációba
  vagy kimenetbe. PR-metaadatban vizsgált titok/személyes útvonal nem volt.
- A GitHub 14 napos adatai: **3 views / 1 unique visitor, 3 clones / 3 unique
  cloners**. Személyazonosító nincs a statisztikában, ezért harmadik fél
  hozzáférése nem állapítható meg biztosan. Az adatok privát helyi JSON-ban
  maradnak. Az egy meglévő PR metaadatairól privát mentés készült.

A naplók, auditok és próbavilágok a privát `.local/verification/` alatt maradnak.

Publikálás előtti végső format/link/privacy kapu **PASS, 1,675 s**:
`20261017-112325-901-phase25-7-final-publish-gate.log`. Új valódi titok vagy
személyes kimenő commit-metaadat nem került elő; módosított bináris nincs.
A korábbi személyes commitemail a felhasználó kifejezett döntésével megmarad.

## 25.6 – kötelező admin-szerverkontextus (2026-10-17)

A régi bot/world/property/gazdasági/agent/AI/társadalmi nézetek minden domain-
kérése a dokumentum rögzített serverId-ját viszi. A központi proxy a kiválasztott
regisztrált/lifecycle-gatewayt választja, friss ownership ellenőrzéssel,
kezelt világnál azonosított worker-kapcsolattal. A gateway összeveti a fejlécet
a saját resource ID-jával. Nincs implicit local-default API-visszaesés.
Az eltérő backendválasz visszatartott; a status cache/pending probe szerverenként
külön van, a session/ownership nem cache-elt.

A saját szerverkártyákból bármely támogatott világ adminja megnyitható,
leállítva is. A név/ID a fejlécben marad, a saját backend kiesése nem vált
másik szerverre. Két lap külön kontextusú, az admin-token tárolása is különül.
Szerverváltás új dokumentum; History API-val átírt context után a régi lap
műveletet nem küldhet. A managed ownernek nem kell local-default ownernek lennie.

Használat, kérésprotokoll, pinning és rollback:
[25.6 admin szerverkontextus](features/phase25-6-admin-server-context.md).
A 25.7 titoktár és későbbi felügyelet/távoli RBAC nem része e lépésnek.

Ellenőrzések:

- Első szerződésváltási kör **21 pass / 6 fail / 0 skip**, **6,542 s**:
  korábbi implicit default-kérésekből hiányzott a context fejléc, a közvetlen
  gateway root 200 helyett saját context URL-re irányító 303, a nem-owner
  domain-hozzáférés explicit kontextussal 404. A fixture-ök az új szerződésre
  álltak, auth/CSRF assertionök megmaradtak.
  `20261017-002618-621-phase25-6-initial-boundary.log`.
- Következő control-plane/Chrome kör **34 pass / 1 fail / 0 skip**,
  **25,581 s**: a korábbi account UI-teszt ideiglenes SQLite-takarítása
  Windows `EBUSY` hibát kapott. A takarítás csak ezen esetben korlátozott
  filesystem retryt kapott (max. 5, 50 ms); assertion/termékkapu nem változott.
  `20261017-002731-058-phase25-6-context-quality.log`.
- Célzott store/proxy/ownership kör **28 pass / 0 fail / 0 skip**, root
  typecheck PASS, **23,575 s**:
  `20261017-002909-695-phase25-6-routing-focused.log`.
- Új kétlapos böngészőteszt első futása **3 pass / 1 fail / 0 skip**, login
  navigációs timeout a második lap előzetes megnyitása mellett. A második lap
  a login után nyílik. A célzott javított eset **1/1 PASS**, root typecheck /
  format PASS, **24,686 s**:
  `20261017-003029-044-phase25-6-browser-context.log`,
  `20261017-003152-629-phase25-6-two-tabs-focused.log`.
  Azonos fiók, két világ, A/B név és ID, csak B-re mentett AI-beállítás,
  A változatlansága, history-átírás utáni elutasítás, saját offline shell PASS.
  Chrome 1440 px és 390 px screenshotok vizuálisan ellenőrizve, nincs
  vízszintes mobil kilógás. Képek: `phase25-6-server-context-desktop.png`,
  `phase25-6-server-context-mobile.png`.
- Végső backendhatár-kör **19 pass / 0 fail / 0 skip**, root typecheck és
  privacy PASS, **21,926 s**:
  `20261017-003319-185-phase25-6-checkpoint-gate.log`.
  Hiányzó/ütköző context, minden domain azonos ID-jának két világba irányítása,
  közvetlen gateway mismatch, külön availability cache, azonnali revokáció,
  hamis backendválasz visszatartása és nem azonosított worker elutasítása PASS.
- Valódi kétvilágos központi proxypróba **PASS, exit 0, 40,723 s**:
  `20261017-003434-839-phase25-6-native-proxy-context.log`.
  Forrás: `6ede42ea1c75378839f91250bcfd299967882c98` checkpoint.
  Minden bot-, agent-, LLM- és modmódosítás a külön control-plane HTTP-n,
  explicit server contexttel ment át két tényleges engine/gatewayhez.
  Saját válaszfejlécek egyeztek, implicit/ütköző központi context 400/409,
  idegen owner 404, közvetlen gateway context nélkül 400, másik ID-val 409.
  Azonos botnév két világban, külön agent/mod/konfig/titok/audit/mentés/cache,
  saját browser proxy, stop/restart/archive és testvérvilág túlélése PASS.
  Host AgentState/config hash-e változatlan; a tesztvilágok leálltak,
  LLM-hívás nem volt.
- Egyszeri teljes regresszió: **1232 pass / 1 fail / 0 skip**, a teljes kapu
  exitje 1, **155,980 s**. Format és root/engine/webclient typecheck PASS,
  mind a négy Chrome-eset PASS. A registry-tesztsegéd az explicit másik
  szerverű oldalnak még local-default fejlécet adott: az elvárt 404 helyett
  helyesen 409 context konfliktus keletkezett. A page fixture a böngészőhöz
  hasonlóan csak querykontextust küld; a termék és az assertion változatlan.
  `20261017-003558-765-phase25-6-full-gate.log`, részletes gyökércsomag:
  `20261017-003559-609-full.log`.
  Indok: a központi és gateway jogosultsági útválasztás több modult érint;
  a fáziszárás önmagában nem indok. Statikus helyi packed cache,
  bot/LLM/élő társadalmi kísérlet nélkül.
- Javított registry **3/3 PASS**, utána a hátralévő domaincsomagok
  **659/659 PASS**; root typecheck és format PASS. Együttes pótlókapu
  **662 pass / 0 fail / 0 skip**, **156,939 s**, exit 0:
  `20261017-004051-924-phase25-6-full-remainder.log`.
  A gyökércsomag és a pótlás együtt az összes **1892 külön tesztesethez**
  sikeres eredményt adott; a két már korábban zöld registry-eset a saját
  fájljában ismét lefutott. A többi sikeres gyökérteszt nem ismétlődött.
  Az eredeti egybefüggő teljes kapu exitje ettől továbbra is 1.
- Helyi admin aktiválás privát konzisztens identity/registry backup után:
  **PASS, exit 0, 2,893 s**. `/health`, login és védett végpontok kapui,
  identity v1 és registry v2 readiness PASS. Engine/gateway/bot állapotot
  az aktiválás nem módosított.
  `20261017-004113-749-phase25-6-local-ready.log`.
- Publikálás előtti format/link/privacy kapu **PASS, exit 0, 1,402 s**:
  `20261017-004355-619-phase25-6-closeout.log`. A kumulatív publikálandó
  szöveges állományok ellenőrzése 0 érzékenyadat-blokkolót és 0 személyes
  kimenő commit-metaadatot talált; módosított bináris nincs. Privát
  adatbázis, mentés, kulcs és futási napló nem kerül a verziókövetésbe.

A naplók és bizonyítékok a privát `.local/verification/` alatt maradnak.

## 25.5 – kezelt világok elkülönítése (2026-10-16)

Az instance binding a saját workspace-hez, forrásverzióhoz és hat porthoz
köti a futtatást. Az összes admin-domain fájlútvonala a saját világ alá esik;
indítás előtt a módosítható állapotban junction/symlink és hard link nem
kapcsolhat másik világhoz. A gateway-modul forrásgyökere és a worker cwd-je
is ellenőrzött. Identity és registry központi marad, domain SQL-séma nem változik.

A bot/skill kizárólag a saját engine/gateway címét és Lite cache-ét kapja;
idegen tárolt vagy kért végpont hibás. A böngészős engine `/gateway` proxy
fix 7780-as címe is példányhoz kötött. A gyermek engedélylistás környezetből
indul, `--no-env-file` mellett, provider/admin/worker titkok nélkül.
Külön login-kulcspár és a saját nyilvános paraméterekkel fordított kliens
készül. A gateway leállításkor kizárja az új gyermekeket, lezárja a saját
bot/skill handle-jeit; utána az engine ment és leáll. Marker-PID alapján
kezelt módban nincs adoptálás vagy idegen folyamat leállítása.

Határok és a korábbi prepared formátum kifejezett migrációs igénye:
[25.5 szerverizoláció](features/phase25-5-server-isolation.md).
A logikai elkülönítés a megbízható helyi OS-fiók alatt működik; a telepített
függőségkód közös, a domainállapot nem. A 25.6 szerverkontextus, 25.7 OS-/
szolgáltatói titoktár és 25.8 általános verziómigráció/felügyelet nyitott marad.

Ellenőrzések és körválasztás:

- Első runtime/legacy-marker/engine-supervisor kör **12 pass / 0 fail /
  0 skip**, root typecheck PASS, **37,143 s**:
  `20261016-210423-555-phase25-5-initial-types-runtime.log`.
- Új izolációs esetek első köre **15 pass / 1 fail / 0 skip**, **1,781 s**:
  a fixture junctionjának Windows Bun `rm` hívása EFAULT-tal hibázott.
  A hard link próbája külön fixture-világba került, az alias-elutasító
  assertionök megmaradtak. `20261016-210607-766-phase25-5-isolation-focused.log`.
- Javított izolációs kör **16 pass / 0 fail / 0 skip** és root/engine/webclient
  typecheck + format **PASS, 1 perc 3,836 s**:
  `20261016-210636-106-phase25-5-isolation-quality.log`.
  Két eltérő privát kulcs/kliens, pontos replay, régi profil elutasítása,
  idegen endpoint, credentials/env titokszűrés, modulgyökér, junction/hard link,
  saját handle helyetti marker elutasítása, késői skillindítás tiltása.
- A módosított határok regressziója **101 pass / 0 fail / 0 skip**,
  **53,493 s**, `20261016-211250-520-phase25-5-affected-boundaries.log`.
  Kör: teljes control-plane/Chrome, admin-safety/audit, marker és engine-
  supervisor, LLM-settings, world-mods, autonomy-supervisor, SDK gateway HTTP.
- Valódi próba első két kísérlete FAIL: **38,708 s** az egy folyamatban futó
  Bun HTTP kapcsolat időtúllépése; a teszt azóta friss HTTP-kapcsolatot kér
  és naplózza a lépést, változatlan 10 s timeouttal. Következő **38,574 s**
  kísérletben az agent-fixture üres personalityTraits listáját az érvényes
  1–12 elem szabály helyesen elutasította; a fixture egy szintetikus traitet
  kapott, termékvalidáció nem lazult. Saját tesztfolyamatok leállítva.
  Naplók: `20261016-210958-982-phase25-5-native-isolation.log`,
  `20261016-211108-981-phase25-5-native-isolation-bounded.log`.
- Valódi kétvilágos próba **PASS, exit 0, 46,445 s**:
  `20261016-211237-341-phase25-5-native-isolation-valid-fixture.log`.
  Forrás: `0b6762d11f1d568c6352c0095baafb1be0fa3e6f` checkpoint.
  Egy owner két világban azonos `isotest` botnévvel, két valódi engine/gateway,
  12 külön port. Külön agent rekordok, bot.env/végpont, natív játékosmentés,
  hot-reloadolt mod, LLM-konfig, szintetikus titok, audit, cache és login-kulcs/
  böngészőkliens igazolt. Mindkét böngészős proxy SDK-sessionje csak a saját
  gatewayben jelent meg. Az egyik stop/archive-ja alatt a másik futott;
  saját botgyermek megszűnt, másik bot életben maradt. Restart megőrizte a
  konfigurációt; végül mindkét világ archivált és leállt, mentései megmaradtak.
  Független admin health 200; a host AgentState/config hash-ei változatlanok.
  LLM-hívás és hosszú társadalmi/paraméterhangolási futás nem történt.
- Archivált állapot külön olvasása **PASS, exit 0, 0,465 s**:
  `20261016-211431-607-phase25-5-retained-isolation.log`. A két modbeállítás
  és backup külön maradt; egyik szintetikus provider-titok sincs egyik auditban.
- Az utolsó, bizonytalan marker felülírását is tiltó indítási kapu célzott
  ellenőrzése **8 pass / 0 fail / 0 skip**, root typecheck és format PASS,
  **41,954 s**: `20261016-211624-488-phase25-5-final-marker-boundary.log`.
  Korábban sikeres engine/webclient és kétvilágos próbát ez a szűk új
  elutasítás nem érint; nem ismételtük őket.
- A helyi registryben nincs korábbi kezelt világ, amely offline profilmigrációt
  igényelne. A control-plane-t leállítás és privát identity/registry backup
  után újraindítottuk az `111eda9f7` végleges kódverzióval. Identity v1,
  registry v2, független health és loginhoz kötött lista/katalógus readiness
  **PASS, exit 0, 3,017 s**:
  `20261016-211809-656-phase25-5-local-activation.log`.
  A későbbi dokumentációs commit nem módosítja a futó kódot/katalóguskötést.
- A feature/progress/TASKS formázás és hivatkozások, valamint a végleges
  forrás/kódcommitok privacy ellenőrzése **PASS, exit 0, 1,511 s**,
  0 blokkoló találat:
  `20261016-211853-283-phase25-5-final-docs-privacy.log`.
- Teljes regresszió nem futott újra: nincs új SQL-séma, közös gazdasági/clock
  tranzakció, HTTP account/session/ownership kapu, runtime-függőség vagy
  globális buildkonfiguráció változás. A per-instance kulcs a már létező
  bundler-paramétereket használja. Az érintett felületi, folyamat-, adatútvonal-
  és kapcsolat-határokat célzott kör és valódi kétvilágos próba fedte le.

A naplók és szintetikus világok privát `.local/verification/` állományok,
nem részei a commitnak. A következő fejlesztési feladat a 25.6.

## 25.4 – helyi szerveréletciklus (2026-10-16)

Megvalósult a felületi létrehozás, a valós helyi Git-commit kiválasztása,
két alkalmazott gazdasági világsablon és az indítás/leállítás/újraindítás/
archiválás. A létrehozás külön workspace-et készít; a meglévő admin és
korábbi világ adatait nem másolja új játékosállapotként. Bot és AI nem indul.

A registry v2 additív migrációja megőrzi a v1 rekordokat. Tartós intent,
actorhoz kötött idempotens request key, revízió és műveletenkénti audit védi
a lifecycle-t. Az új szerver a létrehozóhoz kötődik, a gateway is ezt az
erőforrást ellenőrzi. Hat lefoglalt port, verzióhoz kötött workspace és
hitelesített, generációhoz kötött helyi vezérlés tartozik minden példányhoz.
Az archiválás megőrzi az adatokat és a portfoglalást. Az admin újraindítása
után a félbemaradt művelet azonosított leállítás + megszakadt állapot,
nem automatikusan újrajátszott indítás.

Használat, részletes határok és backup/rollback:
[25.4 szerveréletciklus](features/phase25-4-server-lifecycle.md).
A teljes izoláció (25.5), a régi admin szerverkontextusa (25.6), titoktár
és a további üzemeltetési képességek külön, nyitott feladatok maradnak.

Ellenőrzések:

- Store/HTTP/jogosultsági célzott kör: **21 pass / 0 fail / 0 skip**,
  **11,773 s**; `20261016-202906-596-phase25-4-lifecycle-focused.log`.
- Control-plane, Chrome, Windows process és admin-safety kör: **34 pass /
  0 fail / 0 skip**; root typecheck, PowerShell és format PASS,
  **88,938 s**; `20261016-203151-776-phase25-4-affected-ui.log`.
  A Chrome-próba a felületi létrehozás, műveleti eredmény, látható hiba,
  archiválás és mobil tördelés útját végigjárta. A desktop és 390 px mobil
  képek vizuálisan ellenőrizve; nincs vízszintes kilógás.
- Első valódi próba: FAIL, **18,669 s**, a Windows tar két upstream
  dokumentációs symlink létrehozását elutasította. Csak ezt a két runtimehoz
  nem szükséges bejegyzést zárjuk ki; nem hagyjuk figyelmen kívül a tar hibáit.
  A második próba **4 perc 3,732 s** után HTTP-kapcsolati hibával megszakadt;
  a saját tesztvilágot hitelesített vezérléssel leállítottuk. A próbában azóta
  minden HTTP-kérés időkorlátos és a választest fogyasztott/lezárt.
  Sikertelen naplók: `20261016-203501-988-phase25-4-native-lifecycle.log`,
  `20261016-204029-155-phase25-4-native-lifecycle-repaired.log`.
- Kibontási regresszió: **3 pass / 0 fail / 0 skip**, **1,397 s**;
  `20261016-204253-307-phase25-4-export-regression-repaired.log`.
  Az első minimális fixture-ből hiányzó verziózott engine/webclient
  szülőkönyvtár miatt 2 pass / 1 fail volt (1,417 s); a fixture javult,
  assertion és termékviselkedés nem lazult.
- Valódi kétvilágos próba: **PASS, exit 0, 34,144 s**;
  `20261016-204455-119-phase25-4-native-lifecycle-bounded.log`.
  Forrás: `60f1ae347152982d8dba371d2345aa0e0c46b62d` checkpoint.
  Két külön fiók, két sablon, 12 külön port, tényleges engine/gateway/client
  HTTP, saját gateway 200 / másik tulajdonos 403, stop/restart/archive,
  másik világ közbeni elérhetősége, adatmegőrzés és friss runtimeból
  visszakapcsolódás PASS. A külön admin a végén is 200; a korábbi gyökér
  AgentState-adatbázis hash-e változatlan. A tesztvilágok leálltak,
  bizonyítékaik a privát `.local/verification/` alatt maradnak.
- Teljes regressziós kísérlet: a registry-migráció és a gateway több modult
  érintő erőforrás-jogosultsági változása indokolta. Az első indítás a
  tesztek előtt, **43,318 s** után az új fixture
  `spawnSync` stdin típusánál megállt (exit 2); a helper most fájlból adja
  át a Gitnek a szintetikus symlink célját.
  `20261016-204615-795-phase25-4-full-gate.log`.
  A javított kísérletben format és root/engine/webclient typecheck PASS;
  **1529 pass / 1 fail / 0 skip**, **6 perc 47,974 s**. A régi
  `native completed day pairs…` XP-teszt 15 s időkorlátja szakította meg
  a láncot; az érintett control-plane tesztek átmentek.
  `20261016-204723-379-phase25-4-full-gate-repaired.log`, belső részletes
  napló: `20261016-204724-189-full.log`. Ez nem zöld teljes `check` exit.
  A hibás XP-teszt külön, változatlan assertionökkel és timeouttal
  **1/1 PASS, 13,049 s**: `20261016-205436-408-phase25-4-existing-xp-focused.log`.
  A lánc hátramaradt részében **349 pass / 0 fail / 0 skip**, **33,980 s**;
  a helyi folytató helper túl szűk névellenőrzése a legutolsó,
  számot tartalmazó `test:phase22-acceptance` script előtt megállt (exit 1).
  `20261016-205506-691-phase25-4-remaining-regression.log`.
  Csak ez az el nem indult script futott még le: **6 pass / 0 fail / 0 skip**,
  **0,739 s**, `20261016-205606-608-phase25-4-remaining-phase22.log`.
  A konfigurált teljes kör így összesen **1885 sikeres teszttel lefedett**
  több futásban; az egybefüggő `check` továbbra is FAIL. Nem ismételtünk
  sikeres csomagot pusztán zöld exitért. A teljes kísérlet után a célzott
  XP-ellenőrzés és az el nem indult csomagok összesen további **47,768 s**
  parancsidőt igényeltek. Az XP-futásidő intermittenciája külön
  tesztinfrastruktúra-probléma marad; a 25.4 termékkapu sikeres.
- Publikálási privacy vizsgálat: **PASS, exit 0, 0,952 s**, 707 vizsgált
  szöveges fájl, 0 módosított bináris, 0 blokkoló találat és 0 személyes
  kimenő commit-metaadat; `20261016-205103-332-phase25-4-publish-privacy.log`.
- A helyi admin leállítása után az identity/registry és meglevő WAL/SHM
  állományok privát backupba kerültek. A szolgáltatás az ellenőrzött kóddal
  újraindult; identity v1, registry v2, független health, login és védett
  szerverlista/katalógus API **PASS, exit 0, 3,021 s**:
  `20261016-205635-566-phase25-4-local-ready-migration.log`.
  A katalógus az aktiváláskor commitolt `f75243ad2` kódverzióhoz kötődik.
  A későbbi dokumentációs commit nem módosítja a futó világforrást.
- Végleges feature/progress/TASKS linkek, formázás és kódcommit utáni
  privacy ellenőrzés **PASS, exit 0, 1,562 s**, 0 blokkoló találat:
  `20261016-205718-341-phase25-4-final-docs-privacy.log`.

Az itt felsorolt naplók a privát `.local/verification/` alatt találhatók.
Nincs hosszú társadalmi vagy paraméterhangolási kísérlet.

## 25.3 – szerverregiszter és Saját szervereim (2026-10-16)

Elkészült a saját kezdőoldal és a külön v1 `servers.sqlite` metaadattár.
Induláskor a már konfigurált helyi backend exact, idempotens `local-default`
regisztrációt kap; eltérő binding ugyanazon ID alatt konfliktus. A regisztráció
és audit atomikus, restart után a rekord/timestamp változatlan. A regiszter
önmagában nem ad jogosultságot és nem talál ki szervereket ownership sorokból.

A lista és részlet csak a bejelentkezett fiók meglévő ownership rekordjaihoz
tartozó szervereket adja vissza. Idegen és hiányzó rekord egyforma 404;
belső endpoint/fájlútvonal nem kerül a DTO-ba. Üres/idegen lista nem indít
backendlekérdezést. Csak a konfigurációhoz pontosan kötött default backend
kapja a meglévő cache-elt health próbát és a megnyitható admin URL-t;
egyéb regisztrált metadata nem válik önkényes proxy-/probe-céllá.

Login után a „Saját szervereim” minden fióknak kezdőoldal. Van betöltés,
üres lista, olvasható hiba, Frissítés/újrapróbálás, mobil tördelés, fióknavigáció
és a korábbi helyi admin megnyitása. Nem-default ID nem nyithatja meg
véletlenül ugyanazt a régi admint. A régi domain API tulajdonosi kapuja megmarad.
Új világ létrehozása/indítása/archiválása és teljes több-szerveres elkülönítés
a következő külön pontok. A következő fejlesztési feladat a 25.4.

Használat, invariánsok, konfiguráció és backup/rollback:
[25.3 szerverregiszter](features/phase25-3-server-registry.md).

Ellenőrzés és körválasztás:

- Első célzott kör: **22 pass / 1 fail / 0 skip**, **21,325 s**.
  Egy új teszt tévesen 403-at várt jogosulatlan HTML-megnyitásra; a már
  meglévő biztonságos viselkedés loginra irányító 303. A javított teszt a
  státuszt és a pontos login Location fejlécet ellenőrzi; az API 403/404
  ellenőrzései megmaradtak. Nincs assertion-eltávolítás vagy termékkapu-lazítás.
  `.local/verification/20261016-201101-569-phase25-3-registry-focused.log`.
- Végső érintett kör: **36 pass / 0 fail / 0 skip**, root TypeScript,
  PowerShell syntax/helper és format PASS, összesen **49,091 s**:
  `.local/verification/20261016-201244-721-phase25-3-affected-quality.log`.
  Kör: `server/control-plane/test`, Windows process/launcher és gateway
  `admin-safety.test.ts`. Store restart/idempotencia/konfliktus/audit-rollback,
  idegen/saját/üres lista, azonnali revokáció, kötött endpointok, login/account
  regresszió és Chrome lista-hiba → újrapróbálás → régi admin lánc PASS.
- Chrome 1440 px és 390 px képek vizuálisan ellenőrizve:
  `.local/verification/phase25-3-servers-desktop.png`,
  `phase25-3-servers-mobile.png`. Nincs vízszintes mobil kilógás.
- Teljes regresszió nem futott: új, izolált metadata-séma és célzott lista/
  navigáció változott, identity v1/account/session/domain kapu, engine,
  gazdasági persistence és webclient build nem. A root tsconfig kizárólag
  az új registry-tesztet veszi fel ellenőrzésre; compiler-opció és runtime
  tesztfelderítés nem változott. A végleges érintett kör az alkalmazott kapu.
- A saját regisztrált admin újraindítása, a loginhoz kötött homepage/API
  readiness, végső format és publikálási privacy ellenőrzés **PASS, exit 0,
  3,416 s**; személyes adat/titok vizsgálatában 0 blokkoló találat:
  `.local/verification/20261016-201517-625-phase25-3-local-ready-privacy.log`.
  A helyi szolgáltatás már az új registryvel fut. A `.local` adatfájlok és
  képek nem kerülnek a commitba.

Valódi felhasználói fiók vagy új játékvilág nem készült. A további registry/
ownership rekordok izolált fixture-ök; nem több világ működésének bizonyítékai.
Bot, játékstack, éles LLM vagy hosszú társadalmi kísérlet nem indult.

## 25.2 – fiókok és tulajdonosi jogosultságok (2026-10-16)

Megvalósult a külön v1 identity SQLite-tár, helyi egyszeri tulajdonos-bootstrap,
normalizált felhasználónév, aszinkron Argon2id jelszótárolás, 8 órás lejáró
HttpOnly/SameSite session, login/logout és minden sessiont érvénytelenítő
jelszócsere. A fiók- és jogosultsági felület backendek nélkül is működik.
Új fiók csak tulajdonostól jöhet létre, alapból szerverjogosultság nélkül.
Megadás/visszavonás atomikus audittal; az utolsó tulajdonos nem távolítható el.

A jelenlegi helyi backend a `local-default` erőforrás; nincs új szerverregiszter
vagy több világ létrehozása. A control plane és a gateway HTTP-határa ugyanazt
a sessiont és tartós tulajdonjogot ellenőrzi. Hiányzó/hibás identity DB-nél a
gateway zárva marad; nincs visszaesés a korábbi helyi bypassra. A proxy csak a
validált session cookie-ját továbbítja, egyéb cookie-t nem; a meglévő backend
ADMIN_TOKEN kapu megmarad. CSRF, pontos origin/intent, 8 KiB JSON, tartós
login-kísérlet-korlát és KDF-konkurenciakorlát védi a fiókműveleteket.

A root gateway HTTP dispatcher a külön `admin/entry.ts` modult használja.
Ez a domainhandler előtt végzi a jogosultságvizsgálatot; a régi domain unit
tesztek izolált kontextusukkal futnak, valódi helyi fiókot nem olvasnak.
Külön integráció igazolja a termelési HTTP-belépési pont korábban publikus
config/statikus útvonalait és a control-plane → gateway session/CSRF átvitelt.

Részletek, használat, migráció/backup/rollback:
[25.2 fiókkezelés](features/phase25-2-accounts.md).
Valódi felhasználót/jelszót nem hoztunk létre, csak izolált tesztfiókokat.
A runtime fióktár, screenshot és napló nem publikálandó. `.canvas.tsx`, bot,
LLM-hívás vagy hosszú társadalmi paraméterkísérlet nem készült/indult.

Ellenőrzési kör és indok:

- Kezdeti control-plane/store/HTTP/Chrome/admin-safety: **27 pass / 0 fail /
  0 skip**, **26,312 s**:
  `.local/verification/20261016-194512-917-phase25-2-focused.log`.
- Kibővített Chrome account/grant/revoke/nem-tulajdonos folyamat, gateway
  entry, CLI és Windows indítás: **20 pass / 0 fail / 0 skip**, PowerShell
  syntax/helper PASS, összesen **32,362 s**:
  `.local/verification/20261016-194641-651-phase25-2-boundaries.log`.
- A teljes kapu első indítása **FAIL, exit 2, 24,623 s**, még a root
  TypeScriptnél, regressziós tesztek előtt. A telepített Bun SQLite típusai
  `immediate()` eredményét voidnak jelölik; explicit, commit utáni eredmény-
  átvétel javítja ezt. Assertion vagy teszt-timeout nem változott.
  `.local/verification/20261016-194945-385-phase25-2-full-local-cache.log`.
- A javított teljes kapu **1871 pass / 0 fail / 0 skip**, exit 0,
  format + root/engine/webclient TypeScript PASS, **6 perc 7,982 s** belső
  parancsidő (külső cache-wrapperrel **6 perc 8,929 s**):
  `.local/verification/20261016-195123-069-full.log`, wrapper:
  `20261016-195122-286-phase25-2-full-repaired.log`.
  Indoka a két HTTP-szolgáltatás közös hitelesítési/jogosultsági határának
  módosítása; nem a fázisváltás miatt futott teljes regresszió.
- A teljes kapu után a névvalidáció kizárja a sorvégi karaktereket is, és a
  gateway az admin HTTP-kaput már a WebSocket upgrade előtt lefuttatja.
  Ezek szűk szigorításait célzottan ellenőriztük: **12 pass / 0 fail / 0 skip**,
  root TypeScript, format és privacy PASS, összesen **21,121 s**:
  `.local/verification/20261016-195829-024-phase25-2-final-input-boundary.log`.
  A teljes nagy csomag nem futott újra ezért vagy dokumentációs utómunkáért;
  a teljes és a végső célzott eredmény külön bizonyíték.
- Publikálható források privacy vizsgálata **PASS, exit 0, 14,246 s**:
  `.local/verification/20261016-195405-892-phase25-2-privacy.log`.
- A saját regisztrált helyi admin újraindítása és olvasó readiness-próba
  **PASS, exit 0, 2,447 s**: health/login elérhető, adminroot 303 loginra,
  session/backendstatus/adminconfig bejelentkezés nélkül 401.
  `.local/verification/20261016-195941-589-phase25-2-local-admin-ready.log`.
  Játékstack vagy bot nem indult. A következő fejlesztési pont a 25.3,
  szerverregiszter és „Saját szervereim” kezdőoldal.

Chrome képek izolált adatokkal, vizuálisan ellenőrizve:
`.local/verification/phase25-2-login-mobile.png` (390 px),
`phase25-2-owner-accounts.png` (1024 px). A mobil login nem lóg ki oldalra;
a fióklista és a megadás/visszavonás műveletei olvashatók.

## 25.1 – önálló helyi adminszolgáltatás (2026-10-16)

Elkészült a külön Bun HTTP-folyamat a `127.0.0.1:7781/admin/` címen.
Saját start/stop és ignorált folyamatregiszter/napló tartozik hozzá; a játékstack
leállítása nem állítja le. A statikus admin a gatewayjel közös modulból érkezik.
A control plane nem nyit domain-adatbázist, nem indít botot, LLM-et vagy
SimulationClock/autonómia loopot. Kizárólag a helyi emulátorhoz kapcsolódik.

Külön `/health` és backendállapot-végpont, 1 s-os probe/monotón cache,
független UI-kapcsolatjelzés és újrapróbálkozó bootstrap működik. A teljes
adminoldal gateway és engine nélkül is betöltődik; a gateway visszatérésekor
oldalújratöltés nélkül befejezi az adatbetöltést. Kezdeti offline világtérkép-
kattintás nem okoz kezeletlen script-hibát.

Csak `/api/admin/*` API-közvetítés van, rögzített helyi originre. Módszer,
query, törzs és a felhasználó által megadott hitelesítés megmarad; nincs
tokeninjektálás, cookie-továbbítás vagy tetszőleges proxycél. Idegen origin,
cross-site kérés és intent nélküli mutáció elutasításra kerül. Redirectet
nem követ; GET-hiba 503, mutációnál ismeretlen kimenetelt jelző 503 és
állapot/audit ellenőrzését kérő üzenet. Nincs automatikus mutációismétlés.

V1 admin runtime JSON került külön `.local/control-plane` gyökérbe, gazdasági
séma nem változott. PID/indulási idő és OS-fájllock védi a saját indítást/
leállítást. Foglalt portot nem szabadít fel idegen folyamat kilövésével.
Ismeretlen regiszterverzió elutasít. A végleges Windows indító rejtett shell
indítással saját konzolt használ, a szolgáltatás maga írja privát naplóját:
így nem tartja nyitva a kimenetet elfogó hívó pipe-jait.

Használat, konfiguráció, biztonsági határ, állapot/migráció/rollback:
[Phase 25.1](features/phase25-1-admin-control-plane.md).
Fiókok/jogosultságok, szerverregiszter és több világ elkülönítése nincs
beleértve. A következő TASKS pont a felhasználói bejelentkezés és tulajdonosi
jogosultságok. `.canvas.tsx` és hosszú társadalmi/paraméterhangolási futás nincs.

Ellenőrzés:

- Kezdeti javított teljes control-plane suite: **9 pass / 0 fail / 0 skip**,
  root TypeScript és PowerShell syntax/helper PASS:
  `.local/verification/20261016-162424-907-phase25-1-control-plane-repaired.log`.
- Érintett control-plane/admin-safety/engine-supervisor/society-dashboard kör:
  **26 pass / 0 fail / 0 skip**, format és root/engine/webclient TypeScript PASS:
  `.local/verification/20261016-162721-624-phase25-1-affected-quality.log`.
- Végleges natív HTTP POST-átvitel, timeout és ismeretlen mutációs kimenetel:
  **6 pass / 0 fail / 0 skip**:
  `.local/verification/20261016-163026-070-phase25-1-native-proxy-final.log`.
- Teljes `verify:full` / `check`: **1861 pass / 0 fail / 0 skip**, 31 tesztkör,
  exit 0, format és mindhárom TypeScript PASS, a meglévő csak olvasó packed-cache
  segéddel. A régi 24.8 XP-teszt és változatlan időlimitje ebben a körben PASS:
  `.local/verification/20261016-162909-846-full.log`, wrapper:
  `.local/verification/20261016-162909-024-phase25-1-full-local-cache.log`.
- A teljes kör után a default háttérindítás próbáján kiderült, hogy Windows
  átörökített kimenetkezelők miatt a verification hívó az admin leállításáig
  várhat. Ezt a rejtett saját konzol/saját log indítás javítja. Szigorított
  processzteszt már az indító stdout/stderr EOF-ját is megköveteli a szolgáltatás
  futása közben: **2 pass / 0 fail / 0 skip**:
  `.local/verification/20261016-163742-533-phase25-1-detached-launcher.log`.
  A teljes nagy regressziót e szűk launcher/log pontosításért nem ismételtük meg.
- A végleges default indítás **PASS**, a hívó 2 s alatt visszatér, az admin
  tovább fut: `.local/verification/20261016-163824-787-phase25-1-admin-ready.log`.
- A launcher/log pontosítás után root TypeScript, PowerShell syntax/helper,
  format és adatvédelmi vizsgálat **PASS**:
  `.local/verification/20261016-164002-005-phase25-1-final-quality-privacy.log`.

A publikálás előtti CI-rendezés a két Windows folyamatpróbát külön
`server/control-plane/windows-test` suite-ba tette, a normál root tesztekben
a 7 hordozható HTTP/böngészős eset marad. A Windows GitHub job kifejezetten
futtatja a két OS/launcher esetet, Bun 1.3.14 telepítése után. A fenti teljes
1861-es kör még az egy könyvtárban lévő 9 esetet tartalmazta; a rendezés
útvonalváltozás, nem assertion-kivétel vagy elnémított platformhiba.
A végleges CI-útvonalról futó Windows suite **2/2 PASS**, root TypeScript,
PowerShell helper/syntax, format és privacy audit PASS:
`.local/verification/20261016-164147-151-phase25-1-ci-routing-final.log`.

Valódi Chrome teljes oldalképek kizárólag izolált tesztadatokkal:
`.local/verification/phase25-1-admin-offline-desktop.png` (1440 px),
`phase25-1-admin-offline-mobile.png` (390 px). Vizuálisan ellenőrizve;
kapcsolatjelzés és mobil tördelés olvasható. Az éles helyi adminon csak readiness/
elérhetőség olvasás történt: saját admin készen áll, engine és gateway nem futott.

## GitHub-feltöltés és adatvédelem

A korábbi felgyűlt munkát a `codex/phase22-24-reviewed` ágra, `280da190c`
commitként feltöltöttük. A publikált snapshot szülője az origin/main; a korábbi
helyi commitágak megmaradtak, személyes profilútvonalat tartalmazó régi helyi
commitok nem kerültek az új publikált előzményláncba. A commit identitása
nem személyes contributor-alias.

A GitHubhoz képest új/módosult 664 forrásfájl átvizsgálásakor három személyes
profilútvonalat cseréltünk hordozható feloldásra. Mentések, adatbázisok, helyi
naplók, botkörnyezet és titokfájlok nem kerültek a commitba. A találatként jelzett
skill-verziós fájlnevek és dinamikus adatbázis-URL összerakás kézzel ellenőrzött
téves pozitívok; nem éles hitelesítő adatok. A már origin/main-on lévő upstream
emulátor-tesztkulcs változatlan, új kulcsot nem publikáltunk.

Ellenőrzött commit audit: blokkoló találat **0**, személyes kimenő commit-metaadat
**0**: `.local/verification/20261016-161421-913-github-reviewed-commit-audit.log`.
Az új control-plane kódra is lefutott a vizsgálat: **0 blokkoló találat**,
`.local/verification/20261016-163303-650-phase25-1-privacy-review.log`.
Az új elutasítási tesztben szereplő kitalált user/password URL nem valódi titok.
