# Társadalomszimuláció – roadmapjavaslat

Állapotdátum: 2026-10-18. Baseline: `2df0daad86c6568a3e1f0e62f58f09aa3cd955de`.
Kapcsolódó bizonyítékok: [SOCIETY_VISION_AUDIT.md](SOCIETY_VISION_AUDIT.md).

**Auditból levezetett javaslat, nem elfogadott roadmap.** A meglévő TASKS-,
VISION- és progress dokumentumok, illetve taskstátuszok változatlanok.

Ajánlott következő szakasz: **„Társadalmi működési integráció és első belső
megélhetési lánc”**. A már vállalt működési ellenőrzést és a 15.1 nyitott
nyomonkövetést szolgálja. Új fázisszámot csak közös elfogadás után kapjon.
Az első cél négy egymásra utalt actor valós termelés–csere–fogyasztás köre,
egy fennakadással és restarttal. A hosszú 24.8 kezeléspárok ezt követik.

Az audit legfontosabb tanulsága: az autonomy supervisor, treasury, memory,
estate és benchmark újbóli megírása nem indokolt. Hiteles adapterekre és
összefüggő normál működésre van szükség, amelynek eredménye natívan mérhető.

## 1. Követési és prioritási elvek

A [TASKS.md](TASKS.md) marad az egyetlen aktív feladatlista. A további munka
beillesztése a meglévő 15.1 és 24.8 feladatokhoz, illetve az auditban bizonyított
új hiányokhoz történjen. Már elkészült rendszert nem tervezünk újra pusztán
azért, mert egy régi dokumentumban hiányként szerepel.

Minden későbbi csomag jelöli: ÚJ / KIEGÉSZÍTÉS / ÁTALAKÍTÁS / ÚJRANYITÁSI
JAVASLAT, prioritás, függőség, kockázat és mérhető elfogadási feltétel.
P0 = fundamentális; P1 = az első teljes társadalomhoz kritikus; P2 = mélység
vagy skála; P3 = hosszú távú bővítés. A prioritás nem hibasúlyossági ítélet.

## 2. Célmérföldkövek

1. **Minimum Viable Society:** kis, tartós, önállóan cselekvő közösség,
   belső megélhetési és együttműködési lánccal, mérhető külső függőségekkel.
2. **Generational Society Simulation:** több generáció, működő utánpótlás,
   vagyon- és szervezeti folytonosság, mérhető eltérő életutak.
3. **Human-Compatible Simulation Platform:** ember és AI közös gazdasági és
   társadalmi szabályokkal, biztonságos kezeléssel és bővíthető világprofilokkal.

Ezek elfogadási célszintek; nem automatikusan új fázisszámok.

### 2.1. A három mérföldkő elfogadási kapui

| Célszint | Kötelező eredmény | Szükséges csomagok | Mi nem elég hozzá? |
| --- | --- | --- | --- |
| M1 – Minimum Viable Society | Kicsi önálló közösség, saját különböző célok, két actor-közi megélhetési függőség, belső étel/munka/csere és alapvető pihenés/eszközszolgáltatás, restartálló működés | G00–G05; G08 kezdeti, döntési preferencia-része | Az egyórás proto-soak vagy véges bolti elszámolás önmagában |
| M2 – Generational Society Simulation | Aktív utódok, két kohorszváltás, megőrzött vagyon és működő intézményi szolgáltatás, adottsághatás, teljes demográfiai/ellátási mérés | M1 + G06/G07/G08; legalább egy korlátos G09 intézménytípus | Elhunytak helyett új identity-sor; csak Property átadása; Business dormant állapot |
| M3 – Human-Compatible Simulation Platform | Ember és AI közös typed service-ek, játékosjogú munka/kereskedelem/lakhatás/tagság, explicit offline policy, mért célkapacitás és visszaállítható világprofil | M2 + G10/G11 és közös regresszió | 25–26 adminjog és UI-paritás; belépés a vanilla világba |

M1-en a rövid demonstráció és a tartós társadalmi elfogadás külön kapu.
Az utóbbinál a jelenlegi `society-minimum-policy.json` egy nap bemelegítést és
hét nap értékelést követel; a demo ezt nem írja felül. Gyorsított profil
külön elfogadott idő-/munkakapacitás-arányt igényel.

### 2.2. Meglévő task → javasolt munka megfeleltetés

| Meglévő hivatkozás | Megmaradó eredmény | Javasolt folytatás és típusa |
| --- | --- | --- |
| Aktív 15.1 | Nyitott audit→acceptance és exact ID nyilvántartás | G00 KIEGÉSZÍTÉS; ez az audit bemenet, nem automatikus tasklezárás |
| Completed 15.3–15.11 | Tartós supervision/event/lease/budget/recovery | G02 KIEGÉSZÍTÉS; nem új supervisor |
| Completed 15.6–15.8 | Goal progress, envelope, capability | G01/G02/G03 KIEGÉSZÍTÉS: inputpótlás, új fizikai adapter, korlátos új cél |
| Completed 16 | Clock/genesis/provenance | G01/G04/G05 használja; időarány ellenőrzése, nem új clock |
| Completed 17 | Attribute/cap/experiment típusok és képletek | G08 KIEGÉSZÍTÉS: engine-XP és döntési következmény |
| Completed 18–19 | Needs/housing/food/item domainmodellek | G01 KIEGÉSZÍTÉS/INTEGRÁCIÓ; teljes futási állítás csak új acceptance után |
| Completed 20 | Business-role/stock/work/shop pilot | G03 KIEGÉSZÍTÉS; NPC-cutover meglévő gatejeit használni |
| Completed 21 | Recipe/WIP/facility/capital/logistics | G03 KIEGÉSZÍTÉS: egy fizikai termékút, nem újabb receptkatalógus |
| Aktív 22 lezárt csomagjai | Crime/provenance/evidence/justice | G01/G03 határtesztként újrahasználja; nincs új crime-fázis |
| Aktív 23.6–23.9 | Custody, admin Property-heir, memóriaarchívum és seedelt entry | G06/G07 KIEGÉSZÍTÉS; a szűk MVP-t nem nevezzük utólag hibásnak |
| Aktív 24.1–24.7 és 24.9–24.11 | Minimumszerződés, ledger-reader, grafikon/riport, archive/controller | G04/G05 KIEGÉSZÍTÉS; adatforrás és közös működési bizonyíték |
| Aktív 24.8 | Hat eredeti élő kezeléstípus továbbra is nyitott | G05 VÉGREHAJTÁS később; nem hét új, párhuzamos kísérleti task |
| Aktív 25–26 | Kezelt világok, auth, recovery, admin UX | G10/G11 használja; emberi gameplayhez külön elfogadás |
| TASKS_LATER organization/member/role | Megőrzött későbbi bővítés | G09 KIEGÉSZÍTÉS; nem új CriminalFaction vagy duplikált céhrendszer |
| Mostani család/dinasztia és human-RP cél | A felhasználói vízió explicit része, részletes elfogadás még nincs | G07/G09/G10 ÚJ termék-kiegészítés; jóváhagyandó, nem visszamenőleges vállalás |

