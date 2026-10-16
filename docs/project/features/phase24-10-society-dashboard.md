# Phase 24.10 – mutatóktól a natív eseményekig

Dátum: 2026-10-16. Az adminfelület új **Társadalom** füle a 24.9 értékelési
vektorát, a hozzá tartozó natív termelési/trade bizonylatokat és az eredeti
rekordig vezető lefúrást jeleníti meg. Nem indít kísérletet vagy botot.
A 24.8 élő paraméterkísérletei továbbra is későbbre ütemezettek.

## Használat

1. Admin → Társadalom. Az óraadatok kitöltése a meglévő közös SimulationClock
   állapotát olvassa, nem lépteti az időt. Az automatikus kezdőablak az utolsó
   megfigyelést megelőző szimulációs nap; mindkét határ szerkeszthető UTC ISO.
2. Add meg az értékelés kohorszának agent ID-it. Nincs automatikusan kitalált
   alapítói névsor vagy hallgatólagos populációválasztás.
3. Töltsd be a riportot. A tíz dimenzió külön kártyát kap; a hiányzó natív
   adatsor nem nulla vagy zöld sikerítélet. Összpontszám nincs.
4. Egy eseménnyel alátámasztott mutató **forrásesemény** gombja a megfelelő
   bizonylatlistára szűkít. Jelenleg a specializáció és a strukturális
   rendszerkockázat mögött van ilyen natív eseménysor, a 24.9 korlátai szerint.
5. Szűrj agentre, Businessre, termékre, régióállapotra és időre; az időeloszlás
   egy oszlopára kattintás a bizonylatlista idejét szűkíti. A lapméret 1–100.
6. A **Bizonylat** gomb megmutatja az eredeti natív rekordot, saját digestjét,
   sorszámát, a pontos SimulationClock-kötést, a gráfcsomópontokat/-éleket és
   az adott mutatóhoz való bizonyítékkapcsolatot.

Az eseményszűrők a listát változtatják; nem számítják át hallgatólagosan a
fent látható értékelési vektort vagy annak nevezőit. Más értékelési időablakhoz
vagy kohorszhoz a felső riportfeltételeket kell újra betölteni. Azok szerkesztése
azonnal érvényteleníti a korábbi nézetet. A későn beérkező hálózati válasz nem
írhatja felül az újabb szűrést vagy bizonylatválasztást.

## Dimenziók és bizonyítékhatárok

- **Agent:** csak az esemény idején igazolt agentazonosítást használja. Egy
  puszta playernév vagy workflow-referencia külön, nem igazolt referenciaként
  látszik, nem kap hallgatólagosan hiteles agentstátuszt.
- **Business:** kizárólag a rögzített termelési szerep. Trade-rekordból nem
  talál ki Business-tulajdonost, munkaviszonyt vagy bolti tranzakciót.
- **Termék:** az eredeti termelési/trade bizonylatban szereplő item ID.
  Termékre szűréskor a bizonylat egésze megmarad, az atomi trade másik lába is.
  Egy kétirányú trade egy bizonylat, nem két tranzakció.
- **Régió:** a jelenlegi natív termelési és trade-rekordokban nincs történeti
  helyszín. Az összes/ismeretlen választás ezt láthatóvá teszi. A szerver
  régióazonosító szerinti szűrőt is validál, de a meglévő rekordok egyik
  ismert régióba sem sorolhatók. Nulla találat nem bizonyít régiós
  aktivitáshiányt. Mai koordináta, Business-cím vagy facility nem helyettesíti
  a múltbeli eseményhelyet. A kész státusz régiókezelést, nem új történeti
  régiónapló elkészültét jelenti.
- **Idő:** kanonikus szimulációs `(from,to]` eseményablak, legfeljebb 24
  időoszlop, külön szűkíthető esemény-ablak. A valós idő és az engine tick/
  clock-sorszám a részletben megmarad. Clockhoz nem köthető esemény nem kerül
  az igazolt listába; az `unplaced` számláló a lefedettségnél látható.

A specializáció a kiválasztott kohorsz rögzített receptfelelőssége. A
rendszerkockázat a megfigyelt gazdasági ablak összes agent/Business kiesése,
ezért a scope tágabb az actorlistánál, és ezt a felület külön kimondja.
A HHI mögött minden releváns receptlépés látható; a négyzetes képletben való
részvétel nem eseményenként egy egységnyi számláló-hozzájárulás.
A kiesési mutatónál a maximális forgatókönyvek érintett termelési
bizonyítékai és a teljes megfigyelt termelési nevező külön követhetők.
Átfedő agent/Business-kieséseket nem ad össze.
Holtversenyes maximum esetén a számláló egy determinisztikusan választott
forgatókönyv tanúeseményeire mutat, amelynek target ID-ja látható. Két
független, azonos méretű kiesés eseményeit nem egyesíti nagyobb számlálóvá;
a további holtversenyes forgatókönyvek külön megmaradnak a forrásnézetben.

