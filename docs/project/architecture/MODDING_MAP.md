# Modolási architektúratérkép

Ez a dokumentum rögzíti, hogy az Agent Society funkciói a LostCity/rs-sdk melyik
rétegébe kerüljenek. A cél a visszafordítható, verziózható modok és a lehető
legkisebb upstream-felület.

## A jelenlegi rendszer rétegei

### Engine és világmodell

- `server/engine/src/engine/World.ts` a szerver tick-ciklusának és a játékos-,
  NPC-, zone-, login- és logout-feldolgozásnak a központja.
- `server/engine/src/engine/entity/Player.ts` tartalmazza a játékos futó állapotát,
  inventoryját, statjait és a központi `addXp` műveletet.
- `server/engine/src/engine/entity/Npc.ts`, `Inventory.ts` és `GameMap.ts` kezelik
  a fő runtime entitásokat és világtérképet.
- Saját engine-kód helye: `server/engine/src/mods/`. A vendored osztályokban csak
  keskeny hookhívás maradjon; a mod üzleti logikája ne kerüljön a `World` vagy
  `Player` osztályba.

### RuneScript és content

- A játékmeneti interakciók többsége a `server/content/scripts/**/*.rs2` alatt van.
  Ide valók az NPC-párbeszédek, objektuminterakciók, boltok és egyszerű content-
  specifikus szabályok.
- A `ScriptProvider`, `ScriptRunner` és `ServerTriggerType` köti a lefordított
  scripteket az engine eseményeihez.
- A `server/content/pack`, valamint az engine generált `data/pack` tartalma build-
  eredmény. Generált packot kézzel nem módosítunk; a forrás contentet változtatjuk,
  majd újrapakoljuk.

### Perzisztencia

- A klasszikus játékosállapotot `Player.save()` és `PlayerLoading.load()` bináris
  save-ként kezeli. A helyi mentések a `server/engine/data/players/main` alatt
  jelennek meg, az autosave a login szolgáltatáson halad át.
- Az engine Prisma-sémái a `server/engine/prisma/{singleworld,multiworld}` alatt
  vannak. A már meglévő tartós szerveradatok és telemetria ezt a réteget használják.
- A mod beállításai nem játékosadatok: a verziózott manifest a
  `config/world-mods.json`, a kért lokális állapot a
  `.local/admin/world-mod-state.json`, a pillanatképek pedig
  `.local/admin/world-mod-backups` alatt vannak.
- Új, tranzakciós domainállapotot — például ingatlantulajdon, hitel vagy banki
  főkönyv — nem írunk bele a bináris player save-ba. Külön, migrálható adatbázis-
  táblákban tároljuk stabil játékos- és domainazonosítókkal. Így az egyidejű
  vásárlás és pénzmozgás atomi lehet.

### Kliensprotokoll

- A bejövő játéküzenetek modellje/codec/handler lánca a
  `server/engine/src/network/game/client`, a kimenő csomagoké a
  `server/engine/src/network/game/server` alatt van.
- A vanilla és lite kliens párja a `server/webclient/src` alatt található. Új
  protokollcsomag csak páros engine- és kliensmódosítással kerülhet be; ezt a
  `server/PATCHES.md` kereszt-határ invariánsként tartja nyilván.
- Meglévő játéküzenetet, varpot, interface-t vagy RuneScript-megoldást használunk,
  ha az ki tudja fejezni a funkciót. Új protokoll csak akkor indokolt, ha a kliensnek
  új, másképp nem ábrázolható állapotot kell renderelnie. Az admin- és agentadatok
  alapértelmezésben a gateway API-ján mennek, nem a játékprotokollban.

## Döntési szabály: melyik változtatás hová kerül?

- **Konfiguráció/adat:** feature flag, ár, XP-görbe, regenerációs idő, ingatlan-
  katalógus, helykoordináták és szövegek. Ezek manifestből vagy külön verziózott
  konfigurációból érkezzenek.
