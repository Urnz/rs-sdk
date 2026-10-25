# Társadalmi integráció – végrehajtható fejlesztési feladatok

Dátum: 2026-10-18. Forrásbaseline: `2df0daad86c6568a3e1f0e62f58f09aa3cd955de`.
Hatókör: kizárólag a helyi/private rs-sdk/LostCity emulator.

**Aktuális állapot, 2026-10-24: SI-A technikailag lezárt, SI-B01–B06 és SI-C01–C06
kész;27/45. Következő: SI-C07.** [SI-C06 kibővített baseline](SI_C06_EXPANDED_BASELINE.md).

SI-C07 [readonly előkészítés és reference-fix](SI_C07_RUN_PREPARATION.md)
elkészült; [preflight NO-GO](SI_C07_PREFLIGHT_RESULT.json). A task nyitott:
minimum assessment és tool-demand history hiányzik, a food-only baseline és
gyorsított arány nem elegendő. Hosszú run nem indult; a keret továbbra27/45.

## 1. Státusz, használat és elsőbbség

Ez a felhasználó új kérése szerinti részletes integrációs munkalista.
**Az eredeti dokumentum tervezési baseline; az implementációs eredményeket
taskonként a [progress](SOCIETY_INTEGRATION_PROGRESS.md) rögzíti.**
2026-10-18: az SI-A01 natív fogyasztás, SI-A02 natív gyűjtés/főzés,
az SI-A03 tartós needs authority és az SI-A04 egyszeri natív relief
implementációja és célzott próbái elkészültek; scope/migráció:
[SI-A01](SI_A01_NATIVE_FOOD.md), [SI-A02](SI_A02_NATIVE_PRODUCTION.md),
[SI-A03](SI_A03_DURABLE_NEEDS.md), [SI-A04](SI_A04_NATIVE_RELIEF.md).
Ez a 2026-10-18-i állapot történeti bejegyzése; az aktuális állapot alább olvasható.
2026-10-21-i döntés: előbb a teljes natív technikai működés igazolása;
utána külön, későbbi **SI-C09** a világparaméterek valósághű kalibrációjára.
A cél a részleges szimuláció megfelelő valósélet-közelítése, nem a világ
hozzáigazítása a jelenlegi karakterek túléléséhez. A roadmap eredeti 44
taskja mellé egy új task kerül; a történeti dokumentumellenőrzések darabszámai
a korabeli állapotot jelölik. A részletek: [kalibráció](SOCIETY_REALISM_CALIBRATION.md).
2026-10-22: SI-A01–SI-A15 technikai igazolása lezárva;
[natív bizonyítékok, mért autonóm eredmény és restore](SI_A15_TECHNICAL_RESULT.md).
Az eredeti D1/SI-M1 gazdasági/túlélési PASS továbbra sincs igazolva.
Az SI-C09 későbbi, nyitott feladat; nem történt karaktermentő paraméterhangolás.
**Fejezetzárás: az SI-A technikai fejezet kész. SI-B01–SI-B03 elkészült;
a következő feladat az SI-B04.** [Player-stratégia és ellenőrzési korlátok](SI_B03_PLAYER_STRATEGY.md).
A továbblépés feltétele az elfogadott SI-A15
v2 technikai bizonyíték, nem az eredeti D1/SI-M1 túlélési PASS vagy az SI-C09.
Új munkamenethez: [rövid átadás](SOCIETY_DEVELOPMENT_HANDOFF.md) és
[fejlesztési munkarend](SOCIETY_DEVELOPMENT_WORKFLOW.md).
Az örökölt [TASKS.md](TASKS.md) „egyetlen aktív roadmap” mondata történeti
követési rend marad; e fájl az újonnan kért társadalmi integráció végrehajtási
bontása, nem a korábbi eredmények újabb checkboxmásolata.

Források: [vízióaudit](SOCIETY_VISION_AUDIT.md),
[roadmapjavaslat](SOCIETY_ROADMAP_PROPOSAL.md),
[old_TASKS.md](old_TASKS.md),
[alternatív régi 15–23-as terv](TASKS_PHASES_15_23_REPLACEMENT.md),
[elkészült 15–21](TASKS_COMPLETED_15_21.md),
[aktív 22–26 és nyitott 15.1/24.8](TASKS.md),
[későbbi organization-backlog](TASKS_LATER.md),
[ellenőrzési szabályok](VERIFICATION_POLICY.md).

Az új kérés pontosítja a roadmap sorrendjét: **előbb integrált megélhetés,
utána stratégiai autonómia**. Az első demonstráció használhat előre adott
bounded policyt és determinisztikus döntést; nem állíthat LLM-stratégiát.
A roadmap eredeti három termékcélszintjét nem töröljük: a Minimum Viable Society
itt SI-M1–SI-M3, a Generational Society SI-M4–SI-M5, a Human-Compatible Platform
SI-M6 munkájából áll össze. SI-M1 önmagában egyik teljes termékszint sem.

Az ID-k stabilak (`SI-A01`…); a fázisbetű nem a régi 15–26 újraszámozása.
P0 fundamentális konzisztencia/bizonyítás; P1 célmérföldkőhöz kritikus;
P2 mélység/skála; P3 későbbi opcionális bővítés. A prioritás nem sorrendpótló:
a **Függőség** mező és a mérföldkőkapu együtt kötelező.

Egy későbbi munkamenet egy taskon dolgozzon: olvassa el az audit megnevezett
bizonyítékait és az érintett modul jelenlegi kódját, ellenőrizze a kész függőségeket,
majd kis változtatásban implementáljon. Eredményként pontos diff, teszt/log/run ID,
migrációs állapot és fennmaradó korlát kell; puszta exit 0 vagy komponensdarabszám
nem tasklezárás. A listában szereplő tesztek **előírt jövőbeli ellenőrzések**.

## 2. Megőrzendő alapok és hivatkozási térkép

| Referencia | Meglévő eredmény; ezt nem írjuk újra | A tényleges folytatás |
| --- | --- | --- |
| RUNTIME – completed 15.3–15.11; audit E03–E07/E37 | Enrollment, lease, inbox, supervisor, verified executor, queue, budget, recovery | SI-A07/A11/A14; SI-B01–B06 |
| FOOD – completed 18–19; audit E12–E15 | Tiszta needs/dynamics/self-care, FoodConsumptionStore, tenancy, item-state | SI-A01–A05/A10; SI-C02–C03 |
| ECON – old_TASKS 12–14; completed 20–21; audit E17–E26 | Business/role/stock, escrow, treasury/reward, contract, WIP, bank, governance | SI-A06/A08/A09; SI-B04/B05; SI-D04/D05 |
| EVIDENCE – 22; audit E27/E29 | Engine trade/justice/provenance és custody-guardok | Adapterek újrafelhasználása; nem új crime-fázis |
| CLOCK – completed 16; audit E34 | SimulationClock, genesis/profile/provenance | Minden új state ugyanahhoz kötött; nincs új időforrás |
| METRICS – 24.1–24.11; audit E32/E35/E36 | Minimumszerződés, tíz képlet, részleges natív reader, archive/controller | SI-A12; SI-C04–C07; SI-D06; SI-F05 |
| POP – 23; audit E28–E31 | Finite death, nyolc domain custody, személyes Property-heir, entry identity | SI-D01–D07; nem új halál- vagy teljes estate-motor |
| PROFILE – completed 17; audit E10/E11 | Attribute/potential/cap modellek és kontrollszámítás | SI-C01 tényleges engine-bekötés |
| PLATFORM – 25–26; audit E33 | Világizoláció, titoktár, auth, recovery és adminworkflowk | Minden új adapter kezelt világkontextusban; SI-F01–F04 játékos- és kapacitáspróba |
| ORG – TASKS_LATER | Organization/member/role meglévő későbbi vállalás | SI-E01–E03 részletes bontás, nem párhuzamos céhrendszer |

Az old_TASKS régi 15. „új skillek” és 16. „adminvezérlő” nyitott sorai nem
jelentik a jelenlegi eredmények hiányát. A replacement terv számai egy fázissal
eltérhetnek: például replacement 18 ↔ completed 19 (food/tool), replacement
19 ↔ completed 20 (Business), replacement 20 ↔ completed 21 (production),
replacement 22 ↔ aktív 23 (population), replacement 23 ↔ aktív 24 (kísérletek).
Új személyes Engineering/Machining skill, második treasury, második scheduler,
új általános analytics motor és új adminplatform nem feladat ebben a tervben.

Fő forrásbelépések a későbbi implementációhoz:

- [engine escrow/checkpoint](../../server/engine/src/mods/PlayerInventoryEscrowStore.ts),
  [trade evidence](../../server/engine/src/mods/TradeEvidenceStore.ts),
  [Player](../../server/engine/src/engine/entity/Player.ts),
  [cooking content](../../server/content/scripts/skill_cooking/scripts/cooking.rs2).
- [needs](../../needs), [food-loop](../../food-loop),
  [production WIP](../../production-workflow/wip-store.ts),
  [WIP evidence](../../production-workflow/evidence.ts),
  [Business assets](../../business-assets), [item provenance](../../item-provenance).
- [replan runtime](../../server/gateway/admin/replan-runtime.ts),
  [authorization](../../server/gateway/admin/authorization-envelope.ts),
  [agent skills](../../agent-skills), [agent state](../../agent-state).
- [society metrics](../../society-metrics), [experiments](../../society-experiments),
  [estate](../../population-estate), [population](../../population-lifecycle),
  [housing](../../housing), [Business work](../../business-work).

## 3. Kötelező konzisztencia- és lezárási szerződés

### 3.1. Hiteles állapotforrások

1. Avatar inventory, bank, GP, fizikai művelet és személyes skill: **engine**,
   kanonikus Player/checkpoint és natív receipt. Klienssnapshot, chat, LLM-válasz,
   animáció, XP és skill exit önmagában nem gazdasági bizonylat.
2. Business virtuális stock/WIP és treasury: a meglévő saját domainstore,
   nem az owner személyes inventoryja. Avatarhoz történő kiadás/leadás custody-
   transzfer; mindkét helyen ugyanaz az egység nem lehet elkölthető.
3. Éhség/fáradtság: egyetlen tartós needs authority, exact lifecycle/clock/
   policy-kötéssel. A food-ledger ebből olvas vagy ugyanazon typed tranzakción
   frissít; külön shadow éhségérték nem authoritative.
4. Tulajdon/tenancy/facility, contract, population és estate: meglévő domainjük
   az authority. Adapter nem írhatja más domain belső tábláját saját jogon.
5. Metrika: csak olvasó projection; eredménye nem írható vissza bizonyítékként.
   Hiányzó forrás `unknown/inconclusive`, nem nulla vagy PASS.

### 3.2. Gazdasági művelet életciklusa

Az alábbi **fogalmi leképezés**, nem új központi tranzakciós motor vagy minden
domainre kötelező új enum:

`intent/admitted → reserved → executing → native-committed → domain-applied → completed`

- Minden réteghez előre tartós művelet-ID, exact actor/world/input és request-
  digest tartozik. Az ID az ismétlések között nem változhat.
- A fizikai commit és az engine-bizonylat ne tudjon egymástól végleg elválni:
  a meglévő közös checkpoint-authority tranzakcióját vagy igazoltan egyenértékű
  natív commit-határt kell használni. „Majd a gateway észreveszi” nem megoldás.
- `completed` csak natív állapot + receipt + szükséges domainprojekció
  egyezésekor engedett. A `native-committed/domain-pending` látható, újraindítás
  után egyeztethető részállapot; nem kész gazdasági tranzakció.
- Commit előtti hiba: az igazoltan fel nem használt foglalás release-elhető.
  Commit utáni timeout: ugyanazon ID státuszát olvassuk/folytatjuk; nem indul
  vakon második levonás. Bizonytalan kimenet: `reconcile/blocked`.
- Irreverzibilis commit után javítás csak külön auditált kompenzációval;
  korábbi save/ledger önálló visszamásolása, receipt törlése vagy kitalált
  jóváírás tilos. Több adatbázisra nem állítunk nem létező közös ACID-tranzakciót.
- Actor/lifecycle/world/receipt/policy mismatch fail-closed. Az engine és domain
  saját írási határán is ellenőriz; egy gateway allowlist önmagában kevés.

### 3.3. Minden task közös ellenőrzési minimuma

- Új perzisztenciánál schema-version, additive migráció, régi/hiányos adat
  kezelése és támogatott rollback: írók megállítása + együtt mentett DB/WAL/SHM;
  commitolt gazdasági történet nem rewindolható egyoldalúan.
- Minden érintett új datastore kezelt szerver saját könyvtárát használja;
  nincs fix local-default útvonal másik világból olvasva. Backup/restore és
  estate/dead-actor guard lefedettség az új állapotra is vizsgálandó.
- Egységteszt (U), tényleges adaptereket összekötő integráció (I), szükség
  esetén élő E2E (E). A tasknál az E=nem szükséges megjelölés nem hagyja el
  a későbbi közös SI-A15/B06/C07/D07/F02 elfogadást.
- Célzott modul és módosult boundary, érintett TS-projekt, sorformázás;
  futtatás a repository wrapperével. A VERIFICATION_POLICY szerinti közös
  persistence/gazdasági alap/auth-változáskor egyszer `verify:full`, indokkal.
  Dokumentációs utómunkához runtime-suite nem ismétlendő.
- Test/run ID, forrás/policy digest, kimenet, idő és kézi beavatkozás megőrzése
  a meglévő acceptance/progress rendben. Nincs assertionszűkítés vagy elrejtett FAIL.

## 4. Fázisok és kapuk

| Fázis | Cél / kilépési kapu | Taskok | Előfeltétel |
| --- | --- | --- | --- |
| SI-A / SI-M1 | Integrált négyavatáros megélhetés, fizikailag és könyvelésben egyező eredmény | SI-A01–SI-A15 | Meglévő baseline |
| SI-B / SI-M2 | Önálló stratégiai reakció és együttműködés; külön döntési bizonyíték | SI-B01–SI-B06 | SI-A15 v2 technikai kapu; SI-B01–B06 kész, SI-M2 v2 PASS |
| SI-C / SI-M3 | Tartós, mérhető Minimum Viable Society; eszközpótlás és natív history | SI-C01–SI-C07; SI-C08 facility- és SI-C09 kalibrációs mellékág | SI-B06 v2 PASS; SI-C01–C04 kész, SI-C05 következik; saját taskfüggőségek |
| SI-D / SI-M4 | Aktív utánpótlás, vagyon/Business-utódlás, két kohorszváltás | SI-D01–SI-D07 | SI-C07 |
| SI-E / SI-M5 | Tagsági, háztartási és intézményi döntési kontinuitás | SI-E01–SI-E03 | SI-D07 |
| SI-F / SI-M6 | Emberi részvétel, offline policy, mért kapacitás és teljes kezelési program | SI-F01–SI-F05 | SI-E03; saját taskfüggőségek |

Egy fázis későbbi feladatát nem lehet puszta alacsonyabb sorszám alapján
indítani: a konkrét függőségek szükségesek. Fáziskapu csak a rá támaszkodó
funkciók implementációját/elfogadását zárja; korábbi kód olvasása nem tiltott.

## 5. SI-A – az első integrált megélhetési ciklus

Ebben a fázisban a szerepek és üzleti szabályok előre adottak. A runtime
önállóan végrehajtja őket és determinisztikusan kezeli a hiányt; új foglalkozás
vagy együttműködési stratégia LLM-es kiválasztása az SI-B feladata.

### SI-A01 – Natív, tartós ételfogyasztási bizonylat

- **Státusz/típus/prioritás:** [x] KIEGÉSZÍTÉS; P0; G01, FOOD/EVIDENCE.
- **Cél és indok:** a valódi item-eltűnés legyen bizonyítható; ez az első
  konkrétan implementálandó task, nem újabb általános audit.
- **Meglévő:** SDK `eatFood`, engine/content item-use és közös Player-checkpoint
  mintázat; FoodConsumptionStore caller által adott receiptet könyvel.
- **Módosítás:** egy allowlistelt cooked food valós consume-kimenetéhez natív
  receipt: world/actor/lifecycle, action ID, item/quantity, before/after,
  cause, clock-stamp, commit/checkpoint ID. A kanonikus inventorymódosítás és
  receipt ugyanazon igazolt durable határon commitoljon; readonly exact-ID olvasó.
  A meglévő checkpoint infrastruktúrát bővíteni; külön Player-balance ledger nincs.
- **Modulok:** engine Player/item-use/content hook, engine mods/checkpoint,
  gateway belső source reader; meglévő játékszabályt nem kerülhet meg.
- **Függőség:** nincs új task; a DEC-01 food/item döntési alapválasztása alkalmazandó.
- **Elfogadás:** egy tényleges fogyasztás = egy itemlevonás és egy receipt;
  azonos ID/retry nem új fogyasztás; más actor/item/ID-tartalom ütközése tiltott;
  nincs receipt siker nélküli kattintásból. A már jóllakott/HP-full eset valós
  contentkimenete kerüljön rögzítésre, ne kitalált „elfogyasztva” eredmény.
- **Tesztek:** U receipt/ID-validáció; I valódi engine mutation+checkpoint,
  írási hiba és crash commit előtt/után; E egy avatár helyi consume-smoke,
  eredeti inventoryval összevetve.
