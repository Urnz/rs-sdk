# SI-A15 – D1 futási terv és előellenőrzés

**2026-10-20-i folytatás:** az alábbi eredeti 1:1 terv történeti állapot.
A felhasználó végleges napalapú szabályt választott, amely felváltja az
előre időzített étkezés korábbi javaslatát és az új világok 1:1 korlátját.
Az implementált szabály, külön élő/gyorsított profil és a változatlanul
nyitott D1 kapuk: [napalapú túlélés](SI_A15_DAY_SURVIVAL.md).

Az SI-A15 **nyitott**. A 90 perces élő demonstráció nem indult el:
a jelenlegi fixture/rutin mellett a fogyasztási elfogadás már indulás előtt
bizonyíthatóan nem teljesíthető. Ez archivált preflight-eredmény, nem
sikertelennek vagy sikeresnek átnevezett élő futás.

## Konkrét jelölt terv

A verziózott `config/fixtures/society-lobster-four-d1-plan-v1.json` az
SI-A13 1.0.1 fixture digestjéhez kötött. Az avatárok `sifisher`, `sicook`,
`sicourier`, `silessor`; a Business `karamja-kitchen`, intézményi irányítója
`si-kitchen-mind`. A pozíciókat, személyes Fishing/Cooking szinteket,
kezdő inventoryt, ismert skilleket és jogos partnereket a fixture rögzíti.
A preflight ezeket a konkrét értékeket belefoglalja a riportba.

- T0 az izolált, ellenőrzött baseline aktiválása után; normál 1:1 óra.
  Teljes ablak 90 perc, megfigyelés legfeljebb 60 másodpercenként.
- 45. percnél tervezett engine/gateway restart, egy tényleges in-flight intent
  megtartásával. Az aktív actorok legfeljebb öt percen belül folytatnak vagy
  forrással igazolt blocked állapotba kerülnek. A blocked nem termelési siker.
- A 15–20. perc között előre tervezett supply-szünet; feloldás után ugyanaz
  a rutin folytatódik. A későbbi runnernek ezt policyból kell végrehajtania,
  nem utólagos kézi goaladással vagy készlet törlésével/visszatöltésével.
- Jelölt bérleti ablakok: cook 5–25., fisher 25–45., courier 50–75. perc.
  A két valódi férőhely kapacitása nem változik. Az ütemezés önmagában
  sem fizikai megérkezést, sem natív fizetett bérletet nem igazol.
- 0 providerkérés, nincs futás közbeni külső érték/import/regeneráció.
  Nyitó összes GP 3800, négy személyes bootstrap étel, nulla raw/cooked
  Business-stock, 32 natív harvest-output. Raw plafon 20 GP, cooked ár 40 GP,
  cook/delivery bér 25–25 GP, rent 500 GP. Belső transzferek GP-egyenlege nulla;
  útiköltség csak valódi, naplózott sinkként számolható el.
- Változatlan elfogadás: két natív fogyasztás/avatar, legalább egy-egy belső
  eredetű étel, három vevő–eladó kapcsolat, két actor-közi függőség, legalább
  95% satisfied-demand, valódi bér és rent, nulla megmagyarázatlan eltérés.
- Fedezet-/kapacitáshiányt valódi natív preconditionnel kell előidézni és
  bizonyítani. Ennek időzítése és helyreállítása még nyitott runtime-kötés;
  a terv ezt nem nyilvánítja késznek a supply-szünetből következtetve.

A terv sémája elutasítja a rövidített ablakot, providerköltséget, lazább
fogyasztási/demand-feltételt, hibás restartot és túlterhelt vagy duplázott ágyat.
Új terv új digest; meglévő világon nincs konfigurációs átírás.

## A most igazolt akadályok

**Procedure publication:** a gather/cook/consume 0.1.0 draft. A meglévő
verifier legalább két független, attribútált sikeres trialt és a tartós
natív intent/receipt újraolvasását követeli. Az SI-A14 publication-resolver
szimulációja nem ilyen trial és nem publikáció. A normál promotion új
verziót eredményez; annak exact ref/checksumja új fixture-revízióba kerül.

**Fogyasztás:** kezdeti hunger 0, a legnagyobb normál ráta 300/óra,
az automatikus étkezési küszöb 6000. Még végig online/ébren is csak
`0 + 300 × 90 / 60 = 450` hunger lehetséges. Az első küszöb legkorábban
1200 perc, azaz 20 óra. Alvás/offline idő ezt tovább késleltetheti.
Ez szükségesfeltétel-vizsgálat, nem szimulált siker: egy elérhető küszöb sem
bizonyítana két étkezést vagy 95%-os belső demand-fedezetet.

A korábbi ütemezett etetési javaslatot a felhasználó elvetette: az önálló
túléléshez a napalapú éhségszabály és külön gyorsított világóra az elfogadott
irány. A régi 1:1 artifactot nem írjuk át utólagos sikerre.

**Natív utazás és authority:** a jelenlegi delivery skill Lumbridge-ben
találkozik, a forrás/konyha Karamján, a bérlet Faladorban van. Az SDK-ban
lévő ferry próba önmagában nem ennek a négy actornak a route-acceptance-e.
Menetidő, hajó-/útiköltség, oda-vissza út, érvényes facility/partner és a
bérleti ablak fizikai elérhetősége külön bizonyítékot igényel. Teleport,
közvetlen koordinátaírás vagy az SI-A14 arrival-stubja nem használható.

**Runner és archiválás:** a régi phase15 soak legalább hat `fixture.players`
avatárt vár, ezért nem alkalmas a négy `fixture.avatars` D1 indítására.
A hosszú benchmark minimuma változatlan. A SI-A13 baseline-capture paused,
változatlan nyitóállapotot követel; nem használható előrehaladt D1 result
utólagos baseline-nak minősítésére. Az izolált normál stack/account/controller
kötés, shortage/restarter, rendezett íróstop és valódi result→új helyre
restore→ugyanaz a readonly riport még az élő kapu része.

## Futtatható readonly preflight

```powershell
bun scripts/society-integration-live.ts preflight
bun scripts/society-integration-live.ts preflight --output .local/verification/si-a15-d1-preflight-NEW.json
```

A várt CLI-kód jelenleg **2 (BLOCKED)**. A kimenet külön rögzíti a
`liveRunStarted: false`, `liveVerdict: not-run`, `liveStartAuthorized: false`
értékeket. A statikus vizsgálat sosem helyettesíti a natív live-admissiont.
Nincs ebben az eszközben `start` vagy automatikus trial/publikáció.

A riport hash-eli a jelölt tervet, fixture-t, aktuális procedure/policy és
preflight-forrásokat. Natív DB-ket nem nyit meg, migrációt nem futtat;
51 ismert DB/WAL/SHM/receipt/save útvonal byte-hashét vagy hiányállapotát
előtte és utána összehasonlítja. Drift esetén nem készül stabilnak nevezett
riport. Output csak új JSON lehet a workspace `.local/verification` mappájában;
meglévő artifactot nem ír felül. Hitelesítő adatot nem olvas vagy archivál.

Perzisztencia/rollback: csak új, forráskezelt terv és readonly eszköz került
be, nincs új domain-DB vagy migráció. A preflight artifact elkülönített
bizonyíték; törlése nem adatbázis-visszaállítás. Az SI-A14 forrásjegyzéke és
történeti artifactjai változatlanok maradnak.

A konkrét futásazonosítók és az elvárt blokkolás auditja:
[progress](SOCIETY_INTEGRATION_PROGRESS.md). Az SI-A15 checkboxa az élő
D1-eredmény és újraolvasás elfogadásáig nyitott marad.
