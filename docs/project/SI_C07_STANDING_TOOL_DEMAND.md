# SI-C07 – Tartós natív Mining-igény és igazolt időintervallumok

2026-10-25, fejlesztési részlépés. SI-C07 nyitott,27/45; nincs SI-M3/MVS PASS.

Az egyszeri Mining-próbák mellé elkészült a külön, nyugtázott tartós kérés
életciklusa. Nem keletkezik automatikusan tartós igény egy elutasított kattintásból.
A tracker nem bányászik, nem mozgat avatart és nem javít eszközt. A kért ércet
csak a normál packed Mining valódi kimenete teljesítheti.

## Elkészült natív határ

- `NativeMiningIntentTracker.start`: pontos owner/world/clock/profile/lifecycle,
  egyedi demandId, réz/ón cél, contextDigest és külön natív admission-authorizer.
  Actoronként egy pending kérés; ugyanaz az intent idempotens, átírás konfliktus.
- A kérés legfeljebb300000 wall ms életű. A natív nyitási minta idejéből készül
  az expiry; retry nem tolja ki. `cancel`, `expired`, illetve a konkrét natív
  érc-receipthez kötött `fulfilled` terminális, nincs feltámasztás.
- A World tick a már nyugtázott pending igényeket mintázza. Offline, sleeping,
  terminális vagy hiányzó identity/tool esetén unknown marad; íráshiba nem törli
  a kérést. Hiányzó tick később résként látszik. Az observer hibája nem szakítja
  meg a többi engine-műveletet.
- A valódi kimenet az intent teljesítését is az érc/wear/checkpoint/Mining-event
  meglévő tranzakciójába köti. Az intent-audit íráshibája minden gazdasági hatást
  rollbackel. Határidő utáni érc nem teljesíti a lejárt kérést. Mining-replay nem
  ad új outputot vagy második teljesítést.
- A külön fájlos archive/restore próba tényleges pending natív kérés és audit
  reopenjét igazolja; az eredeti világ későbbi megfigyelése nem kerül a restore-ba.
  Az expanded baseline a kiválasztott `native_mining_intent_state` csatornához
  a teljes intent-láncot/headet és world/clock/profile kötést újraolvassa.
  A fulfilled kimenetbizonyítékát az interval-reader külön ellenőrzi.

## Időmérés és verdict

Csak ugyanazon pending kérés két egymást követő, azonos process-sessionből
származó engine tickje képez igazolt unusable intervallumot. Mindkét oldalon
ugyanaz a natív instance/revision és unusable állapot szükséges. A wall rés
legfeljebb5000 ms, a simulation rés legfeljebb az eredeti minimum-policy
maximumTraceGap értéke; az expiry után semmi nem számolható hozzá.
Az5000 ms az observer bizonyíthatósági korlátja, nem új gazdasági minimum.

A reader az explicit `(from,to]` queryhez vágja a szakaszokat, requestenként a
leghosszabb összefüggő igazolt szakaszt adja vissza. Nem összegezi eltérő actorok
vagy külön kérések idejét. Ez **alsó korlát/negatív bizonyíték**, nem a teljes
tool-type minimum végleges új képlete. Unknown, restart, kihagyott tick,
megváltozott tool-revision és nyitott megfigyeletlen tail nem válik nullás igénnyé.

Ha már ez az igazolt alsó korlát meghaladja az eredeti1 simulation órát, a
`tool-unusable-demand-time` scoped megsértése FAIL; a natív outcome és az
evaluation facade ezt továbbadja, más hiányzó csatorna nem rejti el.
Rövidebb/hiányzó/egyenlő idejű bizonyíték **inconclusive**, sosem automatikus PASS.
Az eredeti policy-file,17 requirement,8 integrity gate és fiziológia változatlan.
A kontrollált negatív fixture FAIL-je nem egy lefuttatott hosszú C07 gazdaság eredménye.

## Még nem kész belépési feltételek