Az önfenntartás korábbi diagnosztikái és a további dimenziók adatkorlátai
a forrásnézetben megmaradnak. Ezekhez nem gyártunk új eseményt vagy mérési
értéket. A dashboard nem teljes gazdasági lefedettség, oksági kísérlet vagy
működő társadalom igazolása.

## Natív gyűjtés és változó adatok

Az `economic-dependency/runtime.ts` új belső `collectEconomicRiskEvidence`
gyűjtése a validált natív bizonylatokat ugyanazokkal a forrásonkénti
snapshotokkal adja át, amelyekből a gráf és a kockázati riport készül.
A `society-metrics/evaluation-report.ts` közös gyűjtése ugyanebből állítja
elő a korábbi 24.9 JSON-t és az új dashboard eseményindexét. A meglévő
riportok tartalma és digest-szerződése változatlan.

A dashboard `snapshot` digestje a projekciós protokollt, az értékelési scope-ot, az értékelési riportot
és a natív függőségi gráfot köti. A lapozás és az eseményrészlet ezt viszi
tovább. A szerver újraolvassa a natív forrást, nem a kliens által küldött
riportot fogadja el. Eltérő snapshot: **409**, újratöltés szükséges. Ez szigorú
kötés: egy forrás bővülése a kiválasztott ablakon kívül is érvénytelenítheti
a régi nézetet. Folyamatosan változó világban ezért újratöltésre lehet szükség.

Az eseményrészlet csak a választott scope és szűrés igazolt eseményét nyitja
meg. Nem található vagy azon kívüli azonosító: **404**. Hiányzó/hibás digest,
időablak vagy lapozási paraméter: **400**. A külön adatbázisok olvasásai önállóan
konzisztensek; nem egy közös atomi világsnapshotot állítunk.

## Admin API

Adminhitelesítés mögött, kizárólag GET:

```text
GET /api/admin/society/dashboard
GET /api/admin/society/dashboard/events/<URL-encoded evidence:id>
```

Kötelező riportparaméterek: `from`, `to`, ismételhető `actor`, `clockId`,
`clockProfileDigest`. Eseményszűrők: `agent`, `business`, `itemId`, `region`
(`unknown` vagy 0–65535), `metric` (a riport által visszaadott kulcs),
`eventFrom`, `eventTo`. Lapozás: `offset` (0–100000), `limit` (1–100,
alapértelmezés 25). További oldalakhoz és minden részlethez `snapshot` kell.
Ismeretlen metric-kulcs és nem kanonikus numerikus HTTP-paraméter elutasított.

HTTP-ről forrásútvonal, feltöltött esemény vagy hitelesítendő riport nem adható
meg. A szerver a már meglévő `selfSufficiencySources`/`dependencyGraphOptions`
konfigurációt használja. A felület eredeti natív rekordot mutat; minden
szöveg, így a tárgynév és a JSON is escaped, nem futtatható HTML.

## Aktiválás, migráció és visszavonás

Új asset: `server/gateway/admin/public/society-dashboard.js`; a meglévő
`admin.js` mountolja, az `index.html`/`admin.css` az új fület és reszponzív
elrendezést adja. Nincs frontend-csomagváltás vagy külső CDN.
A gateway új route-jai a gateway következő indításával aktiválódnak.

Nincs új tartós séma, adatbázis, gazdasági írás vagy clock-léptetés. A natív
olvasó SQLite WAL/SHM koordinációs fájlt létrehozhat, de nem migrál és nem
módosít gazdasági állapotot. Visszavonás: az új GET ágak, tab/mount/asset és
dashboard-modul eltávolítása; a közös gyűjtő visszaalakítható a korábbi
riportolvasóvá. Mentés-visszaállítás vagy történeti backfill nem kell.

## Technikai ellenőrzés

Izolált natív kétlépéses termelés és kétirányú trade: forrás- és clock-kötés,
mutatóhoz tartozó bizonyítékok, összetett dimenziószűrés, lapozás, időhatárok,
hiányzó/sérült forrás, változó snapshot és adminhitelesítés. A fő adatbázisok
tartalmi hash-e olvasás után változatlan.

Headless Chrome komponensellenőrzés a tényleges admin HTML-panellel,
CSS-sel, böngészős modullal és natív admin API-val: lefúrás, lapozás,
szűrés, késői válaszok, megváltozott forrás és kohorsz, XSS-szöveg,
CSP, 1440 px asztali és 390 px mobilnézet. A képek helyi tesztadatot
mutatnak, nem élő társadalmi eredményt. Engine/bot és hosszú benchmark
nem indult. Futtatási napló: [PHASE24_PROGRESS](../PHASE24_PROGRESS.md).