A már lezárt taskot kizárólag akkor javasoljuk **ÚJRANYITNI**, ha az eredeti
elfogadási körben konkrét kódhiba vagy hibás PASS bizonyítható. A mostani fő
hiányok többnyire integrációs továbbfejlesztések; nincs indok automatikus
státusz-visszaállításra. A sandboxban hibás, majd azonos forrással sikeres
teszt nem önmagában újranyitási ok.

## 3. Részletes csomagok és függőségek

### Első bizonyított gapekből következő irányok – munkaközi

- **KIEGÉSZÍTÉS, P0:** a 18–19. fázis meglévő needs/food/housing modelljeit
  hiteles engine-adapterrel és tartós karakterállapottal kapcsolni a normál
  futáshoz; új párhuzamos needs-domain helyett.
- **KIEGÉSZÍTÉS, P1:** a 15. fázis stratégiai tervjóváhagyását és inputhiányos
  fallbackjét pontos, korlátos autonóm döntési szabállyal bővíteni.
- **KIEGÉSZÍTÉS, P1:** a 23. fázis személyes Property-öröklési MVP-jén túl
  külön megtervezni az intézményi folytonosságot és tényleges új belépő
  életkezdését. A jelenlegi belépő nem kap automatikusan avatárfiókot,
  skillt, célt, pénzt vagy enrollmentet.
- **KIEGÉSZÍTÉS, P0:** a 24. fázis natív kereslet/felhasználás- és kohorszadatai
  nélkül nem igazolható az önfenntartás. A számítási képletek újraírása helyett
  forrásadapterek és lefedettségi bizonyíték szükséges.

A fenti lista a korai S1 checkpointot őrzi. Az alábbi G00–G11 csomagok a
pontosított, végleges auditjavaslatok; nem aktív fejlesztési vállalások.

### G00 – Bizonyíték- és elfogadási nyilvántartás

**Típus:** KIEGÉSZÍTÉS, meglévő 15.1. **Prioritás:** P0 a készrejelentéshez.
**Cél:** R12. **Most:** task/progress/run bizonyítékok léteznek, a követelmény
és a normál runtime-lánc közötti térkép hiányos. **Elmaradás:** technikai
MVP-státusz újra teljes társadalmi készültségnek látszhat.

- Feladat: az audit R01–R12 és E01–E37 jegyzékét executable acceptance-listához
  kötni: scope, pontos teszt/run ID, source/commit/policy digest, korlát,
  legutóbbi eredmény és a következő hiányzó próba. H01/H02 külön történeti marad.
- Függőség: jelen audit; G01–G11 később ide szállít bizonyítékot.
- Architektúra: igen, meglévő docs/acceptance bundle használható.
  Komplexitás: **alacsony–közepes**; kockázat: hamis lefedettség, elavulás.
- Elfogadás: minden fő követelményhez van ellenőrzés vagy explicit UNKNOWN;
  nincs puszta checkboxból származtatott PASS; hiányzó/live/adathiány külön;
  az R→G és G→teszt hivatkozások automatikusan ellenőrizhetők.

### G01 – Tartós életfenntartás és hiteles fizikai food-loop

**Típus:** KIEGÉSZÍTÉS/INTEGRÁCIÓ, completed 18–19 és 15.8.
**Prioritás:** P0. **Cél:** R05/R09. **Most:** in-memory needs/rutin, food
receipt ledger és housing/item modellek. **Elmaradás:** nincs működő belső
fogyasztói kereslet, a megélhetés továbbra is coin-/XP-rutin marad.

- Egyetlen, migrálható per-character needs-state authority, a közös clockhoz
  kötve. Online/offline/sleep/dead átmenetek, fractional időszámítás és replay
  ugyanazt a state-et frissítse. Minden memberhez explicit inicializálás.
- A determinisztikus self-care-t a már meglévő supervisor előtt/ben belső
  prioritási lépésként bekötni; nem második tickenkénti LLM-loopot indítani.
- Typed cooking/consumption adapter és engine-outcome: az étel valóban
  kerüljön inventoryba és onnan tűnjön el. Az SDK `eatFood` HP-segédjét nem
  szabad hunger-modellként elfogadni. Sikertelen vagy elmaradt művelet nem relief.
- A food-láncot actorváltással és item-eredettel kiterjeszteni; a jelenlegi
  same-agent closure maradjon támogatott. Tényleges gathering, processing és
  final use kapcsolódjon, nem caller által bemondott sourceDigest.
- Egy meglévő HousingUnit használatával alvás/ébredés és jogosultság;
  az offline világ továbbhalad, logout nem automatikus alvás/delegáció.