- **Perzisztencia/hiba:** additive evidence-séma és migráció/rollback;
  restartkor a receipt a kanonikus állapottal együtt marad; bizonytalan
  kimenet blokkolt, nem ismételt étellevonás. Readonly hiány ne gyártson DB-t.
- **Kockázat:** magas; script- és save-határ, az inventoryváltozás okának téves
  azonosítása. Nem minden `inv_del` étkezés, és HP-heal nem hunger-relief.

**Lezárás, 2026-10-18:** a natív implementáció és az izolált egyavatáros
Player/content/checkpoint smoke elkészült; 13 natív + 35 érintett teszt és
root/engine TypeScript PASS. A teljes regresszió két, korábban is jelentkező
változatlan kísérleti teszt időtúllépésénél FAIL; ez nem teljes-suite PASS.
Exact logok, migráció/rollback és a hálózati/live scope korlátai:
[progress](SOCIETY_INTEGRATION_PROGRESS.md), [működés](SI_A01_NATIVE_FOOD.md).
A korábbi timeoutok az SI-A02 előtti folytatásban javítva, változatlan
időlimitekkel; az új kísérleti csomag 60/60 PASS. A régi FAIL napló megmarad.

### SI-A02 – Natív gyűjtési és főzési kimenet egy food-lánchoz

- **Státusz/típus/prioritás:** [x] KIEGÉSZÍTÉS; P0; G01/G03, FOOD/ECON.
- **Cél és indok:** a konyha ne WIP-tesztadatból termeljen, hanem valós engine-outputból.
- **Meglévő:** verified lobster gathering, cooking content, provenance és
  production evidence; shrimp recipe és lobster food-chain eltérő itempár.
- **Módosítás:** SI-A01 natív commit/bizonylat-határának új művelettípusai:
  raw gain és raw→cooked/burnt tényleges átalakulás. Exact input/output, source,
  worker, batch és outcome; a választott food-recept/katalógus verzióit összehangolni.
  A demo egy forrásának futásonkénti termelési kerete natívan ellenőrzött,
  elfogyasztható quota vagy igazoltan korlátos regeneráció legyen; nem végtelen
  nyersanyagkészlet. Ehhez nem készül általános ökológiamotor.
- **Modulok:** fishing/cooking content hook, engine inventory evidence,
  item-provenance/transformation adapter, config food/production catalog.
- **Függőség:** SI-A01.
- **Elfogadás:** gyűjtött/főtt/elégett output külön; sikertelen főzés nem készétel;
  termelési egységhez egy natív inputhasználat; rossz recipe/worker/item nem fogadható el.
  Elfogyott forráskeret után nincs új raw gain vagy csendes quota-reset restartkor.
- **Tesztek:** U recept/outcome; I engine input/output és provenance, több batch,
  megszakított cooking; E egy gyűjtés és sikeres/elégett főzés a valódi contentúton.
- **Perzisztencia/hiba:** ugyanazon action-ID család és atomic checkpoint;
  hiányzó outputnál pending/failed, nem automatikus siker; legacy evidence unknown.
- **Kockázat:** magas; valódi RNG-outcome és késleltetett contentlépések.

**Lezárás, 2026-10-18:** natív lobster gathering, raw→cooked/burnt checkpoint,
tartós 32-unitos run/source kvóta, typed exact-ID readonly és transformation
adapter elkészült. A 11 izolált natív próba tartalmaz tényleges contentutat,
delay/resume-t, két commit körüli force-killt és gather→cook→consume smoke-ot.
Az első teljes lánc új katalógussorrend-hibája javítva: 61 érintett teszt és
root/engine TypeScript PASS; a lánc hátralévő 415 tesztje is PASS.
További scope/migráció/rollback és exact naplóazonosítók:
[működés](SI_A02_NATIVE_PRODUCTION.md), [progress](SOCIETY_INTEGRATION_PROGRESS.md).

### SI-A03 – Egyetlen tartós needs-állapot és időbeli frissítés

- **Státusz/típus/prioritás:** [x] KIEGÉSZÍTÉS; P0; G01, FOOD/CLOCK.
- **Cél és indok:** az éhség/fáradtság ne csak tiszta függvény bemenete legyen.
- **Meglévő:** `NeedsState`, `advanceNeedsFromClock`, fractional remainder,
  online/offline/sleep policy és finite lifecycle.
- **Módosítás:** lifecycle/world/clock/profile/policy szerint kulcsolt needs-store,
  optimistic revision és egyetlen writer; genesis/admission inicializálás;
  online/offline/alvó/halott átmenetekhez exact-időig frissítés és read API.
- **Modulok:** needs, food-loop tranzakciós adapter, simulation-clock player-time,
  gateway lifecycle/context, managed server path wiring.
- **Függőség:** SI-A01 az esemény-/időszerződéshez.
- **Elfogadás:** sok kis időlépés = egy nagy; restart és offline idő után ugyanaz
  a state; más lifecycle/clock nem keverhető; death után nincs új fiziológiai munka.
- **Tesztek:** U dynamics meglévő esetek megőrzése; I store reopen/concurrency,
  migráció és kétvilágos path; E külön nem kell, SI-A15-ben ellenőrzendő.
- **Perzisztencia/hiba:** needs és receipt-felhasználás közös typed tranzakcióra
  képes persistence-határ; a FoodConsumptionStore saját táblái maradnak.
  Hiányzó régi állapot explicit initialization/unknown, visszamenőleges történet nélkül.
- **Kockázat:** magas; dupla időterhelés, rossz offline policy, másik világ állapotának olvasása.

**Lezárás, 2026-10-18:** tartós needs-store, explicit genesis/admission és
read-only unknown API, revision/CAS, clock v5 atomi módváltás-history és
offline/sleep replay, engine-watermarkig frissítés és terminal freeze elkészült.
A food saját táblái közös connectionön maradnak; nem nulla relief az SI-A04
natív adapteréig tiltott. A végső érintett kör 83 teszt + root/engine
TypeScript + formázás PASS, 51,202 s. Egyszeri teljes regresszió a közös
óra/perzisztencia változása miatt: 2009 PASS / 0 FAIL / 0 SKIP, 396,949 s;
a végső séma/kapu és policy/actor guard célzott utóellenőrzései is PASS.
Valós gateway genesis/entry, kétvilágos/junction és stopped-world backup/restore
próbák; külön élő E2E nem szükséges, SI-A04/SI-A15 továbbra is nyitott.
Exact logok, migráció/rollback és korlátok:
[működés](SI_A03_DURABLE_NEEDS.md), [progress](SOCIETY_INTEGRATION_PROGRESS.md).

### SI-A04 – Valódi fogyasztásból egyszeri hunger-relief

- **Státusz/típus/prioritás:** [x] KIEGÉSZÍTÉS; P0; G01, FOOD.
- **Cél és indok:** engine-fogyasztás és fiziológiai következmény együtt váljon befejezetté.
- **Meglévő:** same-agent closure és atomi FoodConsumptionStore receipt-use lock.
- **Módosítás:** SI-A01 hiteles source reader → SI-A03 időre frissített needs →
  egyszeri relief + consumption-event + receipt-use tranzakció; natív commit után
  kieső gateway számára tartós, újraolvasható recovery cursor.
  A szükségleti étkezés teljes HP mellett is működjön a társadalmi profilban;
  ha a vanilla content ezt tiltja, célzott profilkapuval kell engedni a valódi
  itemfogyasztást. Nulla HP-heal nem nulla ételfogyasztás, és fordítva.
- **Modulok:** food-loop/needs stores, szükség esetén engine/content nutrition
  profilkapu, gateway recovery, society metrics source binding.
- **Függőség:** SI-A01, SI-A03.
- **Elfogadás:** levont ételhez legfeljebb egyszeri, clampelt relief; levonás
  nélkül nulla relief; ismétlés, rossz actor és módosított source tiltott;
  engine-committed/domain-pending látható és restart után pontosan befejeződik.
  Teljes HP + fennálló hunger mellett is valós itemlevonással csökken az éhség;
  nincs mesterséges sebzés az evés lehetővé tételére.
- **Tesztek:** U relief/receiptlock; I crash minden commit/projection határon,
  konkurens fogyasztás; E az SI-A01 smoke teljes hunger-változással.
- **Perzisztencia/hiba:** a needs-update és receipt-felhasználás lokálisan atomi;
  fizikai commit után nincs item-visszateremtés; sérült forrás fail-closed.
- **Kockázat:** magas; out-of-order event és két domain eltérő committed-értelmezése.

**Lezárás, 2026-10-18:** natív delivery outbox a kanonikus Player-checkpointban,
engine tickzárás, readonly exact source és tartós cursor; needs+relief+event+
receipt-use lokálisan atomi alkalmazása, runtime recovery és natív metrika
elkészült. Teljes HP mellett valódi itemlevonás és hunger-relief, öt forced-kill
határ és két párhuzamos worker igazolva; visszateremtett item vagy dupla relief nincs.
A célzott boundary kör 114 PASS, root/engine TS és formázás PASS, 41,213 s.
Egyszeri teljes regresszió: 2033 PASS / 0 FAIL / 0 SKIP, 375,059 s;
az utána pontosított metrika-időablak külön 22 natív/wrapper teszt + root/engine
TS + formázás körben PASS, 88,570 s. A két scope nem egy újabb teljes futás.
A régi legacy eredmény blokkolt egyeztetést igényel, nem retroaktív reliefet.
Scope, source/policy manifest, migráció/rollback és exact naplók:
[működés](SI_A04_NATIVE_RELIEF.md), [progress](SOCIETY_INTEGRATION_PROGRESS.md).
SI-A05 és SI-A15 nyitott; nincs éles hálózati acceptance vagy deployment.

### SI-A05 – Élelmiszer-eredet követése actorváltásokon át

- **Státusz/típus/prioritás:** [x] KIEGÉSZÍTÉS; P0; G01/G04, FOOD/EVIDENCE.
- **Cél és indok:** a gyűjtő, szakács és fogyasztó lehessen három külön actor.
- **Meglévő:** same-agent food closure, item-provenance, engine TradeEvidenceStore.
- **Módosítás:** a meglévő lineage és natív transfer kötése a food receipthez;
  gathering→tulajdonváltás→cooking→eladás→consumer út, batch/stack részfogyasztással.
  Nem másoljuk minden résztvevőre ugyanazt az egyéni closure-t.
- **Modulok:** food-loop, item-provenance/transformation, engine trade reader.
- **Függőség:** SI-A02, SI-A04.
- **Elfogadás:** A termeli/B főzi/C eszi; C kap reliefet, csak egyszer;
  kettévágott stack mennyisége zár; bootstrap/import/internal eredet külön;
  átruházás önmagában nem új termelés vagy végső fogyasztás.
- **Tesztek:** U lineage/quantity; I több trade, részbatch, ismeretlen eredet,
  lopott input meglévő provenance-kapuja; E SI-A15 része.
- **Perzisztencia/hiba:** append-only hivatkozások, meglévő source ID-k és receipt-lock;
  sourcegap esetén fiziológiai tény és belső eredetbizonyítás külön státusz,
  nem kitalált lineage. Egyszer elfogyasztott egység nem adható el újra.
- **Kockázat:** magas; stack merge/split és kettős belsőellátás-számlálás.
- **Eredmény:** [natív lineage, migráció és határok](SI_A05_NATIVE_LINEAGE.md);
  [ellenőrzések és megőrzött hibabizonyíték](SOCIETY_INTEGRATION_PROGRESS.md).
  Teljes regresszió: 2045 PASS / 0 FAIL / 0 SKIP; az SI-A15 élő acceptance külön marad.

### SI-A06 – Egy fizikai konyhai WIP-lépés és Business–avatar custody

- **Státusz/típus/prioritás:** [x] INTEGRÁCIÓ; P0; G03, ECON/EVIDENCE.
- **Cél és indok:** ugyanaz az input ne legyen egyszerre Business-raktárban,
  lefoglalt WIP-ben és a dolgozó szabad inventoryjában elkölthető.
- **Meglévő:** BusinessAssetStore, ProductionWorkInProgressStore, stock/WIP
  atomic reservation és typed facility/role entitlement; natív crafting reader hiányos.
- **Módosítás:** egy food-receptre reservation→exact worker custody→SI-A02
  fizikai processing→output custody→WIP finalize adapter. A belső készlet és
  fizikai hordozó mennyisége egyértelműen elkülönítve; existing escrow/custody reuse.
- **Modulok:** business-assets, production-workflow, facility-capability,
  item-provenance, engine inventory/checkpoint és gateway adapter.
- **Függőség:** SI-A02, SI-A05.
- **Elfogadás:** konkurens run nem foglalhat azonos anyagot; csak exact recipe/
  run/worker natív output finalizálhat; burn/partial batch nem kész cooked stock;
  in-transit egységnek egy tulajdonosa és egy custody-helye van.
- **Tesztek:** U allocation/outcome; I valódi source-DB-k és engine-adapter,
  full inventory, worker death/entitlement expiry, crash kiadás és visszavétel között;
  E konyhai egybatch smoke az SI-A15 előtt.
- **Perzisztencia/hiba:** a meglévő WIP intent/lot/operation rekordjai bővüljenek;
  commitolt input nem téríthető vissza kitalált cancellationnel. Félmunka forward recovery.
- **Kockázat:** magas; virtuális Business-stock és fizikai inventory kettős könyvelése.
- **Eredmény:** [fizikai WIP/custody és migráció](SI_A06_NATIVE_KITCHEN.md);
  [ellenőrzési napló](SOCIETY_INTEGRATION_PROGRESS.md). 21 natív próba,
  két konkurens reservation process és négy force-kill boundary; végleges közös
  teljes regresszió 2093 PASS / 0 FAIL / 0 SKIP. Élő SI-A15 acceptance külön marad.

### SI-A07 – Bounded gathering/cooking/consume/delivery skilladapterek

- **Státusz/típus/prioritás:** [x] KIEGÉSZÍTÉS; P1; G01/G03, RUNTIME.
- **Cél és indok:** a négy avatar a normál verified executorral végezze az új láncot.
- **Meglévő:** gathering/bank/trade skillek, generikus interakciók, declarative
  schema/verifier és runtime-grant; nincs kész, közös cooking/consume út.
- **Módosítás:** a hiányzó minimális typed műveletek adaptere; exact item/batch/
  route/partner/custody paraméter; food-procedure + meglévő receive/give/travel reuse.
  Hiteles outcome olvasás, timeout és részleges eredmény, nem exitből gyártott receipt.
- **Modulok:** agent-skills types/runtime/executor/catalog, sdk meglévő műveletei,
  authorization-envelope, SI-A01/A02 source reader.
- **Függőség:** SI-A01, SI-A02, SI-A06.
- **Elfogadás:** minden új procedure bounded és verziózott; item/partner/árgrantot
  futtatáskor is ellenőrzi; már ismert skill nem duplikálódik szereplőnév szerint;
  csak a verifier szerint verified, agent által ismert verzió fut automatikusan.
- **Tesztek:** U schema/limit; I executor→SDK→receipt correlation;
  E meglévő két független trial/verifier/publikálási rend az új procedure-ökre.
- **Perzisztencia/hiba:** run ID és paraméterdigest megmarad; interrupted run nem
  kap hamis terminal-success-t, uncertain outcome nem vak újrapróbálás.
- **Kockázat:** közepes–magas; mozgás/content-precondition, generic clickből túl tág jog.
- **Eredmény:** [bounded adapterek, recovery és publikálási kapu](SI_A07_BOUNDED_FOOD_SKILLS.md);
  [ellenőrzési napló](SOCIETY_INTEGRATION_PROGRESS.md). Három közös verziózott
  draft, 14 natív SDK/source próba, mindhárom procedure két független fixture
  eredményével; végleges teljes regresszió 2093 PASS / 0 FAIL / 0 SKIP.
  Az implementáció kész; élő trial/publikálás és automatikus aktiválás nem történt,
  az izolált bizonyíték nem kerülheti meg a verifier/emberi approval kaput.

### SI-A08 – Work orderből egyetlen igazolt bérfizetés

- **Státusz/típus/prioritás:** [x] INTEGRÁCIÓ; P1; G03, ECON/RUNTIME.
- **Cél és indok:** a szerephez kötött műszak és a régi player-action queue ugyanazt a munkát jelentse.
- **Meglévő:** BusinessWorkStore scheduled/running/earned/paid,
  player-request accept/approve/start, treasury reserve és engine reward settlement.
- **Módosítás:** egy cook és egy delivery role exact WorkStore orderének
  egy-egy stabil player-request/run/settlement kötése; meglévő policy/employment
  alapján delegáció. Earned csak natív teljesítés, paid csak engine receipt után.
- **Modulok:** business-work, business-roles, gateway agent-state/business ports,
  settlement/reward recovery, SI-A06/A07.
- **Függőség:** SI-A06, SI-A07.
- **Elfogadás:** a WorkStore és request együtt követhető; ugyanazért a műszakért
  egyszer fizet; nincs bér hibás/részleges termelésből vagy lejárt műszakból;
  policy/role hiánya foglalás előtt tilt; üres treasury látható akadály.
- **Tesztek:** U state mapping; I két worker, journal, reward és treasury reopened,
  crash reserve/receipt/paid között; E egy valódi cook/delivery bér SI-A15-ben.
