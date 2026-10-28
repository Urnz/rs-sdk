# Változáshoz igazított ellenőrzés

2026-10-22-i pontosítás: **alapértelmezés a célzott komponens + megváltozott
kapcsolódások; a teljes regresszió kivétel, nem taskzáró rutin.**
2026-10-16: a teljes regresszió nem kötelező minden feladat vagy alfázis végén.
A teszteket megtartjuk; a futtatás körét a változás hatása határozza meg.
A 25.2 fejlesztése e felülvizsgálat alatt nem kezdődött el.

## Alapértelmezett lezárás

1. Nevezd meg a módosított modulokat, a fogyasztóikat és a módosított határokat.
   Implementáció közben a legkisebb releváns tesztet futtasd, lezáráskor az
   érintett komponenst és a megváltozott kapcsolódások integrációs tesztjeit.
   Ha az érintett tesztfájlok felsorolhatók, ne válaszd automatikusan a teljes
   `server/gateway/admin/` vagy `agent-state/test/` gyűjtőmappát. A csomagnév
   nem helyettesíti a fogyasztók és az írási határok vizsgálatát.
   Bun esetén a felsorolt fájlokhoz explicit `./` útvonalat adj:
   `bun test ./society-integrity/test/integrity.test.ts`. A relatív útvonal
   `./` nélkül szövegszűrő lehet, és a backupok tesztmásolatait is bevonhatja.
   Ellenőrizd a logban a tényleges fájllistát; az ilyen tág kör nem bizonyítja
   a kért célzott scope-ot. A FULL-sync/archívum IO-próbákat ne futtasd
   egymás mellett, ha emiatt az egyes esetek mért időkerete sérül.
2. Csak az érintett TypeScript-projekteket ellenőrizd: root a szerver/domain/SDK,
   engine a motorkód, webclient a kliens változásaihoz. Közös típus vagy import
   változásakor a fogyasztó projektek is érintettek. A `verify:quality` mindhárom
   projektet futtatja, ezért nem általános lezárási rövidítés.
3. Formázás mindig; csak dokumentáció esetén formázás és a hivatkozások
   ellenőrzése elég. PowerShell-only módosításnál a helper/szintaxis tesztek,
   launcher változásnál az érintett Windows folyamatpróbák is szükségesek.
4. Sikeres ellenőrzést csak a bemeneteit/fogyasztóit érintő új változás,
   korábbi hiba vagy konkrét nyitott kockázat miatt ismételj. Dokumentációs
   utómunkához ne futtasd újra a már sikeres runtime/TypeScript köröket.
5. A lezárásban/progress fájlban: kör és indok, parancs/napló, eredmény,
   időtartam, maradó bizonytalanság. A célzott PASS nem teljes regressziós PASS.

Például admin HTTP-handler változásnál az érintett handler/auth/proxy tesztjei
és root typecheck szükségesek; a változatlan engine és webclient typecheckje
nem automatikus követelmény. CSS/szöveg esetén célzott UI-ellenőrzés indokolt.
Szerződésváltozásnál az érintett kliens és szerver tesztjei is szükségesek.

## Teljes regresszió indokai

A `verify:full` ténylegesen közös alap megváltoztatásakor indokolt:
meglévő többdomaines perzisztencia/írási tranzakció/migrátor szemantikája,
SimulationClock, gazdasági commit/custody alap, több modult átfogó
auth/jogosultság, runtime-függőség vagy globális build-/tesztfelderítési
konfiguráció. Kifejezetten kért kiadási/integrációs baseline szintén indok.

**Nem automatikus full-trigger** egy komponens saját additív táblája attól,
hogy meglévő DB-fájlban van vagy növeli annak `user_version` értékét.
Ehhez a régi DB→új séma, idempotens migráció, rollback/hiba, reopen,
verzióütközés és az adott DB-t fogyasztó érintett adapterek célzott próbái
kellenek. Akkor válik közös alappá, ha meglévő állapotot/invariánst,
más komponens olvasó-/író-szerződését vagy közös tranzakcióhatárt változtat.
Új teszteset, meglévő fájl lokális felbontása, résznapló/időmérés vagy
komponensspecifikus wrapper javítása sem globális tesztfelderítési változás.

Bizonytalan hatásnál előbb vizsgáld meg az importokat, fogyasztókat és írási
határt, majd végezz kis diagnosztikát. A puszta bizonytalanság nem rövidítés
a teljes körhöz. Ha ezután sem határolható be, rögzítsd a konkrét nyitott
kockázatot. Full indítás előtt legyen négy sor: **megváltozott közös
szimbólum/invariáns; érintett fogyasztók; a célzott kör miért nem elég;
legutóbb mért full-idő**. „Migráció”, „közös fájl” vagy „lezárás” önmagában
nem elegendő indok. A fázisszám vagy a push sem indok.

SI-B01 utólagos scope-pontosítás: a saját observer-cursor tábla és az inbox
v3→v4 bővítése az inbox/coordinator/recovery/context, verzió- és hibapróbákat
indokolta; minden független production/crime/population modul újrafuttatását
nem. A korábbi 17 perces full-döntés túl tág volt, a történeti FAIL megmarad.
SI-A13 wrapper-diagnosztika: native runner stream/hibapróba, a tíz belső próba,
a shared helper egy másik fogyasztója, érintett TS és formázás; nem full.

A kizárólagos `test:quick` alias-törlés nem változtatja
meg a `test`, `check`, CI vagy domain suite-ok tesztfelderítését.