- Függőség: G00, clock/genesis, executor, engine inventory/provenance;
  G04 eseményszerződésével együtt tervezendő.
- Architektúra: **igen**, meglévő modulokra épülő adapterek. Komplexitás:
  **magas**; fő kockázat: dupla fogyasztás, két needs-writer, időtorzulás,
  ember/offline eltérés. Kötelező additive migration, régi adat unknown,
  offline backup/rollback és commit utáni forward reconciliation.
- Elfogadás: két actor közötti food-trace natív receiptből, egyszeri item-
  removal és relief; replay/duplikált receipt/rossz actor tiltott; restart a
  fizikai removal és needs-update között nem éheztet vagy etet kétszer;
  kritikus éhség/fáradtság LLM nélkül válaszol; készlethiánynál typed blocked;
  jogosulatlan ágy és dead actor nem végezhet self-care műveletet.

### G02 – Korlátos stratégiai célváltás és inputpótlás

**Típus:** KIEGÉSZÍTÉS, 15.6–15.9. **Prioritás:** P1.
**Cél:** R01/R02. **Most:** immediate/recurring rutinok, névhez kötött templates,
új terv approval-required, input-required fallback. **Elmaradás:** a közösség
csak a felkészített útvonalon működik, normál hiányhoz admin kell.

- Először egy approved-policyhoz kötött, általános megélhetési és beszerzési
  célsablon. Szükséglet, költségkeret, ismert skill, tulajdon és látható ajánlat
  alapján választás; semmi név szerinti külön kód.
- Az új immediate terv automatikus elfogadása csak meglévő granton belül;
  policyt/engedélyt a modell nem tágíthat. Kívül maradjanak a veszélyes
  szankció-, nagyhitel- és bizonytalan settlement-döntések.
- `acquire-input` eredményből pontos item/mennyiség/árplafon/partner alternatíva,
  elérhetetlen esetben bounded wait vagy más ismert megélhetési skill.
- Állapotpredikátumos cél: „van élelem a következő időablakra”, nem csak
  sikeres runok száma. Eredmény és akadály vissza a memóriába és következő tervbe.
- Függőség: G01 natív megfigyelés; event/lease/queue/budget/envelope meglévő.
- Architektúra: **igen**, jelenlegi planner bővítése. Komplexitás:
  **közepes–magas**; kockázat: hurkok, jogosultságbővülés, költségugrás.
- Elfogadás: ismeretlen nevű két agent azonos API-val, eltérő deklarált
  preferenciával; inputhiány után önálló, granton belüli alternatíva;
  legfeljebb előre rögzített döntésszám/költség; nincs végtelen retry;
  váratlan külső szöveg vagy hamis item nem adhat jogosultságot;
  új célfa szükséges admin-kattintás nélkül, de nem a granton kívül.

### G03 – Egy teljes Business–munka–termék–pénz lánc

**Típus:** KIEGÉSZÍTÉS, completed 20–21 és 15.7.
**Prioritás:** P1; a demo végrehajtási útjának fundamentális része.
**Cél:** R05/R06. **Most:** valós stock/treasury pilot, külön player-request,
WorkStore és WIP. **Elmaradás:** végrehajtás helyett admin/script koordinál.

- A szerep/műszak work order a meglévő one-use player-request útba kötődjön;
  ne keletkezzen második, egymástól független bérjogosultság.
- Egy avatar nélküli Business-agent ugyanazon admission/budget/event
  keretrendszerben stock-, munkakiadási és árdöntést tehessen narrow typed
  domain-akcióval. A fizikai munkát továbbra is player-avatár végezze.
- Egy recipe/WIP fizikai inputját és outputját a natív crafting receipt,
  facility entitlement és Business↔avatar custody kösse össze.
- A demohoz egy pénz- és itemmegmaradó eladási/beszerzési út; existing
  reserve/commit/release és salary reward reuse. Ár elsőként lehet fix,
  de a készlet/kereslet és veszteség valódi legyen.
- Egy meglévő tool kopjon tényleges munkára, majd belső javítás vagy pótlás;
  installed capital csak igazolt mechanikai előnnyel kerüljön a láncba.
- Függőség: G01/G02; treasury/escrow/roles/WIP/provenance/facility.
- Architektúra: **igen**, jelentős boundary-integráció. Komplexitás:
  **magas**; kockázat: dupla custody/output/bér, párhuzamos régi writer.
- Elfogadás: két worker ugyanazt az inputot nem foglalhatja; valódi outputból
  legalább egy másik actor fogyaszt; a bér csak egyszer, bizonyíték után;
  pénz- és készlet-egyenlet zár; restart minden irreverzibilis határon;
  üres stock/treasury esetén nincs NPC-fallback. A célzott NPC-cutover csak a
  meglévő nyolc readiness-gate és rollback-próba után nevezhető elfogadottnak.

### G04 – Natív outcome-források és lefedettségi bizonyíték

**Típus:** KIEGÉSZÍTÉS, 24.1–24.3/24.9–24.11.
**Prioritás:** P0 az önfenntartási állításhoz. **Cél:** R11.
**Most:** tíz képlet, két natív facade-csatorna, részleges food/tool/housing
diagnosztika. **Elmaradás:** egy üres vagy hiányos ledgerből nem mérhető siker.

- Az összes résztvevő igényének és valódi final-use eseményének gyűjtése;
  lineage alapján belső/bootstrap/import forrás, a kereskedelem nem új termelés.
- Azonos időhatárú nyitó/záró GP/készlet, készletforrás és debt külön,
  cohort membership és alive/dead/offline person-time.
- Read-model watermark/forráslefedettség: hiányzó vagy késő source, null
  denominator és eltérő snapshot látható, nem pozitív nulla.
- Meglévő evaluation és society-minimum értékelőt etetni; első körben
  survival + needs + food + tool + housing + inter-actor labor teljesen.
  Gini/mobilitás/árkosár később, megfelelő natív történet alapján.