- **Perzisztencia/hiba:** meglévő settlement ID recovery, két bérledger nem készül;
  earned követelés hiba után megmarad, bizonytalan payout nem release-elhető vakon.
- **Kockázat:** magas; két korábbi work-életciklus eltérő határain dupla jogosultság.
- **Eredmény:** [implementáció, recovery és migráció](SI_A08_SINGLE_WAGE.md),
  [tesztbizonyítékok és megőrzött hibás körök](SOCIETY_INTEGRATION_PROGRESS.md).
  Az implementáció kész; a cook draft publikálása és az élő cook/delivery bérpróba
  továbbra is az SI-A07/SI-A15 meglévő ellenőrzési kapuja mögött marad.

### SI-A09 – Véges belső beszerzés és értékesítés a food-láncban

- **Státusz/típus/prioritás:** [x] INTEGRÁCIÓ; P0; G03, ECON.
- **Cél és indok:** a termék és GP tényleges cseréje ugyanazon gazdasági művelethez tartozzon.
- **Meglévő:** AgentOperatedShopLifecycle pilot, fix stock policy, contract/escrow,
  finite treasury és hiteles player trade; legacy bolti út külön kompatibilitási mód.
- **Módosítás:** a konyha raw procurement és cooked sale útját meglévő
  sale-channel/grant/escrow/stock adapterhez kötni, exact buyer/seller/item/price.
  Business-stock és avatar-átadás custody SI-A06 szerint, kétoldali GP reconciliation.
- **Modulok:** agent-operated-shop, business-stock-policy/assets,
  economic-contract-settlement, institution-treasury, native trade/reward source.
- **Függőség:** SI-A05, SI-A06, SI-A07.
- **Elfogadás:** nincs eladás készlet és vevői fedezet nélkül; a vevő kapott étel
  és levont GP mennyisége egyezik a Business változásával; üres eladó/payer eset
  nem hoz létre értéket; rejtett inventoryból nem keletkezhet piaci tudás.
- **Tesztek:** U ár/fedezet; I natív trade + mindkét domain, stale ár, megtagadás,
  partial/timeout/replay; E több avatár közös vásárlása SI-A15-ben.
- **Perzisztencia/hiba:** existing saga/receipt IDs; one-sided fizikai commit
  egyeztetendő, nem completed. Nincs legacy NPC-restock/payout fallback.
- **Kockázat:** magas; pénzügyi és fizikai boundary, állítólagos stockeladás valódi item nélkül.

- **Eredmény:** [natív csere, recovery és migráció](SI_A09_FINITE_FOOD_COMMERCE.md),
  [tesztbizonyítékok és megőrzött teljesköri timeout](SOCIETY_INTEGRATION_PROGRESS.md).
  Az implementáció és az izolált natív integráció kész; az élő többavatáros
  vásárlás és a rutinba aktiválás továbbra is SI-A15/SI-A11 elfogadási határ.

### SI-A10 – Egy lakóhely: valódi bérlet, alvás és fatigue-hatás

- **Státusz/típus/prioritás:** [x] INTEGRÁCIÓ; P1; G01, FOOD/ECON/CLOCK.
- **Cél és indok:** a negyedik actor szállásadói bevétele és az alvás ne admincímke legyen.
- **Meglévő:** HousingUnit/BedSlot, tenancy és entitlement, PlayerTime,
  housing effect policy; fizikai pihenés és rent settlement együtt nincs igazolva.
- **Módosítás:** egy kijelölt egység több szabályos férőhelyével admission→slot-
  reservation→meglévő GP-settlement→aktív bérlet; engine-helyhez/accesshez kötött
  alvásindítás és ébredés, SI-A03 fatigue-frissítés.
- **Modulok:** housing, Property, simulation-clock player-time, needs,
  escrow/treasury/player settlement, gateway/content adapter.
- **Függőség:** SI-A03, SI-A04, SI-A09.
- **Elfogadás:** rent ténylegesen terheli/bővíti a feleket; telt/nem jogosult
  szoba nem ad alvást; logout nem alvás; az alvás nem gyorsítja az egész világot;
  bérlet lejárata/death után nincs fennmaradó jogosultság.
- **Tesztek:** U tenancy/effect; I fizetés→entitlement→sleep→needs és offline
  reopen, slot race, sikertelen fizetés; E valódi alvás/logout/return SI-A15-ben.
- **Perzisztencia/hiba:** slot és payment intent kötött; paid/entitlement-pending
  nem veszhet el, retry nem kérhet új bért; kompenzáció csak igazolt hibánál.
- **Kockázat:** magas; rent/entitlement és engine pozíció, offline és dead-time eltérés.

- **Eredmény:** [fizetett bérlet, natív sleep és migráció](SI_A10_NATIVE_HOUSING.md),
  [tesztbizonyítékok és teljes regresszió](SOCIETY_INTEGRATION_PROGRESS.md).
  Az implementáció és az izolált natív integráció kész; teljes regresszió
  2171 PASS. Az élő többavatáros alvás/logout/return elfogadása SI-A15,
  a meglévő rutinba aktiválás SI-A11 része marad.

### SI-A11 – Determinisztikus megélhetési rutin a meglévő supervisorban

- **Státusz/típus/prioritás:** [x] KIEGÉSZÍTÉS; P1; G01/G03, RUNTIME.
- **Cél és indok:** a közös lánc admin-kattintások nélkül fusson, még LLM-stratégia nélkül.
- **Meglévő:** lease/due supervisor, immediate/recurring goals, deterministic
  planner, templates és typed self-maintenance.
- **Módosítás:** előre adott, névfüggetlen livelihood policy: self-care elsőbbség,
  esedékes munka/delivery, stock/rent rutin; exact paraméterforrások és grants.
  Business számára a meglévő stock policyból determinisztikus orderindítás,
  nem általános institution LLM-loop. Hiánynál bounded wait/stop és okkód.
- **Modulok:** replan-runtime, goal templates/binding, autonomy supervisor,
  agent-state context és SI-A04/A07–A10 adapterek.
- **Függőség:** SI-A04, SI-A07, SI-A08, SI-A09, SI-A10.
- **Elfogadás:** tetszőleges négy avatar ugyanazzal a policyval fut; éhség/pihenés
  megelőzheti a munkát; nincs duplikált controller/run; inputhiány nem végtelen
  loop vagy új stratégia imitálása. A feldolgozó nem kap ingyen alapanyagot.
- **Tesztek:** U policy-prioritás; I supervisor→adapter→receipt→replan,
  cooldown/quarantine/death/restart; E SI-A15, providerhívás nélkül.
- **Perzisztencia/hiba:** enrollment/inbox/journal reuse; ne legyen második scheduler;
  minden rutin progress/pending oka tartós és visszakereshető.
- **Kockázat:** közepes–magas; starvation, sűrű wake-up és rejtett actoronkénti kézi script.

- **Eredmény:** [névfüggetlen livelihood policy, tartós progress és rollback](SI_A11_DETERMINISTIC_LIVELIHOOD.md),
  [tesztbizonyítékok és forrásscope](SOCIETY_INTEGRATION_PROGRESS.md).
  A shared perzisztencia/lease bővítés teljes regressziója 2193 PASS;
  a végső, behatárolt policy/readonly-join javítás külön 24 PASS és root
  TypeScript ellenőrzést kapott. Providerhívás, live enrollment és skill
  publikáció nem történt; a közös élő elfogadás SI-A15 marad.

### SI-A12 – A demonstráció natív mérési és egyeztetési riportja

- **Státusz/típus/prioritás:** [x] KIEGÉSZÍTÉS; P0; G04, METRICS.
- **Cél és indok:** a siker ne csak logüzenet, hanem forrásból újraszámolható állítás legyen.
- **Meglévő:** society-metrics képletek/readers/dashboard, economic dependency,
  completeCoverage hiányt jelző riportok.
- **Módosítás:** a SI-A01–A10 forrásokat bekötő readonly adapter: teljes
  needs-demand/relief, food eredet/final use, munka/bér/rent, nyitó/záró GP és
  item, custody/WIP/in-transit helyek és saját source watermark/clock-kötés.
  Inter-actor dependency graph, intent/native/domain státuszeltérések külön.
- **Modulok:** society-metrics sources/evaluation/report, economic-dependency,
  meglévő dashboard/export; új gameplay writer vagy feltöltött report-authority nincs.
- **Függőség:** SI-A04, SI-A05, SI-A08, SI-A09, SI-A10.
- **Elfogadás:** minden numeric verdict natív eseményig lefúrható; hiányzó/
  levágott source inconclusive; pénz- és itemegyenlet zár; transfer nem termelés;
  ugyanazon megfigyelt adatból azonos riport. Négy actor teljes nevezője szükséges.
- **Tesztek:** U ismert számláló/nevező és határok; I valódi store-reader, sourcegap,
  snapshot drift és két világ; E SI-A15 kimenetének újraolvasása.
- **Perzisztencia/hiba:** readonly, nincs migráció az olvasás mellékhatásaként;
  schema/profile eltérés explicit; coverage nem becsülhető az eltelt faliórából.
- **Kockázat:** közepes–magas; dupla végfelhasználás és nem azonos időhatárú vagyon.

- **Eredmény:** [readonly natív riport, nevezők, vagyonhatárok és rollback](SI_A12_NATIVE_INTEGRATION_REPORT.md),
  [tesztbizonyíték és scope](SOCIETY_INTEGRATION_PROGRESS.md).
  A végső célzott kör 154 PASS / 0 FAIL; root/engine TypeScript és format PASS.
  A hiányzó teljes gazdasági mutációs lefedettség és a szimulációs stamp
  nélküli bér explicit inconclusive/unplaced marad. Nincs live mérési
  sikerállítás; a fixture/capture SI-A13, a közös élő elfogadás SI-A15.

### SI-A13 – Négyavatáros fixture és visszaállítható baseline

- **Státusz/típus/prioritás:** [x] KIEGÉSZÍTÉS; P1; G00/G05, CLOCK/METRICS.
- **Cél és indok:** előre rögzített, véges indulóhelyzetből legyen megismételhető a próba.
- **Meglévő:** varrock proto fixture, genesis/provenance, closed-society shop gate,
  society-integrity, offline benchmark capture/restore és managed világok.
- **Módosítás:** külön verziózott integration fixture: négy avatar + egy konyha
  Business; gyűjtő/feldolgozó/szállító/szállásadó-vevő kompozíció. Item/skill/
  Property/facility/grant, cash/treasury, férőhely, szükséglet és árkapacitás
  ellenőrzés; minden kezdőérték egyszeri bootstrap.
- **Modulok:** config fixtures, meglévő fixture/genesis/benchmark/paths;
  a korábbi proto fixture és acceptance nem írható át új sikernek.
- **Függőség:** SI-A07, SI-A08, SI-A09, SI-A10, SI-A11, SI-A12.
- **Elfogadás:** apply/replay nem dupláz; az inputok egy szűk, valódi food-láncon
  kompatibilisek; explicit finite resource/regen policy és importhatár;
  nincs korlátlan shop vagy adminérték futás közben; baseline új könyvtárba restore-olható.
- **Tesztek:** U fixture/reference/kapacitás; I preflight/rollback/capture/restore,
  hibás clock vagy skill elutasítása; E read-only preflight SI-A15 előtt.
- **Perzisztencia/hiba:** forrás/config/cache/runtime/digest és tényleges baseline
  párosítás; credential nem kerül csomagba. Korábbi világot nem resetelünk mellékesen.
- **Kockázat:** közepes; a bootstrap tartalék elfedi a valódi termelés hiányát.

- **Eredmény:** [fixture, egyszeri natív bootstrap és offline baseline](SI_A13_INTEGRATION_BASELINE.md),
  [ellenőrzési eredmények és scope](SOCIETY_INTEGRATION_PROGRESS.md).
  A valódi izolált native capture→új könyvtár restore és drift/replay guard
  ellenőrzött. A tényleges readonly preflight három draft food procedure miatt
  BLOCKED; nincs automatikus publikáció vagy operátori világapply.
  A route/travel, kétágyas ütemezés és a normál needs-kimenet SI-A15 kapu;
  az izolált teszt nem élő SI-M1 siker.

### SI-A14 – Közös negatív, megszakításos és restart-acceptance

- **Státusz/típus/prioritás:** [x] TESZT/INTEGRÁCIÓ; P0; G00/G05, aktív 15.1.
- **Cél és indok:** a közös sikerlánc mellett a félbemaradt gazdasági műveletek is helyesek legyenek.
- **Meglévő:** izolált receipt/settlement/recovery tesztek és phase15 acceptance bundle.
- **Módosítás:** az SI-A13 fixture valódi adapterútjának közös harness-e;
  U/I fake csak megnevezett határon, nem kézzel sikeresre írt domainrekord.
- **Modulok:** érintett modulok testjei, gateway integration-tests, existing
  acceptance-bundle/reconciliation; a meglévő 15.1 regression-mapping bővítése.
- **Függőség:** SI-A01–SI-A13.
- **Elfogadás:** üres input/GP, full inventory, burnt batch, túl magas ár,
  rossz partner/tenant, duplicate/módosított receipt, sourcehiány, munka közbeni
  death és engine/gateway kiesés mind külön esettel; nincs végleges engine/domain
  eltérés vagy hamis completed, replay nem dupláz. Uncertain állapot látható.
- **Tesztek:** U az adapterhatárok megőrzése; I crash reservation, natív commit,
  domain apply, wage/rent commit és goal-update pontján; E recovery a SI-A15-ben.
- **Perzisztencia/hiba:** a harness a közös kanonikus checkpoint és valódi domain-
  adatbázisokat nyitja újra; rollback/kompenzáció nem generál értéket.
- **Kockázat:** magas tesztkomplexitás; fake-határ elfedheti a valódi save-gapet.

- **Eredmény:** [26 közös natív eset, nyolc process-kill recovery és határok](SI_A14_NATIVE_RESTART_ACCEPTANCE.md),
  [exact futások és megőrzött FAIL-ek](SOCIETY_INTEGRATION_PROGRESS.md).
  Kanonikus bérreceipt/Player-checkpoint egy tranzakcióban; késői inbox-source
  és haladó órán történő housing admission javítva. A végső 26 eset és
  evidence-audit PASS; a teljes regresszió 2265 PASS / 0 FAIL. Az uncertainty
  explicit marad, a 15.1 audit egészét nem zárjuk le. Élő E-recovery/SI-M1:
  SI-A15, változatlan publication/travel/needs kapukkal.

### SI-A15 – Élő négyavatáros integrációs demonstráció, SI-M1 kapu

2026-10-22: a felhasználó által kért **technikai igazolás lezárva**;
[végső bizonyítékcsomag](SI_A15_TECHNICAL_RESULT.md). A 16 natív mechanikai
kapu, a háromnapos normál autonóm megfigyelés és a végső eredményrestore
elkészült. Az eredeti D1/SI-M1 livelihood-verdict nem lett PASS;
a teljes időablakos gazdasági minősítés `inconclusive` maradt.

**Aktuális továbblépés: SI-A lezárva, SI-B01 kész, SI-B02 következik.** Az alábbi dátumozott
végrehajtási bejegyzések történetiek; korábbi „nyitott” mondataik nem nyitják
újra a lezárt technikai kaput.

2026-10-22 16:48: [kontrollált natív mechanikai bizonyítékok](SI_A15_CONTROLLED_NATIVE_PROOFS.md):
teljes belső étellánc, mindkét valós 25 GP munkabér, fizikai alvás/logout,
natív hiánykezelés és valódi held-inputos in-flight restart igazolt.
Az új autonóm eredmény és annak végső capture/restore-ja még szükséges;
a kontrollált mechanikai eredmény nem önálló túlélési acceptance.

2026-10-22: harmadik autonóm megfigyelés három játéknappal, valódi gatherrel;
beragadt commerce-foglalás/peer kanonikus rendezése és utazási hiány javítva.
Az új travel draft normál trial-verifier PASS, teljes regresszió PASS;
[külön publikációs jóváhagyási csomag](SI_A15_TRAVEL_PUBLICATION_REVIEW.md).
A következő autonóm baseline és az alábbi mechanikai kapuk miatt a státusz nyitott.

- **Státusz/típus/prioritás:** [x] VÉGREHAJTÁS; P1; G05, technikai igazolás lezárva.
- **Cél és indok:** megmutatni, hogy a modulok egy működő világot alkotnak;
  ez nem a végső társadalom és nem stratégiai LLM-bizonyítás.
- **Meglévő:** H01 proto-soak és H02 boltpilot történeti eredménye; nem ez a food-demo.
- **Módosítás:** a 2026-10-21-i felhasználói döntés szerinti külön v2 technikai
  terv: gyorsított profilon három játéknap, maximum 16 valós perc, normál
  runtime és tervezett restart; külön jelölt natív mechanikai esetek,
  megfigyelés és result-capture/restore. Az eredeti D1 minősítése megmarad.
