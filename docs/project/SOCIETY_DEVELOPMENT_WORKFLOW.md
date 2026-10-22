# Társadalmi integráció fejlesztési munkarendje

2026-10-22. Az SI-A15 tanulságai alapján; kizárólag helyi/private emulator.
Belépő: [rövid átadás](SOCIETY_DEVELOPMENT_HANDOFF.md).
Az automatikus belépést az `AGENTS.override.md` repo-local skill útvonala adja.

## Olcsó folytatás és egyértelmű lezárás

`pwsh -NoProfile -File scripts/get-society-work-brief.ps1` visszaadja a
következő nyitott task szövegét és legfeljebb öt friss ellenőrzés fejlécét.
Nem olvas teljes logot, backupfát vagy adatbázist; nem futtat tesztet és nem
cache-el PASS-t. `-TaskId SI-B01` explicit választás; `-RecentChecks 0`
kikapcsolja a logfejlécek olvasását. A sorrendjavaslat nem függőségellenőrzés.

A task elején rögzítsd a módosított határt és az elfogadási bizonyítékot.
Komponens-készültség mellett korán legyen kis valódi közös út; ne a fejezet
végén derüljön ki, hogy az alapvető natív határ még csak mockkal működik.
Lezáráskor a task és a következő fejezet eleje egyaránt mondja ki, lehet-e
továbblépni. A korábbi nyitott státuszok kapjanak történeti jelölést.

Az [ellenőrzési policy](VERIFICATION_POLICY.md) érvényes. A teljes futásokat
csak az ott rögzített változási ok indokolja; a dokumentációs lezárás nem.
Sikeres teszt ismétlésének oka legyen konkrét változás vagy nyitott kockázat.
A teljes kimenet `.local/verification/` alatt maradjon. Az egymásba ágyazott
vagy párhuzamos wrapperidők nem adhatók össze fejlesztési összidőként;
tesztidőből nincs megbízható tokenbecslés.

## Drága natív próba előtt és után

Natív SI-A13/archívum diagnosztikánál a [runner-jegyzőkönyv](SI_A13_RUNNER_DIAGNOSTICS.md)
stabil case ID-jaival válassz próbát. A gateway wrapper már tíz külön teszt;
például `-t "SI-A13 baseline-archive:"` csak a baseline capture/restore határt
futtatja. Az élő résznapló `[native-runtime]` és `[native-case]` JSON sorai
elkülönítik a copy/bootstrap/capture/restore/verify/cleanup időt.
Nem kell minden kisebb adapterváltozásnál újra lefuttatni mind a tíz próbát,
és egy helyi wrapper változása nem indokol teljes regressziót.

Az adott futási terv tartalmazza a hipotézist, előfeltételeket, idő-/költség-
korlátot, stopfeltételeket és az elvárt kanonikus bizonylatokat. Olcsón ellenőrizd
a tényleges forrás-/óraazonosságot, grantet, publikált verziót, készletet,
szabad erőforrást, útvonalat és a mérés olvashatóságát, amennyiben érintettek.
Az offline vagy read-only preflight nem bizonyít tényleges natív végrehajtást.

Egy drága hiba után előbb szűk reprodukció és javításigazolás következzen.
Két egymást követő sikertelen hosszú futás után vizsgáld felül a hipotézist,
a mérési tervet és a segédprogramot; ne indíts automatikusan új teljes világot.
Ez diagnosztikai irányváltás, nem új kötelező felhasználói jóváhagyás.
A sikertelen próbák és a véletlenszerű no-output kimenetek megmaradnak.

Szűk mechanikai hibához használj meglévő, megfelelő állapotú eldobható
workspace-t vagy a meglévő reduced food-trial profilt, ha alkalmas rá.
Egy forrásverzióhoz kötött autonóm run közben ne módosítsd a forrást.
A végső baseline és az eredményrestore minden eredeti garanciát megtart;
nem helyettesíthető trial-világgal. Restore előtt ne kérj még külön verify-t,
ha ugyanaz a normál restore már beépítve elvégzi azt.
Ne törölj automatikusan bizonyítékot, backupot vagy a felhasználó módosítását.

## DEV-I01 – Változatlan runtime-csomag és elkülönített világállapot

**Nyitott toolingfeladat; nem SI-B01 belépési feltétel.** A jelenlegi kör
skillt, tartós átadást és kompakt állapotlekérdezést vezet be. A másolási
architektúra még nem változott; gyorsulást erre nem állítunk.

Az SI-A15 archívuma 14 493 fájl volt; 9415 `server/content` és 2588 `wiki`.
A capture 608,330 s, a beépített verify-t tartalmazó restore 1049,612 s.
Ezek történeti, teljes körös idők, nem kizárólag másolási benchmarkok.

Következő toolingmunka célja:

- Mérd külön az inventory/hash, másolás, SQLite-integrity és riportolvasás
  idejét/fájlszámát azonos, kis eldobható fixture-rel, majd valós méretben.
- Válaszd el a verziózott, hash-kötött változatlan runtime/content csomagot
  a világ saját írható állapotától; ne másold újra a változatlan fájlokat
  minden diagnosztikához. A dirty forrás és a packed/raw assetek is kapjanak
  ellenőrzött azonosságot, ne csak a Git commit.
- Állítsd szembe a költséget és a garanciákat a jelenlegi teljes csomaggal.
  Az önálló export továbbra is minden szükséges adatot tartalmazzon;
  hiányzó vagy módosult közös csomag fail-closed legyen.
- Maradjon offline capture, pontos manifest, path/symlink/secret védelem,
  egyszeri pénzügyi hatás és negatív eredmények megőrzése. Írható állapot
  vagy SQLite nem osztható meg hardlinkkel. A régi v1 bundle olvasható maradjon;
  formátumváltáshoz migráció/rollback és kompatibilitási próba kell.
- A megvalósítás előtt legyen konkrét terv és mérhető cél; utána célzott
  tesztek, izolált capture/restore és a persistence-hatás miatt a policy
  szerinti regresszió. Az elfogadás mind helyességet, mind mért I/O-csökkenést
  kér, és nem előre megígért sebességszorzót.

Ez külön kezelendő alapozó munka. Mostani dokumentációs/tooling módosítás
kedvéért nem nyitjuk újra az SI-A15 világait és nem alakítjuk át archívumait.