- **RuneScript/content:** párbeszéd, NPC/loc/item opció, egyszerű bolt- és quest-
  viselkedés, valamint olyan szabály, amely a meglévő opcode-okkal biztonságosan
  kifejezhető.
- **Engine-modul:** központi vagy atomi invariáns. Ide tartozik az XP-jutalom
  módosítása, az ingatlantulajdon egyediségének és pénzlevonásának tranzakciója,
  a tartós számlálók és a lifecycle hookok.
- **Kliens/protokoll:** csak új játékbeli megjelenítés vagy interakció esetén,
  amikor a meglévő interface/varp/message nem elég.

Konkrét első hookpontok:

- Diminishing XP: `Player.addXp` előtt egy tiszta mod-policy kiszámítja a tényleges
  jutalmat; a content továbbra is az alap XP-t adja meg.
- Ingatlan: RuneScript indítja a vizsgálatot/vásárlást, de az ellenőrzés,
  pénzlevonás, tulajdonbejegyzés és audit egy engine-oldali tranzakció.
- Belépési mintamod: `World.processLogins()` után meghívott, külön
  `mods/WorldMods.ts` hook, a klienshez meglévő game message-en jut el.

## Saját kód és upstream határa

- Az rs-sdk gateway/admin, `config/world-mods.json`, `.local` runtime adatok és a
  `server/engine/src/mods` a mi rétegünk.
- A `server/engine`, `server/content` és `server/webclient` vendored fa. Minden
  szükséges érintkezési pontot fel kell venni a `server/PATCHES.md` listába, hogy
  upstream szinkron után célzottan ellenőrizhető legyen.
- Egy mod engine-hookja egy importból és egy kis hívásból álljon. A hook hiba esetén
  nem hagyhat félkész tranzakciót, és nem állíthatja meg a world ticket.
- Generált fájl és lokális runtime állapot nem kerül Gitbe. Manifest, migráció,
  teszt és dokumentáció igen.

## Feature flag, aktiválás és migráció

Minden mod külön `enabled` flaget, szemantikus modverziót, `dataSchemaVersion`
értéket és deklarált aktiválási
módot kap. A gateway a **kért**, az engine az induláskor betöltött **aktív**
állapotot mutatja. Érvénytelen manifest vagy state esetén az engine fail-closed
módon nem aktivál modot.

Az életciklus:

1. konfiguráció ellenőrzése, automatikus backup és atomi írás;
2. `hot-reload` modnál atomi, azonos adatsémájú újratöltés,
   `restart-required` modnál függő állapot;
3. engine-induláskor séma- és függőségellenőrzés, majd aktiválás;
4. sikertelen aktiválásnál a korábbi konfiguráció visszaállítása és újraindítás;
5. sémaemelésnél `migration-required`, sémacsökkentésnél `rollback-required`
   blokkolás; domainadat-sémaváltásnál előbb backup, majd előre mutató, idempotens migráció;
   a manifest csak sikeres migráció után válhat aktívvá.

A konfiguráció restore nem csökkenti a globális revíziót: a kiválasztott
pillanatkép tartalma új revízióként kerül kiírásra. Ez megőrzi az optimista
konkurenciavédelmet és auditálhatóvá teszi a rollbacket. A domainmigráció nem
egyenlő a konfiguráció restore-ral; ahhoz külön, verziózott migráció és explicit
rollback/forward-fix szükséges.

## Kötelező ellenőrzések új modnál

- Manifest- és konfigurációvalidáció, függőség/ütközés teszttel.
- Engedélyezés, kikapcsolás, restart és restore állapotátmeneteinek tesztje.
- A domain invariáns unit tesztje, tartós adatnál újraindítási integrációs teszt.
- Alapmechanika regressziója kikapcsolt moddal.
- Élő ellenőrzés tesztjátékossal vagy bottal, majd az eredmény rögzítése a
  feladatlistában.
