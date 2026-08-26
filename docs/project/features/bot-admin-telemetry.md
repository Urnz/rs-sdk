# Botadminisztráció és gazdasági telemetria

## Első használható kiadás

A helyi adminfelület a futó stack mellett a
`http://localhost:7780/admin/` címen érhető el. Az oldal öt másodpercenként
frissül, és egyetlen nézetben egyesíti az élő gateway-állapotot, a játékosmentéseket,
a kezelt botfolyamatokat és az agent-skill futásjelzőket.

Az elkészült funkciók:

- az összes mentett és futó bot kereshető, rendezhető és szűrhető táblázata;
- státusz, aktuális tevékenység/agent-skill, combat és total level, pénz,
  pozíció és utolsó aktivitás;
- részletes profil skill/XP, inventory, equipment, bank és hibaadatokkal;
- bejelentkezés nélküli élő Spectate-radar közeli játékosokkal, NPC-kkel,
  objektumokkal, földi itemekkel, inventoryval és játéküzenetekkel;
- bot spawn, despawn és restart, valamint futó agent-skill megszakítása;
- verziózott `verified + shared` agent-skill kiválasztása, séma alapján generált
  paraméterezése és indítása online, kezelt bothoz;
- biztonságos online teleport öt névvel ellátott, verziókezelt célpontra;
- offline mentésszerkesztő level/XP-, pénz-, inventory- és bankmezőkkel,
  automatikus biztonsági másolattal és visszaállítással;
- új vagy korábban elmentett helyi bot hitelesítő adatainak kezelése;
- helyi jogosultságvédelem, minden módosításhoz kötelező indoklás és JSONL audit;
- visszaállítható eltávolítás: az offline bot mentése és helyi konfigurációja
  `.local/admin/trash/` alá kerül, nem törlődik véglegesen;
- pénz-, XP-, online botszám-, total level- és itemkészlet-idősor;
- címkézett, exportálható kísérleti snapshotok.

Az audit és a gazdasági idősor a `.local/admin/` könyvtárban marad, ezért nem
kerül Gitbe. Ha az adminfelületet nem csak localhoston használjuk, indítás előtt
`ADMIN_TOKEN` szükséges; token nélkül a módosítások kizárólag az azonos eredetű
helyi oldalról engedélyezettek.

A kézzel indított skill futásnaplója a `.local/admin/skill-logs/<bot>/`
könyvtárba kerül. Botonként egyszerre egy agent skill indítható. A böngésző csak
a verified katalógust jeleníti meg, de az engedélyezettséget és minden paramétert
a backend ismét ellenőriz, ezért módosított böngészőkérés sem tud draft vagy
ismeretlen skillt elindítani.

A teleport célpontjai a `config/admin-teleport-destinations.json` fájlban vannak.
A böngésző és a gateway csak célpontazonosítót küld; tetszőleges koordináta nem
adható át. Az engine ugyanebből a fájlból oldja fel a koordinátát, majd a következő
world tickben ellenőrzi, hogy a játékos online és szabad, a zóna betöltött, a cél
az aktív világ része, valamint a mező nem blokkolt és nincs rajta játékos vagy NPC.
Aktív agent skill vagy harc közben már a gateway is elutasítja a műveletet.

A gateway–engine módosító csatornát futásonként generált `ENGINE_ADMIN_TOKEN`
védi. A `scripts/start-local.ps1` ezt csak a gatewaynek és az engine-nek adja át;
a botfolyamat nem örökli. Kézi komponensindításnál mindkét szolgáltatásnak ugyanazt
az értéket kell megkapnia.

Ugyanazzal a névvel és jelszóval a normál vagy botkliensbe belépni nem megfigyelés:
az engine és a gateway ezt új sessionnek tekinti, ezért az előző headless botot
szándékosan lecseréli. Megfigyeléshez az adminpanel `Spectate` gombját kell
használni; ez kizárólag az élő telemetriát olvassa, és nem veszi át a bot sessionjét.

## Adatforrások és további lehetőségek

A tesztmentés-generátor új bot létrehozásakor már be tudja állítani a pozíciót,
skill-szinteket, inventoryt, bankot, felszerelést, pénzt és varpokat. Ez fejlesztői
fixture: ugyanarra a névre újragenerálva felülírhatja a korábbi fejlődést, ezért
nem lesz a végleges adminfelület közvetlen eszköze.

A futó rendszerből már elérhető több szükséges adatforrás:

- gateway bot- és controller-státusz;
- engine player count és élő játékospozíciók;
- hiscore-, equipment- és banknézetek;
- hosszú távú mozgástelemetria;
- skillek/XP snapshotok;
- wealth tranzakciós események;
- Prometheus- és tick terhelési metrikák;
- agent-skill futásnaplók, eredmények és hibakódok.

Az első kiadás az alapadatokat már egyesíti; a következő lépés a részletes engine-
és tranzakciós telemetria bekötése, nem egy párhuzamos rendszer megírása.

## Állapotmódosítási szabály

Online botnál az engine memóriája a hiteles állapot. A mentésfájl kézi átírása
futás közben elveszhet vagy sérülést okozhat. Élő módosítás ezért kizárólag az
engine tickjén sorba állított, típusos adminparancs lehet.

Offline botnál a kanonikus player-loading/save codec használható. Minden módosítás
előtt automatikus mentés készül, majd validálás és visszaolvasási próba következik.
Az adminművelet rögzíti az operátort, indoklást, időpontot, előtte/utána értéket
és a kapcsolódó kísérlet azonosítóját.

Az elkészült editor nem ír közvetlenül bájtpozíciókat. A gateway határolja és
validálja a kérést, az engine pedig world-tick határon ismét ellenőrzi, hogy a
játékos nincs online, login alatt vagy logout-mentés közben. Ezután a saját
`PlayerLoading.load()` betöltőjével készít játékosobjektumot, csak a jóváhagyott
mezőket módosítja, és a `Player.save()` metódussal állítja elő az új mentést.
Az írás ideiglenes fájlon át történik, a kész CRC-t visszaolvassa és ellenőrzi.

Az editor megnyitásakor eltárolt mentési időbélyeg optimista zárként működik:
ha közben login, autosave, másik admin vagy párhuzamos kérés módosította a fájlt,
az írás elutasítódik. A backupok a `.local/admin/save-backups/<bot>/` könyvtárban
maradnak, és minden restore előtt az aktuális állapotról is új védőmásolat készül.
A coin külön mező; az engine eltávolítja a korábbi coinstackeket, és a megadott
összeget a kanonikus bankinventoryba teszi.

A gateway `despawn` az ügyfél rendezett lekapcsolása mellett engine-tick parancsot
is küld. Így az engine a normál logout/save útvonalon rögtön felszabadítja a
játékost, nem kell megvárni a hálózati kapcsolat hosszú timeoutját. Az editor
megnyitása külön readiness-lekérdezéssel is ellenőrzi ezt az állapotot.

## Következő kiadás

1. Élő világtérkép és részletes skill-futástörténet.
2. Gazdasági dashboard bővítése: teljes vagyon, termelés,
   fogyasztás, shop-tranzakciók, player trade és XP/óra idősorok.
3. Kontrollcsoportok és több kísérleti snapshot összehasonlító nézete.
