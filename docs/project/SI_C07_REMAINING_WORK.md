# SI-C07 – Rögzített munkacsomagok és lezárási feltételek

Állapot: 2026-10-29. A 2026-10-25-i hét munkacsomag változatlan.
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
   nevezővel/időablakkal/forráskötéssel. Rögzített lezárási lista: **10/11 kész**;
   17/17 részleges szabályadapter, **8/8 pozitív natív kapuút**. Egyedül a teljes
   natív numeric/integrity összesítő PASS-ág, P2-11 nyitott.
   Population és boundary/access/demand bekötve. A tényleges jövőbeli
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

2026-10-28: [P2-04 óra/world-policy natív kapu](SI_C07_WORLD_POLICY_GATE.md) kész:
eredeti 1+7 frame-en pozitív gate és sourceCoverage, két runtime szerephez
kötött rögzített bemenetek, packed reload és clock/mutation history.
**3/11 kész, 8 nyitott; 3/8 pozitív natív kapuút.** Következő P2-05;
P2-03 a többi ismert garancia után kerül végellenőrzésre. C07 NO-GO.

2026-10-28 további lezárás: [P2-05 finite lifecycle/no-respawn kapu](SI_C07_FINITE_LIFECYCLE_GATE.md)
kész. A natív health/mortality/attempt/census és reviewzott runtime teljes
eredeti időablaka együtt PASS-képes; a negatív STAT_ADD HP audit-bypass javítva.
**4/11 kész, 7 nyitott; 4/8 pozitív natív kapuút.** Következő P2-06,
utána P2-07–P2-10, P2-03 végellenőrzés és P2-11. Nincs új pont vagy hosszú run.

2026-10-28 további lezárás: [P2-06 admin/fallback kapu](SI_C07_ADMINISTRATIVE_VALUE_GATE.md)
kész. Reviewzott nyolc producer és teljes natív integrity head/state ablak,
valódi internal payment debit/credit; 1+7 PASS/failure/gap/frozen/C06 restore.
**5/11 kész, 6 nyitott; 5/8 pozitív natív kapuút.** Következő P2-07;
P2-03 a megmaradó garanciák után kerül végellenőrzésre. Hosszú run nincs.

2026-10-28 további lezárás: [P2-07 external shop/import kapu](SI_C07_EXTERNAL_VALUE_GATE.md)
kész. Reviewzott closed shop/restock, friss natív trade/aktív tényleges GE és
treasury prefix/state, teljes eredeti ablak, P2-06 join és belső commerce backing.
**6/11 kész, 5 nyitott; 6/8 pozitív natív kapuút.** Következő P2-08;
utána P2-09, P2-10, P2-03 végellenőrzés és P2-11. C07 továbbra NO-GO.

2026-10-29 további lezárás: [P2-08 internal lineage/final use](SI_C07_INTERNAL_LINEAGE_GATE.md)
kész. Sealed food és tool/material/escrow források, eredeti teljes ablak és
distinct-consumer final use, külön számszerű minimumok. **7/11 kész, 4 nyitott;
7/8 pozitív natív kapuút.** Következő P2-09, majd P2-10, P2-03 és P2-11.

2026-10-29 további lezárás: [P2-09 population lower bounds](SI_C07_POPULATION_BOUNDS.md)
kész. Eredeti closing survivorok + teljes finite lifecycle/health + azonos
checkpoint; külön population boundary, fizikai inventory nem bővül a census miatt.
**8/11 kész, 3 nyitott; 7/8 pozitív natív kapuút.** Következő P2-10,
majd P2-03 végellenőrzés és P2-11. C07 továbbra NO-GO.

2026-10-29 további lezárás: [P2-10 boundary/access/demand history](SI_C07_BOUNDARY_HISTORY.md)
kész. Teljes eredeti needs/access és fizikai inventory, executor warmup és
kötelező custody-flow join. **9/11 kész, 2 nyitott; 7/8 pozitív natív kapuút.**
Következő P2-03 közös natív coverage-audit, majd P2-11. Új pont nincs.

2026-10-29 további lezárás: [P2-03 közös natív16/16 audit](SI_C07_SOURCE_COVERAGE.md)
kész. Ugyanazon applied-genesis/world/cohort/clock és eredeti1+7 ablak;
omission/warmup/fault unknown, frozen readonly azonos, numeric FAIL megmarad.
**10/11 kész, 1 nyitott; 8/8 pozitív natív kapuút.** Következő és egyetlen
megmaradt implementációs pont P2-11, a teljes17+8 natív összesítő.
