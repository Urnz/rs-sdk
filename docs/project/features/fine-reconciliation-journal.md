# Bírság-egyeztetési diagnózisnapló

A `FineLedgerReconciliationStore` külön SQLite-adatbázisban őrzi az
`inspectFineLedger` diagnózisait. Nem ír az escrow-, checkpoint-, treasury-
vagy jogi főkönyvekbe, és nem hoz létre fizetési bizonylatot. Minden rekordban
`canCollect: false` és `canMarkPaid: false` marad, az egyező receipt-alak esetén is.

## Megfigyelés és ismétlés

A hívó egy explicit megfigyelésazonosítót és collection ID-t ad meg; a
diagnózist a napló saját típusos forrásaiból számolja, nem fogad el beküldött
státuszt. Ugyanaz a megfigyelésazonosító ugyanahhoz a collectionhöz az eredeti
rekordot adja vissza. Másik collectionhöz történő újrafelhasználása hibás.
Új állapot ellenőrzéséhez új megfigyelésazonosító kell.

A történeti rekord nem élő státusz: egy későbbi treasury- vagy escrow-változás
nem teszi hibássá a korábbi diagnózis auditját. Az audit a rögzített diagnózis
sértetlenségét bizonyítja, nem a mögöttes rendszerek egyidejű snapshotját vagy
a fizetés megtörténtét. A források hibájából származó `unverifiable` eredmény
is naplózható, de semmilyen jogosultságot nem ad.

A `recordedAt` a megfigyelés metaadata, nem hiteles engine-idő vagy jogi
határidőigazolás. A hash-lánc és a helyi sorszámellenőrzés felismeri a normál
sormódosítást és törlést, de külső audit-anchor nélkül egy teljes adatbázis
korábbi másolatra cserélését vagy támadó által újraszámolt láncot nem bizonyítja.

A rekord és a hash-láncolt auditbejegyzés egy SQLite-tranzakcióban íródik.
Sérült vagy hiányzó auditnál az olvasás és új rögzítés is zárt. Nincs publikus
HTTP/admin route, automatikus időzítés vagy szankció-végrehajtás ebben a szeletben.

## Forrásstabilitás az egyeztetés alatt

Az inspector az első olvasáskor saját, másolt értékeket rögzít, majd újraolvassa
a konkrét intentet, escrowt és a collectionhöz vagy determinisztikus settlement
ID-hoz tartozó teljes receipt-kohorszt. Megfigyelt változásnál `unverifiable`
eredményt ad, külön forrásspecifikus blockerrel. Ugyanez történik, ha a második
olvasás nem lehetséges, vagy az auditellenőrzés már nem érvényes. A treasury
lista sorrendje és más collectionhöz tartozó új receipt önmagában nem eltérés.

Ez korlátozott, egyszeri visszaellenőrzés, nem automatikus retry. A második
olvasás után bekövetkező változást vagy két olvasás közötti változás és teljes
visszaállítás minden esetét nem bizonyítja. Nem közös tranzakció/snapshot és
nem execution-authority; stabil olvasásnál is minden beszedési jogosultság zárt.
A journal az instabil diagnózist is megőrzi; új megfigyelésazonosítóval külön
vizsgálható a későbbi stabil állapot.

Ez a kiegészítés nem változtat perzisztens sémát. A meglévő történeti rekordok
változatlanul olvashatók, nincs backfill; a kód visszaállítható adatátalakítás
nélkül, de a korábbi gyengébb visszaellenőrzés akkor újra érvényesül.

## Migráció és visszaállítás

Ez új, külön v1 adatbázis; meglévő világadatot vagy főkönyvet nem migrál.
Csak üres, verzió nélküli adatbázisból hozható létre. Ismeretlen meglévő
táblák vagy a támogatottnál újabb verzió esetén a megnyitás leáll.

Visszaállításkor a modult ki lehet kapcsolni, a diagnózis-adatbázist pedig
meg kell őrizni; a játékállapotot nem kell visszaírni. A journal nem helyettesíti
a többi főkönyv konzisztens mentését. Élő adatbázist másolás előtt le kell zárni,
vagy SQLite-konzisztens backupot kell készíteni. A diagnózisokat ne tegyük
publikus Gitbe: collection-azonosítókat és jogi folyamatra utaló adatot tartalmaznak.

## Ellenőrzés (2026-09-26)

- Célzott Bun unit- és integrációs tesztek: 26 sikeres, 0 hibás.
- Gyökér `tsc --noEmit` és engine `tsc --noEmit -p server/engine/tsconfig.json`:
  hibamentes.
- Teljes `bun test`, Bun 1.3.14: naplózott újrafuttatásban 1332 sikeres,
  0 hibás, 255 fájl. Az első futásban egy névtelen beforeEach/afterEach hook
  5009,60 ms után időtúllépett (1317 sikeres, 1 hibás); a csonkolt kimenetből
  az érintett suite nem volt biztosan azonosítható. Ezt nem tekintjük zöld
  futásnak és nem állítjuk bizonyíték nélkül, hogy az ismert HTTP-chat flaky
  hiba volt. A teljes naplózott újrafuttatásban nem reprodukálódott; az új
  diagnózisnapló célzott tesztjei mindkét ellenőrzéskor átmentek.
- A külső demo szerverhez kötött collision-oracle ellenőrzés a suite saját
  jelzése szerint elérhetetlen endpoint miatt kihagyódott.
- Formázási és Git whitespace-ellenőrzés: rendben.

### Forrás-visszaellenőrzési kiegészítés (2026-09-26)

- Célzott unit/journal/integrációs csoport: 55 sikeres, 0 hibás teszt.
- Teljes Bun 1.3.14 futás: 1361 sikeres, 0 hibás, 256 fájl; hook-timeout
  ebben a futásban nem jelentkezett. A külső collision-oracle teszt saját
  ellenőrzése az elérhetetlen demo endpoint miatt továbbra is kihagyódott.
- Gyökér és engine TypeScript, formázás és staged whitespace: hibamentes.
- Valódi escrow release és treasury credit közbeni változásra is
  `unverifiable` eredmény; a journal történeti replay változatlan.
