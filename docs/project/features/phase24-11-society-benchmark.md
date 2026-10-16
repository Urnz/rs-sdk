# Phase 24.11 – benchmark, export és reprodukció

A futtatási, exportálási, izolált visszaállítási és eredmény-visszaolvasási
eszközök elkészültek. Hosszú élő társadalmi futás nem indult. A Phase 24
társadalmi elfogadási feltétele és a 24.8 paraméterkísérletei továbbra is nyitottak.
Sorrend: funkciók befejezése, teljes társadalom működési próbája, hibajavítás,
végül paraméterhangolás.

## Futási szerződés és időkeret

A benchmark a [24.7 véges vezérlőjét](phase24-7-long-experiments.md) használja.
A terv pontos genesis-/seed-/cohort-/attribútum-/paraméterpolicy-kötést,
konfiguráció- és kezdeti avatar/célállapot-digestet, bemelegítést, értékelési
ablakot, megfigyelési ütemet és kemény valós időkorlátot tartalmaz. Legalább
egy szimulációs nap és legfeljebb 10000 hullám engedélyezett. Hiányzó
bizonylatot az eltelt falióra vagy mesterséges utólagos megfigyelés nem pótol.

Indítás előtt konkrét terv és várható valós idő kell. A jelenlegi `normal-game`
profil 1:1: egy szimulációs nap legalább **24 valós óra**, plusz bemelegítés és
műveleti többletidő. A `maximumWallMilliseconds` kemény korlát, nem ígéret
elegendő sikeres műveletre. E dokumentum nem jelent hosszú futás indítását.

A `stop` új hullámokat tilt, kiadott skillt nem öl meg. Mentés előtt az írókat
és függő munkákat rendezni kell. Hibás/leállított eredmény is exportálható;
megőrzi a hibát, a hiányos lefedettséget és az esetleges aktív hullámot.
A protokoll `completed` állapota sem bizonyít önfenntartó társadalmat.

## Archivált állapot

Belépési pont: `bun run society:benchmark`. Formátum: `society-offline-archive-v1`.
A csomag `<bundle>/workspace/manifest.json` és `payload/` részből áll. A manifest
tartalmazza a tervet, kiinduló Git commitot, Bun-verziót/platformot, a fájlok
méretét és SHA-256 hashét, a hiányzó opcionális gyökereket, eredménycsomagnál a
natív riportot, valamint saját digestjét. A módosított és nem ignorált új forrás
is bekerül: a tényleges kódazonosságot a `sourceTreeDigest` írja le, a commit
csak referencia. A hash helyi integritás, nem külső hitelesítő aláírás.

A támogatott alapértelmezett helyi tárolási elrendezés:

- Git által ismert és nem ignorált új források, konfigurációk, lockfile-ok.
- `.local/agent-state`, `simulation`, `economy`, `crime`, `agent-skills`, `admin`:
  tagság/történet, clock/stampek, genesis/provenance/integritás, egészség/estate,
  üzlet/termelés/jogok, Phase12/paraméterek/hosszúfutás, XP-state/attesztáció,
  queue/budget és admin override-ok.
- `server/engine/db.sqlite*`, `data/market.sqlite*`, `data/mods`, `data/players`,
  `data/config`, `data/pack`: mentések, engine/gazdasági bizonylatok és tényleges
  lefordított cache, SQLite WAL/SHM/journal fájlokkal együtt.

Kötelező az AgentState, clock, genesis, integritás és paramétertár, továbbá
legalább egy mentés és cache-fájl. Hiányuk hibát ad, adatbázist nem fabrikálunk.
A hiányzó opcionális gyökerek explicit szerepelnek. Egyedi, e körön kívülre
átirányított tároló nem támogatott: archiválás előtt a támogatott elrendezésre
kell átállni. Ez nem általános gépmentés. A natív riportnak nincs alapértelmezett
food/tool/housing ledgerkötése; ezek diagnosztikája továbbra is hiányos.

Nem másolódik `.env`, `bot.env`, `secrets`, `.git`, `node_modules`, helyi
botkönyvtár vagy admin log/trash/korábbi backup. A hitelesítést, környezeti
beállításokat és esetleges egyedi botkódot külön kell kezelni. A csomag ettől
még privát játékos- és auditadatokat tartalmaz, nem anonimizált publikus export.
A telepített függőségek bináris azonosságát nem igazolja: a lockfile-okból,
a rögzített Bun-verzióval kell újratelepíteni őket.

