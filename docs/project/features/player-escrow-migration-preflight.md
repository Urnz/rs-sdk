# Régi escrow előellenőrzése

Az `assessPlayerEscrowMigration(legacyPath, targetPath)` mindkét SQLite fájlt
kizárólag olvasási módban nyitja meg. Csak darabszámokat és blokkolókat ad
vissza; játékosnevet, egyenleget, tárgyat vagy titkot nem. Nem hoz létre fájlt,
nem módosít rekordot és nem végez migrációt.

Az előellenőrzés megkülönbözteti a régi adatbázis nyers `status` mezőjét a
tényleges lezártságtól: kitöltött `committed_at` mellett a rekord lezárt akkor
is, ha a nyers status `held` maradt. Ismeretlen régi sémánál a sorokat
feloldatlannak tekinti. Bármely régi vagy céloldali escrow rekord megállítja
az automatikus „friss közös ledger” kezdést, mert a két forrás összeolvasztása
és a játékos-checkpointtal való egyeztetés még nem bizonyított.

A jelenlegi helyi példányban 1 régi történeti rekord van, ebből 0 feloldatlan;
a céladatbázisban nincs escrow rekord. Ez **nem** migrációs engedély: az
előellenőrzés `legacy-records-require-reconciliation` blokkolót ad. A korábbi
külön escrow-adatbázist és a céladatbázist változatlanul meg kell őrizni.

Migráció és visszaállítás: ez a szelet nem változtat perzisztens sémát vagy
adatot, ezért a kód eltávolítható adatvesztés nélkül. Az éles átállás előtt a
régi rekord és a tényleges játékos-mentés forrását offline, auditált módon
egyeztetni, mindkét DB-ről konzisztens mentést készíteni, majd az új közös
adatbázisban a migráció eredményét ellenőrizni kell. Az első éles közös írás
után a régi fájlra visszakapcsolni automatikus rollbackként tilos.

## Aggregált bizonyítékjelentés

A `reportLegacyPlayerEscrowEvidence(legacyPath, targetPath)` külön, csak olvasható
jelentés. A régi sorokat terminális intézményi `consume`, feloldatlan vagy
ambivalens csoportba sorolja. A `consume` besoroláshoz a nyers `held` státusz,
azonos kitöltött kezdési/lezárási idő, hiányzó payee és hiba szükséges;
hiányos régi sémánál minden rekord ambivalens. A jelentés csak aggregált
darabszámokat és sémajelzőket ad: sem azonosítót, sem játékosnevet, sem összeget
vagy tárgyat nem ad vissza. Fájl hiányában nem hoz létre új fájlt.

A cél `accounts` tábla jelenlétét és a terminális `consume` rekordokhoz tartozó
checkpoint *jelenlétét* külön számolja. Hiányos checkpoint-sémánál a kapcsolat
ismeretlennek minősül. Egy azonos játékoshoz tartozó checkpoint-sor nem bizonyítja,
hogy a régi escrow-lezárással atomi tranzakcióban íródott. Ezért a jelentés
`atomicCorrelationAvailable: false` és `canMigrate: false` értéke állandó;
semmilyen migrációt vagy authority-váltást nem engedélyez.
