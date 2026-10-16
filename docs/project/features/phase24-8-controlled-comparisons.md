# Phase 24.8 – natív hosszú futások összehasonlítása

Dátum: 2026-10-15. Az összehasonlító eszköz elkészült; a TASKS hat élő
kezelés-összehasonlítása továbbra is nyitott. A tesztfixture futásai nem élő
társadalmi benchmarkok.

Későbbi részfeladat: [natív XP-baseline](phase24-8-xp-baseline.md). Az új
Phase 12/program rekordok snapshotot is köthetnek az első hullámhoz; az alábbi
eredeti határok közül az üres, dispatch előtti XP-állapot már külön jelezhető.
Az exact dispatch-időpont és az engine RNG továbbra sincs attesztálva.

## Elérhető műveletek

```powershell
bun run society:experiment --command capabilities
bun run society:experiment --command compare --control xp-control --treatment xp-treatment --axis diminishing-xp
```

Az első parancs hat kezelés bizonyítékképességét mutatja. A második a meglévő
`.local/admin/long-experiments.sqlite` napló két programját olvassa; hiányzó
naplónál/programnál `unavailable`. Nem indít skillt, nem módosít világbeállítást,
és nem hoz létre adatbázist. A JSON stdout normál fájlba menthető.

Admin végpont:

```text
GET /api/admin/society/long-experiment-comparison?control=xp-control&treatment=xp-treatment&axis=diminishing-xp
```

A végpont az admin hitelesítési kapu mögött van. HTTP-paraméterből sem adatbázis-
útvonal, sem feltöltött mérési bizonyíték nem választható. A programozott,
megbízható `LongComparisonOptions` külön, archivált/izolált natív forrásokat is
megadhat a két oldalhoz. Ez nem teszi összehasonlíthatóvá az eltérő genesiseket.

## Diminishing XP: konfigurációs kontroll és leíró eredmény

A `diminishing-xp` tengelyen a kontroll kikapcsolt, a kezelés bekapcsolt
`economy.diminishing-xp` modot igényel. Minden más mod, annak verziója, sémája,
konfigurációja és engedélyezettsége azonos. A Phase 12 ellenőrzője az első
hullám exact parameter profile-ját, avatarját, ismert bankját és céljait is
összeveti.

További kapuk:

- Mindkét hosszú program sikeresen befejezett, aktív hullám nélkül; valamennyi
  kiértékelési ablakban van teljesen beleférő sikeres cohort-hullám.
- Azonos exact genesis/founder/attribute/policy condition digest és azonos
  kezdeti avatar/cél digest; a terv előre rögzített hash-eivel is egyeznek.
- Azonos warmup, mérési időtartam, bucket, cadence, gap és véges wall limitek.
- A napló hash-lánca és tailje, a natív SimulationClock stampjei és minden
  lezárt Phase 12 hullám teljes receipt-digestje visszaellenőrzött.
- Minden hullám környezetdigestje és parameter profile kötése a saját hosszú
  programjához tartozik. A forrás újraolvasás közbeni eltérés hibát ad.
- Terminális skill-bizonyíték nem használható újra a két programban.
- Hiányzó, nem véges vagy túlcsorduló metrika hiba; nincs nullaértékű pótlás.

Az abszolút kezdési idő eltérhet. Az ablakok a saját warmup utáni kezdéstől
számított relatív offset szerint párosulnak. A riport mindkét eredeti
SimulationClock-intervallumot megőrzi.

Egy ablakban csak a teljes claim–settlement megfigyelési borítékával beleférő
hullám számít. Warmup és ablakhatáron átnyúló hullámok nem kerülnek az
összegekbe; az `excludedWaveIds` külön felsorolja őket. A forrásnaplók megmaradnak.

A riport a `totalCoinsDelta`, `totalXpDelta`, `sessionXpDelta`, `economicEvents`,
`grossIncomeGp`, `grossSpendingGp`, `actualGoalsCompleted` hullámmetrikákat
összegzi. Nem összegezi a unique counts, koncentráció, készletszint vagy árszint
jellegű metrikákat. Minden ablak megadja a hullámok számát, a natív receipt
hashét, claim/settlement stampjét és terminális skill-azonosítóit.

- `descriptive-comparison`: minden ablakban azonos a hullámszám; megjelenik a
  kezelés mínusz kontroll eltérés ablakonként és összesítve.
