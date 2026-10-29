# SI-C07/2 P2-03 – Közös natív forráslefedettség

2026-10-29: **P2-03 kész. 10/11 lezárási pont kész, 1 nyitott;
8/8 pozitív natív kapuút.** Következő P2-11 összesítő, új closure pont nincs.
[Rögzített lista](SI_C07_PACKAGE2_CLOSURE.md). Roadmap27/45; SI-C07 NO-GO,
SI-M3/MVS nem PASS. Ez mérési implementációs audit, nem hosszú gazdasági run.

## Változatlan szerződés és közös források

A `society-minimum/source-coverage.ts` az eredeti16 családos leltárból képezi
az elvárt forrásokat. Minden17 szabály és8 kapu source/head/cohort/warmup/
boundary követelménye kötelező; hiány nem nulla és nem numerikus minimum FAIL.
Egyetlen hiányos család mellett nincs complete-source-coverage PASS.

A `society-metrics/source-coverage.ts` kizárólag a meglévő verified backend
readerekből dolgozik. A scope contract/world/clock/profile/original founder/
genesis/window kötött, a digest bizonyítékazonosító, nem feltöltött attestáció.
A riport query nem fogad el source pathot vagy proof-listát. A korábbi részleges
readereket nem írja felül; a már kész P2-04–P2-10 garanciáit illeszti össze.

Az új közös fixture ugyanazon tényleges applied-genesis eredményt és canonical
nyitást, eredeti négy founder/lifecycle-t, teljes1+7 napos órát és natív checkpointot
használ. Native policy/runtime/mortality/census/health, admin, external trade/GE/
treasury, food/tool/material/escrow és executor források; needs/mode replay és
193 frozen physical/property/housing/custody pont. A bootstrap nyitás explicit
külön snapshot. Nincs másik világból vagy friss rosterből kölcsönzött PASS.

Az executor-journal a tényleges prospective descriptor/selection/head és
player-time authority alapján kap coverage-markert. Az online actorok a finite
censusban és a mode történetben is ugyanazok. Megfigyelt üres producer lehet
coverage-complete; ebből sem kérési opportunity, sem nulla várakozási idő nem
következik. A teljesen megfigyelt, de termelést/végfelhasználást nem mutató
lineage/cycle történet szintén nem kap számszerű gazdasági creditet.

## Az audit eredménye és negatív ágai

- **Mind16 család együtt complete**, és a `complete-source-coverage` kapu PASS
  a natív minimum projectionben. A tényleges numerikus minimum FAIL marad,
  `qualifiesMinimum:false`; a globális PASS feloldása P2-11. A gate-ek eddigi
  pozitív útjai és ez a közös source-audit nem egy teljes17+8 minimum PASS.
- Mind16 család külön elhagyása és a warmup-kötés elrontása inconclusive
  source coverage-et ad. A hiány nem törli az önállóan igazolt numeric FAIL-t.
- A checkpoint és mutation-journal külön frozen readonly újraolvasása azonos
  sourceCoverage/integrity eredményt ad. A már ellenőrzött193 pontos historyt
  újrahasználjuk, az összes forrásfájl hash-e az audit végén ismét egyezik.
- Egy új disposable checkpoint-másolaton tényleges
  `NativeLifecycleWatermarkStore.fault()` hívás: native health/lifecycle coverage
  nem complete, az összesített source verdict unknown, numeric FAIL megmarad.
  Az eredeti és a történeti backup payloadok nem módosultak.

A legacy `remainingImplementationDependencies` source-soronkénti garancia-ID-ket
jelöl, nem újra megnyitott taskokat. A közös pozitív adatnál nincs hiányzó család;
a konkrét jövőbeli C07 run forráskijelölése külön későbbi munkacsomag.

## Fixture-előfeltételek és költség

A valódi genesis-fixture közös helperbe került, az eredeti default ág megmaradt.
A finite birth az új közös ágban a genesis/needs admission előtt regisztrált:
a későbbi origin-váltás más lifecycle ID lenne, nem javítható új needs-historyval.
A nutrition-projekció saját táblái a legelső tick előtt frissen inicializáltak;
a publikus needs authority a megkövetelt `.local/simulation` alatt marad.
A deserialize-hoz csak egy új fixture-seed másolat WAL-headerét normalizáljuk;
a valódi genesi opening snapshot és az éles adatbázis nem változik.

A clock kizárólag a külön snapshot másolatában paused. Az eredeti running óra
revíziója/anchorja állandó; így a world-policy gate nem kerül megkerülésre.
A fizikai checkpoint az eredeti DB szükséges canonical domain-tábláinak DDL/row
szintű verbatim másolata, minden táblán equality assertionnel és ugyanazzal a
user_versionnel. Az önálló observer journalokat nem duplikáljuk193-szor.
A teljes eredeti native checkpoint a policy/lifecycle/flow reader authorityja.
Nincs új termék-producer, journal, séma, persistent-cache vagy durability-váltás.
Az óra mechanikai fixture6000:1; nem SI-M3 munka/utazás aránykalibráció.
A későbbi run candidate288:1 aránya változatlanul nem M3-validált.

Keretek: async setup20 s, fő audit30 s, omission/frozen/fault10 s külön mérve;
**az egész fixture-re az eredeti50 s összkeret is érvényes**. Teljes mért kör:
setup10084 ms, fő23334 ms, frozen/fault4008 ms, aggregate37907 ms. Nincs emelt
limit. A fázisnaplók bootstrap/native/projection/snapshot részidőket is írnak.

## Ellenőrzési index

- `20261029-184005-850-si-c07-p203-native-audit`:3 PASS40,634 s; rövid előfeltétel,
  eredeti teljes ablak és16-omission/warmup/native-fault/frozen ágak. Nem3 új run.
- `20261029-184153-460-si-c07-p203-consumers-types`:20 pure/bridge/preflight
  teszt PASS; wrapper TS FAIL21,607 s egy nullable fixture-memóriareferencia miatt.
  Const alias javította, viselkedés nem változott. Végső root TS PASS20,124 s:
  `20261029-184520-885-si-c07-p203-types-final`.
- `20261029-184303-122-si-c07-p203-existing-fixtures`:5 PASS9,916 s;
  rövid joint, régi world-policy/finite/internal-lineage és default genesis ág.
- A kiemelt genesis fájl13 esete PASS az első körben
  (`20261029-182251-050`, wrapper FAIL a World eager-import miatt).
  Ezzel **39 külön célzott eset PASS**; a sikeres teljes genesis fájl és a
  teljes193-pontos audit nem futott újra a puszta típusnarrowing miatt.
- Megőrzött olcsó diagnosztikák: World cwd/privátkulcs import-előfeltétel;
  WAL deserialize seed; genesis utáni birth-origin/lifecycle eltérés;
  hiányzó nutrition mérési séma, majd rossz authority-útvonal. Egyikre sem
  került védelmet kiiktató termékjavítás vagy történeti backfill. A szűk,
  javított próba PASS2,495 s (`20261029-183011-240-si-c07-p203-short-authority`)
  után indult csak az első teljes1+7 audit, PASS35,815 s (`183102-266`).

Végső preflight/formázás az [átadásban](SOCIETY_DEVELOPMENT_HANDOFF.md).
Full regresszió nem indokolt: csak audit-fixture/helper és preflight-diagnosztika;
közös clock/economic/persistence/auth/runtime-dependency alap nem változott.
Nincs live install/start, baseline/import/provider vagy historical payload-read.
Canonical minimum SHA596720f42dd059b713ce0d075b08b9655d25413fdf7b31a8db1a86f3afa6754a változatlan.
