# Gazdasági eseménynapló és kísérleti aktivitásmetrikák

## Hiteles forrás és tartós ledger

A gazdasági események forrása továbbra is a verified agent-skill változtathatatlan
run journalja. A gateway csak strukturált műveleti bizonyítékból képez eseményt:
termelés, felhasználás, shop-vétel/-eladás, player-trade és bankmozgatás. Szabad
szövegből, LLM-válaszból vagy puszta inventory-snapshotból nem talál ki tranzakciót.

Minden feldolgozott run bekerül a `.local/economy/events.sqlite` ledgerbe a teljes
gazdasági bemenet SHA-256 digestjével. Az első feldolgozás egyetlen SQLite
tranzakcióban rögzíti a runt és a belőle képzett eseményeket. Azonos replay nem ír
új sort; ugyanazzal a run ID-val megváltozott journal fail-closed hibát ad, és nem
írja át a korábbi történetet.

Az események tartós sorszáma megőrzi az egy műveletből képzett több esemény eredeti
sorrendjét is. Emiatt egy run visszajátszása nemcsak ugyanazt az aggregátumot, hanem
ugyanazt a rendezett eseménysort adja. A korábbi fájlok az admin gazdasági nézetének
betöltésekor idempotensen migrálódnak a ledgerbe; új skill-runokat a gateway a
folyamat kilépésekor azonnal ingestál.

## Aggregátumok és multi-agent kísérletek

A szűrt eseményhalmazból determinisztikusan számoljuk a termelt és felhasznált
tárgymennyiséget, shop-tranzakciókat, player-trade-eket és a megfigyelt nettó
coinváltozást. Ezek eseményalapú metrikák; a teljes világ gazdasági snapshotját nem
helyettesítik.

Lezárt multi-agent kísérlet ezen felül eltárolja:

- a résztvevők hiteles runjaiból képzett gazdasági eseményszámot és aggregátumot;
- az egyedi exact skill-ID-k számát és runonkénti megoszlását;
- a skillkoncentráció Herfindahl-indexét (`1` = minden run ugyanaz a skill,
  alacsonyabb érték = változatosabb megoszlás).

A globális baseline/final pénz-, XP- és készletdelta ettől külön megmarad. Így a
snapshot megmutatja, mi változott a közös világban, a run-evidence pedig azt, hogy
a résztvevők igazolt műveletei között milyen aktivitás volt.

## Szándékos korlátok

A ledger még nem mér régióbejárást, célpontdiverzitást, piaci árat, egyéni jövedelmet
vagy célhaladást. Ezekhez külön, hiteles koordináta-, ár-, ownership- és goal-event
forrás kell; nem vezetjük le őket bizonytalan szövegből vagy utólagos becslésből.