**A production `gather-loc` admission-bekötés még hiányzik.** A trackernek van
kötelező trusted authorizer portja, a natív próbák saját explicit admissiont adnak.
A normál runtime observer admission-portja fail-closed; nincs új SDK/HTTP parancs,
és önmagában egy kapott digest vagy modellüzenet nem nyithat igényt.
Az integrációs próbák explicit fixture portokat használnak; az admitted gather
start→managed World sampler→output teljes production út még külön belépési próba.
Következő konkrét munka: az executor admitted run/step/parameters/checksum és
active-skill marker forrásából, a kiválasztott avatarhoz kötött start/cancel
csatorna; timeout/abort/disconnect/retarget hibahatár; teljes cohort coverage.
Régi `interact-loc`, unbound és hiányzó identity továbbra lefedettségi rés.

A teljes17 szabály/8 integrity gate assessment, housing exposure, founder
tool/food/housing baseline, ratio, authoritative source-lista és SI-A14 még
belépési feltétel. Preflight **NO-GO**, új hosszú futási/provider engedély nincs.

## Saját séma és rollback

`item-lifecycle/native-mining-intent.ts`: saját séma1, négy additív tábla:
`native_mining_intent_schema`, `native_mining_intent_state`,
`native_mining_intent_audit`, `native_mining_intent_head`. Kezdeti explicit
tool-openingkor az üres séma is létrejön a baseline előtt; ez nem történeti
használati bizonyíték. A közös `user_version` és más komponensek adatai érintetlenek.
Ismeretlen verzió/unversioned adat fail-closed; sikertelen DDL és írás rollbackel.
Immutability, hash-lánc/head és a current projection egyezése külön ellenőrzött.
Hot-path írás a current projectiont és tailt olvassa, nem az egész történetet.

Rollback előtt az írót le kell állítani; a régi kód visszaállítható az új táblák
és bizonyíték megtartásával. A rollback alatt nincs intent-coverage; a pending
kérések múltbeli ideje utólag nem interpolálható. A régi világ komponens-sémáját
az új baseline előtt kell inicializálni; történeti bundle nem módosítható.

A reader100000 audit-row és a meglévő outcome256 MiB korlátja megmarad.
Ez nem korlátlan1:1 vagy24:1 nyolcnapos source-kapacitásígéret: a tényleges
run-planhoz előzetes row/byte budget szükséges. A mostani288:1 candidate
névleg40 wall perc, továbbra ratio- és teljes source-validálásra vár.

## Ellenőrzési határ

Saját upgrade/reopen/rollback/immutability/tamper/életciklus/időmérés, natív
Mining→repair→Mining és expired/cancel/output-hiba, valamint a közvetlen
outcome/evaluation/dashboard/expanded-restore és korábbi Mining/repair/food
fogyasztók célzott próbái. Root és engine TS kell, webclient nem változott.
Nincs közös clock/migrátor/asset-commit/auth alapváltozás; full nem taskzáró rutin.
Konkrét napló/result az átadásban; a nested/átfedő körök nem összeadandók.

`20261025-103413-367-si-c07-intent-consumers`:129 runtime ellenőrzés PASS,
14 fájl59,82 s; összesítve FAIL76,892 s a root TS2322 visszatérési típushiba miatt.
`20261025-103631-057-si-c07-intent-types-return`:explicit return commit után,
7 saját store teszt és root+engine TS PASS104,775 s. A sikeres natív/consumer
köröket a típusjavítás után nem futtattuk újra. Korai5 natív +1 wrapper
`20261025-102821-661-si-c07-intent-native-thin`PASS3,088 s; a végső6 natív
próba az129-es kör része. Nem full-suite vagy M3 PASS.
`20261025-104422-944-si-c07-intent-preflight-and-benchmark`:3 saját preparer és
1 kiválasztott benchmark/result/restore próba, friss NO-GO/sourcehash/link
ellenőrzés PASS9,702 s. A scope/roster/threshold megmaradt; nincs run approval.
