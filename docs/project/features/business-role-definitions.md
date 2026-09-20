# Business role definitions

A Business részletes jogosultsági modellje a verziózott
`config/business-role-definitions.json` katalógusból töltődik be. A stabil
`roleDefinitionId` az autoritatív szerepazonosító; a régi `manager | worker` mező
csak átmeneti kompatibilitási projekció.

Egy szerep külön korlátozza:

- a használható, pontos `id@version` hivatkozású verified skilleket;
- az inventory, storage, treasury, pricing és contracts műveleteket;
- a felvételt, elbocsátást, delegálást és a kiosztható szerepeket.

Az `employment-required-only` policy nem verifikál skillt. Csak arra szűkíti a
szerepet, amelyet a munkaviszony külön előír; a végrehajtási rétegnek ezen felül
meg kell követelnie, hogy ugyanaz a pontos skillverzió az adott agent számára
elérhető és `verified` legyen. Az `allowlist` csak a review-zott katalógusban
verified pontos hivatkozásokat fogad el. Draft, hiányzó vagy eltérő verziójú
allowlist-bejegyzéssel a gateway fail-closed módon nem indul el.

## Adatmigráció

Meglévő adatbázis megnyitásakor a rendszer additívan hozzáadja a
`business_employment.role_definition_id` oszlopot, majd a régi `manager` és
`worker` sorokat rendre a `business.manager.v1` és `business.worker.v1`
szerepre vezeti át. Új adatbázisban az oszlop kötelező. Betöltéskor minden tárolt
azonosítót a katalógus ellenőriz, ezért ismeretlen vagy törölt szereppel a rendszer
nem folytatja csendben a működést.

## Visszaállítás

A migráció nem töröl és nem nevez át régi mezőt, ezért a korábbi programverzió az
extra SQLite-oszlopot figyelmen kívül hagyhatja. Katalógusszerepet csak az összes
rá hivatkozó munkaviszony explicit átvezetése után szabad eltávolítani. Szükség
esetén az új kód visszaállítása előtt adatbázis-mentést kell készíteni; automatikus
visszaalakítás vagy ismeretlen szerep `worker` értékre gyengítése tilos.
