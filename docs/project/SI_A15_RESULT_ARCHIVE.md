# SI-A15 – Előrehaladt natív eredmény archiválása

## Végső forrású autonóm eredmény, 2026-10-22

Forrás: `backups/si-a15-technical-20261022-1648/workspace`, megfigyelés
`a08a3a67-2fe3-4772-8943-d22c552124e3`: három játéknap, 61 minta,
0 olvasási hiba, előre rögzített normál midpoint-restart és négy visszatérés.
A négy önálló étkezés és három rent egyeztetett; a termelési kör nem jött létre.
A teljes időablakos gazdasági mérleg és society-minimum verdict `inconclusive`.
Ezt az archívum megőrzi, nem változtatja meg.

Capture: `20261022-171522-038-si-a15-final-native-result-capture`,
PASS, 608,330 s, 14493 fájl; bundle
`backups/si-a15-technical-result-20261022-1715`.
Manifest digest:
`498e6a79b08d5e8b68bf4a04997ee9a2535e5837543a8ba730b6beba992045ef`;
natív report digest:
`3791d96746ba81232c96469ff806a292ca2ab92910fb244977b234119886e792`.
Az observer és a restart titokmentes naplóinak exact másolata külön
evidence/origin jegyzékkel az állapotcsomagban van, nem natív authorityként.

A normál `restore-result` új célja
`backups/si-a15-technical-restored-20261022-1726/workspace`;
a verify és a natív riport újraolvasása a restore beépített része.
Az ellenőrzés **PASS**:
`20261022-172914-759-si-a15-final-result-verified-restore`, 1049,612 s.
Ugyanaz a manifest, logikai natív inventory és natív report olvasható vissza.
A visszaadott manifest és a titokmentes evidence-origin digestjeinek
utóellenőrzése is PASS, 0,527 s:
`20261022-175048-192-si-a15-final-restored-result-and-evidence-digests`.
Az immutable payload DB-it nem nyitottuk meg kézzel; csak az erre szolgáló
eldobható ellenőrző másolat olvasta őket. A `liveAcceptance` továbbra is
`not-established-by-archive`; a külön [technikai lezárás](SI_A15_TECHNICAL_RESULT.md)
nem változtatja meg a megőrzött, részleges gazdasági minősítést.

## Hatókör

A technikai igazolás egyik korábbi akadálya, hogy az SI-A13 baseline-capture
kizárólag változatlan, paused nyitóállapotot fogad el. A `capture-result`,
`verify-result`, `restore-result` külön protokollt használ:
`society-integration-result-offline-v1`. A baseline-protokoll és annak
genesis-ellenőrzése megmarad; result nem olvasható baseline-ként.

Az eredmény a rögzített fixture/genesis/seal eredetéhez és az eredeti
clock-profile-hoz kötött, paused, ténylegesen előrehaladt állapot. Az eredeti
seal a genesis eredetét igazolja; nem várjuk tőle, hogy az előrehaladt
adatbázisok a nyitóállapottal egyezzenek.

## Ellenőrzés és megőrzés

- Az offline guard a másolás előtt és után is kötelező; a forráskönyvtár
  változását a natív fájlok új inventoryja elutasítja. Aktív world clockot
  az archiváló nem állít meg és nem léptet; a záróhatár előzetes feladat.
- Az unchanged source/config/cache manifest ellenőrzött. A teljes natív
  állapot, a checkpoint, játékosmentések, domain-DB-k és kísérőfájljaik
  bekerülnek; secret/credential és path-escape elutasított. A properties és
  bootstrap-ledger WAL/SHM/journal oldalfájljai is részei az inventorynak.
- A natív táblák logikai digestje és az SI-A12 readonly riport ugyanabból
  az állapotból készül. Új helyre másolva és restore után ezeknek egyezniük
  kell. Hiányos mérési lefedettséget az archívum megőriz, nem változtat PASS-ra.
- Az ellenőrzés eldobható, saját temp másolatban nyit SQLite-ot. Egy readonly
  olvasás is építhet SHM-indexet; a lezárt archívum DB-it ezért nem nyitja meg.
  A payload hash-eit másolás és újraolvasás után ismét ellenőrzi.
- Létező output nem írható felül. Hibás másolás, source-drift, sérült payload,
  hamisított riport vagy eltérő natív újraolvasás nem publikál részleges
  restore-t. Az archívum sikere nem SI-M1 vagy teljes élő acceptance.

## Parancsok

A repository gyökeréből, a kiválasztott világban, leállított írók és paused
záróóra mellett. A fixture kapcsolója az adott világ definíciója legyen:

```powershell
bun scripts/society-integration-fixture.ts capture-result --root C:/PATH/TO/WORLD --fixture config/fixtures/society-lobster-four-v1.json --output C:/PATH/TO/NEW-RESULT --offline
bun scripts/society-integration-fixture.ts verify-result --bundle C:/PATH/TO/NEW-RESULT
bun scripts/society-integration-fixture.ts restore-result --bundle C:/PATH/TO/NEW-RESULT --output C:/PATH/TO/NEW-RESTORE
```

A `verify-result` a valódi natív riportot olvassa újra; nem fogad el bemeneti
riportot hiteles asset- vagy needs-forrásként. A CLI külön jelzi:
`liveAcceptance: not-established-by-archive`.

## Natív teszt és kompatibilitás

Mind az élő, mind a gyorsított napalapú profilban tényleges Playerből a
packed food-script fogyaszt el egy valódi bootstrap lobstert; a checkpoint
és receipt alapján a tartós needs pontosan 2400 hunger reliefet kap.
A teszt ezután állítja meg az órát, készít resultot, új könyvtárba állítja
vissza, és újraolvassa ugyanazt a natív állapotot/riportot.

Publication availability és action-identity/arrival megnevezett technikai
teszthatárok; a többi három actor záró needs-lefedettsége ebben a tesztben
szándékosan hiányos. A riport ezt megőrzi. Ez nem négyavatáros élő demo,
útvonal-acceptance vagy belső eredetű termelés bizonyítéka.

Negatív esetek: genesis resultként és progressed world baseline-ként való
elutasítása; v1/v2 protokollkeverés; aktív writer, másolás alatti treasury-
változás, újrahash-elt hamis riport, sérült survival-profile payload és
meglévő restore-cél elutasítása. Korábbi baseline roundtrip is fut.

Nincs domain-DB migráció. Új, csak olvasható archive-protokoll és új CLI
műveletek kerültek be. Rollbackkor az új resultot az új olvasóval kell
visszaállítani; a régi baseline-olvasó helyesen elutasítja. Az eredeti világ
és az archívum megmarad, a staging hibánál eldobódik.

Exact eredmények: [progress](SOCIETY_INTEGRATION_PROGRESS.md).

## Tényleges autonóm próbáról készült archívum, 2026-10-22-i újraolvasás

Az első három játéknapos production megfigyelés sikertelen technikai
eredményét is megőriztük, nem csak a tesztfixture menthető. A rendezett
stop és paused óra után `backups/si-a15-technical-result-20261021-2024`
készült, majd új könyvtárba, a
`backups/si-a15-technical-restored-20261021-2031/workspace` helyre állt vissza.
A verify és restore ugyanazt a kanonikus natív riportot olvasta újra.
Manifest digest:
`5ac1a59ee6edff38a5190cc0cc5463f0b709607bf62e8b71d84d1baf740f4039`;
report digest:
`1b223a323c6d497056b51750edb339728781fe802475a848fa37bfe36a6dac0a`.
A `liveAcceptance` értéke továbbra is `not-established-by-archive`.
Exact logok és időtartamok a progress aktuális bejegyzésében.
