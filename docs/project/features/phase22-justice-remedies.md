# Phase 22.4 – intézkedés, jóvátétel és időzített custody

## Authority-határok

A jogi finding, a szankciós döntés és a végrehajtás három külön állapot.

- Csak auditált `responsible` finding lehet jóváhagyott intézkedés forrása.
- A `JusticeAdjudicatorGrantStore` külön, hash-láncolt, visszavonható
  joghatósági grantot tart fenn az `adjudication`, `custody` és `restitution`
  képességekre. A döntés az eseménykori grantot ellenőrzi.
- A `JusticeDecisionVerifier` az effektív policy digestjét, az explicit
  döntési akciót és az agent–player/címzett kötést igazolja. Az auditált grant
  önmagában nem elég.
- A `JusticeDecisionStore` csak döntést rögzít. Nem mozgat vagyont és nem
  korlátoz playert.
- Az LLM tiltott műveleti listája változatlanul tartalmazza az
  `issue-fine`, `seize-item`, `imprison-player` és `kill-player` műveleteket.
  Modellkimenet legfeljebb javaslat lehet; nem kap grant-, ledger- vagy engine-
  authorityt.

A döntés típusa zárt: jóváhagyás vagy elutasítás, legfeljebb 24 órás custody,
GP és legfeljebb 28 pontos item/count tétel. Elutasított döntés nem hordozhat
intézkedést. Halál és általános lifecycle nincs ebben a fázisban.

## Restart-safe végrehajtás

A `JusticeExecutionStore` egy már hiteles döntés immutable másolatát fagyasztja
be, determinisztikus escrow-, custody- és command ID-kkal:

1. `planned`: a döntés és a végrehajtási azonosítók tartósak.
2. `held`: a meglévő shared player escrow egyszer kiveszi a GP/item
   jóvátételt a kötelezett inventoryjából.
3. `restricted`: az engine tartós custody rekordot ír, és online belépéskor
   vagy azonnali alkalmazáskor a jail koordinátára helyezi a playert.
4. `settled`: ugyanaz az escrow egyszer átadja a teljes GP/item csomagot a
   pontos kedvezményezettnek.

Ha nincs vagyonjóvátétel vagy nincs custody, az adott külső művelet üres, de a
fázishatár megmarad. Külső siker és journal-write közötti crash esetén ugyanaz
a parancs ismétlődik. Elégtelen vagyon esetén custody sem indul; offline
címzettnél az escrow tartja a vagyont, a custody már fennmaradhat, a gateway
pedig startupkor és periodikusan folytatja a befagyasztott tervet. Új döntést a
recovery nem hozhat.

## Valódi engine-korlátozás és feloldás

Az engine `PlayerCustodyStore` külön SQLite ledgerben, auditlánccal őrzi a
határozatot. Restart után az aktív rekord újra érvényes. Minden world tick:

- a lejárt rekordok egyszer, auditáltan `released` állapotba kerülnek;
- aktív custody mellett a player pending actionje és waypointjai törlődnek;
- a player a határozatban befagyasztott koordinátán marad;
- a network réteg továbbra is leolvassa a protocol/heartbeat packeteket, de
  `USER_EVENT` és `RESTRICTED_EVENT` handler nem fut;
- a player queue, timer, engine queue, interaction, movement, recovery és GE
  feldolgozása kimarad.

Ez végrehajtási korlátozás, nem puszta lifecycle projection. A határidő után a
következő tick feloldja a korlátozást. Kézi vagy LLM-es önkényes release API
nincs.

## Vagyonmegmaradás

A jóvátétel nem mintel és nem semmisít meg tárgyat vagy coint: a 22.3-ban
bevezetett shared escrow ugyanabban a player-checkpoint tranzakcióban holdolja
a kötelezett pontos GP/item csomagját, majd ugyanazt a csomagot commitolja a
sértett inventoryjába. A teszt crash-t injektál a hold, custody és commit után,
majd restart recoveryvel igazolja, hogy egy escrow, egy custody és pontos nettó
`payer decrease = beneficiary increase` marad.

## Persistencia, migráció és rollback

A 22.4 csak új, v1-es adatbázisokat/táblákat ad hozzá:

- gateway: `.local/crime/justice-executions.sqlite` és a döntés/grant store
  konfigurált fájljai;
- engine: `data/mods/player-custody.sqlite` (vagy `PLAYER_CUSTODY_DB`).

Nincs korábbi custody/remedy rekord, ezért történeti adatmigráció vagy kitalált
backfill nincs. Rollbackhez leállított stack mellett a justice recovery és az
internal custody route kikapcsolható, az új fájlokat bizonyítékként meg kell
őrizni. Aktív custody rekordot tartalmazó ledgert nem szabad törölni vagy régi
binárissal figyelmen kívül hagyni; előbb a határidős feloldást és az esetleges
held escrow végleges commitját kell ellenőrizni. A változás meglévő 22.3 ledger
sémát nem migrál.
