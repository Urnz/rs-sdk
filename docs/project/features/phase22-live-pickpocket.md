# Helyi pickpocket acceptance

Az executable: `scripts/run-phase22-pickpocket-live.ts`. Kizárólag a saját
LostCity emulátor `localhost:8888` engine / `ws://localhost:7780` gateway
párját fogadja el. Külön, ehhez létrehozott tesztbotot válassz; meglévő
felhasználói agentet vagy mentést ne használj. A bot jelszavát a meglévő
ignored `bot.env` fájlból olvassa, nem írja a jelentésbe.

## Futtatás

PowerShellben, a repository gyökeréből:

```powershell
$trialBun = Join-Path $env:APPDATA 'npm\node_modules\bun\bin\bun.exe'
& $trialBun bots/create-bot.ts --local --no-chat
# Az előző parancs által kiírt új botnévvel:
./scripts/start-local.ps1 -BotName <new-local-test-bot>
& $trialBun scripts/run-phase22-pickpocket-live.ts <new-local-test-bot>
```

Opcionális valódi player-only tanúpróba: készíts egy második külön botot is,
indítsd el mindkét klienst (`start-local.ps1 -BotNames <thief>,<observer>`),
majd add meg a második nevet a futtatónak:

```powershell
& $trialBun scripts/run-phase22-pickpocket-live.ts <thief-test-bot> <observer-test-bot>
```

A runner az observer tutorialját is elvégzi és Lumbridge-be sétáltatja.
Külön SDK kapcsolat, pontos avatár-azonosítás és private host ellenőrzés kell.
Az engine-eseményben ennek a konkrét observernek kell szerepelnie a valódi
LOS snapshotban. A normál konfigurált figyelmi policy alapján egyetlen
tartós döntés születik; az észlelés nem garantált, és miss után nincs újrasorsolás.
A player-only observerhez nem készül agent identity. Észleléskor a normál
case observation cursor dolgozza fel a discoveryt az elkülönített bundle-ban,
suspect és legal finding nélkül. A döntéseket újranyitás után is replayeli.
Ez nem élő HTTP-feljelentés és nem külön személyazonosítási bizonyíték.

Ha bot nélküli stack már fut, a starter nem csatlakoztat hozzá automatikusan
új botot: indíts külön lite klienst a `server/webclient` könyvtárból
`bun src/lite/runner.ts <new-local-test-bot>` paranccsal, vagy előbb állítsd
le a kezelt stacket. A teszt végén állítsd le a külön tesztklienst.

A runner a tutorial ismert spawnterületén szükség esetén átugorja a tutorialt,
Lumbridge-be sétál, majd legfeljebb nyolc külön egyoperációs draft-futást
enged. Két siker után megáll; 4 alatti aktuális HP esetén nem indít új
műveletet. Nem gyógyít, respawnol vagy módosít mentést közvetlenül.
A globális időkeret 240 másodperc; a skill saját korlátai is megmaradnak.

## Bizonyíték

Minden run journal és a jelentés a `.local/phase22-live/<bundleId>` ignored
könyvtárba kerül. Az SDK-siker önmagában nem elfogadás. Az engine journal
művelet előtti cursora után pontosan egy, ugyanahhoz az avatarhoz, NPC-típushoz,
NPC-példányhoz és pozitív inventory deltához tartozó szerveres esemény kell.
A teljes engine hash-láncot ellenőrzi; a receiptet a normál bridge készíti,
explicit avatar–agent kötéssel, elkülönített acceptance adatbázisba.

Az SDK célpont-pozíciója mozgó NPC-nél eltérhet a szerveres snapshotétól;
az azonosságot ezért nem név/koordináta, hanem type ID + instance index adja.
Az engine XP belső egységű; nem hasonlítjuk nyersen az SDK kijelzett XP-jéhez.
A receipt szerveres XP-t és szerveres item deltát tárol.

A futtató újranyitja az adatbázisokat, ismét ellenőrzi a láncokat és minden
elfogadott eseményt újra ingestál. A replay receiptnek változatlannak kell
maradnia. Sikertelen SDK-runból nem állít ki receiptet. Ez nem jelenti azt,
hogy egy bizonytalan kliensvisszajelzés után nem történhetett engine-esemény:
az ilyen kimenet nem elfogadott élő bizonyíték.

## Tartalomfrissítés és visszaállítás

A szerver meglévő pack esetén startupkor nem feltétlenül fordítja újra a
RuneScript forrásokat. Friss bekötés tesztelése előtt ellenőrizd a packot.
Leállított engine mellett készíts `scripts/backup-local.ps1` mentést,
majd a `server/engine` könyvtárban futtasd a `bun run build` parancsot.
A saját Property loc-módosítások nem egyeznek a vanilla checksumokkal:
csak szükség esetén, kizárólag a build processében állíts `BUILD_VERIFY=false`
értéket, majd állítsd vissza. A compiler típus-/opcode ellenőrzése maradjon.

Nincs új perzisztens production séma vagy adatmodell. Az acceptance bundle
v1-es külön tesztadat; nem ír a fő agent-state/rights/case store-okba.
Rollback: állítsd le a tesztklienst, őrizd meg a bundle-t és engine evidence
adatbázist a WAL/SHM sidecarokkal. Korábbi kód visszaállításakor fordítsd újra
a hozzá illő tartalmat. A tesztbot mentése és megszerzett inventoryja ignored
helyi tesztállapot; production mentések visszaállítása nem része ennek.

Observer nélkül ez kizárólag a pickpocket engine outcome→receipt út elfogadása;
observerrel a valódi sight snapshot→attention→anonim discovery/case út is fut.
Nem HTTP-feljelentés-, identification-, finding-, büntetés- vagy publikációs próba.
A négy Thieving skill draft marad,
és a `thieve-*` műveletek autonóm engedélyezése nem változik.