- **Modulok:** SI-A13 fixture, normál engine/gateway/skills, benchmark/metrics és acceptance export.
- **Függőség:** SI-A14; az adott élő világra ellenőrzött futási terv.
- **Elfogadás:** a v2 terv 16 mechanikai kapujának tényleges natív hatása,
  jogosultsága, könyvelése és egyszeri alkalmazása; hiánykezelés, valódi
  in-flight restart és eredményrestore. A kontrollált mechanikai esetek és
  a nulla kézi céladás/értékinjekció mellett futó autonóm trajectory külön
  bizonyíték. A mért ellátási kudarc és az eredeti D1-verdict nem írható át;
  a teljes gazdasági/önfenntartási PASS nem ennek a technikai checkboxnak az állítása.
- **Tesztek:** U nem új; I SI-A14 kapu; E valós helyi engine/content, readonly
  utóellenőrzés és izolált eredményrestore. Ez különbözik a mockos harness-től.
- **Perzisztencia/hiba:** leállítás függő műveletekkel sem töröl intentet;
  snapshot előtt rendezett írók. Protocol-completed nem automatikus verdict PASS.
- **Kockázat:** közepes–magas; útvonalidő, bootstrap runway, nem megfigyelt háttéríró.

- **2026-10-21 20:24:** a három food skill külön emberi jóváhagyás után
  normál úton publikálva. A három játéknapos első production autonóm
  megfigyelés befejeződött: két bérleti fizetés, egy önálló étkezés és
  egyszeri 2400 relief igazolt. A teljes lánc, fizikai alvás, bér és native
  in-flight restart továbbra is hiányzó kapu; a checkbox nyitott.
  Az új runtime-hibák javítása külön baseline-ban ellenőrzendő;
  [részletes aktuális állapot](SI_A15_TECHNICAL_CLOSURE.md).

- **2026-10-22:** az első tényleges autonóm eredmény offline capture és
  újkönyvtáras restore/kanonikus riport-újraolvasása sikerült. A második
  baseline három önálló étkezést rögzített, de megfigyelői lockhiba miatt
  megszakadt; a bizonytalan gyűjtési intent biztonságos egyeztetése javítva.
  A publikált gather normál CLI-je a fizikailag elért mólón sikeres és
  kanonikus forrásból igazolt. Teljes autonóm lánc és útvonal továbbra is
  hiányzik; SI-A15 nyitott, nem paraméterkalibrációra átsorolt probléma.

- **Előkészítés / BLOCKED (2026-10-19):** [D1 jelölt terv és futtatható readonly preflight](SI_A15_D1_PREFLIGHT.md),
  [exact audit és ellenőrzések](SOCIETY_INTEGRATION_PROGRESS.md).
  A 90 perces ablakban legfeljebb 450 hunger képződik, a rutin 6000-nél eszik;
  első étkezés legkorábban 20 óra. Három draft procedure, natív travel/authority,
  izolált runtime és előrehaladt result-archive/restore is nyitott kapu.
  Az élő D1 nem indult, nincs SI-M1 verdict; a checkbox nyitott marad.

- **Folytatás (2026-10-20):** a felhasználó által véglegesített
  [napalapú túlélési szabály és kontrollált gyorsított profil](SI_A15_DAY_SURVIVAL.md)
  implementálva: egy nap után autonóm ételkeresés, hét nap hiánynál éhhalál,
  egy adag egy nap. Új világban élő nap/óra, tesztben nap/öt perc, azonos
  szabályokkal. A régi világok nem kapnak automatikus átértelmezést.
  Ez felváltja az új profilok 1:1 és scheduled-meal feltevését; az eredeti
  90 perces D1 kététkezéses/95%-os kapuja továbbra is külön felülvizsgálandó,
  nem lezárt acceptance. Exact ellenőrzések a progressben.

- **2026-10-21-i végrehajtási irány:** [technikai lezárás](SI_A15_TECHNICAL_CLOSURE.md).
  Ez történeti döntés: a natív működés bizonyítását írta elő. A publication,
  travel, runtime és result kapuk azóta a v2 technikai protokoll szerint
  teljesültek. A v1 D1 95%-os/90 perces szerződése történeti marad, nem PASS.
- **2026-10-22-i végleges fejezetzárás:** **SI-A kész, SI-B01 elkezdhető.**
  A [v2 technikai bizonyítékcsomag](SI_A15_TECHNICAL_RESULT.md) elfogadási kapuja
  lezárt. A megélhetési eredmény továbbra is hiányos; a valósághű kalibráció
  SI-C09, és egyik sem blokkolja az SI-B fejlesztésének megkezdését.

## 6. SI-B – stratégiai autonómia a már integrált világban

**Fázisbelépés teljesült: SI-A15 v2 technikai igazolása elfogadva.
SI-B01–SI-B06 kész; SI-B06 v2 valódi provideres stratégiai kapu PASS,
SI-C01 elkezdhető.** Az első SI-B06 FAIL változatlanul megőrzött.
Az eredeti D1/SI-M1 önfenntartási PASS nem a fejlesztés
belépési feltétele. Az SI-A mért ellátási kudarcai megmaradnak kiinduló
eredményként. Az SI-B-ben külön kell bizonyítani, hogy az agent észlelt
változást, lehetőségek közül választott, és a következményt visszaértékelte;
az SI-B06 élő elfogadásához saját, aktuális futási terv szükséges.

### SI-B01 – Natív körülményváltozás és observer-specifikus context

- **Státusz/típus/prioritás:** [x] KIEGÉSZÍTÉS; P1; G02/G04, RUNTIME/METRICS.
- **Cél és indok:** bevételkiesés, készlethiány és veszély felismerése ne operátori üzenet legyen.
- **Meglévő:** persistent inbox/domain recovery, context/retrieval, offer/work/goal
  események; SI-A12 natív outcome és demand.
- **Módosítás:** saját income/cash-runway, esedékes needs/rent, ismert ajánlatok,
  lezárt munka/partnerhiány és jogszerűen látott készlet összegzése; verziózott
  küszöbök, dedup/hysteresis és cooldown szerinti wake-up. Saját és intézményi
  adatok láthatósága elkülönítve, source-freshness és unknown explicit.
- **Modulok:** agent-state context/retrieval, gateway domain-event/replan inbox,
  Business/assets és metrics read adapters.
- **Függőség:** SI-A15, SI-A12.
- **Elfogadás:** valódi jövedelemforrás-megszűnés egyszer ébreszt; nincs globális
  idegen inventory-tudás; stale megfigyelésből nincs biztos gazdasági tény;
  új esemény nem kerüli meg a lease/cost gate-et.
- **Tesztek:** U küszöb/hysteresis; I natív változás→inbox→context→decision,
  restart és sourcegap; E SI-B06.
- **Perzisztencia/hiba:** durable source cursor és admission ID; megfigyelés
  bizalmi szintjét memory-ingestion nem emelheti bizonyítatlanul.
- **Kockázat:** közepes; eventvihar, privacy és a hiány tényként félreértelmezése.

2026-10-22: [implementáció, source/cursor szerződés, migráció és rollback](SI_B01_OBSERVER_CONTEXT.md)
elkészült; natív employment→recovery→inbox→context és scripted döntési út,
privacy, freshness, hysteresis/cooldown, restart és írási hibapróbák igazoltak.
Az érintett körök és root TypeScript PASS; a teljes regresszió FAIL-jét
és a külön próbált időkorlátokat a [progress](SOCIETY_INTEGRATION_PROGRESS.md)
megőrzi. Az SI-A13 wrapper későbbi [diagnosztikája és javítása](SI_A13_RUNNER_DIAGNOSTICS.md)
mind a tíz natív próbát igazolta, változatlan belső limitekkel; ez nem új full PASS.
SI-B06 élő stratégiai E2E nem történt. Következő: SI-B02.

### SI-B02 – Állapotcél és korlátos tervelfogadás

- **Státusz/típus/prioritás:** [x] KIEGÉSZÍTÉS; P1; G02, RUNTIME.
- **Cél és indok:** „fenntartható megélhetés/van élelem” ne sikeres runszámmal legyen azonos.
- **Meglévő:** célhierarchia, successful-skill-runs progress, proposal/approval
  ledger és narrow execution grant; új stratégiai terv adminnál megáll.
- **Módosítás:** kis allowlistelt állapotpredikátumok natív evidence-ből;
  replan/plan-adoption a meglévő granton belül, kötött parent-revision és
  scope mellett. Rövid szükséglet és hosszú stratégiai cél külön horizon.
- **Modulok:** agent-state goal/store/planner, llm-runtime validator,
  replan-runtime és authorization-envelope; publikus grant nem bővülhet.
- **Függőség:** SI-B01.
- **Elfogadás:** skill exit 0, de elégtelen tartalék → goal nem completed;
  validált új immediate terv admin-kattintás nélkül elfogadható; stale parent,
  túl nagy költség vagy új jogosultság fail-closed; self-care felülírhatja az aktuális munkát.
- **Tesztek:** U predicate/goal-revision; I model plan→adoption→dispatch→native
  outcome→goal, crash minden váltásnál; E SI-B06.
- **Perzisztencia/hiba:** additive goal/proposal schema és policyversion,
  legacy run-goal szemantika megőrzése; ugyanaz a terv nem aktiválható kétszer.
- **Kockázat:** magas; cél-újranyitási loop, tág implicit jogosultság és hamis siker.

2026-10-23: [implementáció, migráció/rollback és célzott bizonyíték](SI_B02_STATE_GOALS.md)
kész. Állapotpredikátumok, azonos parent revisionhöz/granthoz kötött egyetlen
immediate terv elfogadása és cseréje, self-care elsőbbség, admin-route,
valódi natív food-következmény és öt process-kilépési barrier igazolt.
Az érintett ellenőrzések, root/engine TS és formázás PASS; teljes regresszió
nem indult. SI-B03 és SI-B06 élő E2E nem történt. Következő: SI-B03.

### SI-B03 – Player-stratégia: beszerzés, más munka vagy más termelési út

- **Státusz/típus/prioritás:** [x] KIEGÉSZÍTÉS; P1; G02/G08, RUNTIME.
- **Cél és indok:** egy bevételi út elvesztése után az agent maga válasszon alternatívát.
- **Meglévő:** LLM-provider/orchestrator, ismert verified skillök,
  acquire-input/input-required fallback, identity traits/values.
- **Módosítás:** legalább két ténylegesen végrehajtható megélhetési alternatíva
  és beszerzési terv same Skill[] modellel; actor számára látható lehetőség,
  igény/költség/kockázat és egyéni preferencia a bounded contextben.
  Inputhiányból acquisition/munka/explicit várakozás, új tickenkénti LLM-loop nélkül.
- **Modulok:** llm-runtime planning/types/validation, agent-state goal/known skills,
  replan-runtime/binding és existing skill catalog.
- **Függőség:** SI-B02, SI-A07, SI-A09.
- **Elfogadás:** elvont nevű agent nem actor-specifikus branchből választ;
  megszűnt munka után más engedélyezett tervet készít; elérhetetlen skillt
  capability-gapnek jelöl; az új tervnek van valós state/evidence következménye.
- **Tesztek:** U tool/plan-validáció; I legalább két alternatíva és nulla
  elérhető alternatíva, budget/death/cooldown, prompt injection; E SI-B06.
- **Perzisztencia/hiba:** a kiváltó esemény, context/policy, validált döntés és
  terv ID összekötött; retry nem duplikál feladatot vagy providerfoglalást.
- **Kockázat:** magas; az előre bekódolt helyettesítés LLM-választásnak tűnhet.

2026-10-23: [implementáció, támogatott preflight-határ, migráció/rollback és bizonyíték](SI_B03_PLAYER_STRATEGY.md)
kész. A modell explicit observer-opciók közül választ, nem actor-név alapján.
Resource/beszerzési és jóváhagyott munkaút, inputhiány/wait/capability-gap,
provider/plan/dispatch dedup, tartós cooldown és natív state-következmény célzottan
igazolt; root/engine TS és formázás PASS. Full és élő provider/világ nem futott;
SI-B06 stratégiai E2E nem állítható. Következő: SI-B04.

### SI-B04 – Institution-agent stratégiai döntési admissionje

- **Státusz/típus/prioritás:** [x] KIEGÉSZÍTÉS; P1; G02/G03, ECON/RUNTIME.
- **Cél és indok:** a konyha policyválasztását ne admin vagy fix callback végezze.
- **Meglévő:** Business/Faction read/write portok és control-profile; player-only
  automatikus replan; SI-A11-ben szándékosan determinisztikus Business-rutin.
- **Módosítás:** a meglévő enrollment/inbox/queue/budget lifecycle avatár nélküli
  szerepre bővítése. Első scope csak exact Business subject stock-/work-/árpolicy
  javaslat és granton belüli alkalmazás; a fizikai feladat player-request marad.
- **Modulok:** autonomy supervisor/replan coordinator, agent-state/control,
  Business agent-port, llm-runtime role-specific tool schema.
- **Függőség:** SI-B02, SI-A08, SI-A09.
- **Elfogadás:** institution képes változott keresletre új ordert/policyt választani;
  nem vezérel avatárt; más Business treasuryjét nem írhatja; ugyanaz a leállítás,
  dedup, cooldown és costlimit érvényes. Faction-politikai AI nem része e tasknak.
- **Tesztek:** U szerep/tool boundary; I Business event→plan→work→player→reward
  és loop/restart, idegen subject; E SI-B06.
- **Perzisztencia/hiba:** enrollment és decisionledger reuse, nincs második
  institution scheduler; folyamatos provider/port hiba quarantine-olható.
- **Kockázat:** magas; avatarfeltételezések rejtett kódban és intézményi privilege escalation.

2026-10-23: [implementáció, explicit grant, migráció/rollback és célzott bizonyíték](SI_B04_INSTITUTION_ADMISSION.md)
kész. Exact avatarless Business a meglévő supervisor/inbox/queue/ledger útján
policy/stock/ár/work opcióazonosítót választhat; fizikai munka typed player-request.
Lease/stop/cooldown/budget, idegen subject, provider uncertainty, újrainduló
alkalmazás és egyszeri natív settlement igazolt. 107 közvetlen fogyasztó PASS;
utolsó kör 37 PASS + root/engine TS + format. Full, élő provider/világ és új
publication nem futott. Default grantlista üres. Következő: SI-B05.

### SI-B05 – Együttműködés kezdeményezése typed gazdasági akciókkal

- **Státusz/típus/prioritás:** [x] KIEGÉSZÍTÉS; P1; G02/G03, ECON/RUNTIME.
- **Cél és indok:** munka/kereskedelmi partner ne csak fixtureben kiosztott kapcsolat legyen.
- **Meglévő:** offer/contract/employment és commitment domainek, Business-port;
  a player toolkészlet nem teljes önálló gazdasági kezdeményezőfelület.
- **Módosítás:** korlátos ajánlat, elfogadás/elutasítás és munkaigény-javaslat
  role-specific typed akcióval; feltételek/partner/fedezet/határidő validálása.
  A pénzügyi vállalás csak meglévő contract/escrow lifecycle-on keresztül valósulhat meg.
- **Modulok:** economic-contracts/settlement, business-agent-port, agent-state
  social memory/control, llm-runtime action validator.
- **Függőség:** SI-B03, SI-B04.
- **Elfogadás:** két actor kezdeményezhet és visszautasíthat együttműködést;
  nincs forced consent, fiktív teljesítés vagy új hitel/adóhatóság; egyéni
  trust nem válik globális tudássá. Egy elfogadott együttműködés fizikailag teljesül.
- **Tesztek:** U ajánlat/consent/risk; I ajánlat→contract→skill→receipt→settlement,
  rejection/expiry/default és retry; E SI-B06.
- **Perzisztencia/hiba:** stable offer/contract/request ID, pending pénzügyi
  vállalás nem veszhet el; duplicate event nem két ajánlat/szerződés.
- **Kockázat:** magas; szabad LLM-szöveg helyett végrehajtható gazdasági vállalás létrehozása.

2026-10-23: [typed együttműködés, támogatott feltételek, migráció és ellenőrzési index](SI_B05_ECONOMIC_COOPERATION.md)
kész. Saját kapcsolatból partnerkeresés, korlátos offer/work-proposal és külön
címzetti acceptance/rejection; privát trust, existing funded contract/escrow,
stabil ID és restart-safe outbox. A native service feltétel egy exact natív
meghívás; ACK/journal nem teljesítés. Kontrollált modellválasztás→SDK→packed
engine→natív receipt→egyszeri finite díj igazolt. 125-ös zárókör + root/engine
TS/format PASS; full és élő provider/világ nem futott. Default grantlista üres.
Következő: SI-B06; SI-M2 valós-provideres PASS továbbra sincs.

### SI-B06 – Stratégiai autonómia elfogadás, SI-M2 kapu

- **Státusz/típus/prioritás:** [x] TESZT/VÉGREHAJTÁS; P1; G02/G05/G08.
- **Cél és indok:** külön bizonyítani a döntési autonómiát és a skill működését.
- **Meglévő:** SI-A15 stabil mechanikus lánc és deterministic/mock providertesztek.
- **Módosítás:** ugyanazon baseline kontrollja és három változás: megszűnt
  bevétel, raw-hiány, új együttműködési lehetőség; előre rögzített opportunity
  set, pénz/idő/híváskeret. Scripted provider technikai teszt után külön valós
  providerrel ritka stratégiai próba, rögzített model/prompt/config mellett.
- **Modulok:** existing experiments/benchmark, llm-runtime audit, context/goal
  history és native metrics; nincs új optimalizáló keretrendszer.