- Függőség: G01/G03 eseményei; előre specifikálható velük párhuzamosan.
- Architektúra: **igen**, meglévő readers/export. Komplexitás:
  **közepes–magas**; kockázat: duplaszámolás, selection/survivorship bias.
- Elfogadás: ismert kis fixture pontos számláló/nevezővel; egy source
  eltávolítása `inconclusive`; az actorok és időablak szélein nincs dupla
  számolás; minden sikerértékig natív eseményre lehet lefúrni; a demo
  független újraolvasása ugyanazt a riportot adja. A teljes minimum csak
  minden szükséges csatorna és időablak megfigyelésekor adhat PASS-t.

### G05 – Közös társadalmi demonstráció és utána kontrollok

**Típus:** VÉGREHAJTÁS/KIEGÉSZÍTÉS a 15.1 és 24-es működési acceptance alatt;
24.8 feladatok végrehajtása később. **Prioritás:** P0 termékbizonyítás,
P1 hosszú kontrollkísérlet. **Cél:** R07/R12.

- A 4. fejezet konkrét D0→D1→D2 próbáit futtatni, minden sikertelen kimenetet
  és beavatkozást őrizve. A tesztfixture és a valódi világ eredménye külön.
- D1 után hibajavítás, majd a jelenlegi society-minimum hosszú ablaka.
  Csak ezután 24.8 hat előírt kezeléstípusa, egyszerre egy tengelyen.
- Függőség: G00–G04; hosszú futáshoz konkrét idő/költség/erőforrás-terv és
  felhasználói jóváhagyás. Ez a dokumentum semmilyen futást nem indít.
- Architektúra: **igen**, meglévő fixture/controller/benchmark/acceptance bundle.
  Komplexitás: **közepes** tooling, **magas** empirikus kockázat. Siker nem garantált.
- Elfogadás: a demonál nyilvános kritériumlista és exact run/event/settlement/
  manifest ID-k; natív exportból ellenőrizhető inter-actor dependency és
  recovery; végig vezetett intervention log. A hosszú minimum és a 24.8
  kezeléspárok külön verdictet kapnak; nincs protokoll-completed→society-PASS.

### G06 – Az új népességbelépőből cselekvő életút

**Típus:** KIEGÉSZÍTÉS, 23.9. **Prioritás:** P1 M2.
**Cél:** R04. **Most:** bounded seedelt felnőtt admission, pause-olt clock,
64 aktív/256 élettartam-admission limit, account és életkezdés nélkül.
**Elmaradás:** az eredeti népesség kihal, az új statisztikai népesség nem dolgozik.

- Az admission után külön saga a helyi account/avatar létrehozására, megfelelő
  titoktári credentialre, finite bindingra és játékbeli induló helyre.
- Starter skill/cél és megélhetési lehetőség explicit policyból, minimum
  induló erőforrás auditált eredettel. Nem másoljuk a halott memóriáját vagy
  vagyonát, és nem gyártunk belső termelésnek álcázott utánpótlást.
- A tagságot, világba aktiválást és munkába állást külön receipt igazolja;
  megfelelő policy után autonomy enrollment. Failure-nél részleges belépő
  látható, retry nem hoz létre új személyt.
- Függőség: G01–G05; 23.9, engine account, vault, genesis/provenance.
- Architektúra: **igen**. Komplexitás: **magas**; fő kockázat: identity-
  ütközés, credential leakage, bootstrap infláció, láthatatlan inaktív népesség.
- Elfogadás: a generált belépő emberi céladás nélkül megszerzi első belső
  jövedelmét és elfogyaszt egy belső terméket; crash/retry ugyanaz az avatar;
  nulla halott-reaktiválás; népesség és vagyoni mérleg egyezik. A pause/batch
  mechanizmus folyamatos pótlássá bővítése külön policy, nem limitkikerülés.

### G07 – Vagyon- és intézményi utódlás

**Típus:** KIEGÉSZÍTÉS/ÁTALAKÍTÁS, 23.6–23.8; a teljes dinasztikus működés
ÚJ, jóváhagyandó termékrészlet. **Prioritás:** P1 M2. **Cél:** R04/R06.
**Most:** nyolc domain custody, admin personal-Property transfer;
Business dormant, személyes pénz/készlet/equity nincs szétosztva.
**Elmaradás:** a társadalmi tőke zárolódik, szervezetek alapítóhalálhoz kötődnek.

- Elsőként egy kijelölt, élő örökös/successor policy, nem teljes családjog.
  Személyes cash/item, Business tulajdon és vezetői authority külön eszköztípus.
- Követelés-, escrow-, bér- és collateral-állapotok explicit rendezése;
  jogvita maradhat blocked. Az elhunyt személy tartozását nem töröljük
  hallgatólagosan és a Business pénzét nem olvasztjuk a személyes hagyatékba.
- Intézményi szabály: az alapító elvesztésekor előre adott manager/successor
  vagy szabályos megszűnés; közös tulajdon és fennmaradó szerződések kezelése.
- Estate source adapterek verziózott capability-regisztere, új domain
  hiánya fail-closed. Fokozatosan csökkenteni a közvetlen táblasémafüggést.
- Függőség: G03/G04/G06, death/estate/bank/treasury/Property/roles.
- Architektúra: **igen, fontos adapter- és jogosultságbővítéssel**.
  Komplexitás/kockázat: **nagyon magas**, mert több ledgert és engine-save-et
  érint. Minden új assettípusnak saját migráció/rollback/reconciliation.
- Elfogadás: halál nyitott munkával és adóssággal; közös mérleg változatlan
  az igazolt forrás/elnyelő kivételével; két utódváltás után is működő termelés;
  replay nem dupláz vagyont/jogot; hiányzó source esetén tiltás; az örökös
  nem kap automatikusan személyes emléket vagy nem örökölhető jogosultságot.

