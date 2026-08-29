# LLM-integráció – tervezési vázlat

## Első use case

Egyetlen kezelt játékosügynök kapjon egy már aktív immediate célt és tömör
játékállapotot. A modell a bot által ismert, nem blokkolt és a megbízható
katalógusban elérhető magas szintű agent skillek közül választhat. A döntés
először csak javaslat; a determinisztikus végrehajtó kizárólag egyszer használható
approval azonosítóval indíthatja el.

Az első változat nem hoz létre célt vagy skillt, nem ír memóriát és nem kap
alacsony szintű engine-, fájl- vagy kódfuttatási eszközt.

## Rétegek

1. **Megfigyelés:** releváns játékállapot strukturált összefoglalása.
2. **Tervező/model adapter:** providerfüggetlen kérés és válasz.
3. **Policy/validator:** jogosultság, séma, költség-, idő- és lépéshatár.
4. **Végrehajtó:** szűk rs-sdk eszközök; közvetlen fájl- vagy engine-hozzáférés nélkül.
5. **Audit:** futásazonosító, modell, eszközkérés, eredmény, idő és hibakód.

## Elkészült 11A alap

- `llm-runtime/types.ts`: provider-, kérés-, döntés-, limit- és audit szerződések.
- `llm-runtime/planning.ts`: az agent snapshot, releváns memória és ellenőrzött
  skillkatalógus összekötése; a nem megbízható epizódok elkülönítése.
- `llm-runtime/orchestrator.ts`: közös inference queue, szigorú output-validáció,
  költség- és időkorlát, egyszer használható approval és emergency stop.
- `llm-runtime/mock-provider.ts`: hálózatmentes, determinisztikus provider a
  regressziós tesztekhez.
- `llm-runtime/audit.ts`: memóriabeli és JSONL audit sink; a nyers context helyett
  kérés-hash és korlátozott metaadat kerül a naplóba.
- `config/llm-runtime.json`: alapértelmezetten kikapcsolt mock konfiguráció.

## Elkészült 11B előnézet

- Az Agentek adminfülön külön `LLM dry-run` gomb kér friss, legfeljebb öt
  másodperces online botállapotot.
- A felület külön mutatja a célt, a trusted contextet, a nem megbízható adatot,
  a szűrt skilllistát, a mock modell döntését és annak futásazonosítóját.
- A dry-run mindig szimuláció: approval azonosítót ugyan a teljes pipeline állít
  elő, de az admin végpont nem kínál hozzá végrehajtási műveletet.
- Az orchestration audit külön `.local/admin/llm-audit.jsonl` naplóba kerül; a
  szokásos admin audit csak a futásazonosítót, státuszt, döntést és usage adatot
  tartja meg.
- Az eseményvezérelt réteghez elkészült a típusos domain-event gate, az ismételt
  forrásesemények deduplikálása és az agentenkénti burst cooldown. A valódi
  skill-/cél-/ajánlat-/gazdasági eseményforrások bekötése a következő részfeladat.

Valódi provider csak az eseményforrások és az admin jóváhagyási folyamat után,
explicit kis jogosultságú tesztkonfigurációval kapcsolható be.

## Biztonsági alapok

- A játékchat és minden külső szöveg nem megbízható adat.
- Titok nem kerülhet promptba vagy naplóba.
- A modell nem kap tetszőleges kódfuttatást az első verzióban.
- Minden futásnak van maximális lépésszáma, ideje és költségkerete.
- Vészleállítás után újabb modell- vagy eszközhívás nem indulhat.
- A tesztek alapértelmezetten determinisztikus mock modellt használnak.

