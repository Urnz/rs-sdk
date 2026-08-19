# Botadminisztráció és gazdasági telemetria

## Jelenlegi képességek

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

Az admin panel első feladata ezek egyesítése, nem egy új telemetriarendszer
nulláról való megírása.

## Állapotmódosítási szabály

Online botnál az engine memóriája a hiteles állapot. A mentésfájl kézi átírása
futás közben elveszhet vagy sérülést okozhat. Élő módosítás ezért kizárólag az
engine tickjén sorba állított, típusos adminparancs lehet.

Offline botnál a kanonikus player-loading/save codec használható. Minden módosítás
előtt automatikus mentés készül, majd validálás és visszaolvasási próba következik.
Az adminművelet rögzíti az operátort, indoklást, időpontot, előtte/utána értéket
és a kapcsolódó kísérlet azonosítóját.

## Tervezett felület

1. Botlista: online/offline, aktuális skill, hely, vagyon, combat/total level,
   utolsó esemény és hiba.
2. Botprofil: minden skill/XP, inventory, bank, equipment, coins, ismert agent
   skillek, célok és futástörténet.
3. Élő vezérlés: skill indítás/megszakítás, kontrollált teleport, logout/restart.
4. Offline szerkesztés: XP/szint, pénz, inventory és bank biztonságos módosítása.
5. Gazdasági dashboard: pénzmennyiség, összvagyon, itemkészlet, termelés,
   fogyasztás, shop-tranzakciók, player trade és XP/óra idősorok.
6. Kísérletek: snapshot, címkék, kontrollcsoportok és exportálható eredmények.

Az első kiadás read-only lesz. Írási műveletek csak az adatforrások egységesítése,
jogosultságkezelés és auditnapló tesztelése után kerülnek a felületre.