### G08 – Mérhető egyéni különbségek

**Típus:** KIEGÉSZÍTÉS, 10/15/17 és 24.8 attribute/potential tengely.
**Prioritás:** P1 a kezdeti különböző preferenciához; P2 a mély kutatáshoz.
**Cél:** R02/R03. **Most:** trait/value context, seedelt profile és XP-képlet,
de normál engine-hatás és társadalmi következmény nincs igazolva.
**Elmaradás:** a személyiség és tehetség dekoráció marad.

- Meglévő `AttributeProfile` tartós, lifecycle-hoz kötött authority és a négy
  célskill központi engine-XP hookja. Nem átírható a profile tréninggel.
- A determinisztikus rutinok és LLM tervek lássanak ugyanazon, kis terjedelmű
  preferenciát: kockázat, önállóság, biztonsági tartalék, partnerhűség.
  Nem kell előre szkriptelt életpálya vagy merev profession-class.
- Állapot, lehetőség és személyiség külön okkód/tervdöntés trace-e;
  nem várunk mindenkor optimális választást, de a teljes véletlent sem
  személyiségként értékeljük.
- Függőség: G02/G04; valós karrierkövetkezményhez G03/G05.
- Architektúra: **igen**. Komplexitás: **közepes–magas**;
  kockázat: balansz és nem azonosított engine-XP út; konfúz társadalmi mérés.
- Elfogadás: azonos XP-esemény és eltérő profile tényleges Player statja/
  reward receiptje eltér a policy szerint; más skillek vanilla maradnak;
  ugyanolyan profillal replay egyezik. Párosított rövid viselkedési próba
  kimutatja legalább két eltérő preferencia döntési nyomát; hosszú életúthatás
  csak több seedű 24.8 futás után állítható.

### G09 – Közösségi tagság, háztartás és irányítás

**Típus:** KIEGÉSZÍTÉS a TASKS_LATER organization/member/role feladathoz;
család/rokonság/háztartás ÚJ, explicit termékterv. **Prioritás:** P2;
komplex királyságpolitika P3. **Cél:** R06. **Most:** Business-role és
Faction-terület, directed kapcsolat. **Elmaradás:** céh/klán/család név marad,
nincs belső döntés, képviselet és folytonosság.

- Legfeljebb két első intézménytípus: gazdasági társulás és háztartás.
  Tagság, consent, képviselet, közös cél, közös vagyon és kilépés.
- Egy egyszerű vezetési szabály; alapító távozása/halála, konfliktus és
  felbomlás explicit átmenet. A treasury és Property marad saját domainjében.
- Kinship/dinasztia-változat: szülő/utód és jogi rokonság külön a directed
  trusttól. Elsőként generált utódkapcsolat elég; biológiai reprodukció P3.
- Függőség: G07 és közös actor-/jogosultságmodell; G08 a motivációhoz.
- Architektúra: meglévő modellek **kompozíciójával**, korlátos új domainnel.
  Komplexitás: **magas**; kockázat: Business/Faction duplikálása, korlátlan politika.
- Elfogadás: két külön típus ugyanazt a tagsági/role-invariánst használja;
  consent nélkül nincs tagság vagy közös vagyonhoz jog; vezetőhalál és
  kilépés után helyes authority; nem jön létre külön CriminalFaction.

### G10 – Emberi játékos közös társadalmi útja

**Típus:** ÚJ integrációs acceptance, meglévő player/identity/domain service
kiegészítése. **Prioritás:** P1 M3; az authority-szerződés már G01/G03 során
szempont. **Cél:** R08/R09. **Most:** közös vanilla világ és adminworkflowk.
**Elmaradás:** az AI és ember külön gazdaságot kap, vagy az ember adminjogot igényel.

- Emberi persistent actor AI-enrollment nélkül; a játékos hiteles sessionje
  jogosít domainakcióra, a profil nem vonja őt automatikusan planner alá.
- Ugyanaz a contract/work/housing/organization/Property service, eltérő
  inputadapterrel. A közös engine-szabály nem másolható külön human kódba.
- Játékosfelület vagy meglévő content-interakció normál kereskedelemhez,
  munkához és tagsághoz; admin control plane megmarad üzemeltetésre.
- Offline/sleep/mortality és opcionális delegated policy expliciten kezelve,
  emberi hozzájárulással és kiadási/veszélyhatárral.
- Függőség: M1 és G07/G09, meglévő 25–26 auth/server-context.
- Architektúra: **igen**, ha actor és controller szétválasztása megmarad.
  Komplexitás: **magas**; kockázat: jogosultságszivárgás, két writer, eltérő világidő.
- Elfogadás: az F forgatókönyv valódi klienssel és API-negatív teszttel;
  ember+AI trade/bér/rent ugyanazokat az invariánsokat tartja; más account
  assetje és más world tiltott; logout nem grants, duplikált kontroll tiltott.

### G11 – Mért célkapacitás és célzott optimalizálás

**Típus:** KIEGÉSZÍTÉS, 15.9/24/25. **Prioritás:** P2.
**Cél:** R10. **Most:** soros inferencequeue/backlog100, folyamat és due-scan;
nincs száz/ezer agent mérés. **Elmaradás:** a skálacél ígéret marad.

- Előre rögzített hardver, commit/policy, népesség és eseményterhelés;
  mockos 10→50→100 actor kapacitáspróba, majd külön budgetes providerpilot.
- p95 wake-up/decision latency, queue service/wait, fairness, SQLite-lock,
  CPU/RAM, processzszám és elszámolt költség/actor/szim-nap.
- Mért bottleneck szerint incremental source scan, bounded batch, poololt
  olvasás vagy korlátozott inference-párhuzamosság; nem előre clusteres újraírás.
- A 64 aktív/256 admission limit bővítése csak a lifecycle/migration és
  kapacitáspróba után; a guardok értékeit nem emeljük teszt helyett.
