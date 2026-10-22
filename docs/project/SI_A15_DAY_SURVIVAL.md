# SI-A15 – Napalapú önálló túlélés

A 2026-10-20-i felhasználói döntés végleges szabálya: egy játéknap után
az avatár éhes és az önálló rutin ételt keres; hét játéknap teljes
táplálékhiány halálos. Egy normál adag egy játéknapot pótol. Az élő
világban egy nap egy valós óra, a gyorsított profilban öt perc.
Nincs előre ütemezett etetés vagy tesztben eltérő élettan.

## Szabály és tekintély

A `config/survival-rules.json` azonos mindkét profilban. Egy nap 24 szimulált
óra, a hunger minden online/offline és awake/sleep állapotban 100/óra:
naponta 2400, ételkeresési küszöb 2400, halálos hiány 16800. Egy lobster
2400 hunger egységet pótol, nullánál clampelve. A korai evés nem halmoz
fel tartalék napokat. Hat nap hiány után egy adag öt napra csökkenti a
hiányt; nem indít újabb hétnapos türelmi időt. A hetedik napi határon
már nincs étellel való feltámasztás.

A hunger és a végleges halál közös alapja a világ szimulációs ideje,
az eredeti tartós Needs-admission és a kanonikus natív food-journal.
Az engine újraolvassa a tényleges fogyasztásokat, beleértve a gateway által
még nem projektált commitokat. A `no-use`, hiányzó étel vagy puszta
skillkérés nem táplálék. A hiányzó/sérült/truncated forrás hibát eredményez,
nem egészséges állapotot vagy bizonyítatlan halált.

A starvation az engine meglévő végleges finite-avatar death latch-ébe
kerül, offline tagokra is. A gateway ebből zárja a lifecycle-t, szünetelteti
az autonómiát és indítja a meglévő halál utáni feldolgozást. A demográfia
külön `starvation` számlálót ad. A halál előtti natív action-admission
ugyanezt a feltételt ellenőrzi. A halálig eltelt időt a világóra leállítása
megállítja; pusztán az avatár offline állapota nem.

## Két rögzített világprofil

- `config/fixtures/society-lobster-four-live-day-v1.json`: 24:1 óra,
  nap/60 perc, éhhalál/420 perc teljes ételhiánynál.
- `config/fixtures/society-lobster-four-accelerated-test-day-v1.json`:
  288:1 óra, nap/5 perc, éhhalál/35 perc. Ugyanaz a seed, needs,
  dynamics, adag és survival-policy digest; külön clock-profile digest.

A fixture 1.1.0 verziója explicit köti a szabályt és a módot. Az SI-A13
`fixture:integration` parancs meglévő `--fixture` kapcsolója választja ki.
A konfiguráció csak új, még nem publikált staging workspace-ben készül;
a gyermek natív bootstrap a kiválasztott definíciót kapja. A source
manifest a generált policykat és a survival-profile kötést is rögzíti.
A skill-publication, offline és natív baseline-kapuk változatlanul érvényesek.

A kontrollált automata tesztek a valódi racionális világórának adnak
rögzített falióra-megfigyeléseket; a natív tesztek az eredeti packed content
fogyasztási scriptjét és valódi SQLite checkpointokat használják. Ez
determinista határ-/restart-ellenőrzés, nem 35 perces valós idejű soak
vagy az SI-M1 élő társadalmi futásának helyettesítése.

## Kompatibilitás és visszaállítás

Meglévő világ automatikusan nem kap új órát vagy új jelentést a régi
hunger adataira. A survival-profile nélküli világ a régi konfigurációt
használja; a jelen lévő, de hibás kötés nem esik vissza régi szabályra.
Az 1.0.0/1.0.1 fixture és korábbi archivált eredmények tovább olvashatók.
A kiválasztott profil eltérő needs-policy és dynamics azonosítót kap.

SQLite-sémaváltás nincs; a meglévő JSON death-cause új `starvation` ággal
bővül. Régi bináris ezt nem tudja értelmezni. Visszaállításkor vagy meg
kell tartani az új olvasót, vagy leállított írók mellett a világ összes
kapcsolódó DB-jének és konfigurációjának összehangolt, régebbi snapshotját
kell új helyre visszaállítani. Death-row törlés, hunger-nullázás, aktív
világon profilcsere vagy csak egy ledger visszatekerése nem rollback.

## A D1 kapu még nyitott

A readonly preflight `--fixture` és `--plan` kapcsolója kezeli a két új,
digesthez kötött `society-lobster-four-d1-*-plan-v1.json` jelöltet is.
Az eredeti D1 elfogadási feltételeit egyik sem lazítja.

Példa a gyorsított jelölt olvasására a repository gyökeréből:

```powershell
.\scripts\invoke-verification.ps1 -Name day-preflight -CommandText 'bun scripts/society-integration-live.ts preflight --fixture config/fixtures/society-lobster-four-accelerated-test-day-v1.json --plan config/fixtures/society-lobster-four-d1-accelerated-test-plan-v1.json'
```

A jelenlegi eredmény szándékosan `BLOCKED`, exit 2; ez nem tesztsiker,
hanem a natív élő indítás elutasítása a még nyitott kapuk miatt. A profilt
ellenőrző automata tesztek sikerét külön verification-naplók igazolják.

Élő 90 perc alatt egy egészséges induló avatár első étkezése a 60., a
második a 120. percben esedékes: a két étkezéses 90 perces kapu így továbbra
is blokkolt. A gyorsított 90 perc 18 játéknap, összesen 72 névleges adag
négy avatárnak; a 32 harvest és négy személyes tartalék legfeljebb 36
adag még főzési veszteség előtt is. Ez nem igazolhat 95% ellátást.
Az új szabályok tesztprofilja ettől használható, de a teljes D1 futási
ablak/készlet felülvizsgálata, a normál procedure-promotion, natív utazás,
runtime/restart és eredményarchiválás továbbra is külön nyitott feladat.

Ellenőrzések és exact naplók: [implementációs progress](SOCIETY_INTEGRATION_PROGRESS.md).