- **Függőség:** SI-B01–SI-B05.
- **Elfogadás:** natív esemény→agent észlelése→LLM alternatívák közti választása→
  új terv→valós eredmény trace; bevételkiesésnél tényleges stratégia-/munkaváltás,
  scarcitynél acquisition/alternatíva, együttműködésnél önálló ajánlat.
  Puszta retry, előírt next-skill vagy exit 0 nem stratégiai PASS.
- **Tesztek:** U nem új; I rossz/jogtalan modellválasz és stratégia helyett
  rutin folytatása negatív eset; E kis, budgetes valódi providerpróba.
- **Perzisztencia/hiba:** minden validált választás és natív outcome megőrzött;
  no-provider vagy budgethiány `not-tested`, nem mock alapján valós-LLM PASS.
- **Kockázat:** közepes–magas; nem determinisztikus modell, kedvező futás kiválogatása.

2026-10-23: [futtató, javítások és ellenőrzési index](SI_B06_STRATEGIC_ACCEPTANCE.md),
[első valódi Luna/medium eredmény](SI_B06_LUNA_ATTEMPT_1.json) és a külön
[v2 elfogadási bizonyíték](SI_B06_LUNA_ATTEMPT_2.json). Scripted
natív út és célzott TS/format ellenőrzések PASS, új full nem indult.
Valódi mérés: 5 kérés / 0,001795 USD; control és raw-hiány natív eredménnyel,
income-lossnál ugyanaz a production stratégia, cooperationnél két külön
ajánlat. Ez történeti FAIL, nem lett utólag átminősítve. A mérés után javított saját
funding-context és cooldown-t tartó ellenajánlat-folytatás scripted igazolt;
külön v2-ben azonos baseline-ból három ténylegesen fedezett munkaforrás közül
választás, income-loss után 5→4 GP-s work-source váltás, native acquisition
és önálló kezdeményezés→külön Business-consent→natív service→5 GP díj igazolt.
**Négy valódi stratégiai PASS; SI-B06 kész, SI-M2 kapu teljesült.** Két
valódi mérés összesen 11 kérés / korrigált 0,004235 USD, readonly zárt pénzegyenletekkel;
ez eldobható natív fixture-elfogadás, nem önfenntartási vagy live rollout PASS.
Következő: SI-C01.

## 7. SI-C – tartós, heterogén és mérhető Minimum Viable Society

**Fázisbelépés: SI-B06 v2 teljesült; SI-C01–C04 kész, következő SI-C05.** Az első valódi
FAIL és a javított baseline külön PASS-a egyaránt megőrzött. Nem kell újabb gazdasági domaint építeni: egy
termelőeszköz tényleges pótlása és a natív történet teljessége a cél.

### SI-C01 – Az attribute/potential tényleges engine-hatása

- **Státusz/típus/prioritás:** [x] KIEGÉSZÍTÉS; P1; G08, PROFILE/RUNTIME.
- **Cél és indok:** az adottság és tanult készség életúthatása ne csak tesztképlet legyen.
- **Meglévő:** immutable AttributeProfile, seedelt allocation, potential/cap és
  tiszta XP-kontroll; kísérletbeli declared input nem engine-enforcement.
- **Módosítás:** lifecycle-hoz kötött tartós profile lookup a meglévő XP-award
  határon Fishing/Cooking/Mining/Smithing számára; exact policyversion és natív
  granted-XP receipt; diminishing XP/potential/experiment szorzók sorrendje rögzítve.
- **Modulok:** character-attributes, engine Player/WorldMods XP-hook,
  genesis/population profile binding és context.
- **Függőség:** SI-B06, SI-A01 natív commit-pattern.
- **Elfogadás:** eltérő profile azonos workloadból más valódi Player-XP-t ad;
  hard/soft/facility cap helyes; többi skill vanilla; hiányzó profile nem
  kap kitalált átlagot. A facility nem írja át a személyes skillt.
- **Tesztek:** U meglévő képletek; I tényleges Player addXp/checkpoint, policy-
  kombináció és reopen; E páros kis karakterpróba, nem többnapos életpályaállítás.
- **Perzisztencia/hiba:** immutable creation policy/digest, migráció a régi
  karakterekre explicit; training nem módosítja az alaptulajdonságot.
- **Kockázat:** magas; több XP-út és szorzók nem felcserélhető sorrendje.

2026-10-24: [natív XP/binding és ellenőrzési index](SI_C01_NATIVE_ATTRIBUTE_XP.md),
[páros actual Player/checkpoint bizonyíték](SI_C01_PAIRED_RESULT.json).
Új genesis/population profil és exact policy tartós/immutable; a régi profilhiány
explicit migrációt igényel. Calibration→diminishing→potential→global-rate→cap;
nyolc native receipt, azonos80-ból60/100 actual XP négy skillnél.13 natív eset,
közvetlen fogyasztók, root/engine TS és format PASS; full és providerhívás nincs.
**SI-C01 kész; SI-C02 következik.** Nem SI-M3 vagy többnapos életpálya-PASS.

### SI-C02 – Egy valós termelőeszköz natív használata és kopása

- **Státusz/típus/prioritás:** [x] KIEGÉSZÍTÉS; P1; G03, FOOD/ECON.
- **Cél és indok:** a termelőtőke pótlási kereslete tényleges munkából származzon.
- **Meglévő:** ItemLifecycleStore, bronze-pickaxe-mining cycle, wear/break szabályok.
- **Módosítás:** egy exact iteminstance és native Mining action receipt között
  kapcsolat; sikeres munka használatot könyvel, broken toolt az engine valóban tilt.
  Inventory/transfer és instance ownership ugyanazt az eszközt kövesse.
- **Modulok:** item-lifecycle, engine mining/tool-use hook, provenance,
  agent-state/tool context; nincs új durability-motor.
- **Függőség:** SI-B06, SI-A02, SI-A05.
- **Elfogadás:** valódi munka fogyaszt durabilityt, replay nem még egyszer;
  használhatatlan tool nem termel; átadás nem reseteli; puszta animáció nem wear proof.
- **Tesztek:** U use policy; I native action→wear→broken execution gate,
  transfer/reopen/death; E egy eszköz kifárasztása helyi bounded próbában.
- **Perzisztencia/hiba:** native commit után pending wear recoverable;
  instance-id/migration és gazdátlan tool explicit, nem automatikus új item.
- **Kockázat:** magas; normál stackitem és egyedi instance eltérő reprezentációja.

2026-10-24: [natív Mining/tool/custody eredmény és migráció](SI_C02_NATIVE_MINING_TOOL.md),
[100 valós művelet bizonyítéka](SI_C02_NATIVE_RESULT.json). Exact bronze-instance,
valódi copper/tin output→wear→break→engine gate; normál100/1 policy.
Native inventory/bank és BOTH_MOVEINV ugyanazt az ID-t, kopást és provenance-t
tartja; az ismeretlen tárgycsere quarantine, nem friss tool. Output/wear/save
egy commit; replay/rollback/reopen/death/clock és13 natív eset PASS; közvetlen
lineage/XP/context fogyasztók és root/engine TS PASS. Full/providerhívás nincs.
**SI-C02 kész; SI-C03 következik.** Repair/replacement és SI-M3 továbbra nyitott.

### SI-C03 – Egy eszköz belső javítása vagy pótlása

- **Státusz/típus/prioritás:** [x] INTEGRÁCIÓ; P1; G03/G05, ECON.
- **Cél és indok:** az alapítók kezdőtool-készlete ne rejtsen hosszú távú külső függőséget.
- **Meglévő:** repair policy, ore→bar→tool workflow, WIP/facility/roles és SI-A06 physical bridge.
- **Módosítás:** egy kiválasztott repair vagy replacement recepthez natív input,
  idő, hozzáférés és worker skill; hiányzó minimális mining/smelting/forging
  procedure SI-A07 rendje szerint, nem teljes új productionkatalógus.
- **Modulok:** production-workflow, item-lifecycle/repair, facility-capability,
  existing skill adapters és Business custody.
- **Függőség:** SI-C02, SI-A06, SI-A07, SI-B03.
- **Elfogadás:** valódi anyag és idő fogy, durability/service-capacity visszaáll;
  replacement régi instance-t lezár, újat igazoltan köt; azt új munkában használják;
  input/facility nélkül nincs ingyen repair.
- **Tesztek:** U recept/capacity; I use→break→input procurement→repair/replace→use,
  crash és elégtelen skill/anyagtartalék; E SI-C07 hosszú láncában.
- **Perzisztencia/hiba:** existing WIP/receipt IDs és instance audit; running
  félreparált művelet nem törölhető és nem dupláz anyagot.
- **Kockázat:** magas; output és repairhatás kétszeres elszámolása, hiányos upstream inputlánc.

### SI-C04 – Natív vagyon-, ár- és üzleti pénzügyi idősor

**Belépés: SI-C03 kész;24/45.** [100 Mining→break→belső anyag→repair→use](SI_C03_NATIVE_TOOL_REPAIR.md),
[source-bound eredmény](SI_C03_NATIVE_RESULT.json). A választott repair mechanikai
kapu PASS; az autonóm hosszú lánc SI-C07 és SI-M3/MVS továbbra nyitott.
Történeti SI-C04 belépés, saját SI-B06/SI-A12 függőségekkel. Azóta
[SI-C04 mechanikai mérési kapu kész](SI_C04_NATIVE_FINANCE_HISTORY.md).

- **Státusz/típus/prioritás:** [x] KIEGÉSZÍTÉS; P1; G04, METRICS/ECON.
- **Cél és indok:** a meglévő Gini/mobilitás/árképletek hiteles adatból számoljanak.
- **Meglévő:** tíz evaluation képlet, treasury/contract/bank és trade-journal;
  teljes azonos-határú nyitó/záró vagyontörténet nincs.
- **Módosítás:** actorcohort és source-watermark szerint nyitó/záró cash,
  Business-egyenleg, követelés/adósság külön; unit-price/fixed basket;
  Business revenue/input/wage/rent/capital cashflow és alapítás/megszűnés okkód.
- **Modulok:** society-metrics native sources, economic-dependency/export,
  treasury/banking/contract reader; nem új gameplay valuation.
- **Függőség:** SI-B06, SI-A12.
- **Elfogadás:** összvagyon és belső transfer nem dupláz; GP-only Gini scope
  kimondott, debt/tárgyi vagyon külön; azonos actorok rangmozgása, hiányos
  price-basket inconclusive; veszteség nem tűnik el a riportból.
- **Tesztek:** U ismert vagyon/kosár/tie; I natív boundary snapshot és ismételt
  readonly report, sourcegap/clock drift; E SI-C07 adataiból újraolvasás.
- **Perzisztencia/hiba:** immutable observation binding; snapshotokhoz támogatott
  consistent-boundary policy, nincs színlelt cross-DB ACID vagy utólagos értékelés tényként.
- **Kockázat:** közepes–magas; debt/net-worth és cég/személy tulajdon duplaszámolása.

### SI-C05 – Foglalkozási, társas és döntési outcome-metrikák

**Történeti belépés: SI-C04 kész;25/45.** [Readonly frozen finance/basket/cashflow](SI_C04_NATIVE_FINANCE_HISTORY.md),
[source-bound eredmény](SI_C04_NATIVE_RESULT.json). GP-only scope, claims/debt és
hiányzó Business rent/capex forrás külön; nincs SI-C07/SI-M3/MVS minősítés.
SI-C05 a felhasználó kérésére elkészült, SI-C04/SI-B06 függőségekkel.

**Zárás: SI-C05 kész;26/45.** [Readonly worker/social/goal/provider projection](SI_C05_NATIVE_OUTCOME_METRICS.md),
[source-bound eredmény](SI_C05_NATIVE_RESULT.json). Actual credit és worker-output
külön a responsibility HHI-től; observer-owned graph, újraszámolt state evaluation
és native-clock goal transition; külön wall provider audit/queue. Hiányzó
available-and-willing denominator és active service unknown. Kontrollált natív
próba/célzott kapuk, nem SI-C07/SI-M3/MVS. Következő SI-C06 új kérésre.

- **Státusz/típus/prioritás:** [x] KIEGÉSZÍTÉS; P2; G04/G08, METRICS/RUNTIME.
- **Cél és indok:** megkülönböztetni a termelési felelőst, fizikai munkást és társas partnert.
- **Meglévő:** recipe-responsibility HHI, employment, directed social memory,
  commitment, döntési budget/token audit és goal-success progress.
- **Módosítás:** actual worker/time/output szerepkötés, available-and-willing
  person-time, teljesítési/várakozási idő; observer-specifikus trade/cooperation/
  conflict élek; natív goal-outcome, provider queue/service/latency és token/cost.
- **Modulok:** society-metrics, agent-state/retrieval/history, Business work,
  llm-runtime audit/queue és source readers.
- **Függőség:** SI-C04, SI-B06.
- **Elfogadás:** offline nem automatikusan munkanélküli; sikeres skill nem
  sikeres stratégia; trade nem automatikusan trust; hiányzó munkaigény-nevező
  unknown; LLM-hívás és költség auditból származik, nem becsült használati tény.
- **Tesztek:** U szerep/person-time/graph; I ismert kis natív munkahét és
  observer láthatóság, incomplete denominator; E SI-C07 riport.
- **Perzisztencia/hiba:** existing event ID-kre épülő projection, új központi
  social-score vagy párhuzamos memória nincs; személyes adat exportja scope-olt.
- **Kockázat:** közepes; hibás nevezőből tetszetős, de félrevezető társadalmi következtetés.

### SI-C06 – A kibővült világ összehasonlítható baseline-ja

**Történeti belépés: SI-C05 kész;26/45.** [Outcome-verzió és source/clock korlátok](SI_C05_NATIVE_OUTCOME_METRICS.md),
[mechanikai elfogadás](SI_C05_NATIVE_RESULT.json). Új outcome store nincs;
archive/source coverage vizsgálatnál a meglévő authoritative source-ok és a
reportverzió rögzítendő. SI-C06 a felhasználó kérésére elkészült.

**Zárás: SI-C06 kész;27/45.** [Coverage/pin/restore és CLI](SI_C06_EXPANDED_BASELINE.md),
[source-bound eredmény](SI_C06_NATIVE_RESULT.json). Új checkpoint+sidecar és finance
observation coverage; explicit source/schema/runtime/policy/cache/provider/report
pin; exact baseline/result link; stagingben native state/report újraolvasás.
V1 kompatibilitás, WAL és valódi native WIP replay célzottan ellenőrzött.
Selected coverage nem teljes világ és nem bitazonos rerun; C07/SI-M3/MVS nyitott.

- **Státusz/típus/prioritás:** [x] KIEGÉSZÍTÉS; P1; G04/G05, METRICS/CLOCK.
- **Cél és indok:** az új needs/custody/profile store ne maradjon ki a már meglévő restore-ból.
- **Meglévő:** offline hash-archívum, új könyvtáras restore, controller és
  XP/condition digest-kapuk, explicit RNG/LLM reprodukciós korlátok.
- **Módosítás:** új authoritative store-ok és migrációk archive/reopen támogatása;
  baseline/result explicit összekötése; pinned run/model/policy/cache/config,
  natív riportverzió. Kezelés előtt a tényleges engine-enforcement ellenőrzése.
- **Modulok:** society-experiments archive/controller/source/comparison,
  backup/offline-probe, új domain path-adapterek.
- **Függőség:** SI-C01, SI-C03, SI-C04, SI-C05.
- **Elfogadás:** baseline restore és eredmény újraolvasás más könyvtárban egyezik;
  missing store/dirty baseline/policy drift elutasított; model/RNG korlát jelölt;
  azonos seed nem bitazonos teljes világeredményként szerepel.
- **Tesztek:** U manifest/coverage; I roundtrip új store-okkal és WAL-lal,
  corruption/restore migration; E kis újrafuttatási preflight, nem hosszú sim.
- **Perzisztencia/hiba:** offline cohérent állapot, secrets kizárva;
  új tároló nem kezeli hiányzó régi file-t érvényes üres társadalomként.
- **Kockázat:** közepes–magas; snapshot teljesség és konfigurációból csak látszólag eltérő kezelés.

### SI-C07 – Tartós önfenntartási próba, SI-M3 kapu

**Belépés: SI-C06 kész;27/45.** [Explicit baseline és korlátok](SI_C06_EXPANDED_BASELINE.md),
[mechanikai eredmény](SI_C06_NATIVE_RESULT.json). A teljes required source-lista,
eredeti minimum denominátorai és tényleges enforcement előzetesen ellenőrzendő.
Csak új kérésre induló terv/preflight; a hosszú valódi run külön, konkrét tervre
adott futási jóváhagyást és költségkeretet igényel. Eddig nincs SI-M3/MVS PASS.

**2026-10-24 előkészítés:** [run-tervezet, NO-GO és következő kódmunka](SI_C07_RUN_PREPARATION.md),
[forráskötött diagnosztika](SI_C07_PREFLIGHT_RESULT.json). Day-survival minimum
reference-ID ütközés javítva,17 eredeti requirement és policy-fájl változatlan.
Új hosszú run/baseline/értékimport/providerköltség nincs. 2026-10-25:
[natív Mining request-napló és outcome bekötés](SI_C07_NATIVE_TOOL_DEMAND.md)
elkészült. [Tartós natív igény/lifetime/cancel/output és időmérés](SI_C07_STANDING_TOOL_DEMAND.md)
is kész komponensszinten. A production source-backed gather admission, teljes
cohort coverage és minimum bridge még hiányzik; utána baseline/ratio/SI-A14
preflight és jóváhagyás.