A futási jegyzőkönyvben együtt kell megőrizni a baseline és az eredmény
manifest-digestjét. A tervet, `sourceTreeDigest` értéket, konfiguráció- és
cache-fájlok hashlistáját is össze kell vetni. Az export nem hoz létre automatikus
baseline–eredmény kapcsolatot, és önmagában nem igazolja, hogy futás közben senki
nem módosított kódot vagy külső környezeti beállítást. Eltérő feltétellel készült
új futás nem azonos baseline reprodukciója vagy kontrollált kezelésmérés.

## Baseline előkészítése

A [24.7 JSON-tervét](phase24-7-long-experiments.md) töltsd ki valós helyi genesis-
és profile-azonosítókkal. A két expected hash először 64 nulla lehet. Működő,
nyugalmi cohort, ismert bank- és célállapot mellett a konkrét későbbi futáshoz:

```powershell
bun run society:experiment --command prepare --plan .local/benchmark-raw.json |
    Set-Content -Encoding utf8 .local/benchmark-plan.json
pwsh -NoProfile -File scripts/stop-local.ps1
# Külön indított botokat/vezérlőket és minden egyéb írót is állíts le.
bun run society:benchmark --command pause --offline
New-Item -ItemType Directory -Force backups | Out-Null
bun run society:benchmark --command capture --offline --kind baseline --plan .local/benchmark-plan.json --output backups/society-baseline-001
bun run society:benchmark --command verify --bundle backups/society-baseline-001
```

A baseline ellenőrzi a genesis/cohort/policy kötést; szünetelő clockot, még
nem használt session ID-t, szabad hosszúfutás-lockot és függő Phase12-futás
hiányát követeli meg. Nem helyettesíti az online avatar-preflightot: restart
után a mentésből betöltött avataroknak és bank/cél megfigyeléseknek is egyezniük
kell. Eltérésnél az indítás elutasít. Expected hash csendes átírásával nem
szabad azonos baseline-t állítani.

A `--offline` kifejezett állítás minden író leállásáról. A Windows-probe emellett
ellenőrzi a kezelt PID-eket, a 7780/8888/3000 listenerportokat és az ismert
Bun/Node/Java parancsokat; felderítési hibánál elutasít. Folyamatot nem állít le,
ismeretlen külső SQL-írók teljes körű felderítését nem ígéri. A teljes inventory
és fájlhash másolás előtti/utáni összevetése változásnál elutasít. Ez offline
eljárás, nem élő, több adatbázison átívelő atomi snapshot.

Csak a konkrét futási terv elfogadása után, még leállított stackkel:

```powershell
bun run society:benchmark --command resume --offline
# Ezután a helyi indítóval csatlakoztasd a pontos alapítócohortot.
# Autonóm/egyedi vezérlő ne változtassa a baseline-t a preflight előtt.
bun run society:experiment --command start --plan .local/benchmark-plan.json --run --poll-ms 30000
```

A pause/resume meglévő, aktuális sémájú, konfigurációhoz kötött clockon,
natív revision-ellenőrzéssel működik; nem hoz létre órát vagy új profilt.
A szünetelő baseline későbbi resume-ja megőrzi a szimulációs időt az offline
időszakon át. Futó órájú eredményarchívumra ez nem állítható. Indítási kapcsolók,
hitelesítés és root/engine/webclient `bun install --frozen-lockfile` lépések:
[helyi fejlesztés](../setup/local-development.md).

## Eredményexport és izolált visszaállítás

Lezárt program, rendezett munkák és leállított stack mellett:

```powershell
bun run society:benchmark --command capture --offline --kind result --plan .local/benchmark-plan.json --output backups/society-result-001
bun run society:benchmark --command verify --bundle backups/society-result-001
bun run society:benchmark --command restore --bundle backups/society-result-001 --output backups/society-review-001
```

Restore cél nem létezhet, szülőjének viszont léteznie kell. Először teljes
manifest/fájlellenőrzés, utána saját staging, fájlonkénti újraellenőrzés és
minden `.sqlite` esetén `quick_check`, végül publikálás történik. Hibás staging
eltakarításra kerül. Nincs élő állapotot felülíró kapcsoló. Tiltott az útvonalkilépés,
Windows ADS/reserved név, case-ütközés, nem listázott payload, symlink/junction
és hard link. A restore `<output>/workspace` alá helyezi a kódot és állapotot.

Az eredményrestore CLI-je a helyreállított natív Phase12/clock/XP forrásból
újraszámolja a riportot és összeveti az exporttal. Sérülés/hiány hibát ad;
nincs visszaesés az élő világ adataira. A `verify` csak fájlintegritás;
önmagában nem natív bizonyítékellenőrzés. A manifest riportja nem tölthető
vissza bizonyítékként az admin API-ra.
Natív riporteltérés esetén a parancs hibával zár; az izolált másolat megmarad
vizsgálatra. A cél világ helyett semmit nem írunk vissza az eredeti állapotba.

