# Új világok közös escrow-authority kapuja

Az `openSharedPlayerEscrowAuthority` egy friss világban, ahol a régi külön
escrow-adatbázisban nincs rekord, azonos SQLite adatbázisban állítja fel az
escrow és a játékos-checkpoint authorityt. A v1 `player_escrow_authority`
jegyzőrekordot digesttel, `IMMEDIATE` tranzakcióban írja. Újraindításkor a
jegyzőt és a régi forrás változatlanságát ellenőrzi, ezért a már az új
adatbázisba írt escrow-rekordok nem akadályozzák a folytatást.

Az új közös út minden tényleges escrow-állapotváltozáshoz ugyanebben a
tranzakcióban láncolt `player_inventory_escrow_audit` bejegyzést ír. Az
ismételt, változatlan művelet nem hoz létre új bejegyzést. Olvasás és írás
előtt a teljes láncot és minden aktuális escrow-sor utolsó lenyomatát
ellenőrzi; hiányzó vagy sérült auditnál zárva marad. A közös adatbázisban a
közvetlen `hold`/`release`/`commit`/`consume` hívás tilos, csak a játékos-
checkpointtal egybekötött művelet engedélyezett. Ez nem külső aláírás:
adatbázis-adminisztrátori átírás ellen önmagában nem bizonyíték.

Régi rekordnál – akár lezárt történeti rekordnál is –, jelöletlen céloldali
escrow-sornál, hiányzó checkpoint-táblánál vagy sérült jegyzőnél zárva marad.
Az indítási kapu nem migrál adatot és nem oldja fel a jelenlegi helyi világ
egyeztetési blokkolóját. A digest véletlen sérülést észlel, nem helyettesít
kriptográfiailag független auditnaplót vagy sérült DB teljes helyreállítását.

Perzisztens séma: a céladatbázisba additívan kerül a
`player_escrow_authority` v1 és a `player_inventory_escrow_audit` tábla.
Üres audit csak üres közös escrow-táblához érvényes. Korábban írt, audit
nélküli közös rekordot automatikusan visszamenőleg hitelesíteni tilos;
ellenőrzött migráció és külön történeti egyeztetés szükséges. Éles használat
előtt mindkét adatbázist konzisztensen menteni kell. Visszaállítás az első új
escrow-írás előtt: a céladatbázis konzisztens mentése visszaállítható. Az első
írás után a régi külön fájlra visszakapcsolni tilos; az escrow-rekordokat, az
auditot és a játékos-checkpointokat ugyanabból a céladatbázis-mentésből
együtt kell helyreállítani. Auditbejegyzést vagy escrow-sort külön törölni,
illetve az auditot újragenerálni nem szabad.

Az élő `World` csak a külön `PLAYER_ESCROW_SHARED_CHECKPOINT=true` kapcsolóval
használja ezt a kaput; az alapérték `false`, így a jelenlegi világ viselkedése
nem változik. A világ-tick adapter az inventory pillanatképét hiba esetén
visszaállítja, és a játékos mentését az escrowval közös tranzakcióban rögzíti.
A login-szerver autosave ezután csak másodlagos másolat, nem a siker
feltétele. A jelenlegi helyi világban a régi történeti rekord miatt az opt-in
kapu `reconciliation-required` hibával zár; a kapcsolót egyeztetés nélkül
nem szabad bekapcsolni. A célzott adapterteszt nem helyettesíti az éles
folyamatindítási és áramkimaradás-próbát.