- **Státusz/típus/prioritás:** [ ] VÉGREHAJTÁS; P1; G05, aktív 24 acceptance.
- **Cél és indok:** a rövid siker és a bootstrap-élettartam után is működjön a társadalom.
- **Meglévő:** a 24.1 minimum policy egy nap warmup + hét nap evaluation,
  food/housing/tool/labor/integrity kapukkal; ez korábban nem lett élőben igazolva.
- **Módosítás:** konkrét approved run-plan a meglévő controllerrel, saját
  maxwall/költség/stop feltételekkel; SI-A15/B06 után javított közös gazdaság.
- **Modulok:** existing minimum/evaluation/benchmark és normál runtime; nincs új minimumképlet.
- **Függőség:** SI-C01–SI-C06.
- **Elfogadás:** az eredeti minimum minden kapuja natívan kiértékelhető és PASS;
  legalább egy valódi használat→karbantartás/pótlás→új használat; teljes
  inter-actor végfelhasználás és kezdeti tartalékot nem felélő ellátás.
  Ha a gazdaság elbukik, eredmény FAIL, nem küszöbcsökkentés.
- **Tesztek:** U nem új; I teljes preflight és SI-A14 regresszió; E hosszú
  valódi run és offline eredményrestore, külön futási jóváhagyással.
- **Perzisztencia/hiba:** minden sourcegap/adminérték/extraimport naplózott;
  1:1 esetén legalább nyolc valós nap. Gyorsított profil külön arányvalidálás.
- **Kockázat:** magas empirikus; pénzforgalmi egyensúly, demográfia, fizikai munka/idő arány.

### SI-C08 – Egy facility-/tőkeelőny valódi termelési hatása

- **Státusz/típus/prioritás:** [ ] KIEGÉSZÍTÉS; P2; G03/G04, ECON/METRICS.
- **Cél és indok:** a 24.8 facility-kezelése tényleges munkát módosítson,
  ne csupán egy tiszta tervező által számított hipotetikus időt.
- **Meglévő:** ProductionCapitalService, installation receipt, bellows-
  throughput/quality/capacity hatás és telemetryOnly értékelés.
- **Módosítás:** egy existing capital item fizikai beszerzés/installation,
  entitlement és kopás bizonyítéka; egy recept tényleges engine-végrehajtási
  idő/capacity vagy outputhatásának natív mérése, commissioning/capex forrással.
- **Modulok:** production-capital, facility-capability, WIP execution,
  item-lifecycle és society-metrics investment/source adapter.
- **Függőség:** SI-C03, SI-C06. Ez oldalsó P2 ág; SI-C07 nem függ tőle.
- **Elfogadás:** installed/usable/entitled állapotban valós mérhető különbség,
  eltávolított/broken tőke nem ad előnyt; egyszeri beruházási kiadás;
  telemetry nem határoz meg mesterséges gameplay-árat vagy kész stat-értéket.
- **Tesztek:** U effect-policy megőrzése; I baseline/installed actual recipe,
  installation replay és crash; E kis páros facility-próba, később 24.8.
- **Perzisztencia/hiba:** existing installation/investment/instance receipt;
  outputhatás nem könyvelhető fizikai outcome nélkül, missing effect unknown.
- **Kockázat:** magas; tervezett gyorsulás összetévesztése a valós engine-idővel.

### SI-C09 – Világparaméterek valósághű kalibrációja

- **Státusz/típus/prioritás:** [ ] KUTATÁS/KÍSÉRLET; P2; G04/G05, későbbi feladat.
- **Cél és indok:** a részlegesen modellezett világ paraméterei a valós élet
  lényeges viszonyait közelítsék; az elhagyott folyamatok hatása dokumentált
  kompenzációval jelenjen meg, ne a jelenlegi karakterek megmentésével.
- **Meglévő:** napalapú needs/adag/halál szabály, diminishing XP, versioned
  parameter profile, natív metrikák, archive/comparison alapok. Ezek nem
  jelentenek minden paramétercsoportra alkalmazott, igazolt treatmentet.
- **Módosítás:** modellhatár és empirikus referenciák; valós/játék idő- és
  munkarányok; verziózott paramétertér, rögzített követelmények, dokumentált
  absztrakciós korrekciók, érzékenységi vizsgálat és csak utána módszerválasztás.
  Részletes előkészítés: [kalibrációs feljegyzés](SOCIETY_REALISM_CALIBRATION.md).
- **Modulok:** needs/food/housing, population-lifecycle, XP/world-mods,
  production/logistics, society-experiments és society-metrics; agentpolicy
  tanítása külön kezelés, nem automatikus része a világ kalibrációjának.
- **Függőség:** SI-A15, SI-B06, SI-C06. Külön P2 kutatási ág.
- **Elfogadás:** minden változóhoz referencia/tartomány/bizonytalanság és
  tényleges natív alkalmazás tartozik; több ismétlés és félretett kohorszok;
  túlélési idő csak kimenet, nem kizárólagos reward. A helyes eredmény lehet
  az is, hogy a választott modellben nincs közös, referenciáknak megfelelő
  tartomány. Az egy-/hétnapos kiinduló szabály felülvizsgálata külön indokolt,
  verziózott modellváltozás, nem az optimizer szabad mentőkapcsolója.
- **Tesztek:** U paraméterhatárok/egységek/célfüggvény kijátszása;
  I alkalmazott treatment és restore, gyorsított/élő időarányok; E korlátos
  kontrollált kísérletek ismétléssel, érvénytelen runok és kudarcok megőrzésével.
- **Perzisztencia/hiba:** immutable profil/run/reference/seed/source digest,
  nyers kimenet és modellezési hiányok; nincs aktív világ átírása vagy régi
  acceptance utólagos sikerre minősítése. RNG-korlát és futási horizont jelölt.
- **Kockázat:** magas módszertani; azonosíthatatlanság, kohorszra túlillesztés,
  valós referencia hibás leképezése, reward-kijátszás és időgyorsítási torzítás.

Az SI-A15, SI-C07 és a többi termék-mérföldkő nem függ az SI-C09
kalibrációs kísérlet sikerétől.

## 8. SI-D – aktív utánpótlás és generációváltás

**Fázisbelépés: SI-C07.** Az első utánpótlás seedelt felnőtt bevándorló;
reprodukció és teljes családjog nem előfeltétele a népesség fennmaradásának.

### SI-D01 – Population-entry receiptből valódi account és avatar

- **Státusz/típus/prioritás:** [ ] KIEGÉSZÍTÉS; P1; G06, POP/PLATFORM.
- **Cél és indok:** egy admitted identity ne maradjon a világban nem cselekvő adatbázissor.
- **Meglévő:** seeded-arrival-v1, paused-clock batch admission, identity/finite
  membership; engine account-namespace adapter, vault és BotSupervisor.
- **Módosítás:** exact entry ID-hez tartós account/avatar activation-saga;
  névütközés, finite binding, initial spawn, vault credential és engine readiness.
  A megjegyzett credentials csak a meglévő titoktárban; az agentstate nem jelszótár.
- **Modulok:** population-lifecycle/agent-state entry, gateway population-entry,
  local account adapter, engine binding, vault és supervisor.
- **Függőség:** SI-C07.
- **Elfogadás:** admitted actorhoz egy valódi, saját finite avatar; retry nem
  új név vagy account; deceased identity nem reaktiválódik; failed activation
  megkülönböztethető a sikeres belépéstől és a gazdasági munkaképességtől.
- **Tesztek:** U activation mapping; I namespace collision, vault/account failure,
  crash minden saga-lépésnél; E egy új avatar tényleges bejelentkezése.
- **Perzisztencia/hiba:** stable entry/account IDs és additive intent;
  a sikeres accountot nem töröljük vissza részleges hiba miatt; titok nem exportálható a receiptben.
- **Kockázat:** magas; account lifecycle, jelszó és holt személy újjászületése.

### SI-D02 – Az új avatar megélhetési indulása és enrollmentje

- **Státusz/típus/prioritás:** [ ] KIEGÉSZÍTÉS; P1; G06/G08, POP/RUNTIME/PROFILE.
- **Cél és indok:** a megjelenő karakter saját életutat indítson, ne mikromenedzsmentet igényeljen.
- **Meglévő:** genesis/attribute/skill knowledge/goals/grants, SI-A livelihood és SI-B
  stratégia; a régi entry szándékosan nulla vagyon/skill/cél/enrollment.
- **Módosítás:** verziózott arrival-start policy profile/needs, minimális tanulási
  és állapotcél, jogszerű kezdőmunka/hozzáférés; csak explicit starter allocation
  vagy már igazolt öröklési receipt. Enrollment külön végső readiness-lépés.
- **Modulok:** population entry, character-attributes, needs, agent-state/
  agent-skills knowledge, genesis/provenance és autonomy admission.
- **Függőség:** SI-D01, SI-C01, SI-B03.
- **Elfogadás:** új avatar saját első belső jövedelmet és food-fogyasztást ér el;
  a régi agent emléke/tudása nincs lemásolva; legfeljebb egyszeri starterérték;
  ismertté nem tett, globális catalogskillt nem használhat.
- **Tesztek:** U starter policy; I activation→needs/profile→goal→grant→enrollment,
  hiányos policy/anyag és retry; E első saját work/food cycle.
- **Perzisztencia/hiba:** starter receipt külön a későbbi örökléstől;
  részleges readiness nem indíthat skilleket; legacy entrant migráció explicit.
- **Kockázat:** magas; ingyen tudás/vagyon, dupla bootstrap és nem fenntartható belépési költség.

### SI-D03 – Korlátos demográfiai utánpótlási policy

- **Státusz/típus/prioritás:** [ ] KIEGÉSZÍTÉS; P1; G06, POP/CLOCK.
- **Cél és indok:** a társadalom ne csak kézi, pause-olt batch által pótolja a kiesőket.
- **Meglévő:** bounded admission, 8/batch, 64 active, 256 lifetime limit,
  death és workforce metrikák; ezek guardok, nem mért skálakapacitás.
- **Módosítás:** forráskötött demográfiai trigger és rate/carrying-capacity
  policy; az entry admission meglévő pause-szerződésének rövid, biztonságos
  checkpoint-admissionné alakítása vagy ütemezett controlled batch. Nem globális
  adminloop és nem a limitek csendes megkerülése.
- **Modulok:** population entry/membership, simulation-clock boundary,
  gateway event admission, SI-D01/D02 aktiválás.
- **Függőség:** SI-D02.
- **Elfogadás:** egy kiesés nem vált ki többszöri belépőt; erőforrás- és
  policykorlát felett nincs spawn; lifetime limit elérése explicit exhausted;
  belépő személynek új identity/lifecycle, megfigyelt ok és starterköltség tartozik.
- **Tesztek:** U trigger/limits; I párhuzamos death/entry, clock safe point,
  restart és admission conflict; E SI-D07.
- **Perzisztencia/hiba:** durable trigger→batch→activation-kötés;
  reset/death nem tölti vissza jogosulatlanul az élettartam-admission keretet.
- **Kockázat:** magas; clock-pause gazdasági torzítás, kontrollálatlan népesség/infláció.

### SI-D04 – Személyes GP és item hagyatéki átadása

- **Státusz/típus/prioritás:** [ ] KIEGÉSZÍTÉS; P1; G07, POP/ECON.
- **Cél és indok:** a személyes Property öröklése mellett a használható vagyon is folytonos legyen.
- **Meglévő:** verified death, nyolc domain custody, admin single-heir Property
  policy, memory archive; készpénz/inventory és adósságrendezés nem teljes.
- **Módosítás:** egy kijelölt élő heir számára cash/item asset-adapterek a
  meglévő estate-ben; követelések/bér/loan/escrow/szankció elsőbbsége explicit
  policyval, vitás elem blocked. Új needs/custody állapotokat is felvenni a source coverage-be.
- **Modulok:** population-estate source/schema/inheritance, engine canonical
  checkpoint/inventory/bank, treasury/contract/bank/justice guardok.
- **Függőség:** SI-D02, SI-C04.
- **Elfogadás:** nincs elosztható vagyon fedezetlen claim mögött; donor death
  függetlenül hiteles; személyes cash/item egyszer jut élő heirhez; Business-
  treasury nem személyes hagyaték. Property meglévő útja megmarad.
- **Tesztek:** U asset/claim priority; I engine+estate reopen, debt/collateral/
  pending reward és part-transfer crash; E egy halál utáni valós heir-inventory egyezés.
- **Perzisztencia/hiba:** versioned source adapters és custody receipts;
  partial distribution forward recovery, sourcehiány nem nulla vagyon;
  személyes memória nem automatikus inheritance.
- **Kockázat:** nagyon magas; követelések elvesztése, több store és save atomitásának félreértése.

### SI-D05 – Business-tulajdon és vezetői authority utódlása

- **Státusz/típus/prioritás:** [ ] KIEGÉSZÍTÉS; P1; G07, POP/ECON/RUNTIME.
- **Cél és indok:** az alapító halála ne állítsa le szükségszerűen a teljes ellátási funkciót.
- **Meglévő:** Business külön jogi actor, employment/policy/treasury és deathkor
  dormant custody. Leadership/equity succession nincs.
- **Módosítás:** egy előre kijelölt successor/manager policy, külön owner és
  execution-authority; az aktív work/WIP/contract és treasury reservation
  megőrzése. Valid transfer után kontrollált resume, különben szabályos closure.
- **Modulok:** estate Business-adapter, business-manager/roles/ports,
  treasury/contract/WIP guards, institution enrollment.
- **Függőség:** SI-D04, SI-B04, SI-A06/A08.
- **Elfogadás:** founder death után a megfelelő successor kap jogot, más nem;
  a cég saját stock/pénze/szerződése megmarad; elhunyt személy jogai lezártak;
  legalább egy új valódi order folytatódik vagy explicit felszámolás indul.
- **Tesztek:** U successor/law gate; I running work és unsettled payment melletti
  halál/restart, successor is meghal; E SI-D07.
- **Perzisztencia/hiba:** immutable ownership/control transition, source adapter
  schema-version és fail-closed coverage; dormant nem kézi sorátírással oldódik fel.
- **Kockázat:** nagyon magas; intézményi vagyon privatizálása és elavult képviseleti jog.

### SI-D06 – Dinamikus kohorszok és generációs metrikák

- **Státusz/típus/prioritás:** [ ] KIEGÉSZÍTÉS; P1; G04/G06/G07, POP/METRICS.
- **Cél és indok:** az új belépő nem helyettesítheti észrevétlenül a meghalt alapító túlélési mutatóját.
- **Meglévő:** 23.10 demográfia, archived specialist loss, founding-cohort
  minimum és long-experiment roster kötés.
- **Módosítás:** admission→active→working, death/estate/heir és Business-
  continuity idővonal; kohorsz/person-time és adott időponti vagyon/szolgáltatás.
  Külön verziózott generációs run-protokoll dinamikus rosterrel, a founder
  benchmark változatlanul megőrizve; bevándorlás nem születés.
- **Modulok:** population-demographics, society-metrics/history,
  society-experiments cohort/source binding, estate/Business readers.
- **Függőség:** SI-D03, SI-D04, SI-D05, SI-C05/C06.
- **Elfogadás:** birth/admission/activation/death/reset külön; generációváltás
  mellett a founder-survival nem javul új belépőtől; equity/cash öröklés és
  szolgáltatáskiesés mérhető; ismeretlen birth/forrás explicit.
- **Tesztek:** U known/unknown/censored age és cohort; I két kohorszváltásból
  natív reader, history hiány és export/restore; E SI-D07.
- **Perzisztencia/hiba:** immutable membership/ownership event-referenciák;
  újraolvasás nem írja át a történelmi rosterscope-ot.
- **Kockázat:** közepes–magas; survivor bias és összemosott „generáció” fogalom.

### SI-D07 – Kétkohorszos folytonossági próba, SI-M4 kapu

- **Státusz/típus/prioritás:** [ ] TESZT/VÉGREHAJTÁS; P1; G05/G06/G07.
- **Cél és indok:** az első népesség leváltása után is működjön a társadalom.
- **Meglévő:** SI-C07 tartós gazdaság és SI-D01–D06 mechanizmusok;
  a régi Property-heir teszt nem e teljes forgatókönyv.
- **Módosítás:** bounded mortality/entry/inheritance terv legalább két
  kohorszváltással, saját generációs acceptance-szerződéssel és időprofilvalidálással.
- **Modulok:** normál runtime, population/estate/Business/metrics/benchmark;
  a halál nem LLM-akció, tesztinjektálás csak külön jelölt technikai fixture.
- **Függőség:** SI-D01–SI-D06.
- **Elfogadás:** aktív utódok termelnek/fogyasztanak; vagyon/claim/jog mérleg zár;
  egy intézmény az alapító nélkül valóban szolgáltat; zero resurrection/duplicate;
  megmarad az ellátási kapacitás vagy a veszteség okkal kimutatható. Csak teljes
  kritériumlista esetén PASS; két adminnal átnevezett bot nem kohorszváltás.
