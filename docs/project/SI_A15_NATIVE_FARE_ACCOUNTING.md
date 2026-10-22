# SI-A15 – Natív hajódíj kanonikus elszámolása

Állapot: implementálva; teljes regresszió és kétirányú élő igazolás PASS.
A díj változatlanul a meglévő natív tartalom szerinti 30 GP. Nincs új
pénzforrás, utazási juttatás vagy feltöltés.

## Natív határ

A védett `INV_DEL` meglévő ellenőrzése után két pontos content-label
kap bizonylatot: `[label,karamja_sailor_dialogue]` Captain Tobiasnál a
Port Sarim-i kikötőben és `[label,customs_pay]` a Musa Point-i vámtisztnél.
A bizonylat élő, közeli, földszinti NPC-t, pontos 30 GP-t, aktív életciklust
és a kanonikus világóra megfigyelését követeli. Más script, más NPC-hely
és nem népességtag karakter nem kap ilyen társadalmi bizonylatot.

A pénzlevonás, a karakter checkpointja és a hash-láncos díjnapló azonos
Player-save SQLite-tranzakcióba kerül. Checkpoint-hibánál a tartós mentés,
napló és a memóriabeli pénzkészlet visszaáll. Ugyanaz a natív action-ID
újraolvasva sem a díjat, sem az utána következő boarding scriptet nem
ismétli. Más életciklus vagy óraprofil nem használhatja fel az előző ID-t.

Ez a díj kifizetésének bizonylata. A későbbi hajózás, kiszállás és célba
érkezés külön utazási postcondition; az SDK továbbra sem gazdasági authority.
Nincs kliens által feltölthető receipt vagy új díjlevonási API.

## Riport és ismeretlen állapot

A readonly source a kanonikus checkpoint DB három új tábláját és a teljes
napló hash-láncát/headjét olvassa. Sérült, részleges vagy hiányzó forrásból
nem állít elő sikeres nulla díjat. A tényleges, világ-/óra-/időablakhoz kötött
díj a GP-egyenlet outflow oldalára kerül egyszer. Hiányzó forrás esetén a
GP-egyenlet `fare-source-unverified`, a teljes egyenleg legfeljebb
`inconclusive`. Egy záródó megfigyelt egyenlet továbbra sem jelent teljes
gazdasági mutációlefedettséget vagy SI-A15 acceptance-et.

## Migráció és rollback

Additív, saját `native_travel_fare_schema` v1 a meglévő kanonikus Player-save
adatbázisban; nem módosít upstream `user_version` értéket vagy korábbi
receiptet. Új fixture bootstrapkor üres, auditált head készül. Meglévő
világban az első ilyen natív fizetés előtt mindhárom tábla atomikusan jön
létre. Részlegesen jelen levő séma hibát okoz, nem automatikus javítást.
A migráció előtti díjak ismeretlenek; nem tölthetők vissza SDK-adatokból.

Rollback: rendezett stop és paused világóra után a korábbi teljes
forrás-/állapotbundle visszaállítása új könyvtárba. A díjnaplót tartalmazó
eredeti világ és audit megmarad. Tilos a napló tábláinak törlésével vagy
korábbi snapshotra visszaírással eltüntetni egy már levont díjat. A korábbi
forrásokkal archivált eredményeket a saját megőrzött forrásaik olvassák.

Az új implementáció külön, változatlan forrású utility-világban futott:
`backups/si-a15-fare-trials-20261022-1200/workspace`. A szakács mindkét
irányban a normál publikált travel CLI-vel hajózott. Két külön natív
receipt, összesen 60 GP; a kanonikus Player-save és üzleti treasury alapján
**3800 − 60 = 3740 GP**. A célba érkezés külön SDK-postconditionnel igazolt.
Audit: `20261022-121511-133-si-a15-two-way-native-fare-canonical-conservation`,
PASS, 0,541 s. Ez kontrollált pénzügyi bizonyíték, nem autonóm acceptance.
A korábbi diagnosztikai világok díjai továbbra sem kapnak visszamenőleges receiptet.

Teljes regresszió:
`20261022-120530-305-si-a15-native-fare-and-profile-archives-full-retry`,
PASS, 960,314 s; root/engine/webclient TypeScript, formázás, fő tesztcsomag
és mind a 31 további modulparancs. Az előző, közös időkeretbe futó
archive/restore teszt sikertelen naplója megmarad; a két profil változatlan
állításokkal és egyenként változatlan 60 s korláttal külön teszteset lett.
