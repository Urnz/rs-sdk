# Későbbi világparaméter-kalibráció – SI-C09

## Felhasználói döntés, 2026-10-21

Előbb a technikai működés teljes natív igazolását kell lezárni. A világ
paramétereinek kalibrációja külön, későbbi kutatási feladat; ebben a
munkamenetben nem indul optimalizáló vagy agenttanítás.

**A cél a valós élet lényeges viszonyainak közelítése egy részleges
szimulációban.** A világot nem a jelenlegi karakterek képességeihez vagy
sikeréhez kell igazítani. Mivel a modell nem szimulál mindent, egyes
paramétereknek az elhagyott folyamatok hatását is képviselniük kell.
Minden ilyen kompenzációhoz le kell írni, mely hiányzó jelenséget közelíti,
és milyen megfigyelhető viszonyt kíván megőrizni.

A társadalom fennmaradási ideje fontos kimenet és diagnosztika. Önmagában
nem a kalibráció célfüggvénye és nem jogosítja fel a keresőt éhség,
fáradtság, szűkösség vagy következmények eltüntetésére. Egy valósághűbb,
de a jelenlegi agentekkel rövidebb életű világ is lehet jobb modell.

## Szükséges előkészítés

1. **Modellezési határ:** mi van fizikailag szimulálva, mi aggregált, és mi
   hiányzik? Példák: a napi rutin más tevékenységei, változó munkaterhelés,
   élelmiszer-energia, pihenés, készségtanulás, erőforrás-utánpótlás.
2. **Mérhető referencia:** minden vizsgált jelenséghez elsődleges forrásokkal
   alátámasztott tartomány, mértékegység, populáció és bizonytalanság kell.
   A játékbeli XP/szint nem közvetlen valós mértékegység; tanulási időt és
   határhozamot kell hozzá rendelni, nem egyetlen „valódi XP-rátát”.
3. **Leképezés:** a valós idő, játéknap, engine-tick, munka-, utazás- és
   döntési idő arányainak rögzítése. A nap/óra és nap/öt perc profilok azonos
   needs-szabályai nem bizonyítják a teljes világ dinamikai paritását.
4. **Paraméterszerződés:** rögzített tervezési követelmények, mérésből becsült
   paraméterek és absztrakciós kompenzációk külön leírása. Az egy-/hétnapos
   éhség és egynapos adag a jelenlegi rögzített kiinduló szabály. Későbbi
   felülvizsgálatuk indokolt, verziózott modellváltozás lehet; nem a kereső
   szabad menekülőútja egy sikertelen futásból.
5. **Kísérleti infrastruktúra:** teljes natív végrehajtás, lezárt baseline,
   alkalmazott paraméterprofil igazolása, egyező kezdőállapotok, megőrzött
   sikertelen futások, eredményarchive és új helyen történő újraolvasás.

## Vizsgálható paramétercsoportok

- Éhség és táplálék: fogyasztási ütem, adagok relatív értéke, ellátási hiány
  következményei. Ezeket a referencia és a modellhatár együtt indokolja.
- Fáradtság és alvás: terhelés, regeneráció, alvásigény, használható napi
  munkaidő; a szállás fizikai elérése és kapacitása is része a mérésnek.
- Termelés és logisztika: munkaigény, hozam, veszteség, tárolás, utazás,
  megújuló és nem megújuló erőforrások külön kezelése.
- Tanulás és XP: tapasztalatszerzés, ismétlés csökkenő határhozama,
  specializáció és készségátvitel. A diminishing XP görbe is ide tartozik.

Kezdetben kevés paraméter változzon, rögzített agentpolicy mellett.
Az agentek döntéseinek tanulása külön kezelés; egyszerre változó világ és
viselkedés mellett nem tudnánk azonosítani a különbség okát. A kalibrált
modell ne csak a négy jelenlegi avatárra legyen értékelve: eltérő képességű,
összetételű és korábban nem használt kohorszokkal is ellenőrizni kell.

## Értékelés és keresés

Első eredményként érzékenységi vizsgálat és elfogadható paramétertartományok
kellenek, a bizonytalanságokkal együtt. A valós referencia-tartományoktól
való eltérés és a megőrzendő összefüggések legyenek elsődlegesek. A túlélés,
ellátottság, munkamegosztás, pihenés és fogyasztási/termelési arányok külön
kimenetek; nincs előre eldöntött „mindenképpen túlélő” eredmény.

Több ismétlés, kontrollált kezdőállapotok, és a kereséshez fel nem használt
ellenőrző helyzetek szükségesek. Azonos seed nem jelent jelenleg bizonyított
bitazonos engine-RNG-t; ezt a bizonytalanságot jelenteni kell. A futási
időkorlátig fennmaradó társadalom csak az adott horizontig megfigyelt túlélés,
nem ismert végtelen élettartam. A resource-limit miatti kimerülés ne
keveredjen technikai hibával vagy a modell egészének cáfolatával.

A módszerválasztás későbbi feladat: egyszerű mintavétel/érzékenységvizsgálat,
majd szükség esetén Bayes-féle vagy evolúciós keresés; deep learning csak
indokolt modell- vagy döntéstanulási részhez. Egyik módszer sincs most
telepítésre vagy futtatásra kiválasztva.

## Elfogadás és megőrzött korlátok

- A paraméterváltozás magyarázata valós referencia vagy dokumentált
  modellhiány legyen; a jelenlegi karakterek megmentése nem elégséges indok.
- Kimeríthető keret és szabályozott megújulás külön kísérlet. Az utánpótlás
  nem vezethető be rejtett, korlátlan készletként.
- Lehet olyan korrekt eredmény, hogy a választott absztrakciókkal nincs a
  referenciáknak megfelelő közös paramétertartomány. Ekkor a modellt kell
  felülvizsgálni; a referencia és a sikertelen futások megmaradnak.
- Egy hosszú túlélés, magas XP vagy sok kereskedés nem helyettesíti a
  valósághűségi értékelést. Reward-kijátszásra külön negatív esetek kellenek.
- Minden treatment immutable profilhoz és natív alkalmazási bizonyítékhoz
  kötött. Meglévő világot vagy történeti eredményt nem írunk át.
- A kalibráció nem javít sourcehiányt, jogosultsági hibát, kettős könyvelést,
  hiányzó skill-publikációt vagy nem megvalósított natív útvonalat.

Kapcsolódás: [SI-C09 feladat](TASKS_SOCIETY_INTEGRATION.md#si-c09--világparaméterek-valósághű-kalibrációja),
[technikai lezárás](SI_A15_TECHNICAL_CLOSURE.md),
[napalapú túlélés](SI_A15_DAY_SURVIVAL.md).