- Függőség: G04 telemetria, stabil G05 szelet; M3 célkapacitás döntése.
- Architektúra: **valószínűleg igen**, de nagyobb skálán méréstől függ.
  Komplexitás: **közepes a mérés**, optimalizálás **ismeretlen**.
- Elfogadás: előre vállalt terhelésnél nincs elveszett vagy duplikált esemény,
  költséglimit tartott, minden actor kap bounded kiszolgálást; p95/erőforrás
  küszöböt a mérési tervben számmal rögzíteni. Ezer agent készültsége csak
  ezer agentre érvényes külön bizonyítékkal állítható.

### 3.1. Ajánlott függőségi sorrend és szakaszhatár

```text
G00 követhetőség
  → G01 tartós fizikai megélhetés + G04 mérési szerződés
  → G02 korlátos újratervezés
  → G03 Business/munka/átadás + G04 natív teljesség
  → G05 rövid demo → hibajavítás → hosszú M1 acceptance → 24.8 kontrollok
  → G06 aktív új belépő + G07 utódlás + G08 mély heterogenitás
  → G09 egy-két intézménytípus → M2
  → G10 human workflow + G11 mért célkapacitás → M3
```

A human actor/authority-határ már G01-nél szükséges; a teljes human felület
G10-ben jön. A G08 első preferenciái G02 részei, a későbbi engine-potenciál
nem akadályozza az első food-demo elindíthatóságát.

Az ajánlott **következő fejlesztési szakasz kizárólag G00–G05 D1**:
egy food-lánc, egy housing-hely, egy véges Business/megbízás, egy szükséglet-
állapot, egy korlátos replanning policy, natív eredménynyom. Tool-maintenance
teljes, hosszabb szolgáltatási ciklusa D2/M1 acceptance része. Nem része a
szakasznak új tőkegépkatalógus, komplex politika, teljes családjog vagy
ezer agent. Minden csomag végén kód+teszt+run/hiány+javasolt következő lépés
kerül a meglévő követési rendszerbe.

## 4. Minimális társadalomszimulációs demonstráció

### 4.1. Miért ez a legkisebb értelmes szelet?

Négy persistent player-avatar és egy avatar nélküli konyha-Business döntéshozó.
A szerepek fixturebeli induló körülmények, nem kódba égetett profession-classok:

1. Gyűjtő: nyers ételt szerez és a konyhának ad el.
2. Feldolgozó: alkalmazottként valós inputból ételt készít, bért kap.
3. Szállító/eladó: átadja a terméket a vevőknek, valódi megbízásért bért kap.
4. Szállásadó/vevő: hozzáférést ad egy meglévő lakóhelyhez, bérleti jövedelméből
   ételt vesz; maga is szükségletet kezelő karakter.

Az első három actor is fogyaszt és szállást használ; a konyha bevétele fedezi
a nyersanyagot és béreket. Ez pénzkörforgást tesz lehetővé ahelyett, hogy az
egyetlen vevő korlátlan kezdőpénzből vásárolna. A fix ár elfogadható kezdetben;
az árak és mennyiségek mellett ex ante pénzforgalmi/kapacitásmérleg készüljön.
Nem követelmény, hogy minden választott ár mellett sikerüljön a társadalom.

Közös seedelt indulóállapot: véges készpénz és Business-treasury, egy ágy/
férőhely-katalógus, munkához szükséges eszközök, rövid food-tartalék,
életkezdéshez szükséges személyes skill és ismert verified eljárások.
Minden bootstrap allocation külön genesis receipt; a kezdeti tárgyak nem
számítanak a futás belső termelésének. A D1 után új értékinjekció tiltott.

**Konkrét jelenlegi inkompatibilitás:** a food-loop katalógus lobster
377→379, a production-workflow első food-receptje shrimp 317→315.
Egyiket sem szabad a másik helyettesítő bizonyítékának tekinteni.
Ajánlott első változat: a már verified lobster-gyűjtést használni,
hozzá egy bounded cooking/consumption és delivery adaptert elfogadni,
és a szükséges személyes induló kompetenciát explicit bootstrapként rögzíteni.
Alternatíva az alacsony belépési szintű shrimp-lánc, új food-chain verzióval
és verified gathering adapterrel. D0 legelső feladata a rövidebb, valóban
hozzáférhető út kiválasztása; új engine-funkció helyett meglévő content/SDK
használat, ahol lehetséges. A draft receptreferencia önmagában nem eljárás.

### 4.2. D0 – determinisztikus közös acceptance

- Egy tesztvilág, ideiglenes adatbázisok és scripted mock; nincs providerhálózat.
- Teljes food-trace és rent/wage/payment saga, kettős inputfoglalás,
  elfogyott készlet, tiltott partner/ár, private információ, restart minden
  kritikus ponton. A könyvelést nem közvetlen test helperrel sikeressé írjuk,
  hanem a bekötött adapter útját teszteljük; fizikai fake külön jelölést kap.
- Nulla dupla GP/item/relief; minden state és receipt forrása visszakövethető;
  a kihagyott esemény megakadályozza az eredmény készre jelentését.
- Ez technikai acceptance, még nem autonóm társadalmi kísérlet.

### 4.3. D1 – rövid, valódi világban megfigyelt társadalmi demo

**Javasolt keret:** 60–90 perc falióra, normál 1:1 időprofil, négy avatár,
egy Business-agent. Nem a többnapos minimum. Egy baseline és egy korlátos
shock-változat ugyanazon offline indulócsomagból, külön világban vagy egymás
után helyreállítva. Az első alapfutás legyen shock nélkül.

