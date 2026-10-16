# Élő HTTP-tanúfeljelentés acceptance

Az executable: `scripts/run-phase22-witness-http-live.ts`. Egy korábban elfogadott,
restart-verified pickpocket bundle valódi engine eseményét, player-only tanúdöntését
és case discoveryjét használja. Nem hoz létre mesterséges tanúadatot, nem ismétel
lopást, nem másolja a bundle-t a fő társadalmi adatbázisokba.

## Izoláció és hitelesítés

A gateway operator-only `CRIME_REPORT_ACCEPTANCE_BUNDLE=<bundleId>` kapcsolója
csak a `/crime/report/:avatar` intake ledger-pathjait változtatja meg. A fő admin,
autonomy, economy és agent-state útvonalak nem változnak. Az engine evidence és
a konfigurált figyelmi policy továbbra is a valódi helyi szerver forrása.
HTTP-ből nem választható bundle vagy adatbázis.

Csak a `.local/phase22-live/<bundleId>` alatti elfogadott csomag használható.
Path traversal, hiányzó/félkész bundle és az onnan kifelé mutató junction/link
elutasítva. Az existing report fájlok is a kiválasztott bundle-ban maradnak.
Hibás acceptance konfigurációnál a gateway startup megáll; nincs fallback a
fő crime-adatbázisokra. Acceptance-módban kötelező `LOGIN_SERVER=true`.
A mód neve a report-válasz fejlécében látszik, filesystem path vagy credential nem.

A teszt az eredeti `BotSDK.fileWitnessReport` metódust, a valódi HTTP-végpontot,
LostCity loginserver-hitelesítést és gateway game-avatar freshness ellenőrzést
használja. Az observer SDK kapcsolat `observe` módú, nem veszi át a játékvezérlést.
A jelszó kizárólag a bot ignored `bot.env` fájljából jön és bearer fejlécbe kerül.
A JSON kérés kizárólag case ID-t és source case-event ID-t küld.

## Futtatás

Előbb állítsd le a kezelt stacket. A meglévő, elfogadott bundle-hoz tartozó két
külön tesztbotot használd; ne felhasználói agentet. PowerShellben a repo gyökeréből:

```powershell
$trialBun = Join-Path $env:APPDATA 'npm\node_modules\bun\bin\bun.exe'
$env:LOGIN_SERVER = 'true'
$env:CRIME_REPORT_ACCEPTANCE_BUNDLE = '<accepted-bundle-id>'
./scripts/start-local.ps1 -BotNames <offender-test-bot>,<observer-test-bot>
& $trialBun scripts/run-phase22-witness-http-live.ts <accepted-bundle-id> <observer-test-bot> <offender-test-bot>
```

Ellenőrzi: bearer hiánya, rossz jelszó, rossz avatar, hamisított bejelentőmező,
helyes bejelentés, pontos replay, egyetlen report és az auditláncok. A report
nem hoz létre identificationt vagy legal findingot. Új gateway/engine process
indítása után ugyanazzal a bundle-lal újrafuttatva is az eredeti report ID-t kell
visszaadnia. Jelentés: a bundle `http-acceptance.json` fájlja.

A külön testbot kliensének leállítása után, de még futó gateway/loginserverrel:

```powershell
& $trialBun scripts/run-phase22-witness-http-live.ts <accepted-bundle-id> <observer-test-bot> <offender-test-bot> --offline-check
```

Ez helyes jelszó mellett az explicit `Matching live avatar is required` 409-es
választ követeli meg, nem elégedik meg bármilyen domain-elutasítással.
Jelentés: `http-offline-acceptance.json`.

A végén állítsd le a stacket, állítsd vissza mindkét környezeti változó eredeti
értékét, majd indítsd újra a normál stacket. Ha nem volt bundle-változó, töröld;
üres stringet ne használj, az hibás konfigurációként megállítja a gatewayt.
Az acceptance-mód kizárólag process-scope, nem kerül bot.env vagy titokfájlba.

## Migráció, rollback és korlátok

Nincs production séma-változás. Az elkülönített report store a már létező sémát
használja; a fő crime/agent ledgerekhez nem adunk tesztreportot vagy tesztidentityt.
Rollback: állítsd le a gatewayt, töröld/vond vissza az acceptance beállítást és
őrizd meg a bundle összes adatbázisát a WAL/SHM fájlokkal. A régi kód normál
intake pathjai változatlanok. A sikeres reportot ne töröld a replay kedvéért.

Normál fejlesztői gatewayn, ha `LOGIN_SERVER` nincs bekapcsolva, a report végpont
továbbra is 503-mal zár. Ez szándékos védelem, nem bypassolandó acceptance-hiba.
Ez player-only HTTP-notice elfogadás, nem élő agent report, külön recognition,
guilt, büntetés, másik Thieving procedure vagy skill-publikáció elfogadása.
