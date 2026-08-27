# Csökkenő XP-jutalmak

## Cél és állapot

Az `economy.diminishing-xp` az első valódi economy world mod. Alapból ki van
kapcsolva, ezért telepítés után nem változtatja meg a játékot. A World Adminban
hot reloaddal, engine-újraindítás nélkül aktiválható.

## Activity kulcs

Minden XP-jutalom egy játékosonként elkülönített kulcshoz tartozik:

```text
SKILL | RuneScript neve | célpont típusa és ID-je | szint:régióX,régióZ
```

A normál content XP-je a `stat_advance` opcode-on halad át. Innen a mod megkapja
a futó script nevét, az aktív object/loc/NPC célpontot és a játékos helyét. Ha
nincs célpont, a script és a régió továbbra is elkülöníti a tevékenységet. A
központi biztonsági hook a `Player.addXp` előtt fut; a mod kikapcsolva szigorú
no-op, hibánál pedig fail-open módon az eredeti XP kerül kiosztásra.

## Görbe és regeneráció

Az első jutalom 100%. A négy további lépcső kezdete és szorzója külön állítható;
az alapértékek:

- kezdő ismétlések: `5 / 15 / 30 / 60`;
- szorzók: `0.90 / 0.70 / 0.40 / 0.15`;
- regeneráció: óránként egy elfelejtett ismétlés;
- régióméret: 64 tile.

A szorzók csak csökkenhetnek, a küszöböknek szigorúan növekedniük kell. A World
Admin és az engine is ellenőrzi ezeket. Nulla szorzó valódi nulla XP-t jelent.
A regeneráció folyamatos; egy teljes regenerációs időszak egy ismétlést töröl.

## World Admin

A modkártya összecsukható szerkesztőjében módosítható:

- az érintett skillek vesszővel elválasztott listája;
- a térképrégió mérete és a regeneráció ideje;
- mind a négy csökkentett lépcső küszöbe és szorzója.

Aktiválás és XP-jutalmak után a kártyán játékosonkénti, görgethető állapottábla
jelenik meg. Ez mutatja az activity kulcsot, a regenerált ismétlésszámot és a
következő jutalom várható szorzóját. Az összesített base/granted/withheld XP,
csökkentett jutalmak, játékosok és activity kulcsok a runtime metrikák között
láthatók.

## Perzisztencia és biztonság

A játékosonkénti számlálók verziózott JSON-állapota a gitből kizárt
`.local/admin/diminishing-xp-state.json` fájlban van. Minden jutalom atomi
fájlcserével mentődik, ezért engine-újraindítás után folytatódik a számláló. A
modkonfiguráció backup/restore rendszere ettől külön működik: konfiguráció
visszaállítása nem törli a játékosok tanulási állapotát.

Ellenőrzött esetek: activity-kulcs képzése, görbehatárok, folyamatos regeneráció,
nulla jutalom, gyorsan ütemezett jutalmak, perzisztencia/újraindítás, hibás
konfiguráció fail-open működése és kikapcsolt mod no-op regressziója.

## Hátralévő kísérleti munka

A mod működőképes, de az economy hipotézis még nincs igazolva. Kontrollcsoportos
botkísérlet szükséges annak mérésére, hogy valóban növeli-e a hely-, célpont- és
skilldiverzitást. Ugyanebben a kísérletben külön kell mérni a resource respawn,
az árak és a késztermékek értékének torzító hatását.