LLM-mód: D0-ban mock; D1-ben ritka, valódi stratégiai döntések rögzített
provider/model/prompt és kemény pénzlimittel. Javasolt felső korlát
**24 providerkérés az egész futásra**, max. egy új stratégiai kérés/actor/
15 perc; ismert rutin/self-care determinisztikus. A konkrét pénzplafont és
modellezett tokenigényt a futtatási tervben előre kell jóváhagyni. Egy csak
determinista D1a próba elfogadható technikai lépcső, de nem LLM-stratégia
bizonyítéka. Ez a javaslat nem ad felhatalmazást költséges futásra.

Előkészítés:

- Commit/forrásfa, cache, config, clock és genesis digest; konkrét avatar-
  és kezdőkészletlista; verified skill/role/facility/access/grant és várható
  hunger/rent/food termelési kapacitás. A személyes szintek engine-ben
  ellenőrizve; nem írjuk felül őket teszt közben.
- A food/lakhatás/contract forrásadapterek bekötve; `closed-society` vagy
  külön explicit, véges külső határ. A legacy NPC-restock nem választható
  csendes fallbackként.
- Offline baseline capture és visszaolvasási preflight; zero unintended
  controllers, egyértelmű leállítási feltételek és titok nélküli run-azonosítók.

Javasolt lefutás:

1. 0–15 perc: megélhetési terv, self-care és első megbízás; az operátor nem
   ír új célt vagy work ordert. A Business döntése a saját state-jéből történik.
2. 15–35 perc: nyersanyag→feldolgozás→eladás→végső fogyasztás, bér és bérlet.
3. Körülbelül félidő: egy tervezett engine+gateway restart, a függő munkák és
   intentek megőrzésével; nincs actoronkénti kézi újraindítás.
4. A shock-változatban egy beszállító/út előre rögzített, rövid kiesése;
   belső tartalék/alternatív partner/várakozás választása. A kontroll ezt nem kapja.
5. Leállítás az előre adott idő/keret végén; függő munkák rendezése, readonly
   riport, offline eredményarchive és izolált újraolvasás.

Elfogadási feltételek – a számok **javasolt demo-küszöbök**, nem korábbi vállalások:

- Mind a négy actor legalább két saját, natív item-removallal igazolt
  fogyasztást végez; legalább egy a másik actor által termelt/feldolgozott étel.
- Legalább két külön actor-közi függőség, három külön vevő/eladó viszony;
  nem négy egymástól független, saját ételt előállító bot.
- Legalább egy teljes, fizikai outputhoz kötött bér és egy valódi jogosultságot
  biztosító bérlet; nulla jogosulatlan vagy ismételt GP/item átadás.
- Egy dokumentált inputhiány vagy shock nyomán önálló új terv/várakozás,
  a személyiség/preferencia és az ismert megoldások figyelembevételével.
- Restart után 5 percen belül minden jogosult, online képes actor folytatja
  a bounded loopot vagy konkrét, hiteles blocked állapotban van; a korlátot
  előzetes útvonal-preflight indokolja. Blocked actor nem számít elvégzett munkának.
- Az operátor legfeljebb vészleállít, előre tervezett restartot végez vagy
  bizonytalan biztonsági állapotot kezel. Minden más segítség külön esemény és
  a felügyelet nélküli acceptance sikertelen eredménye.
- Minden GP- és itemmérleg zár; a bootstrap és a futás közbeni belső termelés
  elkülönül. A megfigyelt needs-igénynek legalább 95%-a teljesül az ablakban;
  a küszöbhöz teljes nevező kell. Nem állítunk szükségletmentes túlélést.
- A baseline/eredmény manifest, run/event/decision/settlement ID és natív
  riport új könyvtárban újraellenőrizhető; nincs kézzel javított sikeradat.

Stop/failure feltételek: budget vagy falióra elfogy, duplikált/hamis receipt,
kézi értékinjekció, source/clock drift, bizonytalan custody, kritikus szükséglet
tartós ellátatlansága, vagy nem tervezett emberi vezérlés. A kudarc is megőrzött
eredmény; nem indítunk automatikusan új, kedvezőbb run-t a régi eldobásával.

Ez a demonstráció a társadalmi kölcsönfüggést és működő közös mechanizmust
igazolhatja. Egyetlen kontroll/shock pár még nem bizonyít általános emergens
gazdasági törvényt vagy tartós önfenntartást.

### 4.4. D2 – tartós M1, majd generációs és kutatási acceptance

A rövid demo hibái után hozzáadandó a belső tool-maintenance és inputpótlás,
majd a meglévő society-minimum **1 nap warmup + 7 nap evaluation** ablaka,
legalább négy alapítóval, a policy összes forrás- és survival-kapujával.
1:1 profilban ez legalább nyolc valós nap; erre külön futtatási jóváhagyás kell.
A hosszú controller minimum egy szimulációs napja nem azonos ezzel az ablakkal.

M2-höz két kohorszváltás és működő successor/Business-szolgáltatás következik;
ne a teljes founder-survival M1-változót használjuk a természetes generációs
halál büntetésére. Eltérő, verziózott generációs acceptance szükséges.
Ezután 24.8 előírt hat tengelye: attributes/potential, diminishing XP,
facility-előny, genesis/burn-in, housing/needs szigor, mortality/kontroll.
Ismételt seedpárok és előre rögzített kimenetek nélkül csak leíró összehasonlítás.

## 5. Nyitott tervezési kérdések

Az audit megkülönbözteti a termékszintű döntéseket és az implementációs hibákat.
Az új ötletek nem válnak automatikusan korábban vállalt követelménnyé.