- `inconclusive`: legalább egy ablakban eltér a mintaszám. Abban az ablakban és
  az összesített eredménynél az eltérés `null`; a két nyers mérés látható marad.
- `unsupported`: a tengelyhez nincs elegendő alkalmazási bizonyíték, ezért
  nincs mérési összehasonlítás vagy összeg.
- Hibás/kontaminált kötés vagy megváltozott natív receipt esetén a művelet
  hibával zárul; HTTP-n 400. Egy régi JSON riport nem helyettesíti a forrásokat.

A kimenet kanonikus SHA-256 digestet, a két program definition digestjét,
sequence-ét és head hashét tartalmazza. Változatlan forrásra ismételve azonos.

## Bizonyítékhatárok és a további öt kezelés

Az XP pár is **leíró** eredmény. A hullámok snapshotjai a globális gazdaság
köztes változásait is tartalmazhatják. A hullámok közötti idő nem mért; a
megfigyelési boríték nem exact gazdasági eseményidő. Azonos mintaszám nem
bizonyít azonos futási időzítést, munkamennyiséget vagy oksági hatást.

A kezdeti avatar digest nem köti a diminishing-XP korábbi repetition-state-jét,
egyéb rejtett engine-állapotát vagy az engine véletlenfolyamának resetjét.
Ezekhez külön natív attesztáció szükséges egy valódi kezeléshatás-állításhoz.
Egy futáspár nem ad replikált hatásbecslést vagy statisztikai szignifikanciát.

A capability lista a következőket explicit hiányként közli:

- `attribute-potential`: a generált bemenet nem bizonyítja az engine-ben
  alkalmazott attribute/potential eloszlást.
- `facility-advantage`: nincs alkalmazott facility-kezelés és kezdeti állapot
  kötése a hosszú protokollban.
- `world-start`: a jelenlegi controller finite tagságot igényel; a blank-slate
  és seeded kezdetnek nincs ilyen kötése. Egy címke átírása nem kezelés.
- `housing-needs`: a policyfájl hash-e nem igazolja az alkalmazott szigorúságot.
- `mortality`: nincs hitelesített mortalitás nélküli kontroll a finite hosszú
  protokollhoz. A classic respawn nem cserélhető be mortalitáskontrollként.

Ezért a TASKS hat checkboxa továbbra is `[ ]`. A továbblépéshez a hiányzó
kezeléskötések, teljes kezdeti állapot-visszaállítás és valódi, lezárt hosszú
futáspárok kellenek. A 24.9 társadalmi többcélú értékelés, dashboard és benchmark
export/reprodukció külön feladat marad.

Az összehasonlítási artifact mindig `causalEffectEstablished=false`, `engineRandomStreamSeeded=false`,
`attributeEnforcement=not-attested-by-phase12`, `economicAssessment=unassessed`,
`provesSelfSufficiency=false`, `completeEconomyCoverage=false` értéket ad.

## Adatmodell, rollback, ellenőrzés

Új perzisztens adatmodell, sémaemelés vagy migráció nincs. Az összehasonlító
kizárólag olvas; rollbackje a kód visszaállítása. A korábbi hosszú futásnapló,
Phase 12, SimulationClock és világadatok mentési szabályai változatlanok.
Élő stack, bot és hosszú benchmark nem indult, `.canvas.tsx` nem készült.

A natív tesztpár két teljes napnyi protokollablakot, 48 ablakot és 192
terminális skill-rekordot ellenőriz gyorsított tesztórával. Egy második natív
pár eltérő mintaszám mellett ellenőrzi a `null` eltérést. Ez forrásadapter- és
vezérlőintegrációs teszt, nem az engine gazdasági szimulációja.

Végleges teljes ellenőrzés: **1777 pass / 0 fail / 0 skip**, exit 0,
root/engine/webclient TypeScript és format PASS
(`.local/verification/20261015-222203-995-full.log`). Az eredeti egynapos teszt
első teljes futása az 5 másodperces limitet elérte. A fixture lemezes
Phase 12/programnaplói WAL módban, változatlan szinkronizálási beállítással és
valamennyi állítással futnak; a végső teljes regresszióban ez a teszt 3,07
másodperc alatt sikeres volt. Timeoutot és bizonyítékkövetelményt nem emeltünk.
