# SI-C07/2 P2-07 – Külső shop/import érték kapuja

2026-10-28. A `no-external-shop-or-import-value` pozitív natív adaptere elkészült.
**6/11 lezárási pont kész, 5 nyitott; 6/8 pozitív natív kapuút.**
SI-C07 továbbra nyitott, 27/45, preflight NO-GO; SI-M3/MVS nem PASS.
Következő pont: P2-08, verified internal lineage és final use.

## Natív határ és kiértékelés

Az új readonly `external-trade/value-coverage.ts` a tényleges engine trade
auditot, az aktív GE adatbázisát és a treasury credit receipt/audit láncot
olvassa. A meglévő natív policy tickpont opcionális cursorában rögzíti ezek
prefixeit, aktuális állapotdigestjét és a workspace-relatív forrásazonosságot,
valamint a tényleges shop-módot és GE-enabled állapotot. Új journal, tábla,
schema/user_version, gazdasági commit vagy clock setter nincs.

A reviewzott producer manifest tartalmazza a raw shop belépési és végső
request guardjait, a restock-módot, trade/GE és commerce/treasury útvonalakat.
A `closed-society` mód kizárja a fedezetlen legacy shopot és automatikus
restockot. A tényleges shop opcode és a World observer bekötése próbázott.
A szerződés a P2-04 rögzített alkalmazásbemeneteire épül; nem teljes,
ellenséges hostot és minden függőséget lefedő attestáció.

A `society-metrics/external-value.ts` a P2-06 admin/fallback eredményt és a
teljes eredeti warmup/evaluation tickablakot köti az applied genesishez,
world/clock/profile és immutable founder cohorthoz. Idegen admin eredmény
nem adhat sem pozitív coverage-et, sem másik runból származó FAIL-t.
Hiteles, saját scope-ú import FAIL akkor is megmarad, ha más forrás hiányos.

- Két eredeti founder közötti natív trade belső átrendezés. Külső szereplőtől
  kapott bármely item/GP import FAIL; az azonos értékű csere sem nullázza.
  A tisztán kifelé adott ajándék önmagában nem import.
- GE-settlement az eredeti cohort és külső szereplő között import FAIL.
  A GE DB eltérhet a player-checkpoint DB-től: az aktív tényleges forrás kell.
  Kikapcsolt GE külön natív állapot; hiányzó aktív forrás unknown.
- A treasury „external credit” a Businessen kívülről érkezést jelöli.
  Belső társadalmi bevételhez exact completed native sale, két eredeti actor,
  azonos world/clock/profile, trade ID, Business és GP-összeg kell. Szabadon
  megadott `source_ref` nem eredetbizonyíték; a fedezetlen címke unknown.
- P2-06 által igazolt post-genesis import/fallback érték FAIL. Mennyiségileg
  nem igazolt privileged debugproc coverage-hiány, nem kitalált importösszeg.

Pozitív értékeléshez prospektív, üres trade/GE-offer/trade/treasury-credit
nyitócsatorna kell. Korábbi történetet nem törlünk, nullázunk vagy backfillelünk:
az ilyen opening jelenleg unknown. A későbbi konkrét baseline ezt offline,
forráskijelöléssel teljesítheti; nincs élő import vagy mostani új baseline.
A nem kereskedelmi natív termelés eredetét és tényleges végfelhasználását a
külön P2-08 kapu vizsgálja; inventory-növekedés önmagában nem belső lineage.

## Fogyasztók, mentés és visszaállítás

A native-outcomes, minimum-assessment és sourceCoverage azonos eredeti
binding mellett kapja a pozitív vagy negatív kapueredményt. Globális
`qualifiesMinimum:false` megmaradt. A preflight változatlanul NO-GO,
`selectedSources:null`; a 17 szabály, 8 kapu és az eredeti küszöbök változatlanok.

A C06 inventory megköveteli a cursorban hivatkozott trade és treasury,
aktív GE esetén a külön market forrás bevonását, pontos prefix/path kötését.
A readonly frozen reread és archive/restore ugyanazt a cursort adja vissza.
Hiányzó forrás vagy eltérő prefix új baseline-t sem enged.

Nincs perzisztencia-migráció. Bevezetéshez új, összetartozó reviewed source pin
és prospektív selection kell. Rollback: stop, korábbi bináris és hozzá tartozó
selection; meglévő bizonyítékot nem írunk át, szigorú futást nem folytatunk régi
binárissal. Nincs live install/start, providerhívás vagy hosszú gazdasági próba.

## Célzott ellenőrzés

A teljes 1+7 mechanikus fixture 193 tickpontot, belső trade-et, pozitív natív
gate/sourceCoverage-et és frozen readonly újraolvasást ellenőriz; nem gazdasági
run és nem időarány-kalibráció. Külön valódi engine sale és GE-settlement,
import/fallback FAIL, hiány/legacy/head/tail/prehistory/source-identity esetek,
observer és C06 forrásbevonás/restore ellenőrzik a módosított határokat.

A végleges logok és időmérések az [átadásban](SOCIETY_DEVELOPMENT_HANDOFF.md)
és a [progressben](SOCIETY_INTEGRATION_PROGRESS.md) vannak: **106 külön célzott
eset, root/engine TypeScript és friss NO-GO artifact PASS**. Teljes regresszió
nem szükséges: readonly adapter és opcionális meglévő frame-mező; közös
tranzakciós/clock/auth/dependency alap nem változott. Csak a közvetlen tesztek
és az érintett root/engine TypeScript projektek ellenőrzendők.
