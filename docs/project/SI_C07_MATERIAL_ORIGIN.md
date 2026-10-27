# SI-C07 – Prospektív natív javítóanyag-eredet

2026-10-27, a2. munkacsomag része; [előző mechanikai lánc](SI_C07_TOOL_MAINTENANCE.md).
SI-C07 továbbra NO-GO,27/45, [6 munkacsomag maradt](SI_C07_REMAINING_WORK.md).
Az eredeti17 követelmény és8 integrity gate/küszöb változatlan.

## Közvetlen érc → bronz → javítás

Az új `production-workflow/native-material.ts` saját1-es sémájú, append-only
event/head/lot napló. A tényleges Mining output ugyanabban a checkpoint
tranzakcióban kap egyedi, egyetlen tárgyat jelentő lotot. A lot natív event-
digesthez, owner/world/lifecycle/clockhoz kötött. Játékbeli tárgyat nem hoz létre.

Az engine csak a valóban új inventory object-referenciához ad volatile tokent,
és ezt a sikeres checkpoint-tranzakció után teszi elérhetővé. Az olvasztás és
javítás azokat a slotokat vizsgálja, amelyekből a natív escrow ténylegesen
fogyaszt. Darabszám-egyezésből, másik tárgyból vagy korábbi receiptből nem
rekonstruálható token. Egy lot legfeljebb egyszer kerülhet WIP holdba.

Az olvasztás input-holdja tartósan megőrzi a két érc lotját, a WIP intent/
escrow/kezdőóra kötését. A valódi packed smelt csak ezek elfogyasztása után
mintel egy bronz lotot, az actual smelt output objecthez kapcsolva. A javítás
ehhez a konkrét bronzhoz rögzíti a holdot és a meglévő consume receiptet.
Ismeretlen inputból származó bronz is nyilvántartható, de nem lesz belső eredetű.

Az offline reader függetlenül ellenőrzi a teljes material auditot és lot-
projekciót, a Mining lifecycle-use receiptet, a WIP-et és a committed natív
hatást. A material holdhoz a valódi escrow audit/purpose, pontos mennyiség és
consume tartozik. Az olvasztás kezdeti held digestje és záró committed receiptje
külön kötött. Hiányos vagy sérült naplóból nincs belső eredetigazolás.

## Minimumcredit és korlátai

A [maintenance-reader](SI_C07_TOOL_MAINTENANCE.md) most a teljes, igazolt natív
kopás→javítás→új használat mellé `inputOrigin:internal` eredményt is adhat.
A minimum adapter ezt csak az eredeti applied founder/genesis, azonos
contract/world/clock/ablak és genesis utáni eredet esetén fogadja el pozitív
cycle alsó korlátként. A puszta repair-count továbbra nem elég. Üres naplóból
nem lesz nulla-ciklus FAIL, teljes minimum PASS vagy integrity PASS.

Jelenleg a közvetlen, azonos tulajdonosnál megőrzött fizikai tárgyidentitás
támogatott. Másolt tárgy, ismeretlen inputkeverék, példányt másoló banki mozgatás,
átadás vagy a még nem holdolt tárgy újrabetöltése után nincs implicit eredet.
Ezek konzervatívan unproven maradnak. A már holdolt WIP tartós inputlánca
újrabetöltés után is ellenőrizhető; az új actual smelt output új tokent kaphat.
Replacement/successor eredet még unproven. A teljes source universe, mortality/
enforcement, boundary/access coverage és8 integrity gate külön hiányosság.

## Bevezetés, migráció és rollback

Új tool explicit nyitásakor, baseline előtt inicializáljuk a saját sémát,
a nyitás meglévő tranzakcióján belül. A meglevő adatbázis közös user_versionje
változatlan. Régi bound tool vagy WIP történetéből nincs backfill, automatikus
lot-kiosztás vagy implicit újrainicializálás. Régi checkpointnál a meglévő
natív munka tovább működhet, de material source nélkül nincs új eredetcredit.

Meglevő világra explicit offline schema-init, új source/schema/build pin és
új baseline kell. A saját séma bővítése nem közös persistence-migráció.
A C06 explicit `requiredTables` kijelölésnél a material naplót, headet és
projekciót is validálja, majd az eredeti checkpointtal archiválja/visszaolvassa.
Nincs live install vagy új baseline ebben a fejlesztésben.

Rollback előtt stop és új pin szükséges: régi bináris nem írja ezt a prospektív
naplót, így nem folytathat igazolt material coverage-et. A táblákat és megőrzött
evidence-t nem töröljük; hiányos jövőbeli láncból nincs visszamenőleges credit.
A reader100000 sor felett elutasít, nem csonkol. Explicit hosszú-run row/byte/IO
budget továbbra a későbbi run-plan része.

## Ellenőrzési határ

Valódi100 Mining output→törés→packed smelt→javítás→új Mining output, pozitív
belső eredet és byteazonos frozen offline reread. Külön próbák: kevert ismeretlen
érc, azonos mennyiségű érc/bronz cseréje, banki másolás és reload; WIP reload;
failed hold/checkpoint rollback; single-spend, idegen owner/lifecycle, időfordulás,
sérült material projection/head és immutable history; explicit C06 restore.
A minimum adapter original-genesis, scope és opportunity negatív ágai is külön
ellenőrzöttek. Ebből nincs empirikus SI-M3/MVS PASS.

A módosítás a saját native material komponensre és közvetlen Mining/tool-work/
metrics/restore fogyasztóira korlátozódik. Közös Inventory, clock, gazdasági
tranzakcióalap, auth és függőség változatlan; célzott tesztfájlok és root/engine
TS szükséges, full nem indokolt. Check-ID-k/idők: [átadás](SOCIETY_DEVELOPMENT_HANDOFF.md).

Következő a2. csomagban a teljes source-coverage integrity feltétel explicit
forrásjegyzéke és a folyamatos mortality/enforcement bizonyítékának bekötése.
Az igazolatlan anyagmozgatás külön source gap marad. A3. founder baseline,
ratio-próba és hosszú run továbbra nem kezdődött el; C08 nem indul.
