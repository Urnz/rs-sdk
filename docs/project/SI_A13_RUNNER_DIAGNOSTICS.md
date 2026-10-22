# SI-A13 – natív próbák időmérése és a wrapper javítása

2026-10-22. Kizárólag helyi/private emulator; változatlan gazdasági runtime.
Ág: `codex/si-a13-native-test-diagnostics`.

## Mit bizonyít a mérés?

A régi gateway-wrapper tíz belső Bun-próbát egyetlen 120 s-os külső tesztbe
zárt. Kilenc belső próba saját kerete 60 s, a save-readeré 5 s volt. A wrapper
mindkét pipe teljes tartalmát megvárta, és csak a gyermek kilépése után írta
ki. Külső timeout esetén így a befejezett belső próbák részletei is elvesztek.

Először kizárólag folyamatos outputot és időmérést adtunk hozzá, **az eredeti
120 s-os külső és valamennyi belső limit megtartásával**. Eredmény: mind a tíz
natív próba PASS, teljes wrapper/helper-kör **41,505 s**. Runtime-előkészítés
10 ms, child-start 26 ms, cache load 100 ms, child-exit 41005 ms, cleanup 3 ms.
Ebben a futásban nem funkcionális hiba vagy runtime-előkészítési másolás,
hanem az eredményarchiválás/ellenőrzés adta az idő nagy részét.

A korábbi két 120 s-os bukás pontos belső helye utólag nem bizonyítható:
az akkori wrapper nem őrizte meg a résznaplót. Nem állítunk visszamenőleg
konkrét fájlrendszerhibát vagy garantált futásidőt. A bizonyított szerkezeti
hibák: eltűnő részdiagnosztika és az önálló tesztkeretektől független,
tíz próbát egyszerre levágó külső kapu.

Belső próbák ideje az eredeti egyprocesszes mérésben, majd az új elkülönített
futtatásban, cleanup-pal együtt. A két futás eltérő processzelrendezésű;
ez nem gyorsulásmérés, és az I/O-idők változtak:

1. `draft-trial`: 3262 → 2861 ms.
2. `published-trial`: 2725 → 1006 ms.
3. `day-profiles`: 3785 → 1929 ms.
4. `genesis-replay`: 887 → 1072 ms.
5. `treasury-drift`: 863 → 1071 ms.
6. `grant-clock-drift`: 803 → 3310 ms.
7. `baseline-archive`: 4118 → 8508 ms.
8. `recovery-save`: 1 → 7 ms.
9. `live-result`: 11691 → 22110 ms.
10. `accelerated-test-result`: 11419 → 30723 ms.

## A javított futtatási szerződés

- [Közös case-manifest](../../server/gateway/admin/integration-native-cases.ts):
  stabil ID, exact eredeti tesztnév és változatlan belső limit. A motoroldali
  regisztráció hiányzó/dupla/idegen esetnél elutasít, így nem maradhat ki csendben
  egy próba. Mind a tíz eredeti test body és mind a **90 natív assertion** megmaradt.
- [Gateway-wrapper](../../server/gateway/admin/integration-fixture.test.ts):
  tíz külön teszt, exact névfilterrel, gyermekenként pontosan egy sikeres eset
  és nulla failure kötelező. Egy próba önmagában is futtatható; nincs közös
  120 s-os plafon és nincs a belső limitek vak megemelése.
- [Shared helper](../../server/gateway/admin/native-food-test-runtime.ts):
  stdout/stderr már futás közben továbbítva; setup, child és cleanup mérve.
  Egy 60 s-os belső próba gyermekprocesszének 65 s a watchdogja, a gateway
  tesztnek 70 s a kerete; ebből külön 5 s processz-overhead és 5 s leállítási/
  takarítási tartalék. A save-reader 5/10/15 s-os kerete ugyanezt követi.
  A processz-overhead mért nagyságrendje ~1,5 s volt az első mérésben.
- Watchdog/pipe-hiba esetén csak a saját gyermek áll le, és a helper megvárja
  kilépését. A child TEMP/TMP/TMPDIR könyvtára az eldobható runtime alatt van,
  így a megszakadt belső fixture-ök is takaríthatók. Írható SQLite nincs megosztva.
- A [natív próbák](../../server/engine/src/mods/IntegrationFixtureNative.test.ts)
  case-start/body-pass/body-fail/case-end eseményt, továbbá copy/bootstrap/seal,
  capture/restore/verify/reread és cleanup szakaszokat írnak. Ezek folyamatosan
  bekerülnek az `invoke-verification.ps1` helyi logjába, timeout előtt is.

Példa egyetlen érintett natív határra, a szokásos verification wrapperben:

```powershell
pwsh -NoProfile -File scripts/invoke-verification.ps1 -Name si-a13-baseline-archive -CommandText 'bun test ./server/gateway/admin/integration-fixture.test.ts -t "SI-A13 baseline-archive:"'
```

## Ellenőrzési bizonyíték és scope

- `20261022-234138-335-si-a13-streaming-original-budget`: **PASS**, 13 teszt
  (10 natív + 1 gateway + 2 stream-próba), **41,505 s**; eredeti 120 s-os kapu.
- `20261022-234648-617-si-a13-isolated-cases-and-runner`: **PASS**, **34 teszt**,
  **99,950 s**. Tíz natív és tíz gateway-eset, öt runner stream/filter/deadline
  próba, valamint másik helper-fogyasztóként nyolc NativeTravelFare + egy wrapper.
  A tíz natív body ugyanazt a 90 assertiont teljesítette, mint az eredeti mérés.
- `20261022-234847-465-si-a13-affected-types-format`: root TS **PASS**, az engine
  TS a mérőwrapper generikus típusánál **FAIL**, összesen **142,857 s**.
  A javítás csak típusannotáció; runtime-próbát és sikeres root fordítást nem
  ismételtünk. A hibás napló megmaradt.
- `20261022-235222-734-si-a13-engine-types-final`: engine TS + format **PASS**,
  **41,116 s**. Webclient nem érintett, nincs webclient typecheck.

A logok/result JSON-ok `.local/verification/` alatt vannak. A két mérésből
generált `si-a13-native-timings.json` case- és processzidőket, assertion-számot
és az alapul szolgáló logneveket tartalmaz; ez diagnosztika, nem gazdasági receipt.

**Teljes regresszió nem futott.** Ez helyi test-runner/diagnosztika és policy
javítás, nem gazdasági tranzakciós alap vagy globális buildkonfiguráció.
A korábbi full FAIL történeti eredmény marad; a javított SI-A13 kapu célzottan
PASS, ebből nem állítunk új teljes-suite vagy társadalmi outcome PASS-t.
SI-B02 nem kezdődött el; DEV-I01 archívum-I/O optimalizálás külön nyitott munka.
