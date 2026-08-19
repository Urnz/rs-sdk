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

## Következő kiadás

1. Élő vezérlés: skill hozzárendelés és kontrollált teleport.
2. Offline szerkesztés: XP/szint, pénz, inventory és bank biztonságos módosítása.
3. Élő világtérkép és részletes skill-futástörténet.
4. Gazdasági dashboard bővítése: teljes vagyon, termelés,
   fogyasztás, shop-tranzakciók, player trade és XP/óra idősorok.
5. Kontrollcsoportok és több kísérleti snapshot összehasonlító nézete.