A `check`/`verify:full` és az összes meglévő teszt/assertion megmarad.
A Windows folyamatpróbák külön `test:control-plane:windows` körben futnak,
ha a Windows launchert ellenőrizzük; a hordozható alapcsomag nem tartalmazza őket.
A Lite cache-tesztekhez helyi packed-cache HTTP-forrás szükséges
(`LITE_TEST_ORIGIN`); előfeltételhiány nem PASS és nem indok tesztkihagyásra.
Ehhez nem kell botot vagy társadalmi hangolási kísérletet indítani.

A meglévő CI root/webclient typechecket és széles root `test` csomagot,
valamint külön Windows tooling kört futtat. Nem azonos a teljes `check`-kel:
nem állítjuk, hogy minden domain regresszióját a CI elvégzi helyettünk.

Hibánál őrizd meg a sikertelen eredményt, célozd a hibás tesztet és az érintett
függő kört. Ne ismételd a teljes csomagot pusztán zöld exit keresésére.
Egy megszakadt full után a még el nem ért, változástól független csomagokat
se indítsd el automatikusan külön: ez ugyanannak a széles regressziónak a
folytatása. Csak konkrét változási kockázat vagy a kért közös baseline
igénye indokolja; egyébként jelöld a full FAIL-t és a nem vizsgált határt.
A régi intermittáló XP/SQLite hibák külön követendők; nincs assertion-elrejtés
vagy automatikus timeout-emelés. Új/módosított határt érintő hiba lezárást blokkol.

## Megfigyelt költség és mérés

Fixture-időkorlátnál külön mérd a setupot, a kiértékelést/frozen rereadet,
illetve a capture és restore fázist. Előbb távolítsd el a redundáns teljes
olvasásokat és változatlan fixture-inputok ismételt fájlmegnyitását; az éles
source-validációt ne cache-eld vagy gyengítsd emiatt. Hookba mozgatott setupnak
is legyen explicit korlátja. Az összesített keretet is dokumentáld: ugyanaz a
test-timeout literal nem jelent változatlan teljes időkeretet, ha mellé új
setup-budget kerül. Ez helyi tesztkeret-korrekció, nem run/bootstrap-limit.

A korábbi helyi wrappernaplókban rögzített belső `full` időtartamok:

- 24.10: 1830 PASS, **7 perc 26,484 s**;
  `.local/verification/20261016-152545-238-phase24-10-full-local-cache.log`.
- 24.11: 1496 PASS / 1 FAIL, **5 perc 48,987 s**, a régi XP időkorlátjánál
  megszakadt lánc; a maradék 355 teszt külön további **54,687 s** volt.
  `.local/verification/20261016-155708-034-phase24-11-full-local-cache.log`,
  `20261016-160356-825-phase24-11-remaining-regression.log`.
- 25.1: 1861 PASS, **4 perc 26,109 s**;
  `.local/verification/20261016-162909-024-phase25-1-full-local-cache.log`.
- Összehasonlítás: a 25.1 érintett kör 26 tesztet, formázást és mindhárom
  typechecket **51,437 s** alatt végzett; egy szűkebb 6 tesztes HTTP-kör
  **2,849 s** volt. Ezek különböző lefedettségű, korábbi futások, nem azonos
  tesztkörön mért gyorsítás. A 26 tesztes körrel lezárható hasonló változásnál
  a további teljes kör elhagyása körülbelül 4,5 percet takarít meg.

A három teljes kísérlet összesen kb. **17 perc 42 s**, a maradék körrel
kb. **18 perc 36 s** volt. Ebben nincs benne a kódolás, hibakeresés, ismételt
typecheck, publikálás vagy daemonindítás miatti várakozás. A teljes belső
naplók egyenként kb. 200–250 kB-osak; ez nem tokenmérés.

A helyi tesztfuttatás idejéből/tesztszámából nem számítható ki a Codex-limit.
A modellnek visszaadott kimenet, a kontextus, gondolkodás és eszközhasználat
befolyásolja a fogyasztást; a rövid összesítés ezért hasznos, a teljes sikeres
napló bemásolása kerülendő. Pontos korábbi, feladatra bontott tokenfogyasztás
ezekből a naplókból nem áll rendelkezésre.
[Hivatalos OpenAI dokumentáció](https://learn.chatgpt.com/docs/pricing).

A `scripts/invoke-verification.ps1` a teljes napló mellett `.result.json`
fájlt ment: kezdés/vég, parancsidő másodpercben, outcome/exit, ismert
tesztszámok és naplóbájtok. A parancsidő nem a teljes fejlesztési idő;
egymásba ágyazott wrapperidőket ne adj össze. A fájlok helyiek, ignoráltak,
parancsokat és helyi útvonalakat tartalmazhatnak, nem publikálandók.
Nincs tokenbecslés, automatikus eredménycache vagy tesztkihagyás.

## A folyamatmódosítás ellenőrzése

A wrapper siker/hibás exit/indítási hiba/Bun-fallback próbái és a tesztszám-
összesítés próbája ellenőrzik az új JSON eredményeket is. A teljes PowerShell
syntax/helper kör és a formázás **PASS, exit 0, 10,939 s**:
`.local/verification/20261016-193124-297-verification-policy-tooling.log`.
A korábbi package-scriptekkel összehasonlítva csak a `test:quick` alias tűnt el;
a `test`, `check`, domain és CI által használt parancsok változatlanok.
Runtime/TypeScript kód nem módosult; teljes regressziót nem indokolt ez a kör.