| Döntés | Ésszerű alternatívák | Ajánlás és időzítés |
| --- | --- | --- |
| Első élelmiszer | Meglévő lobster gathering + új cooking adapter; vagy shrimp új food-chainnel | D0 preflight válassza a rövidebb valós utat; ne tervezzünk mindkettőből teljes láncot |
| Needs authority | Engine-modul vagy domain store hiteles engine-receipttel | Egyetlen writer, clock/lifecycle binding és atomic/fail-closed határ kötelező; adapterdöntés G01 előtt |
| Terv-önállóság | Minden új cél emberi review; vagy előre adott policy/granton belüli automatikus terv | Utóbbi hétköznapi megélhetésre; high-risk és grantbővítés marad explicit kapu |
| Első gazdaság | Fix ár; bounded készlet/kereslet alapú ár; order book | D1 fix ár elegendő, endogén alkalmazkodás később. A fix ár nem szimulált piaci árképzés |
| Zárt vagy nyitott világ | Teljes belső ellátás; vagy explicit véges import/export | A demo világosan deklarálja. A 24 minimum closed-economy állításába import nem rejthető |
| Offline ember | Védett/passzív policy; in-world sleep; korlátos delegáció | Külön playerdöntés; logout ne jelentsen automatikus AI-kontrollt |
| Utód keletkezése | Seedelt bevándorló, generált családi utód, reprodukció | Először cselekvő bevándorló G06; családi kapcsolatok G09; biológia később |
| Öröklés | Egy kijelölt successor; több örökös/végrendelet/jogi vita | Először egy successor, de személy és jogi személy vagyona külön; G07 |
| Időgyorsítás | 1:1 vagy külön gyorsított világprofil | D1 normál; hosszú futás előtt fizikai munka/needs/aging arány ellenőrzése |
| „Jó társadalom” | Túlélés, egyenlőség, produktivitás, szabadság, biztonság súlyozása | Meglévő metrikavektor megtartása; nincs önkényes összpontszám |
| Reprodukció célja | Bitazonos engine; vagy azonos baseline+visszakövethető sztochasztikus run | Utóbbi M1-re elég; RNG-infrastruktúra csak konkrét kutatási kérdésnél bővüljön |
| Skálacél | Tíz/száz/ezer teljes avatár vagy vegyes absztrakció | Mért G11 után dönteni; nem oldjuk meg előre feltételezett shardinggal |

### 5.1. Mit nem állít ez a javaslat?

Nem igazolja utólag a teljes élő társadalom működését, nem ír át taskstátuszt,
nem fogad el új költségkeretet és nem indít fejlesztést. A becsült komplexitás
relatív, nem embernap- vagy teljesítési ígéret. A legkockázatosabb csomag G07;
az első demóhoz ezt nem kell előre teljesíteni.

## 6. Szakasznapló

### S0 – roadmapforrások azonosítása

- Vizsgálva: aktív és történeti tasklisták rendje, három célmérföldkő.
- Bizonyított: az aktív 15.1 és 24.8 nyitott munka; a 26. fázis lezárt státuszú.
- Ellenőrizetlen: a ténylegesen újranyitandó integrációs láncok és új hiányok.
- Következő: implementációs bizonyítékhoz kötött gap→task megfeleltetés.

### S1 – runtime és domainhatárok

- Vizsgálva: autonomy supervisor, planner, needs/attributes fogyasztók,
  estate és natív társadalmi riport.
- Bizonyított: a fő hiányok jelentős része meglévő domain integrációja;
  a régi supervisorhiány már megoldott.
- Ellenőrizetlen: gazdasági körforgás és intézményi kontinuitás teljes lánca.
- Következő: a csomagok korlátozása egy valódi termelés–fogyasztás demonstrációra,
  újabb nagy infrastruktúrafázis automatikus előírása nélkül.

### S2 – gazdasági és generációs függőségek

- Vizsgálva: meglévő fix áras stock policy, WIP, véges bolt pilot,
  Business-custody, admin öröklés, népességbelépés, mérési és reprodukciós határok.
- Bizonyított: a következő fejlesztés főként integráció és adatgyűjtés;
  teljes új gazdasági motor vagy új LLM-keretrendszer nem indokolt.
- Ellenőrizetlen: a javasolt demo élő megvalósíthatósága és küszöbei.
- Következő: három mérföldkőhöz rendelt, meglévő taskokat nem duplikáló
  feladatcsomagok, konkrét elfogadási feltételekkel és kockázatokkal.

### S3 – részletes csomagok és elfogadási tervek

- Vizsgálva: G00–G11 függősége, a meglévő taskok megfeleltetése, M1–M3 és
  D0/D1/D2 elfogadási szintek; food-katalógusok tényleges itemeltérése.
- Bizonyított: nem szükséges új supervisor/ledger/clock/analytics alapot
  írni; az első integrációs cél konkrétan körülhatárolható. A hét korábban
  hibázó tesztfájlt lefedő diagnosztika 157 PASS / 0 FAIL, 58,724 s,
  sandboxon kívül, termékforrás-módosítás nélkül.
- Ellenőrizetlen: a javasolt demo tényleges lefutása, működési költsége,
  többgenerációs eredmény és skálakapacitás. Ezek nem a terv elkészítésével
  teljesülnek. Teljes hiánylista a társ-audit 9.2. fejezetében.
- Következő: dokumentumellenőrzés után megállás; közös termékértékelésből
  döntés a G00–G05 integrációs szakaszról. Fejlesztés/futás nem indult.

### S4 – dokumentumellenőrzési checkpoint

- Vizsgálva: a két dokumentum 119 helyi Markdown-linkje és formázása.
- Bizonyított: 0 hibás hivatkozás, formázás PASS, exit 0, 1,371 s;
  `20261018-134109-412-society-audit-documents`.
- Ellenőrizetlen: a roadmap elfogadása, a javasolt demo és minden későbbi
  működési mérföldkő; ezek fejlesztési és futtatási munka, nem auditkimenet.
- Következő: közös értékelés és döntés. A két új dokumentum elkészítésével
  a jelen dokumentációs munkát lezárjuk; további implementáció nem indult.

Végleges ellenőrzés: `20261018-134302-402-society-audit-final-documents`,
PASS, exit 0, 1,214 s; 119 helyi link, 0 hiba, formázás és kódblokkok rendben.
Kizárólag a két új dokumentum változott a verziózható kimenetben; commit/push nincs.
