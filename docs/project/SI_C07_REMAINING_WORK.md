# SI-C07 – Rögzített munkacsomagok és lezárási feltételek

Állapot: 2026-10-27. A 2026-10-25-i hét munkacsomag változatlan.
**Az 1. kész, a 2. folyamatban, a 3–7. későbbi fázis.** A fő feladatlista
27/45; SI-C07 nyitott, preflight NO-GO. Hosszú C07 gazdasági próba nem indult.

A korábban ismételt „6 maradt” a 2–7. nagy csomagot számolta, nem a 2. csomag
részfeladatait. A 2. csomagban 15 fejlesztési commit készült `e9d852b63` és
`2785e6fee` között. A változatlan főszámláló eltakarta a belső haladást, a
folyamatosan hozzáírt következő naplózási lépések pedig nem adtak ellenőrizhető
lezárási tervet. Ezt a bontást az alábbi rögzített feltételek váltják fel.
Részletes [állapotfelmérés és a 2. csomag lezárási listája](SI_C07_PACKAGE2_CLOSURE.md).

1. **KÉSZ – Executor → SDK → natív belépés pontos kötése.** Egyszer használható,
   forrásból hitelesített dispatch/target; replay/cancel/late-ACK és másik raw
   kattintás nem teljesítheti az igényt. A kijelölt founder cohort támogatott
   bronze Mining útjain az azonosítatlan belépés naplózott elutasítás.
   [Eredmény](SI_C07_NATIVE_DISPATCH.md).
2. **FOLYAMATBAN – Teljes minimum-assessment implementáció.** Az eredeti
   17 szabály és 8 integritási kapu natív kiértékelése, minden szükséges
   nevezővel/időablakkal/forráskötéssel. Rögzített lezárási lista: **2/11 kész**;
   17/17 részleges szabályadapter, **2/8 pozitív natív kapuút**. A maradék hat
   kapu pozitív útja, a pozitív population-korlátok, a teljes boundary/access/
   demand integráció és az összesítő PASS-ág még nyitott. A tényleges jövőbeli
   run adatai nem ennek az implementációs csomagnak az elkészülési feltételei.
3. **Teljes közös founder-baseline.** Négy founder kompetenciákkal, pontos
   verified skill/grant csomaggal; natív Mining→smelt→repair→reuse input/
   kapacitás, étellánc és lakhatás. Az eredeti minimumhoz szükséges jóváhagyott
   indulóállapot, nem a teszteredményhez igazított készletnövelés.
4. **Natív időarány-validálás.** A választott clock-ratio összevetése a content
   tickkel, travel/harvest/work credit és tényleges meal/needs ritmussal.
   A 288:1 nem tekinthető már validált M3-aránynak.
5. **Végső preflight és konkrét futási terv.** Authoritative source-lista,
   C06 schema/state/environment pin, tényleges SI-A14, sor-/byte-/IO-budget,
   modell/költség/maxwall/stopfeltételek és ellenőrzött mentési/restore út.
   Csak technikailag belépésre kész tervhez kérhető külön futási jóváhagyás.
6. **Jóváhagyott hosszú önfenntartási próba.** Eredeti 1 nap warmup + 7 nap
   evaluation, frozen founders és invariánsok; drift/gap/limit/operator stop
   vagy bizonyított sértés kezelése a terv szerint. Provider csak külön
   engedélyezett modellel és kerettel; nincs a B06-ból örökölt általános jog.
7. **Eredményarchívum, offline restore és végső kiértékelés.** Az eredmény
   külön könyvtárba visszaállítva, a natív forrásokból újraolvasott értékeléssel,
   teljes bizonyítéklánccal és őszinte SI-M3/MVS eredménnyel. Az SI-C07 sikeres
   lezárása az eredeti minimum minden kapujának tényleges PASS-át igényli.

A csomagok és a 2. csomag lezárási pontjai nem garantált beszélgetési körök vagy
időbecslések. Új megfigyelő/napló önmagában nem lezárt pont: meg kell nevezni,
mely eredeti feltétel kiértékelését teszi lehetővé, és be kell kötni a fogyasztóba.
Újonnan felfedezett hiba külön, indokolt változás; nem csendben növekvő lista.
A történeti részletek a [progressben](SOCIETY_INTEGRATION_PROGRESS.md), az
aktuális következő lépés a [rövid átadásban](SOCIETY_DEVELOPMENT_HANDOFF.md).
SI-C08 nem indul automatikusan; sikertelen gazdasági eredményt megőrzünk.

2026-10-27: a [P2-03 lefedettségi kiértékelő és natív hiánymátrix](SI_C07_SOURCE_COVERAGE.md)
elkészült. A pont teljes natív lezárása a már ismert P2-04–P2-10 garanciáitól
függ, ezért továbbra nyitott; 2/11 kész, 9 nyitott pont. Következő P2-04,
utána P2-05–P2-10, majd P2-03 végellenőrzés és P2-11. Ez függőségi sorrend,
nem új részfeladatlista vagy új kapuk bevezetése.