- **Tesztek:** U nem új; I gyorsított tesztclockos death→entry→heir→work és
  failure injection; E külön engedélyezett élő generációs terv, valós evidence.
- **Perzisztencia/hiba:** hosszú run és hibás részrun is archivált;
  dinamikus roster mellett is exact lifecycle/clock binding, ritka sourcegap megmarad.
- **Kockázat:** magas empirikus; időgyorsítás, szakembervesztés, zárolt vagyon felhalmozódása.

## 9. SI-E – intézmények és családi/társas kontinuitás

**Fázisbelépés: SI-D07.** Itt a Businessen túli közös döntési és tagsági
mechanizmusok készülnek. Komplex királyságpolitika és biológiai reprodukció P3,
nem előfeltétel az első öt mérföldkőhöz.

### SI-E01 – Általános organization/member/role integráció

- **Státusz/típus/prioritás:** [ ] KIEGÉSZÍTÉS; P2; G09, meglévő TASKS_LATER.
- **Cél és indok:** céh/klán/társulás ne csupán FactionKind címke legyen.
- **Meglévő:** Business-role, Faction/Jurisdiction, gazdasági actor és directed
  relationship; általános tagság/consent/representation csak backlog.
- **Módosítás:** egy korlátos, verziózott tagság- és képviseleti adapter,
  joining/leaving/removal, role grants és history. Business/Faction saját
  pénzügyét/tulajdonát nem másoljuk át egy új szervezetledgerbe.
- **Modulok:** organization/member/role kiegészítés, agent-state actor links,
  existing Business/Faction/Property/treasury adapters.
- **Függőség:** SI-D07, SI-D05.
- **Elfogadás:** két intézménytípus ugyanazt a tagsági invariánst használja;
  consent nélkül nincs beléptetés; kilépés/halál lezárja a jogot;
  idegen tulajdonhoz tagság önmagában nem jogosít; nincs CriminalFaction.
- **Tesztek:** U membership/role; I treasury/Property grant és revoke, egyidejű
  belépés/kilépés és reopen; E kis céh/társulás működése SI-E03-ban.
- **Perzisztencia/hiba:** additive membership history, stable actor IDs,
  source adapters változása az estate coverage-be bevezetve.
- **Kockázat:** magas; már meglévő organization-szerű domainek duplikálása.

### SI-E02 – Háztartás, rokonság és kijelölt családi utódlás

- **Státusz/típus/prioritás:** [ ] ÚJ, meglévő domainek kompozíciója; P2; G07/G09.
- **Cél és indok:** a felhasználói család/dinasztia célhoz explicit kapcsolatok és gazdasági következmények kellenek.
- **Meglévő:** relationship/affinity, tenancy, seedelt adult entry és single-heir
  estate; a bizalom nem rokonság vagy törvényes örökösi jog.
- **Módosítás:** együttélő háztartás és rokonsági/jogi utód külön; közös
  hozzájárulás/hozzáférés, eltartási és successor policy. Elsőként generált
  családi kapcsolat vagy kijelölt utód; reprodukció/pregnancy nincs e scope-ban.
- **Modulok:** organization adapter, agent-state social links, housing,
  population entry és estate legal-policy binding.
- **Függőség:** SI-E01, SI-D04/D05.
- **Elfogadás:** rokonság nélkül is létező háztartás; közös tulajdon nem
  megosztott korlátlan wallet; családi successor jogszerű, nem affinityből
  kitalált; a következő generáció eltérő profillal és explicit starterforrással indul.
- **Tesztek:** U relationship/household/law; I szétválás, halál, debt és öröklés,
  nem hozzájáruló tag; E kétgenerációs kis háztartási történet natív adatokból.
- **Perzisztencia/hiba:** immutable jogi/membership history, személyes emlék
  és semantic tudás csak a meglévő explicit transfer policy szerint mozog.
- **Kockázat:** magas; jogi, rokoni és érzelmi kapcsolat összemosása, scope túlburjánzása.

### SI-E03 – Közös intézményi cél, vezetőváltás és konfliktuskezelés

- **Státusz/típus/prioritás:** [ ] KIEGÉSZÍTÉS; P2; G07/G09, ECON/RUNTIME.
- **Cél és indok:** az intézmény célja, vezetése és fennmaradása ne egy alapító scripted döntése legyen.
- **Meglévő:** institution planner SI-B04, Business successor SI-D05,
  membership SI-E01 és existing policy/commitment/treasury.
- **Módosítás:** egy egyszerű vezetési szabály (kijelölt képviselő vagy korlátos
  szavazás), közös célból jogos munkakiadás, egy konfliktus/exit/dissolution út;
  szervezeti knowledge access és tagprivacy külön.
- **Modulok:** organization governance adapter, institution goal/control,
  Business/Faction ports, treasury/Property és social memory.
- **Függőség:** SI-E01, SI-E02, SI-B05.
- **Elfogadás:** közös célból valós teljesítés; visszautasító tag nem kényszerül;
  vezetőhalál/kilépés után új képviselet vagy szabályos megszűnés; nincs
  újraírt múlt, magánvagyon konfiskálása vagy treasury-duplication.
- **Tesztek:** U döntési/quorum policy; I konfliktus→revoke/claim→új képviselő,
  restart; E három eltérő érdekű actor közös szervezete, SI-M5 elfogadási trace.
- **Perzisztencia/hiba:** stable proposal/vote/decision ID és egyeztethető
  authority transition; bizonytalan mandátummal nincs pénzügyi végrehajtás.
- **Kockázat:** magas; intézményi jogok és önálló agentérdek összeütközése.

## 10. SI-F – emberrel kompatibilis platform és ellenőrzött skála

**Fázisbelépés: SI-E03.** A közös actor/world/authority szabály már az SI-A
adaptereknél érvényes; itt a tényleges emberi belépés és részvételi út készül.
Az admin UI-paritás nem használható játékosjogi acceptance helyett.

### SI-F01 – Emberi actor és játékosjogú domain-authority

- **Státusz/típus/prioritás:** [ ] KIEGÉSZÍTÉS; P1; G10, PLATFORM/RUNTIME.
- **Cél és indok:** embernek ne kelljen AI-agentként vagy adminként belépnie a gazdaságba.
- **Meglévő:** vanilla account/player, actor-identity boundary, player-only witness,
  bothoz kötött player control profile és szerverenkénti admin-auth.
- **Módosítás:** hiteles account→persistent economic actor/lifecycle binding,
  AI enrollment nélkül; gameplay session a közös typed service-ekhez exact
  world/actor/role authorityt adjon. A controller személye külön az asset ownerétől.
- **Modulok:** engine/player session binding, gateway gameplay auth/actor adapter,
  contract/work/housing/organization service authorization.
- **Függőség:** SI-E03, SI-D05.
- **Elfogadás:** ember és AI ugyanazt a domaininvariánst éri el; más account/
  world vagy adminjog nem szerezhető; human actor létrehozása nem ad LLM-budgetet,
  agentmemóriát vagy automatikus kontrollátadást.
- **Tesztek:** U authority/identity; I session→service→engine és cross-world/
  revoked-session/forged-actor negatív esetek; E SI-F02.
- **Perzisztencia/hiba:** meglévő account/actor azonosítók, no duplicate wallet;
  identity migration és visszavonás meglévő vagyont/claimet nem töröl.
- **Kockázat:** magas; új többdomaines auth-határ és az AI-kontroll implicit engedélyezése.

### SI-F02 – Emberi megélhetési és intézményi workflowk

- **Státusz/típus/prioritás:** [ ] ÚJ input/UI-integráció; P1; G10, PLATFORM.
- **Cél és indok:** valós játékos ugyanabban a társadalomban dolgozzon és éljen.
- **Meglévő:** közös engine, adminfelületi contract/Business/housing nézetek;
  a SI-A–SI-E service-ek kész gazdasági végrehajtási határai.
- **Módosítás:** egy szűk játékosút: ételvétel AI-tól → munkaajánlat elfogadás
  és teljesítés → bér → bérlet → szervezeti csatlakozás/kilépés.
  Elsőként meglévő content/interface/HTTP adapter, új protokoll csak bizonyított szükségre.
- **Modulok:** player/content vagy webclient gameplay UI, közös domain services,
  player session adapter; nem új adminplatform és nem külön human economy.
- **Függőség:** SI-F01.
- **Elfogadás:** normál account adminjog nélkül végigviszi az utat; az AI
  ugyanazon stock/treasury/slots körből gazdálkodik; látható pending/success/
  failure; másik fél consentje és fizikai receipt továbbra is kötelező.
- **Tesztek:** U input/format; I API/content→same service contract negatív
  jogokkal; E valódi vanilla ember + AI, két account és közös mérleg.
- **Perzisztencia/hiba:** disconnect és dupla submit ugyanazon intentet
  követi; nincs „UI siker” engine nélküli állapotban vagy automatikus módosító retry.
- **Kockázat:** közepes–magas; a UI megkerüli az authorityt vagy elrejti a részleges végrehajtást.

### SI-F03 – Emberi offline/alvás/delegáció szabályparitás

- **Státusz/típus/prioritás:** [ ] KIEGÉSZÍTÉS; P1; G10, FOOD/PLATFORM.
- **Cél és indok:** logout ne adjon ingyen fennmaradást vagy kéretlen LLM-kontrollt.
- **Meglévő:** PlayerTime és offline needs-rate policy, SI-A10 sleep, finite life;
  opcionális offline-delegated vízió külön consenttel.
- **Módosítás:** world-profileba kötött human offline/sleep/mortality szabály és
  visszatérési tájékoztatás. Elsőként passzív/offline és in-world alvás;
  delegáció csak opt-in, exact skill/grant/idő/kiadás/veszélyhatárral.
- **Modulok:** needs/clock/player-time, session/controller admission,
  agent-state optional delegation és gameplay UI.
- **Függőség:** SI-F01, SI-F02, SI-A10.
- **Elfogadás:** offline állapot, alvás és delegated mode külön; világ nem áll
  meg; visszatérő user kontrollátvétele rendezett; revoked delegation nem
  indít új munkát; elhunyt emberi avatarra is ugyanaz a finite policy érvényes.
- **Tesztek:** U idő/mode/consent; I offline intervallum, lease és controller
  konfliktus/restart; E elalvás→logout→return, majd korlátos delegáció opt-in/ki.
- **Perzisztencia/hiba:** consent/policyversion és korlátok tartósak,
  hiányukból nem következik felhatalmazás; existing in-flight commit egyeztetendő.
- **Kockázat:** magas; offline büntetés/balansz, kettős controller és hozzájárulás elvesztése.

### SI-F04 – Kapacitásmérés és kizárólag mért bottleneck optimalizálása

- **Státusz/típus/prioritás:** [ ] KIEGÉSZÍTÉS; P2; G11, PLATFORM/METRICS.
- **Cél és indok:** a száz/ezer actor cél tényleges költség- és működési korlátokat kapjon.
- **Meglévő:** soros inference queue/backlog100, lease/fairness/budget,
  per-avatar processz, 64/256 population guard és SI-C05 telemetria.
- **Módosítás:** pinned gép/workload/profil mellett 10/50/100 actor mockos
  terhelés; queue wait/service, p95 wake-up, CPU/RAM, DB lock, fairness és
  költség. Ezután külön kis budgetes providerpróba. Mérési eredményből külön
  bounded patch: pl. incremental scan vagy korlátozott inference concurrency.
- **Modulok:** existing runtime/queue/supervisor/metrics/benchmark;
  population-limit módosítása külön migration/config döntés, nem tesztkihagyás.
- **Függőség:** SI-C05, SI-C06, SI-F03.
- **Elfogadás:** előre számértékekkel rögzített workload/SLO mellett nulla
  duplikáció és elveszett wake-up; bounded fairness és budget; limitérési
  viselkedés kimutatott. Ezer actor készültséghez ezerre külön bizonyíték kell.
- **Tesztek:** U patch-specifikus; I determinisztikus terhelés és recovery;
  E valódi avatarterhelés és providerpilot csak konkrét erőforrás-/költségtervvel.
- **Perzisztencia/hiba:** overload nem dobhatja el az authoritative intentet;
  backlog/retry külön metrika, aktív limit nem módosul magától a mérés kedvéért.
- **Kockázat:** mérés közepes, optimalizálás méréstől függ; korai cluster-újraírás kerülendő.

### SI-F05 – A meglévő 24.8 kontrollprogram és platformelfogadás

- **Státusz/típus/prioritás:** [ ] MEGLÉVŐ NYITOTT FELADAT VÉGREHAJTÁSI BONTÁSA;
  P2; G05/G08/G11, aktív 24.8. Nem új párhuzamos kísérleti backlog.
- **Cél és indok:** mechanizmusokból kialakuló jelenségeket hasonlítsunk össze,
  ne a mock vagy implementációs hiba mellékhatását nevezzük társadalmi hatásnak.
- **Meglévő:** 24.8 hat tengelye, controller/comparison/archive, natív XP
  részattesztáció, és e tervben már működő társadalmi változók.
- **Módosítás:** tengelyenként külön véges run-plan: (1) attributes/potential,
  (2) diminishing XP, (3) facility-előny, (4) blank/seeded/burn-in genesis,
  (5) housing/needs szigor, (6) mortalitás/kontroll; egy terv egy tengely,
  előre regisztrált metrika/seedpár/ablak/költség/stop és bizonytalanság.
- **Modulok:** existing society-experiments és natív metrics/profile adapters;
  eredeti taskhatás és új SI-M6 platformeredmény külön verdict.
- **Függőség:** SI-C06, SI-C07, SI-C08, SI-D07, SI-E03, SI-F02, SI-F03, SI-F04.
  Az egyes korábbi kezeléspárok a 12. fejezet részkészültségi szabálya szerint előrehozhatók.
- **Elfogadás:** minden tengelynek van valódi engine/domain enforcementje és
  azonos érvényes baseline/protokoll; sikertelen/contaminated run is megmarad;
  output újraolvasható, hatásméret/lefedettség/korlát közölve. Egy pár nem
  általános oksági bizonyíték; összpontszám nem fedheti el a túlélési bukást.
- **Tesztek:** U comparison invariánsok; I confounded baseline/missing source
  elutasítás; E a hat terv külön elfogadott tényleges futása, majd human+AI platformpróba.
- **Perzisztencia/hiba:** baseline és result manifest explicit kötés;
  nincs eldobott negatív arm, sem korábbi fájlból utólag gyártott történelem.
- **Kockázat:** magas empirikus/költség; paramétertengelyek összekeverése és hamis reprodukálhatóság.

## 11. Az első integrált demonstráció végrehajtási protokollja

Ez az SI-A15 eredeti, történeti v1 D1 acceptance specifikációja; nem az
aktuális fejezetstátusz vagy SI-B fejlesztési belépési kapu. A v2 technikai
lezárás és a hiányos autonóm eredmény a [végső csomagban](SI_A15_TECHNICAL_RESULT.md)
olvasható. A v1 küszöbök megőrzése nem jelenti teljesülésüket.

### 11.1. Szereplők, készletek és mérleg

Négy önálló avatár és egy avatar nélküli konyhai Business. Mind a négy eszik
és szükségleteket kezel. A gyűjtő nyers ételt ad el; a szakács feldolgoz;
a futár kereskedelmi átadást végez; a szállásadó férőhelyet biztosít és
bérleti jövedelemből fogyaszt. A konyha beszerzést és két igazolt munkadíjat
fizet, ételértékesítési bevétele van. Egy actor több Skill[] képességet ismerhet.

Indulás előtt a konkrét terv számmal rögzítse:

- avatar/account/actor/lifecycle/world ID-k, kezdeti pozíciók és személyes skillek;
- verified procedure-ref/checksum, ismert skill, jogos partner/quantity/árgrant;
- konyhai és személyes GP, raw/cooked/tool mennyiségek, WIP/custody helyek,
  valódi elérhető férőhelyek és initial needs/remainderek;
- harvest/regen limit, inputanyagok, nyersanyagár, bérek, ételár, rent és
  kötelezettségidők; az új anyag forrása és a cég fizetési runway-ja;
- 1:1 clock/profile/policy, ablak, stop/budget és mi számít külső értéknek.

A pénzáram ex ante ellenőrizhető: belső GP-transzferek összege nulla;
záró GP = nyitó + igazolt forrás − elnyelő + nettó külső mozgás.
Itemenként nyitó + natív termelés − inputfelhasználás − fogyasztás ± átadás
= záró, a Business/WIP/avatar/in-transit helyek együtt, duplikáció nélkül.
Az átalakulást recept/lineage magyarázza, nem összesített itemdarabszám-egyezés.

Nincs végtelen NPC-payout/restock, szabad admin item-/coinadás, sourcegap
utólagos kitöltése vagy elrejtett második controller. A bootstrap készétel
fogyasztható túlélési tartalék, de nem teljesíti az előírt belső termelési láncot.
M1 nem követel teljes többnapos gazdasági egyensúlyt; a veszteséget kimutatjuk.

### 11.2. D0 automatikus acceptance → D1 élő futás

1. **D0:** SI-A14 valamennyi hibás és kedvezőtlen esetét végigfuttatni, a
   perzisztens source-okat újranyitva. Fake fizikai adapter eredménye külön
   technikai scope; valós engine checkpoint próba is kötelező.
