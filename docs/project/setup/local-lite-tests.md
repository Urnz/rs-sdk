# Helyi Lite-kliens validálás

A cache-adatot igénylő hat Lite-tesztfájl alapértelmezett forrása a saját
`http://localhost:8888` emulátor, nem az upstream publikus demója. A közös
beállítás a `server/webclient/src/lite/test-cache-config.ts` modulban van.
Másik private emulátorhoz `LITE_TEST_ORIGIN`, a cache helyéhez `LITE_TEST_CACHE`
adható meg; az alap cache az operációs rendszer temp könyvtárában van.

Indítás botok nélkül: `pwsh -NoProfile -File scripts/start-local.ps1 -NoBot`.
Ha a stack már fut, ne indítsunk mellé másik példányt. A tesztek a cache-HTTP
adatokat olvassák; a login-redeploy teszt külön mock szervert használ, nem
valódi játékosfiókot léptet be. Meglévő mentést vagy világadatot nem írnak át.
A normál engine indítása ettől külön, a meglévő helyi runtime workflow szerint
történik; a tesztek maguk nem indítanak és nem állítanak le engine-t.

Az `action-encoding`, `crc-redeploy`, `interfaces`, `cycles`, `packet-errors`
és `world/CollisionBuilder` tesztek már nem nyelik el a hiányzó cache hibáját.
Elérhetetlen helyi szerver vagy hibás archívum esetén a futás sikertelen,
indítási útmutatóval és az eredeti hibával. A beforeAll hookok explicit
60 másodperces keretet kapnak a hideg cache betöltésére; a collision teszt
180 másodperces, kezdeti elérhetőségi ellenőrzése legfeljebb 5 másodperc.

Az oracle a teljes böngészős `ClientBuild` implementációval hasonlítja össze
a könnyített kliens akadályjelzőit: Lumbridge, Varrock, Falador, Draynor és
Al Kharid régióban, mind a négy szinten. A helyi futás ezzel valós ellenőrzés,
nem pusztán zöldként elszámolt korai visszatérés.

Sémaváltozás nincs. Visszaállításkor a tesztkonfiguráció visszavonható;
az eltárolt temp cache törlése nem szükséges, és nem játékosmentés. A korábbi
külső alapértelmezést/kihagyást visszaállítva azonban újra megszűnne ez a
kötelező helyi lefedettség.

## Ellenőrzés (2026-09-26)

- Hat célzott fájl: 22 sikeres, 0 hibás teszt, 163 assertion; az oracle ténylegesen
  lefutott, 20 régió–szint összehasonlításban nulla eltérés.
- Elérhetetlen `http://127.0.0.1:1` forrással action-encoding: exit 1,
  0 sikeres / 1 hibás hook, eredeti ConnectionRefused hibával; nincs rejtett skip.
- Webclient TypeScript: hibamentes.
- Az első teljes helyi futás hat cache-függő hibát hozott elő: a
  `ClientInteraction.test.ts` globális fetch-stubja hiányos Response-ot
  hagyott a későbbi teszteknek (`/crc failed with undefined`). A fölösleges
  stub eltávolítása után a kliens- és a hat Lite-fájl közös futása
  41 sikeres / 0 hibás, 207 assertion; a helyi HTTP-szerver végig elérhető volt.
- Szándékosan elérhetetlen forrással a collision-oracle is exit 1-et ad,
  0 sikeres / 1 hibás, korai sikeres visszatérés nélkül.
- Végső teljes `bun test` (Bun 1.3.14, közvetlen Windows executable):
  1413 sikeres / 0 hibás, 6660 assertion, 257 fájl, 86,95 másodperc.
  A collision-oracle is lefutott; nincs cache miatti rejtett kihagyás.
- Root, engine és webclient TypeScript ellenőrzés: exit 0.

A hosted CI-t ebben a futásban nem indítottuk. Ott is szükséges a saját
emulátor cache-szolgáltatása; a tiszta checkout önmagában nem tartalmazza a
helyi packed cache-t. A hiányzó előfeltétel most hibát jelez, nem ál-zöld
teszteredményt. Külső publikus demóra nem állítjuk vissza az alapértelmezést.