A terv a manifestből kiírható. Telepítés után a helyreállított kódból,
játékfolyamat indítása nélkül is újraolvasható az eredmény:

```powershell
$manifest = Get-Content backups/society-result-001/workspace/manifest.json -Raw | ConvertFrom-Json
$manifest.plan | ConvertTo-Json -Depth 100 | Set-Content -Encoding utf8 backups/benchmark-plan.json
Set-Location backups/society-review-001/workspace
# Függőségek telepítése után:
bun run society:benchmark --command report --plan ../../benchmark-plan.json
```

SQLite readonly olvasás/quick-check változtathat SHM-fájlt. A natív ellenőrzés
a visszaállított másolaton fut, az archív payloadot nem módosítja. Az adatbázis
tartalma és auditja marad meg; a segédfájlok olvasás utáni bájtpontos azonosságát
nem ígérjük.

Új futáshoz a **baseline** csomagot állítsd helyre egy másik új könyvtárba,
az ottani kódot/dependenciákat/hitelesítést használd, majd ugyanazt a tervet
pontos preflighttal indítsd. A baseline-ban még nem létező session és azonos
wave ID-k az izolált világban érvényesek; két világ azonos helyi portokon
egyszerre nem futhat. A terminális eredménycsomag riportolásra való: a régi
journal source-path kötését nem írjuk át más helyen történő folytatáshoz.

A `.git` nincs archiválva. Újabb exporthoz a visszaállított forrást önálló
Git checkoutként kell rögzíteni, mert az export `git ls-files` alapján azonosítja
a forrásokat. A manifest pontos forráslistája használható hozzá (a saját Git
név/e-mail konfigurációval); titkokat vagy állapotfájlokat nem kell stage-elni.
Példa a repo gyökeréből, előzőleg helyreállított baseline-nal:

```powershell
$baselineManifest = Get-Content backups/society-baseline-001/workspace/manifest.json -Raw | ConvertFrom-Json
$baselineManifest.sourceFiles | Set-Content -Encoding utf8NoBOM backups/society-repeat-001/workspace/.local/benchmark-source-files.txt
$baselineManifest.plan | ConvertTo-Json -Depth 100 | Set-Content -Encoding utf8 backups/repeat-plan.json
Set-Location backups/society-repeat-001/workspace
git init
git --literal-pathspecs add --force --pathspec-from-file=.local/benchmark-source-files.txt
git commit -m 'Restore archived benchmark source'
bun run society:benchmark --command resume --offline
# Helyi stack/cohort indítása és a pontos preflight feltételeinek teljesítése után:
bun run society:experiment --command start --plan ../../repeat-plan.json --run --poll-ms 30000
```

Az új Git commit eltérhet, a tényleges forrásazonosságot továbbra is a
fájlhashlista és `sourceTreeDigest` alapján kell összevetni. A replay előtt
változtatott policy, kód vagy állapot új feltételnek számít.

Az archivált bizonyíték/riport pontosan újraolvasható. Az új futás LLM-válaszai,
időzítése és nem seedelt engine-véletlenfolyama eltérhet. A támogatás rögzített
induló feltételeket és visszakövethető eltéréseket jelent, nem determinisztikus
gazdasági eredményt. A 24.9 riport hiányai láthatók; nincs súlyozott összpontszám
vagy automatikus társadalmi sikerállítás.

## Séma, visszavonás és ellenőrzés

Nincs új runtime séma vagy gazdasági írás. Az archívum v1 külön fájlszerződés;
ismeretlen protokoll elutasításra kerül, implicit migráció nincs. A pause/resume
a meglévő clock API-t használja. Visszavonás: az opcionális parancsok elhagyása;
az új könyvtárak csak saját, ellenőrzött célból távolíthatók el. A régi
`backup-local.ps1`/`restore-local.ps1` engine-only eljárását nem hívjuk társadalmi
restore helyett.

Izolált tesztek: dirty/untracked forrás és állapot roundtrip, WAL-bizonylat,
sérülés/útvonal/link/case-védelem, meglévő cél megőrzése, offline elutasítás,
menet közbeni változás, CLI és óra pause/resume. Külön natív Phase12/clock/XP
próba azonos riportot állít elő új könyvtárban, majd sérült XP-journalnál
elutasít. Ezek technikai tesztek, nem hosszú élő társadalmi kísérletek.
Eredmények: [PHASE24_PROGRESS](../PHASE24_PROGRESS.md).