2. **Preflight:** SI-A13 exact baseline/cash/input/grant/skill/facility/path/
   férőhely/needs binding, native readers és clean controllers ellenőrzése.
   A hosszú benchmark minimumát nem rövidítjük le a demo kedvéért: a 90 perces
   D1 a meglévő fixture/runner/acceptance toolinggal külön rövid protokoll.
3. **D1:** 60–90 perc, maximum 90 perc falióra, normál 1:1 időprofil,
   determinisztikus policy, **0 LLM/providerhívás**. A rutinok saját eseményre
   folytatódnak; ez SI-M1 mechanikus autonómiája, nem SI-M2.
4. **Első rész:** raw termelés→fizikai cooking→custody/sale→fogyasztás,
   bér és rent; minden lépés source-receiptje bekerül az acceptance bundle-be.
5. **Tervezett restart:** körülbelül félidőben engine+gateway újraindítás,
   actoronkénti kézi céladás/újraindítás nélkül. Egy in-flight intentet tudatosan
   megőrizni, és ugyanazzal az ID-val végigkövetni.
6. **Negatív szakasz:** előre rögzített ideig nincs raw input vagy nem
   elérhető a szállító; egy vevő fedezete/egy slot kapacitása kevés.
   A rendszer bounded módon vár/tilt, majd a fennakadás megszűnése után folytat.
   E szakasz nem bizonyít LLM-es foglalkozásváltást.
7. **Utóellenőrzés:** rendezett írók/függő munkák mellett archive/result,
   readonly inventory/GP/needs/projection egyeztetés és új könyvtáras riportolás.

### 11.3. SI-M1 elfogadási és bukási feltételek

| Követelmény | Kötelező bizonyíték |
| --- | --- |
| Valós véges erőforrás | A rögzített harvest/input/GP/stock keret betartott, kimerülése látható; nincs korlátlan fallback |
| Termelés | Native raw-input és cooked/burnt output, összekötött WIP/custody |
| Kereskedelem/tulajdon/pénz | Legalább három külön vevő–eladó viszony, pontos item és GP receipt, legalább egy bér és egy rent |
| Fogyasztás | Mind a négy avatar legalább két valódi fogyasztása, legalább egy-egy futásban belsőleg termelt/feldolgozott ételből; clampelt natív relief |
| Kölcsönös függőség | Legalább két külön actor-közi final-use függőség; nem négy self-sufficient bot |
| Szükséglet | Teljes observed-demand nevező és legalább 95% satisfied-demand az ablakban; minden kritikus/blocked idő látható |
| Kedvezőtlen eset | Natív input/fedezet/kapacitáshiány, nincs hamis completed vagy inventált étel/pénz |
| Restart | A jogosult aktív actorok 5 percen belül folytatnak vagy hiteles blocked állapotban vannak; blocked nem termelési siker |
| Konzisztencia | Nulla megmagyarázatlan inventory/GP/custody/needs eltérés; domain completed ↔ natív commit + domain-applied |
| Megőrzés | Exact run/intent/decision/skill/receipt/settlement/manifest ID, intervenciólista, ugyanaz az újraolvasott riport |

Az ötperces restartablak és a fogyasztási szám előzetes preflighttal igazolandó
demo-küszöb; nem a korábbi society-minimum átírása. Ha az útvonal vagy az
időarány nem tudja teljesíteni, a tervet indulás előtt kell javítani, nem a
futási eredményt utólag átminősíteni.

**Azonnali stop/FAIL vagy érvénytelen run:** nem tervezett értékinjekció,
source/clock/config drift, dupla vagy hamis receipt, idegen világállapot,
bizonytalan custody továbbengedése, költség/időlimit túllépés, tartósan
ellátatlan kritikus szükséglet, elhallgatott kézi segítség. A fail-closed
leállás helyes biztonsági működés lehet, de nem a társadalmi demo sikere.

### 11.4. SI-M2 stratégiai próba külön sikerszintje

A v1 tervben SI-M1 utánra tervezett SI-B06 próba: legalább két valós megélhetési lehetőség,
egy ténylegesen megszűnő bevételi forrás, egy raw-hiány és egy új partnerlehetőség.
A szükségletkezelés továbbra is determinisztikus. A provider/model/prompt és
a pénzplafon előre rögzített; javasolt felső határ **24 valódi providerkérés**
az egész rövid próbára, max. egy új stratégiai kérés/actor/15 perc.
A konkrét pénzkeret a futási terv kötelező döntése, nem e dokumentum költési engedélye.

Külön három verdict: **operatív végrehajtás**, **önálló stratégiai választás**,
**megélhetési outcome**. Érvényes, mégis veszteséges LLM-stratégia nem hamis
adat, de nem sikeres fennmaradás; a tervben elfogadott outcome-küszöb marad mérvadó.
Scripted providerrel a technikai stratégiaút tesztelhető, a valódi LLM döntési
és költségpróba enélkül `not-tested`.

## 12. Kritikus függőségek, részeredmények és lefedettség

### 12.1. Ajánlott megvalósítási sorrend

```text
SI-A01 native consume receipt
  ├─ SI-A02 native raw/cooking
  └─ SI-A03 needs-store → SI-A04 consume→needs
SI-A02 + SI-A04 → SI-A05 actor-közi lineage
  → SI-A06 custody/WIP → SI-A07 verified eljárások
  → SI-A08 work/bér és SI-A09 eladás/beszerzés
SI-A09 → SI-A10 rent/alvás
SI-A04/A07/A08/A09/A10 → SI-A11 rutin-runtime
SI-A04/A05/A08/A09/A10 → SI-A12 natív riport
SI-A11 + SI-A12 + gazdasági adapterek → SI-A13 fixture
  → SI-A14 negatív/restart teszt → SI-A15 SI-M1
  → SI-B01 esemény/context → SI-B02 állapotcél
  → SI-B03 player-stratégia és SI-B04 institution-stratégia
  → SI-B05 együttműködés → SI-B06 SI-M2
  → SI-C01–C06 actual profile/tool/history/baseline → SI-C07 SI-M3
     └─ SI-C08 tényleges facility-előny (külön ág)
  → SI-D01–D06 aktív entry/utódlás/generációs mérés → SI-D07 SI-M4
  → SI-E01–E03 tagság/háztartás/közös döntés → SI-M5
  → SI-F01–F04 emberi részvétel/offline/mért skála
  → SI-F05 hat kezeléstípus és SI-M6 platformelfogadás
```

A rajz a kritikus utat tömöríti; a taskok **Függőség** mezője tartalmazza az
összes konkrét előfeltételt. Az azonos csomagon belüli kapcsolódó teszt nem
számít körkörös taskfüggőségnek. Taskot felbontani megengedett, de elődje
ID-ját és acceptance scope-ját meg kell őrizni, új funkciót nem lehet DONE-ként örökölni.

Az SI-F05 teljes lezárása minden függőségét igényli. Az eredeti 24.8 munka
nem vár szükségtelenül a teljes emberi UI-ra: SI-C07 után egy-egy **részterv**
végrehajtható, ha a hozzá szükséges tengely valóban működik, az SI-C06 baseline
és natív metrikák készek. Attribute: SI-C01; facility: SI-C08; housing/need:
SI-A03/A10; mortality: SI-D06/D07 szerinti megfelelő kohorszprotokoll;
genesis/burn-in: változatlan érvényes indulóállapot; XP: a meglévő natív kapuk.
Egy részterv nem zárja le az SI-F05-öt vagy mind a hat eredeti összehasonlítást.

### 12.2. Audit-gap → konkrét task

| Audit/roadmap gap | Végrehajtási hely |
| --- | --- |
| G00 / R12 követhetőség | SI-A12/A14/A15 acceptance, minden task közös 3.3. lezárása; meglévő 15.1 folytatás |
| G01 fizikai életfenntartás | SI-A01–SI-A07, SI-A10/A11 |
| G02 stratégiai autonómia | SI-B01–SI-B06; SI-A11 csak operatív alap |
| G03 gazdasági/intézményi integráció | SI-A06/A08/A09, SI-B04/B05, SI-C02/C03/C08 |
| G04 natív mérés | SI-A12, SI-C04/C05/C06/C08, SI-D06 |
| G05 működési/kísérleti bizonyítás | SI-A14/A15, SI-B06, SI-C07, SI-D07, SI-F05 |
| G06 utánpótlás | SI-D01/D02/D03 |
| G07 vagyon és intézményi utódlás | SI-D04/D05/D07; SI-E02/E03 |
| G08 egyéni különbségek | SI-B01/B03/B06, SI-C01/C05, SI-F05 |
| G09 társadalmi szerveződés | SI-E01/E02/E03 |
| G10 emberi kompatibilitás | A fázistól közös actor authority; SI-F01/F02/F03 |
| G11 skála/költség | SI-C05 és SI-F04 |

Nem duplikált új feladat: a már működő bank/hitel, justice/provenance,
property-purchase, world-mod lifecycle, verified publikálás, queue és admin-
control plane. Ezek szükséges source/adapters/tests az egyes taskokban.
Újranyitásuk csak konkrét hibabizonyíték esetén, a saját eredeti taskjukhoz
rendelt indokkal történhet; a történeti PASS nem garantál új integrációt.

A society-evaluation tíz dimenziójából a survival/needs/food/housing/labor/tool
források SI-A12/C07, wealth/mobility/prices SI-C04, foglalkozás/döntés/hálózat
SI-C05, generáció SI-D06, commissioning/investment SI-C08 alatt bővülnek.
A bűnözési natív facade teljes incidenciája továbbra is coverage-kötött:
a meglévő crime-metrics csak igazolt megfigyelést számíthat; nem állítunk teljes
áldozati incidenciát új, megfelelő exposure-forrás nélkül. Ez nem teszi szükségessé
egy új crime-fázis első demo elé helyezését. A tízdimenziós teljes natív PASS
csak minden dimenzió megfelelő adatával állítható, nem automatikusan SI-M6-ból.

## 13. Tervezési döntések és munkakezdési alapválasztások

Az alábbi alapválasztások az eredeti tervet rögzítik. A DEC-05 régi 1:1/90
perces feltevését az új profilokra az SI-A15 napalapú szabálya és v2 technikai
protokollja váltotta fel; a fejezet státuszát az 1., 5. és 6. rész adja.
Alternatívára
váltáskor a döntési indokot és az érintett taskot kell rögzíteni; a meglévő
audit/roadmap szövegét ehhez nem kell visszamenőleg átírni.

| ID / döntés | A terv alapválasztása | Nyitott alternatíva / döntési pont |
| --- | --- | --- |
| DEC-01 food | Elsőként existing lobster gathering, cooked 377→379; SI-A02 exact recipe és bounded forráskeret | Ha a natív út/precondition túl költséges: shrimp 317→315 verziózott food-chainnel és gathering eljárással. SI-A01 kis local fixture-rel elkezdhető; nincs több élelmiszerpár egy taskban |
| DEC-02 durable boundary | Existing canonical Player/checkpoint authority új evidence-alakja; nincs második avatar-inventory store | Ha a jelenlegi határ nem tud consume/cooking commitot együtt tartósítani, az SI-A01 ezt célzott patchben pótolja és teszteli; nem admin save-edit kerülőút |
| DEC-03 needs-authority | Domain-owned needs-state, a meglévő food-ledgerrel közös typed atomic receipt-apply határ, egy writer | Konkrét fizikai DB/connection kialakítás SI-A03 implementation döntése; két független canonical hunger store nem elfogadható |
| DEC-04 árak és cég | Egy konyha, fixed bounded ár, véges stock/treasury; SI-A11 determinisztikus manager | Adaptív ár és intézményi stratégia SI-B04; teljes order-book/komplex hitel nem SI-M1 |
| DEC-05 idő | SI-A15 normál 1:1, max. 90 perc; hosszú SI-C07 meglévő 1+7 napos minimum | Gyorsítás előtt engine-munka/needs/aging arány tesztelendő; egy rövid demo nem hosszú society acceptance |
| DEC-06 szükséglet/offline | Existing policy, explicit awake/sleep/offline/dead állapot; critical self-care determinisztikus | Human offline szigor és opt-in delegation SI-F03 döntése; korai adapter nem kódolhat kizárólag botokra működő szabályt |
| DEC-07 utánpótlás/öröklés | Seedelt felnőtt arrival, egy kijelölt élő heir/successor, külön személyes/céges vagyon | Több heir, végrendelet, reprodukció és teljes dinasztiajog későbbi bővítés; adósság nem tűnhet el egyszerűsítés címén |
| DEC-08 LLM | SI-M1 0 hívás; SI-B06 mock után valódi, ritka stratégia, max. 24 requestes rövid próba | Konkrét provider/model/pénzplafon a jövőbeli futási tervben, tényleges konfiguráció alapján; e dokumentum nem autorizál költést |
| DEC-09 „jó társadalom” | Metrikavektor és célonkénti verdict; nincs összpontszám | Gazdasági egyenlőség, szabadság, innováció és biztonság súlyozása külön termékdöntés |
| DEC-10 skála | Előbb 10/50/100 mock- és avatarprofil mérése, meglévő limitet tiszteletben tartva | Célhardver, SLO, száz/ezer teljes avatar vagy vegyes absztrakció SI-F04 előtt konkrétan rögzítendő |

Azonnali munkakezdést csak konkrét hiányzó jogosultság/forrás akadályozhat.
Az SI-A01 a kiválasztott cooked fooddal és egy temp karakterfixture-rel
végrehajtható; nem kell hozzá új társadalmi balansz, hosszú run vagy LLM-kulcs.

## 14. Az első implementációs munkamenet pontos scope-ja

**Az eredeti terv első implementálandó taskja: SI-A01.** Aktuális státusza
a tasknál és a progressben követhető. Kimenete egy natív, idempotens,
inventory-commit mellé tartósított fogyasztási receipt és a hozzá tartozó
engine-határteszt. Nem része a needs-state tárolása, hunger-relief, új
stratégiai planner, négyavatáros futás vagy teljes recipe-keretrendszer.

Munkamenet-indító ellenőrzőlista:

1. AGENTS.override és engine/content útvonalak; exact consume script/handler
   és Player/checkpoint persist-határ azonosítása, meglévő shared authority
   migrációs állapotának ellenőrzése. A kódszimbólumokat a munkakezdéskor újra ellenőrizni.
2. Egy cooked food, egy world/actor/lifecycle és action-ID szerződés;
   kanonikus before/after és mi számít ténylegesen végrehajtott consume-nak.
3. Engine-oldali natív evidence/checkpoint patch; readonly lookup; nincs
   caller-uploadolt „hiteles” receipt vagy inventory másolata a gatewayben.
4. U/I crash, retry, wrong actor, full/no-use outcome és reopen; egy bounded
   helyi smoke csak ha a temp tesztek után indokolt és a célvilág biztonságos.
5. A módosított gazdasági persistence-határ miatt a repository policy szerinti
   teljes regresszió egyszer, előre megnevezett indokkal; érintett engine/root
   typecheck és content build, ha a script/opcode módosult. Webclient csak
   megváltozott protokollnál. Az eredmény exact log ID-val kerüljön a követésbe.

Az SI-A01 után a következő függő feladat SI-A02 vagy SI-A03; egy munkamenet
nem kezdheti el automatikusan az összes további taskot. Az eredeti
dokumentumkészítési kérésben az implementáció indítása nem volt benne;
a későbbi implementációs kérés eredményét a progress rögzíti.

## 15. Dokumentumellenőrzés és megőrzött korlátok

Ez a terv az audit bizonyítékaira és célzott forrásellenőrzésre épül;
nem új runtime-audit. A korábbi technikai teszteredmények nem az itt
leírt még meg nem valósított taskok PASS-ai.

Kötelező dokumentumellenőrzés: egyedi taskazonosítók, minden task kötelező
mezője, létező és körmentes függőségek, mérföldkőkapuk helyes sorrendje,
G00–G11 megfeleltetés, helyi Markdown-linkek és formázás. Dokumentációs
változtatás miatt runtime teszt/typecheck/full regresszió most nem fut;
a tervezett későbbi ellenőrzések scope-ját a taskok rögzítik.

Elvégzett első dokumentumellenőrzés: **PASS**, 44 egyedi task, taskonként
10 kötelező mező, 138 konkrét függőségi él, kör és előrefüggés nélkül;
mérföldkőkapuk helyesek. Mind a 29 helyi Markdown-hivatkozás létezik,
G00–G11 lefedett, a formázás megfelelő. Wrapper:
`20261018-141057-657-society-integration-task-document`, exit 0, **1,479 s**.
A későbbi szövegpontosítás a HP és nutrition eltérő jelentését is explicit
feladattá teszi; kód nem változott. A korábbi tasklisták tracked diffje üres.

Végleges dokumentumellenőrzés: `20261018-141240-687-society-integration-task-document-final`,
**PASS, exit 0, 1,267 s**; 44 task × 10 kötelező mező, 138 függőségi él,
29 létező helyi link, 0 szerkezeti/feloldási/formázási hiba. A vizsgálat
ellenőrizte, hogy SI-M1 nem függ a stratégiai fázistól, és a P2 facility-ág
nem blokkolja SI-M3-at. Forráskód és korábbi dokumentum nem változott;
új runtime-funkció vagy élő futás nem készült, commit/push nem történt.
