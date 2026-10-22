# Társadalomszimuláció – projekt- és vízióaudit

Állapotdátum: 2026-10-18. Vizsgált baseline: `2df0daad86c6568a3e1f0e62f58f09aa3cd955de`.
Auditág: `codex/society-vision-audit`. Kizárólag a helyi/private LostCity fork.

## 1. Vezetői összefoglaló és bizonyítási rend

**Összegzés:** a rendszer több egy kibővített botkeretrendszernél: tartós
identitás, memória, felügyelt rutin-autonómia, valódi gazdasági főkönyvek,
halál/custody és kísérleti infrastruktúra létezik. **Önfenntartó, többgenerációs,
emberrel közösen működő társadalom még nincs bizonyítva.** A fő szakadék a
domainmodellek és a normál, hiteles világállapotot módosító futási út összekötése.

Ez dokumentációs, forrás- és célzott tesztaudit. Nem teljes működési elfogadás:
az élő A–F láncok, hosszú társadalmi futás, generációváltás és skálaterhelés
ellenőrzése hiányzik. A sandboxban hibázó célzott tesztek később sikeresek lettek.
Pontos korlátok a 9. fejezetben. Százalékos készültséget nem adunk: egy jól
elkészült ledger nem
helyettesíti a megélhetési lánc hiányzó végrehajtását.

Az öt legnagyobb előrelépést adó hiány:

1. Tartós needs/self-care és fizikai termelés–átadás–végső fogyasztás összekötése.
2. Korlátos önálló stratégiai célváltás, beszerzés és intézményi döntés.
3. Hiteles keresleti/felhasználási történet és bizonyítható önellátás.
4. Aktív életkezdésre képes új belépő, valamint pénz-/Business-utódlás.
5. Személyiség, adottság és kapcsolatok tényleges döntési/életpályahatásának mérése.

A következő fázisra végrehajtható integrációs csomagot javaslunk, nem újabb
széles funkciókatalógust. Részletek:
[SOCIETY_ROADMAP_PROPOSAL.md](SOCIETY_ROADMAP_PROPOSAL.md).

A felhasználó 2026-10-18-i részletes feladatleírása a vizsgált termékvízió:
hierarchikus AI, egyéni életutak, adottság és tanult készség elkülönítése,
véges élet és öröklés, belső gazdaság, intézmények, emergens viselkedés,
emberi részvétel és reprodukálható kutatás.

Bizonyítéktípusok: **KÓD** = ellenőrzött implementáció; **TESZT** = ebben az
auditban futtatott ellenőrzés; **TÖRTÉNETI** = korábbi dokumentált eredmény;
**TERV** = dokumentált szándék; **KÖVETKEZTETÉS** = auditértékelés;
**JAVASLAT** = jóvá nem hagyott új fejlesztési irány. A kód jelenléte nem élő
elfogadás, a tesztdarabszám nem társadalomszimulációs bizonyíték.

Képességállapotok: IMPLEMENTED, PARTIAL, SCAFFOLD, MOCKED, DOCUMENTED,
MISSING, UNKNOWN. Az IMPLEMENTED minősítés mindig a megnevezett szűk
képességre vonatkozik; a teljes termékminősítés ettől eltérhet.

## 2. Dokumentumok és követelmények nyomonkövetése

- [TASKS.md](TASKS.md): saját követési rendje szerint az egyetlen aktív roadmap.
  A 15.1 audit→regresszió nyilvántartás és a 24.8 élő összehasonlítások nyitottak.
- [old_TASKS.md](old_TASKS.md): 0–14. fázis történeti vállalásai; az ottani régi
  15–16. fázisszámok nem azonosak a jelenlegi fázisokkal.
- [TASKS_COMPLETED_15_21.md](TASKS_COMPLETED_15_21.md): későbbi integrációs
  eredmények; az elfogadási bizonyítékokat külön ellenőrizni kell.
- [TASKS_PHASES_15_23_REPLACEMENT.md](TASKS_PHASES_15_23_REPLACEMENT.md):
  megőrzött alternatív terv, nem második aktív tasklista.
- [SIMULATION_VISION.md](SIMULATION_VISION.md): a PROJECT és az aktív roadmap
  által hivatkozott vízió. A benne lévő régi készültségi szöveg nem írja felül
  az újabb implementációt.
- [SIMULATION_VISION_UPDATED.md](SIMULATION_VISION_UPDATED.md) és
  [old_SIMULATION_VISION.md](old_SIMULATION_VISION.md): összevetendő történeti
  változatok. Az UPDATED fájlnév önmagában nem prioritási döntés.
- [AUTONOMOUS_PROTO_SOCIETY_AUDIT.md](AUTONOMOUS_PROTO_SOCIETY_AUDIT.md):
  2026-09-08-i baseline; az azóta elkészült 15–26. fázis miatt a hiánylistáját
  nem lehet változtatás nélkül jelen idejű megállapításként átvenni.
- [AGENTS.override.md](../../AGENTS.override.md): kompozíciós Skill[] modell,
  típusos LLM-eszközök, atomi és auditált gazdasági műveletek, célzott verifikáció.
  Ez forrásaudit, nem gameplay/SDK-operáció; a CLAUDE gameplay-útmutató betöltése
  ezért nem szükséges. További beágyazott AGENTS fájlt a repókeresés nem talált.

### 2.1. További releváns forráscsoportok és időbeli elsőbbség

Az audit feltérképezte a `docs/project/features/`, `architecture/`, `decisions/`,
`setup/` dokumentumokat, a [BASELINE.md](BASELINE.md),
[PROJECT.md](PROJECT.md), [architecture.md](architecture.md),
[ECONOMIC_DOMAINS.md](architecture/ECONOMIC_DOMAINS.md),
[MODDING_MAP.md](architecture/MODDING_MAP.md),
[TASKS_LATER.md](TASKS_LATER.md) és a 22–26. progressfájlok kapcsolatait.
Fókuszált tartalmi olvasás történt az autonómia 15.6–15.10, needs, food,
attributes, Business/work/WIP/shop, population 23.7/23.9/23.10,
24.9/24.11, finite-shop, NPC-migration és 26.7 leírásokon.
A teljes dokumentumkorpusz minden sorának olvasását nem állítjuk.

Az elsőbbségi rend: mostani felhasználói vízió → explicit későbbi döntés és
aktív TASKS → a képesség aktuális implementációja/tesztje → történeti task és
progress → korábbi audit. A követelmény érvényességét dokumentum igazolja;
a megvalósítottságot kód/teszt/élő bizonylat igazolja. Egyik nem helyettesíti a másikat.

A Git-történetben a jelenlegi víziót érintő `a3b589a84` integrációs változás
2026-09-13-i; a VISION és UPDATED közvetlen diffje szerint az előbbi tartalmazza
a proto-society köztes mérföldkövet és a megfigyelhetőségi kiegészítést.
Az UPDATED elnevezés tehát nem bizonyítja, hogy az a későbbi irányadó változat.
Mindkettő őriz tervezési szöveget; egyik sem aktuális készültségi leltár.

### 2.2. Az eredeti és későbbi vízió összevetése

| Osztály | Megállapítás | Bizonyíték / következmény |
| --- | --- | --- |
| Továbbra is érvényes | Ritka stratégiai LLM, verified rutin, egyéni identitás, gazdaság, tulajdon, memória, emberi világ | Felhasználói leírás 2.1–2.8; VISION alapelvek és 1–23. fejezet |
| Tudatosan módosított | A régi opcionális permadeath helyett a célprofilban véges élet, külön respawn-kontroll | old_VISION 8. fejezet → VISION 5. és 17.; TASKS 23 |
| Tudatosan pontosított | Új személyes skill helyett először meglévő RS-skill + eljárás + facility kompozíció | old_TASKS régi 15 → VISION 1–2.; completed 17. és 21. fázis |
| Ütemezésben módosított | Előbb proto-society integráció; az alternatív terv fázisszámai eltolódtak | TASKS_COMPLETED 15–21 és aktív 22–24; a replacement számait nem új feladatként vesszük át |
| Explicit elhalasztott | Élő paraméter-összehasonlítás a teljes társadalom működési próbája után | TASKS 24, 2026-10-16-i felhasználói sorrend; nem eltörölt 24.8 |
| Tudatosan későbbi | Gang/cartel/thieves' guild általános organization/member/role alapból | TASKS_LATER; nem külön CriminalFaction |
| Nem igazolt elvetés | Család, dinasztia, több örökös, autonóm intézményalapítás, társadalmi vezetés | A mostani vízió része; nincs végrehajtható, teljes aktív tasklefedés. A hallgatás nem scope-törlés |
| Lehetséges dokumentációs elveszés | A részletes eredeti életút-/kapcsolat-/családcéloknak nincs mindenhol explicit elfogadási kapuja | Auditkövetkeztetés: requirement→teszt térkép kell. Történeti elvesztés okságát Git-diff önmagában nem bizonyítja |
| Ellentmondás / elavulás | VISION szerint nincs restart supervisor, miközben completed 15 és kód szerint van | Elavult készültségi bekezdés; nem termékhiány |
| Értelmezési feszültség | Régi architecture: nincs részállapot; mostani settlement/estate tartós részlépésekkel működik | Az atomi helyi tranzakció és a többdomaines saga külön szerződés; globális ACID nem bizonyított |

Teljesen és tudatosan elvetett korábbi termékötletre az átolvasott forrásokból
nem áll rendelkezésre általános, hiteles elvetési lista. A kompozíció és a
későbbi szervezeti modell pontosított irány, a családrendszer pedig nyitott cél.

### 2.3. Követelményazonosítók

| ID | Vizsgált követelmény | Forrás → jelenlegi állapot → továbblépés |
| --- | --- | --- |
| R01 | Stratégia, skill, visszajelzés, újratervezés | Kérés 2.1; completed 15 → rutinloop igen, általános célváltás részleges → G02 |
| R02 | Személyiség, értékek, célok, memória, társadalmi különbség | Kérés 2.2; old_TASKS 10 → adat/context igen, oksági életpályahatás nincs igazolva → G08 |
| R03 | Adottság ≠ tanult készség ≠ eljárás ≠ facility | Kérés 2.3; completed 17 → típusok/képletek igen, engine-enforcement nincs → G08 |
| R04 | Permadeath, öröklés, generáció és intézményi folytonosság | Kérés 2.4; TASKS 23 → halál/custody igen, teljes utódlás nincs → G06–G07 |
| R05 | Belső kereslet, termelés, fogyasztás, munka, piac | Kérés 2.5; completed 18–21; TASKS 24 → több működő rész, zárt kör nincs igazolva → G01/G03/G04 |
| R06 | Család, vállalkozás, céh/klán, vezetés és közös cél | Kérés 2.6; old_TASKS 12–14; TASKS_LATER → gazdasági intézmények részlegesek → G03/G07/G09 |
| R07 | Emergens, mechanizmusokból származó jelenségek | Kérés 2.7; TASKS 24.8 → nincs igazolt társadalmi oksági eredmény → G05 |
| R08 | Emberi játékos ugyanazon szabályokkal | Kérés 2.8; manual-play; completed 18; TASKS 25–26 → közös világ igen, társadalmi paritás részleges → G10 |
| R09 | Integritás és jogosultság | Kérés 5; ADR-0002/0003; 15.7; 22; 24.2 → erős határok, teljes mindenút-lefedés ismeretlen → G01/G04/G10 |
| R10 | Száz/ezer agent, költség és ütemezés | Kérés 5; 15.9 → bounded queue igen, kapacitásmérés nincs → G11 |
| R11 | Metrikák, seed, snapshot/export, összehasonlítás | Kérés 6; TASKS 24.1–24.11 → képletek/eszközök igen, natív lefedés részleges → G04/G05 |
| R12 | Összetett A–F teszt és nyomonkövethető acceptance | Kérés 7–11; aktív 15.1 → jelen audit forgatókönyvei, végrehajtott teljes láncok hiányoznak → G00/G05 |

A G-azonosítók a roadmapjavaslat részletes csomagjai; nem új aktív taskok.

## 3. Szakasznapló és ellenőrzési lefedettség

### S0 – hatókör és dokumentumtérkép

- Átvizsgálva: feladatleírás; repository-utasítások; aktív roadmap követési
  rendje; vízióváltozatok szerkezete; dokumentum- és moduljegyzék;
  [VERIFICATION_POLICY.md](VERIFICATION_POLICY.md).
- Bizonyított: a baseline tiszta munkafával indult; a projektben a 26. fázis
  is lezárt státuszú; több korábbi auditállítás időközben elavulhatott.
- Nyitott: forráskód, integrációs láncok, teszteredmények és élő működés.
- Következő: dokumentumdifferenciák, futási útvonalak és célzott tesztkörök.

## 4. Funkcionális lefedettség

### S1 – első ellenőrzött integrációs eredmények

- **KÓD:** tartós enrollment/lease, due supervisor és restart-reconciliation már
  létezik: `server/gateway/admin/autonomy-supervisor.ts:111`,
  `server/gateway/gateway.ts:1020`, `:1100`. A korábbi audit „nincs supervisor”
  megállapítása a jelenlegi baseline-ra nem igaz.
- **KÓD:** `server/gateway/admin/replan-runtime.ts:180` környezetében az automatikus
  planner exact player-avatar szerepet követel; `:364` környezetében az új
  stratégiai célterv `approval-required`. Ez rutin-autonómia, nem korlátlan
  stratégiai vagy institution-autonómia.
- **KÓD:** `needs/maintenance.ts:81` és `needs/dynamics.ts:125` tiszta
  döntési/számítási API. A célzott teljes repós import- és híváskeresés nem
  talált normál engine/gateway fogyasztót. Ugyanez igaz az
  `applySkillPotentialProgression` engine-bekötésére; a megtalált fogyasztó a
  `character-attributes/experiment.ts` kontrollszámítása.
- **KÓD:** `population-estate/runtime.ts:12` nyolc domainen vezetett, újrapróbálható
  custody-folyamat; `population-estate/inheritance.ts:114` adminút. Az örökölhető
  MVP-eszköz személyes Property; készpénz, inventory és Business-részesedés nem
  támogatott öröklés. Ez részfunkció, nem hiányzó teljes öröklési modul.
- **KÓD:** `society-metrics/evaluation-report.ts:20` két natív mérési csatornát
  táplál; a teljes társadalmi minimum eredménye szándékosan `inconclusive`.
- **TÖRTÉNETI, HELYBEN MEGTALÁLT:** a 15. fázis elfogadási csomagja és a
  véges bolt pilotjának riportja elérhető; digestjük egyezik a dokumentált
  tartalmi digesttel. Ez korábbi működés bizonyítéka, nem mai újrafuttatás.

Ezek az S1 checkpoint forrásbizonyított megállapításai. A későbbi ellenőrzésekkel
pontosított minősítéseket az alábbi mátrix és a 9. fejezet tartalmazza.

### 4.1. Funkcionális mátrix a vizsgált baseline-on

Az „élő” megjegyzésnél külön szerepel, ha csak korábbi pilot áll rendelkezésre.
A PARTIAL nem azt jelenti, hogy a belső domain hibás: a termékszintű lánc hiányos.

| Képesség | Minősítés | Bizonyított terjedelem és hiány | Bizonyíték |
| --- | --- | --- | --- |
| Tartós identitás, négyszintű célok | IMPLEMENTED | SQLite, revízió, szigorú hierarchia; nem önálló életcél-felfedezés | E01; agent-state tesztek |
| Episodic/semantic/social memória | IMPLEMENTED | Tartós modell, bounded retrieval, journal-ingestion; trade nem generál automatikusan bizalmat | E01/E02 |
| Autonóm felügyelet és restart | IMPLEMENTED | Enrollment, lease, due-event, marker-reconciliation, quarantine; ismert rutinokra | E03/E04; TÖRTÉNETI H01 |
| Általános stratégiai autonómia | PARTIAL | LLM skillt és céltervet javasol; új célterv adminnál megáll, inputhiány typed fallback | E05/E06 |
| Hierarchikus LLM/operatív szétválasztás | IMPLEMENTED | Magas szintű választás, deklaratív bounded executor, typed runtime-grant | E05/E07 |
| Valódi LLM-provider és teljes társadalmi stratégia | PARTIAL | Provideradapter van; alapkonfig kikapcsolt mock; fizetős mai próba nincs | E06; config/llm-runtime.json |
| Determinisztikus tesztprovider | MOCKED | Szándékos ScriptedMockProvider, nem emberi viselkedés bizonyítéka | llm-runtime/mock-provider.ts |
| Összetett skillkatalógus és tanulás | PARTIAL | Verified verzió, private/shared tudás; limited gathering/bank/shop/smith/trade/thieving készlet | E07/E08; hardlink-tesztek akadályozottak |
| Személyiség és értékek | PARTIAL | Identity/context stringek; nem bizonyított viselkedési vagy életúthatás | E01/E09 |
| Született adottságok és skillpotenciál képlete | IMPLEMENTED | Seedelt budget/allocation, négy cap-policy, kontrollszámítás | E10; character-attributes/test |
| Adottságok tényleges engine-XP hatása | DOCUMENTED | Progression adapter létezik; normál engine-hívó nem talált; kísérleti input nem enforcement | E10/E11 |
| Hunger/fatigue és önellátási döntés | PARTIAL | Tiszta időalapú modell és intent; tartós normál karakterloop nincs bekötve | E12 |
| Élelmiszer végső fogyasztási könyvelés | PARTIAL | Három receipt együgynökös lobster closure, atomi ledger; több szereplő fizikai lánca nincs | E13 |
| Lakhatás/bérlet/berendezés | PARTIAL | Domainmodellek és storage-security engine-forrás; teljes alvás–bérlet–fizetés loop nincs igazolva | E14; housing/test |
| Itemkopás/javítás/pótlás | PARTIAL | Tartós item-state és termelési ciklus, tesztelt invariánsok; normál mining-hit→kopás út nem igazolt | E15 |
| Property-tulajdon | IMPLEMENTED | Engine-oldali vásárlás és tartós tulajdon; nem általános földpiac | E16 |
| Új föld/épület | SCAFFOLD | land-construction extension-határ; nem működő dinamikus építés | land-construction/extension.ts |
| Business, szerep és alkalmazotti policy | IMPLEMENTED | Tulajdon, aktív employment, exact role/skill és policy, treasury-port | E17 |
| Önálló vállalkozásalapítás és intézményi döntés | PARTIAL | Domainport létezik; player replan nem futtat institution-t, lifecycle-módosítás admin | E05/E17 |
| Ajánlat/szerződés/escrow/bér | IMPLEMENTED | Szűk, bizonyítékalapú reserve/commit/release és jutalom, restarttesztek | E18/E19 |
| Bank/hitel/default | PARTIAL | Institution-domain és end-to-end MVP-teszt; player-autonóm hitelfelvételi életút nincs | E20 |
| Véges bolt | PARTIAL | Valós pilot, véges stock/treasury/bér; nem általános NPC-cutover vagy folyamatos manager-loop | E21/H02 |
| NPC-szolgáltatók teljes migrációja | DOCUMENTED | Planning-only readiness-katalógus; closed-mode tiltás külön implementált | E22 |
| Endogén kereslet/árazás és gazdasági körforgás | PARTIAL | Vanilla/GE és fix Business-ár létezik; belső szükségletvezérelt piac nem bizonyított | E12/E21/E23 |
| Többlépéses production/WIP/facility/tőke/logisztika | PARTIAL | DAG, inputfoglalás, receipt, capability és tervek; normál fizikai engine-lánc hiányos | E24/E25 |
| Faction/Jurisdiction és adó | PARTIAL | Tartós joghatóság, policy, obligation/treasury, intézményi port; tagsági politika/vezetés nem teljes | E26 |
| Tulajdonvédelem, bűnözés, provenance, justice | PARTIAL | Jelentős engine-evidence és jogi pipeline; célzott tesztek és történeti 22. acceptance; mai közös élő lánc nincs | E27 |
| Öregedés/health/terminális halál | IMPLEMENTED | Finite membership, hiteles engine-death, fizikai tiltás és gateway-reconciliation | E28 |
| Estate/custody | IMPLEMENTED | Nyolc domain őrizete, blokkolók és idempotens checkpoint; nem teljes hagyatékfelosztás | E29 |
| Teljes vagyon- és Business-utódlás | PARTIAL | Admin személyes Property-öröklés; pénz/item/equity/vezetés nincs | E30 |
| Új népesség aktív belépése | PARTIAL | Seedelt felnőtt identity és membership; nincs automatikus játszható életkezdés | E31 |
| Család/dinasztia/reprodukció | MISSING | Nincs megtalált családi/rokonsági/reprodukciós domain; a born típus nem születési mechanizmus | E31; entry.ts explicit scope |
| Általános céh/klán tagság és vezetőutódlás | DOCUMENTED | Faction/Business részmodellek és külön organization-backlog | E26; TASKS_LATER |
| Emergens társadalom | UNKNOWN | Technikai alap és társas tranzakció van; sem adaptív gazdaság, sem többgenerációs jelenség nincs elfogadva | E32/H01/H02 |
| Ember és AI közös világ | PARTIAL | Vanilla klienssel részvétel leírt, közös engine; teljes társadalmi workflow-paritás nincs | E33 |
| Kísérleti idő/genesis/provenance | IMPLEMENTED | Seedelt kezdőállapot, digests, clock és bootstrap-eredet | E11/E34 |
| Reprodukálható teljes társadalmi kísérlet | PARTIAL | Offline snapshot/export/restore és összehasonlítási protokoll; RNG/LLM nem teljesen determinisztikus | E32/E35 |
| Natív többcélú társadalmi telemetria | PARTIAL | Tíz képlet, két facade-adatcsatorna; demográfia külön; önellátás inconclusive | E36 |
| Száz/ezer agent kapacitása | UNKNOWN | Bounded queue és költségkeret igen; nincs ilyen terhelési bizonyíték | E03/E06/E37 |

### 4.2. Implementációs bizonyítékjegyzék

A linkek repository-relatívak; a `:sor` jelölés a baseline-ban ellenőrzött belépési pont.
A tesztfájl neve jelzi az ellenőrzés helyét; futtatási eredményt csak a 9. fejezet ad.

- **E01:** [agent-state/types.ts](../../agent-state/types.ts):42 `AgentIdentity`,
  :118 `AgentGoal`; [store.ts](../../agent-state/store.ts),
  [context.ts](../../agent-state/context.ts):10/44 és `agent-state/test/`.
- **E02:** [agent-memory-ingestion.ts](../../server/gateway/admin/agent-memory-ingestion.ts),
  [retrieval.ts](../../agent-state/retrieval.ts),
  [agent-state README](../../agent-state/README.md) social-memory szerződése.
- **E03:** [autonomy-supervisor.ts](../../server/gateway/admin/autonomy-supervisor.ts):111/133/168,
  [autonomy-reconciliation.ts](../../server/gateway/admin/autonomy-reconciliation.ts)
  és az azonos nevű tesztek.
- **E04:** [gateway.ts](../../server/gateway/gateway.ts):1020–1150 bekötés;
  [supervisor.ts](../../server/gateway/admin/supervisor.ts):333 skillspawn,
  `durable-replan-coordinator.test.ts` és `supervisor-reconciliation.test.ts`.
- **E05:** [replan-runtime.ts](../../server/gateway/admin/replan-runtime.ts):138,
  exact avatar gate, approved template, dispatch és approval-required goal proposal;
  :124 inputhiányos fallback; [goal-templates.ts](../../server/gateway/admin/goal-templates.ts).
- **E06:** [llm-dry-run.ts](../../server/gateway/admin/llm-dry-run.ts):20,
  [orchestrator.ts](../../llm-runtime/orchestrator.ts),
  [planning.ts](../../llm-runtime/planning.ts), `llm-runtime/test/`.
- **E07:** [executor.ts](../../agent-skills/executor.ts),
  [rs-sdk-runtime.ts](../../agent-skills/rs-sdk-runtime.ts),
  [authorization-envelope.ts](../../server/gateway/admin/authorization-envelope.ts).
- **E08:** [types.ts](../../agent-skills/types.ts):48 műveletunion,
  [catalog](../../agent-skills/catalog),
  [15.8 capability coverage](features/phase15-8-capability-coverage.md).
- **E09:** [planner.ts](../../agent-state/planner.ts):22/45;
  highest-priority immediate és seedelt holtverseny; személyiség nem ezen policy
  explicit hasznossági bemenete.
- **E10:** [progression.ts](../../character-attributes/progression.ts):30,
  [experiment.ts](../../character-attributes/experiment.ts):88,
  [character-attributes leírás](features/character-attributes.md).
- **E11:** [society-experiments/source.ts](../../society-experiments/source.ts)
  `attributeAuthority: declared-seeded-input-not-engine-enforcement`;
  [WorldMods.ts](../../server/engine/src/mods/WorldMods.ts) valódi XP-hookok.
- **E12:** [maintenance.ts](../../needs/maintenance.ts):81,
  [dynamics.ts](../../needs/dynamics.ts):125, [needs leírás](features/needs.md).
- **E13:** [closure.ts](../../food-loop/closure.ts):32,
  [consumption-store.ts](../../food-loop/consumption-store.ts):19 és `food-loop/test/`.
- **E14:** [tenancy-store.ts](../../housing/tenancy-store.ts),
  [engine-storage-runtime.ts](../../housing/engine-storage-runtime.ts), `housing/test/`.
- **E15:** [item-lifecycle/store.ts](../../item-lifecycle/store.ts),
  [production-cycle.ts](../../item-lifecycle/production-cycle.ts),
  [tool-cycle config](../../config/production-tool-cycles.json).
- **E16:** [PropertyStore.ts](../../server/engine/src/mods/PropertyStore.ts),
  [PropertyRuntime.ts](../../server/engine/src/mods/PropertyRuntime.ts),
  [properties leírás](features/properties.md).
- **E17:** [business-manager.ts](../../server/gateway/admin/business-manager.ts):22–103,
  [business-agent-port.ts](../../server/gateway/admin/business-agent-port.ts),
  [business-work/work.ts](../../business-work/work.ts):66,
  [control.ts](../../agent-state/control.ts):13.
- **E18:** [economic-contract-settlement.ts](../../server/gateway/admin/economic-contract-settlement.ts)
  és tesztje; [institution-treasury.ts](../../server/gateway/admin/institution-treasury.ts).
- **E19:** [phase15-business-flow.test.ts](../../server/gateway/admin/phase15-business-flow.test.ts):35
  két munkás + Business fixture; a megbízást a teszt állítja elő, nem autonóm manager.
- **E20:** [banking-ledger.ts](../../server/gateway/admin/banking-ledger.ts),
  [banking-loans.ts](../../server/gateway/admin/banking-loans.ts),
  [banking-mvp.test.ts](../../server/gateway/admin/banking-mvp.test.ts).
- **E21:** [agent-operated-shop/lifecycle.ts](../../agent-operated-shop/lifecycle.ts):44,
  [business-stock-policy/policy.ts](../../business-stock-policy/policy.ts):9,
  [pilot script](../../scripts/run-agent-shop-live-accounting.ts).
- **E22:** [ShopEconomyPolicy.ts](../../server/engine/src/mods/ShopEconomyPolicy.ts),
  [finite shops](features/finite-legacy-shops.md),
  [migration catalog](../../config/economic-npc-migrations.json).
- **E23:** [ExperimentMarket.ts](../../server/engine/src/mods/ExperimentMarket.ts),
  [grand-exchange leírás](../grand-exchange.md). Az árképzési építőelemekből
  nem következik belső szükségletvezérelt kereslet.
- **E24:** [wip-store.ts](../../production-workflow/wip-store.ts):39,
  [production-workflows config](../../config/production-workflows.json),
  [WIP leírás](features/production-work-in-progress.md).
- **E25:** [ProductionCapitalService](../../production-capital/service.ts):21,
  [logistics/planner.ts](../../logistics/planner.ts):17,
  [facility-capability](../../facility-capability), a kapcsolódó modulok tesztjei.
- **E26:** [governance.ts](../../server/gateway/admin/governance.ts):5–61,
  [governance-agent-port.ts](../../server/gateway/admin/governance-agent-port.ts),
  [governance leírás](features/governance.md).
- **E27:** [ThievingEvidenceStore.ts](../../server/engine/src/mods/ThievingEvidenceStore.ts),
  [crime-cases](../../crime-cases), [crime-checkpoints](../../crime-checkpoints),
  [PHASE22_PROGRESS.md](PHASE22_PROGRESS.md), célzott skill/crime tesztcsomag.
- **E28:** [population-death-runtime.ts](../../server/gateway/admin/population-death-runtime.ts),
  [PlayerHealthEvidenceStore.ts](../../server/engine/src/mods/PlayerHealthEvidenceStore.ts),
  [gateway.ts](../../server/gateway/gateway.ts):89–104; population testkönyvtárak.
- **E29:** [estate/runtime.ts](../../population-estate/runtime.ts):11,
  [estate/source.ts](../../population-estate/source.ts):24/199, `estate.test.ts`.
- **E30:** [inheritance.ts](../../population-estate/inheritance.ts):47/117,
  [öröklési scope](features/phase23-7-population-inheritance.md),
  [policy](../../config/population-inheritance-policy.json) üres bindinglista.
- **E31:** [entry.ts](../../population-lifecycle/entry.ts):118,
  [admin entry](../../server/gateway/admin/population-entry.ts),
  [23.9 scope](features/phase23-9-population-entry.md), `population-entry.test.ts`.
- **E32:** [controller.ts](../../society-experiments/controller.ts),
  [comparison.ts](../../society-experiments/comparison.ts):85 és az explicit
  `causalEffectEstablished=false`/RNG-korlátok; `controller.test.ts`.
- **E33:** [manual-play](setup/manual-play.md),
  [actor identity boundary](features/actor-identity-boundary.md),
  [player-only witness reports](features/player-only-witness-reports.md).
- **E34:** [SimulationClock](../../simulation-clock),
  [world-genesis/result.ts](../../world-genesis/result.ts),
  [genesis provenance](../../world-genesis/provenance.ts), tesztkönyvtáraik.
- **E35:** [archive.ts](../../society-experiments/archive.ts):112/141/171,
  [24.11 protokoll](features/phase24-11-society-benchmark.md),
  [JavaRandom.ts](../../server/engine/src/util/JavaRandom.ts):66.
- **E36:** [evaluation-report.ts](../../society-metrics/evaluation-report.ts):16,
  [evaluation.ts](../../society-metrics/evaluation.ts),
  [report.ts](../../society-metrics/report.ts),
  [demográfiai forrás](../../server/gateway/admin/population-demographics.ts).
- **E37:** [InferenceQueue](../../llm-runtime/queue.ts):63,
  [budget.ts](../../llm-runtime/budget.ts),
  [inference-queue-store.ts](../../llm-runtime/inference-queue-store.ts).

**H01 – megtalált történeti acceptance:**
`phase15-soak-20260912T201229Z-a104dbef`, helyi
`.local/phase15-soak/.../acceptance.json`; a `bundleDigest` mező
`975ebb737bb04332c39cc80632607157e6f65df12df508a350bad25615ffc7de`,
`criteria.accepted=true`, hat persistent agent, tervezett engine/gateway restart,
nem tervezett beavatkozás nélkül. A dokumentált futás 3600,58 s. A mezők és a
fájl jelenléte ellenőrzött; az összes mögöttes run újbóli hitelesítése nem történt.
Ez hatékony ellenbizonyíték a „sosem volt autonóm loop” állításra, de nem food/
needs/generációs acceptance.

**H02 – megtalált boltpilot:**
`.local/economy/agent-shop-live/acceptance-report.json`, `passed=true`,
`evidenceDigest=447ceae4f641edc94a512bb907b85382a46ed8c8f4fe091cf2bc63018ecb2427`.
A riport: 8 kalapács, 935 GP, 15 GP bevétel, 60 GP beszerzés, 20 GP bér,
−65 GP eredmény. Ez működő véges elszámolás; egy veszteséges, előkészített pilot
nem fenntartható kereslet vagy autonóm piac bizonyítéka.

## 5. Architektúra és integrációk

### S2 – gazdasági és generációs kapcsolatok

**KÓD:** a `BusinessManagerStore` tulajdont, munkaviszonyt és policyt tartósít;
a `BusinessStockPolicy` árazási módja jelenleg `fixed`
(`business-stock-policy/policy.ts:9`). A készlet, treasury, bér és termelési WIP
valós tranzakciós építőelemek; az autonóm vállalkozásalapítás és a belső
áralkalmazkodás ettől még nincs bizonyítva.

**KÓD:** a `ProductionWorkInProgressStore` a Business-adatbázisban foglal
inputot és könyvel outputot, de a normál engine/gateway útvonalakra végzett
keresés nem talált futó WIP-koordinátort. Az `AgentOperatedShopLifecycle`
élő fogyasztója egy dedikált pilot script; a bolti sikert nem általános
folyamatos intézményi működésként értékeljük.

**KÓD:** a halál utáni custody a saját Business-t `dormant` állapotba teszi
(`population-estate/source.ts:199`), a meghalt munkás munkaviszonyát lezárja.
Ez megóvja a vagyont, de nem tulajdonosi/vezetői utódlás. A custody nyolc domain
táblaneveit és részletes sémáját közvetlenül ismeri (`source.ts:24`); ez
megalapozott későbbi karbantartási kockázat, nem igazolt adatvesztés.

**KÓD + TERV:** az új népességbelépő csak tartós identity/membership;
account, credential, cél, skill, vagyon és enrollment nélkül. A belépés
pause-olt clockot és explicit admin batch-et igényel. Nincs bizonyított
önműködő generációs utánpótlás (`population-lifecycle/entry.ts:118`,
`features/phase23-9-population-entry.md`).

**KÓD + TERV:** a `closed-society` engine-kapu letiltja a legacy boltot és
restockot, de a gazdasági NPC-cutover katalógusa `planning-only`.
Ezért a „végtelen NPC-gazdaság megszűnt” általános kijelentés nem igazolt.
A mód kiválasztása és a helyettesítő szolgáltatás működése külön feltétel.

### 5.1. A tényleges futási architektúra

```text
Tartós enrollment + event inbox
  → due supervisor + lease + friss avatármegfigyelés
  → determinisztikus immediate planner / ritka LLM-javaslat
  → exact skill + tudás + authorization envelope + budget
  → BotSupervisor → deklaratív executor → SDK → kliens/gateway → engine
  → journal / engine receipt
  → goal, memory, economy ingestion + settlement recovery → következő esemény
```

A fenti út forrásban bekötött (E03–E07). A Business/Faction portok, a tiszta
needs/adottság modellek és a WIP-könyvelés nem automatikusan ennek részei.
Egy institution tool nevének megjelenése a contextben még nem LLM által
meghívható végrehajtó és nem folyamatos institution-lifecycle.

**Erős pont:** a stratégiai döntés nem tickvezérlés; a rendszer exact verziót,
paraméterforrást, partner-, mennyiség-, árszint- és költségkorlátot ellenőriz.
A modell nem kap általános shellt vagy SQL-eszközt. A skillkészítés deklaratív,
a publikálás külön trust-határ. A queue, ledger, event és run ID-k jó alapot
adnak restartálló orchestrationhöz. Ezt meg kell őrizni.

**Legnagyobb architekturális kockázat:** két párhuzamos igazság alakulhat ki:
az engine-ben egy játékos műveletet végez, a domainledgerben pedig egy teszt
vagy megbízhatónak deklarált adapter más termelést/felhasználást könyvel.
Például a WIP-befejezés pontos input/output egyezést ellenőriz, de a termelési
esemény hiteles fizikai forrását a bekötött consumernek kell garantálnia.
Enélkül egy érvényes digest csak belső konzisztencia, nem megtörtént játékművelet.
Ez integrációs és authority-probléma; új receptek felvétele nem oldja meg.

Nem indokolt az egész rendszert újraírni. Az engine-owned fizikai állapothoz
natív receipt-adapterek, a domain-owned állapothoz explicit írási jogosultság,
a köztük lévő folyamathoz tartós intent/checkpoint/reconciliation szükséges.
Minden új adaptert a már meglévő executor/settlement útba kell kötni.

### 5.2. Rendszerszintű értékelés

| Szempont | Értékelés | Mi korlátozza most? |
| --- | --- | --- |
| Agent autonomy | Jó operatív alap, részleges stratégia | Ismert rutinok futnak; új célfa, beszerzési terv, társadalmi/domain-döntés nem általánosan önálló |
| Agent heterogeneity | Adatban létezik, következményben nem bizonyított | Promptbeli trait és seedelt tie-break nem igazolt temperamentum; potenciál nincs normál XP-be kötve |
| Social interactions | Megbízható tranzakciós és memória-alap | Kölcsönös szándékegyeztetés, alku, bizalomváltozás, konfliktusfeloldás nem teljes autonóm lánc |
| Economic sustainability | Nyitott termékbizonyítás | Keresleti nevező, fizikai végső fogyasztás, eszközpótlás és belső inputok összekötése hiányos |
| Generational continuity | Biztonságos lezárás, hiányos újratermelés | Új member nem aktív avatár; ingatlanon túli hagyaték és család hiányzik |
| Institutional continuity | Jogi személy elkülönül, működési utódlás hiányzik | Elhunyt tulajdonos Business-e dormant; nincs autonóm vezető-/jogosultságváltás |
| Simulation integrity | Erős szűk kapuk, nem teljes bizonyítás | Receipt-bizalom, eltérő adatforrások, read-snapshot határok és minden út lefedése további igazolást kér |
| Scalability | Eszközök vannak, mért kapacitás nincs | Soros plannerqueue, teljes listázások/DB-nyitások, avatáronkénti folyamat, sűrű reconciliation |
| Human integration | Közös világ megvan, közös társadalmi termék nem | Adminművelet nem játékosjog; Propertyn túl több domainhez nincs emberi játékworkflow |
| Extensibility | Jó adatvezérelt modellek, drága kereszt-domain kötés | Új típushoz receipt, authority, projection, runtime és migráció kell; nem puszta JSON-bővítés |

### 5.3. Konkrét integrációs rések

1. **Needs → self-care → engine → végső fogyasztás.** A tiszta modellekből
   nincs megtalált normál writer. Az engine HP-heal nem automatikusan hunger
   relief. A kiéhezés és a fiziológiai kereslet jelenleg nem igazolható minden
   enrolled karakteren. Következmény: a „megélhetés” maradhat coin-/XP-farm.
2. **Food-trace több szereplő között.** A `closeFoodLoop` ugyanazon agent három
   receiptjét köti össze. Ez jó egyéni pilot, de farmer→szakács→vevő átadásához
   item lineage + tulajdonosváltás + végső fogyasztó követés kell. Ugyanazt az
   egységet nem szabad három termelőnél háromszor belső ellátásnak számolni.
3. **Recipe/WIP → fizikai készlet.** A recipe `production.cook-item` és
   `production.smelt-bronze` referenciája nem megtalált verified katalógusverzió
   bizonyítéka. A WIP Business-készlet és az avatar inventory közti custody is
   explicit adaptert igényel. A forráskatalógusban nincs külön typed consume-food
   vagy cook-item művelet (E08); generikus interact létezése nem acceptance.
4. **Készlethiány → új cél → beszerzés.** Typed `acquire-input` felismerés van,
   de a fallback nem bizonyít önálló beszerzési láncot. A mostani célhaladás
   sikeres skillrunok száma; nem általános, állapotfüggő életszükséglet-cél.
5. **Business-policy → munka → ellátás/értékesítés.** A régi player-action
   request és a későbbi szerep/műszak WorkStore külön életciklus. A 15-ös
   integrációt nem szabad automatikusan teljes 20–21-es runtime-integrációnak
   tekinteni. Egy közös adapter szükséges, a treasury settlement megőrzésével.
6. **Halál → jogi őrizet → utódlás.** A custody biztonságot ad, de zárolt
   vagyont hagyhat hosszú ideig. Jelenleg több bizonytalan claim blokkolja a
   személyes Property szűk átadását is. Nincs automatikus követelésrendező bíró;
   ennek hiánya nem oldható fel a blokkolók csendes törlésével.
7. **Belépő → tanulás/munka/tulajdon.** A generált identity korlátozottan
   számít népesség-utánpótlásnak, amíg fiók, starter-custody, skill, cél és
   enrollment nem teszi cselekvőképessé. Az eredeti alapítócohort hosszúfutás-
   protokollját a generációs méréshez külön módon kell bővíteni.
8. **Human actor → minden domain.** A fizikai engine és a player-only witness
   út bizonyítja, hogy nem minden emberhez kell AI-identity. A szerződéses és
   foglalkoztatási út gyakran agentId-t kíván; ehhez kontroll nélküli emberi
   actor-kötés és játékosjogosultság kell, adminhozzáférés helyett.

### 5.4. Architektúrahiány és funkcióhiány elkülönítése

- **Architektúra/integráció, P0:** egységes fizikai evidence/custody-szerződés,
  tartós needs-writer, hiányos read-projection lefedettség. A meglévő alapokon
  megoldható, de kereszt-domain migrációs és duplikációs kockázatú.
- **Architektúra-bővítés, P1:** player és institution stratégiai döntésének
  közös admissionje, szerepspecifikus typed domain-akciókkal. A jelenlegi
  lease/queue/budget újrafelhasználható; külön második plannerloop kerülendő.
- **Funkció, P1/P2:** automatikus beszerzési terv, pénz-/Business-utódlás,
  aktív új belépő, valós áralkalmazkodás, család/tagság/vezetés.
- **Bizonyítás, P0/P2:** minimum society és skálázási acceptance. Ezek hiánya
  nem automatikusan hibás implementáció, de a céltermék készre jelentését gátolja.

Az estate közvetlen SQL-sémakapcsolása külön kockázat: új domain hozzáadásakor
a nyolc forráshoz kötött guardok könnyen nem látják az új claimet. Javaslat:
versioned source adapter-regiszter, explicit támogatottság és hiányzó forrásnál
fail-closed állapot. Ez fokozatos refaktor, nem azonnali mindenmodulos átírás.

## 6. End-to-end forgatókönyvek

Minden értékelés a teljes felhasználói forgatókönyvre vonatkozik. A következő
automatikus/manuális lépések **JAVASOLT elfogadási próbák**, nem lefuttatott
vizsgálatok. A most futtatott temp-fixture teszteket a 9. fejezet sorolja fel.

### A. Önálló megélhetés – PARTIAL

- **Működik:** ismert verified gyűjtési/shop/bank rutin, célhaladás,
  memória-ingestion és restart; a H01 ezt korábban hat avatárral mutatta.
- **Részleges:** élelem, alvás, bérlet és eszközpótlás külön domainként;
  a cél nem automatikusan fennmaradás, gyakran előre kiosztott rutin.
- **Hiányzik:** tartós hunger/fatigue, hiteles elfogyasztott étel, megkeresett
  jövedelemből finanszírozott belső ellátás, hiány utáni autonóm beszerzés.
- **Összekötés:** E12/E13/E14/E15 ↔ E05/E18 ↔ engine inventory.
- **Automatikus próba:** négy szereplős fixture, egyik eladja a nyers ételt,
  másik feldolgozza, harmadik/negyedik jövedelemből veszi és elfogyasztja;
  üres input, árplafon, hozzáféréshiány és restart esetén typed fallback;
  nincs adminérték vagy végtelen NPC-vétel/eladás. Hunger nem reliefelhető
  item-removal receipt nélkül; ugyanaz a receipt nem játszható újra.
- **Manuális próba:** néző kliensből követni a tényleges gathering/cooking/
  transfer/eating/resting eseményeket; a trace és a készlet/GP egyezzen.
- **Siker:** a roadmap G05 demo küszöbei; hosszú önfenntartáshoz külön a
  jelenlegi society-minimum többnapos feltételei, nem a rövid demo.

### B. Vállalkozás alapítása és működtetése – PARTIAL

- **Működik:** Business létrehozás, employment/role/policy, finite stock,
  treasury és exact munka/jutalom; H02 pilot hiteles történeti részlet.
- **Részleges:** manager-port javasolhat, player-action delegáció fizethet;
  WIP-könyvelés több lépést kezel.
- **Hiányzik:** az agent maga fedez fel lehetőséget, saját jogán alapít,
  munkást keres, inputot szerez és tartós vevői keresletből fennmarad.
- **Összekötés:** stratégiai typed Business-akció → szerepjog → munka →
  fizikai/WIP receipt → készlet → eladás → treasury → bér/költség → új döntés.
- **Automatikus próba:** véges tőkéből két piaci lehetőség közül választás,
  legalább egy munkásnak teljesített bér, visszautasított dupla inputfoglalás,
  elégtelen pénznél leállás/áttervezés; megszakítás settlement közben és replay.
- **Manuális próba:** az intézmény döntési trace-e és a két avatár
  tényleges munkája/átadása; admin csak előre elfogadott policyt állít be.
- **Siker:** valós végfelhasználóhoz jutó termék, teljes költségkimutatás;
  nyereség nem kötelező minden futásban, a veszteség ne váljon ingyen pénzzé.

### C. Társadalmi szerveződés – PARTIAL

- **Működik:** tartós kapcsolatok, commitment, Business-szerepek,
  Faction/Jurisdiction/kincstár/adó. Ezek többek puszta címkéknél.
- **Részleges:** közös gazdasági célból work order és intézményi policy.
- **Hiányzik:** általános, agentek által létrehozott tagság, belépés/kilépés,
  képviselet, vezetőválasztás/utódlás és belső konfliktuskezelés.
- **Összekötés:** megfigyelt kapcsolat → közös javaslat → tagsági authority →
  közös treasury/Property → döntés és megbízás → egyéni consent/jog.
- **Automatikus próba:** három eltérő érdekű agent együttműködést ajánl;
  legalább két tag elfogadja, egy visszautasítja; jogosulatlan treasury-használat
  tiltott; konfliktus/kilépés után nincs árva jogosultság.
- **Manuális próba:** kizárólag az adott actor számára látható információból
  követhető tagság és döntés. Nem szkriptelt „most alapíts céhet” történet.
- **Siker:** a döntésekből származó tartós együttműködés; első körben Business
  elég, teljes politikai rendszer nem előfeltétel.

### D. Generációváltás – PARTIAL

- **Működik:** engine-death, terminális avatar, memóriaarchívum, gazdasági
  guard/custody, kiválasztott személyes Property admin-öröklése.
- **Részleges:** explicit semantic tudásátadás és seedelt felnőtt belépők.
- **Hiányzik:** pénz/item/equity rendezése, családi szabályok, aktív új életút,
  működő Business irányításának öröklése. Az alapító halálával a szervezet
  fennmaradó sora még nem intézményi folytonosság.
- **Összekötés:** death → custody → követelések rendezése → policy-heir →
  asset/role/treasury új jog → új aktív avatar → termelés újraindulása.
- **Automatikus próba:** tulajdonos halála nyitott hitellel, pending bérrel és
  futó szerződéssel; ismert recovery-pontokon crash; az örökös csak támogatható
  vagyont kap, nincs resurrection, duplikált coin vagy fizikai jog. A Business
  vagy szabályosan továbbtermel, vagy explicit felszámolásba kerül.
- **Manuális próba:** halott account belépése/művelete tiltott; örökös
  inventory/Property/szerep és a közös mérleg összevetése.
- **Siker:** legalább két kohorszváltásnál megmaradó szolgáltatás és teljes
  leltáregyezés; ez új M2 elfogadás, a mostani 23-as MVP-státuszt nem írja át.

### E. Gazdasági sokk – PARTIAL / adaptív kimenet UNKNOWN

- **Működik:** megfigyelt függőségi gráf, kiesési sérülékenységi számítás,
  verziózott paraméterek, explicit import/export-mérés.
- **Részleges:** inputhiány és failure osztályozás; költség- és stock-limit.
- **Hiányzik:** igazolt alternatív beszállító, árválasz, fogyasztáscsökkentés
  vagy termékhelyettesítés; a statikus gráfkiesés nem dinamikus sokkpróba.
- **Összekötés:** valós készlet/termelési shock → elérhető ajánlatok/context →
  korlátos új terv → új trade/munka → kereslet és túlélés idősor.
- **Automatikus próba:** baseline után egy beszállító előre rögzített kivonása;
  készletarány, ellátatlan igény, ár, új partner és helyreállási idő mérése.
  Azonos baseline kontrollja ne kapjon ilyen kivonást; más policy ne változzon.
- **Manuális próba:** üres raktár és valódi sikertelen beszerzés látható;
  az LLM tudása nem tartalmazhat rejtett másik agent inventoryját.
- **Siker:** értelmezhető alkalmazkodás vagy jól megmagyarázott összeomlás.
  A negatív eredmény is kutatási eredmény, implementációs hibát külön kell jelölni.

### F. Emberi játékos – PARTIAL

- **Működik:** ugyanazon helyi engine világában vanilla kliens, látható botok,
  fizikai trade/Property-mechanikák; külön player-only witness-forrás.
- **Részleges:** több társadalmi API adminon át érhető el; az admin UX/paritás
  lezárása nem human-gameplay paritás.
- **Hiányzik:** játékosjogon ajánlat/szerződés, munkavállalás, lakhatás,
  szervezeti tagság és utódlás közös szabályú végigvitele.
- **Összekötés:** hiteles player account → persistent actor, opcionális AI
  kontroll nélkül → közös typed domain service → engine-visszajelzés.
- **Automatikus próba:** emberként hitelesített kliens ugyanazt a szerződést
  köti és bért kapja, mint az AI; más playerét nem írhatja; logout nem
  enrollment és nem automatikus LLM-átvétel; double-login/control tiltás.
- **Manuális próba:** valódi vanilla játékos ételt vesz AI-tól, munkát vállal,
  elalszik/kijelentkezik/visszatér, a közös ledger és időkezelés egyezik.
- **Siker:** nincs adminjog a normál gazdasági/social részvételhez; a tartós
  emberi identitás nem függ az AI-planner engedélyezésétől.

### G. Kiegészítő integritási és reprodukciós próba

Egész értéklánc közepén gateway/engine restart, duplikált/eltérő receipt,
hiányzó source, árult lopott input és tiszta utódoutput tesztelendő.
Automatikus sikerfeltétel: újrajátszáskor nulla extra GP/item/goal-transition,
hiánynál bizonytalan/blokkolt állapot, majd ugyanazon intent folytatása.
Manuálisan az offline restore csak külön világkönyvtárba történjen.
Ez a meglévő recovery/benchmark tesztek közös gazdasági kiterjesztése.

## 7. Metrikák és reprodukálható kísérletek

### S2 – bizonyított mérési határok

A tíz többcélú képlet implementált, de a natív facade csak receptfelelősségből
specializációt és megfigyelt kiesési kockázatot táplál. A hiányzó keresleti
nevezők miatt a belső önellátási hányad nem igazolható. Nincs automatikus
teljes Gini-/mobilitás-/árkosár-/munkanélküliségi történet
(`society-metrics/evaluation-report.ts:16`).

Az offline archívum forrást, konfigurációt, cache-t, mentéseket és társadalmi
adatbázisokat tartalmaz; új könyvtárba állítható vissza. Ez erős indulóállapot-
és eredménymegőrzés, de nem élő, több adatbázison atomi snapshot és nem teljes
determinisztikus engine-visszajátszás. A JavaRandom alapértelmezett seedje
`Math.random()` (`server/engine/src/util/JavaRandom.ts:66`), a kontrollriport
pedig maga is jelzi az RNG- és oksági korlátokat. Ugyanaz a genesis seed nem
garantálja ugyanazt az egész társadalmi pályát.

### 7.1. Technikai, játékmeneti és kutatási siker különválasztása

- **Technikai működés:** crash/retry hibaarány, event-lag, duplikáció,
  stale source, accounting egyezés, blocked/quarantine ok és recovery-idő.
  A legtöbb jelenlegi teszt ezt vizsgálja; ez nem túlélési siker.
- **Játékmenet:** megélhetési lehetőség, teljesíthető munka, lakhatási/étkezési
  hozzáférés, elveszett idő és érthető emberi visszajelzés. A nulla halál sem
  minőségbizonyíték, ha szükséglet sosem futott.
- **Kutatás:** mechanizmusváltozás melletti reprodukálható megfigyelés,
  kontroll és ismétlések, megfelelő kohorsz, hiánykezelés és bizonytalanság.
  Egy eseménydús run vagy alacsony Gini nem általános „jó társadalom”.

### 7.2. Ajánlott mérések és a jelenlegi támogatás

Minden új adatgyűjtés **JAVASLAT**; a 24.9 képleteit és meglévő ledgerolvasókat
újra kell használni. Az ismeretlen érték ne legyen nulla.

| Terület | Meglévő támogatás | Javasolt mérés és hiányzó forrás |
| --- | --- | --- |
| Népesség, élettartam, generáció | Külön 23.10 natív demográfia, finite membership/death | Születés/belépés/halál külön; person-time mortalitás, túlélési görbe, kohorsz és generáció. Ismeretlen születés és jobb oldali cenzorálás jelölése; rokonsági generáció még nincs |
| Vagyon és mobilitás | Gini/rangmozgás képlet kész, facade-adat hiányzik | Azonos határon GP-cash, treasury, követelés, adósság; tárgyi vagyon külön értékelési policyval. Nyitó/záró azonos actor, átlagrangos holtverseny; személyes és intézményi vagyon ne duplázódjon |
| Termelés és árak | WIP-felelősség és gazdasági trade-journal, részleges gráf | Fizikai eladható output/munkaóra, selejt és éhezés miatti kiesés; exact item/quantity/GP unit-price, kosárindex, forgalom és spread, nem átlagolt eltérő itemár |
| Fogyasztás, hiány, tartalék | Food/tool/housing diagnosztika | Teljes igény minden aktív actorra, tényleges felhasználás, unmet-demand idő, forráseredet és tartalék/igény arány. Alvó/offline/dead idő külön szerződéssel |
| Foglalkozás, munkamegosztás | Recipe-stage HHI; employment és munkakör | Fizikailag végzett idő, jövedelem és output alapján foglalkozási részesedés; cross-actor végfelhasználási lánc. A responsible agent nem feltétlenül a munkás |
| Vállalkozások | Business status, stock/treasury és pilot profit | Alapítás, bezárás/csőd külön okkód; tőke, cashflow, hozzáadott érték, bér, készlet és beruházás; alapítóhalál utáni szolgáltatáskiesés |
| Társadalmi hálózat | Directed relationship, familiarity/commitment és trade | Időbélyegzett csere/segítség/konfliktus-élek, reciprocitás, partnerkoncentráció, hálózatkomponensek; megfigyelői bizalom külön a globális outcome-tól |
| Intézményi stabilitás | Business-role/Faction állapot, nincs általános tagságtörténet | Tag- és vezetőváltás, szabálymódosítás, közös vagyon, tagélettartam, szervezet túlélése alapító nélkül; G09 után mérhető teljesen |
| Személyiség/adottság | Trait context, seedelt profile, tiszta XP-kísérlet | Párosított induló feltételek, egy tengely változtatása, életút/partner/kockázat/specializáció eloszlása. Policyhatás és LLM-szöveghatás külön ablatív kontroll |
| Döntés és célkövetés | Goal success-run progress, decision ledger, failure fingerprint | Állapotcél teljesülési arány, idő és budget/cél; abstain, replan, acquisition fallback, persona-konzisztencia; a skill exit 0 ne legyen automatikus életcél-siker |
| LLM-költség és operatív megbízhatóság | Audit model/token/cost, napi budget, queue, run journal | Request/actor/sim-nap, input/output token, elszámolt költség, p50/p95 latency, wait/service idő, retry és cache. Skilleknél exact verzió, terminális ok, megszakítás és siker/attempt nevező |

Az exportban külön kell őrizni az eseménytáblát és a származtatott metrikát.
Ajánlott minimális eseményszerződés: run/world/actor ID, source kind/ID/digest,
schema/policy/clock verzió, simulation timestamp és wall timestamp,
causation/correlation ID, input/output mennyiség és authority minősítés.
Ez a meglévő bound stampek és economic/provenance események egységes exportja
legyen, ne új párhuzamos főkönyv.

Pénzügyi ellenőrző egyenlet: záró GP = nyitó GP + igazolt forrás − igazolt
elnyelő + nettó import; a belső transzferek összege nulla. Itemre típusonként
nyitó + termelés + import − inputfelhasználás − végső fogyasztás − export −
igazolt veszteség = záró. Átalakításkor recept és lineage köti össze az itemeket,
nem értelmetlen összesített darabszám-megmaradást várunk.

### 7.3. Reprodukálhatósági szintek

1. **Kezdőállapot reprodukció:** meglévő seed/profile/genesis/attribute digest
   és offline baseline; támogatott. Konfiguráció, forrásfa, cache, runtime és
   függőségek ugyanazon változatai szükségesek, a commit önmagában nem elég.
2. **Eredmény újraolvasása:** archivált natív ledgerből ugyanaz a riport;
   meglévő benchmark célja, technikai teszt és sandboxkorlát a 9. fejezetben.
3. **Döntés visszajátszása:** rögzített validált LLM-válaszokkal és request-
   kötésekkel részlegesen modellezhető; a jelen audit nem igazolta teljes,
   minden domainre kiterjedő replay szolgáltatásként.
4. **Teljes világ bitazonos újrafuttatása:** nem támogatottnak tekintendő,
   amíg RNG-folyam, eseményütemezés és LLM-kimenet nem rögzített. Ehhez nem
   kell az első demót elhalasztani; az állítást kell korlátozni.
5. **Összehasonlítható kísérlet:** azonos baseline és megfigyelési protokoll,
   egy deklarált kezelés; jelenleg infrastruktúra van, élő elfogadás nincs.
   Az attribútumkezelés csak akkor valós kezelés, ha az engine alkalmazza is.

Javasolt kutatási protokoll: baseline és eredmény manifest párosítása; előre
rögzített hipotézis, mérési ablak és kimenetek; kontroll–kezelés több seedpáron;
a futási sorrend kiegyensúlyozása; minden sikertelen/contaminated run megőrzése;
hatásméret és bizonytalanság, nem csak egy kedvező példa. Az első pilot lehet
egyetlen páros futás, de ebből oksági általánosítást nem teszünk.

A napi / heti society-minimum időkeretét nem szabad egy rövid gyorsított demó
kedvéért csendben csökkenteni. A jelen konfiguráció 1:1; a minimum egy nap
bemelegítés + hét nap értékelés. Gyorsított profilnál előbb igazolni kell, hogy
az engine-ben elvégezhető fizikai munka és a needs/aging aránya nem torzul.

### 7.4. Skálázhatóság és költség

A megosztott inferencequeue soros végrehajtású, backlogja a gatewayben 100
(E06/E37). Fairness, retry/backoff és tartós claim létezik; ebből nem következik
ezer agent kapacitás. Az autonomy supervisor due-listája sorban halad, több
újratervezési pont teljes identity/snapshot listát olvas; processz- és SQLite-
költsége csak mérésből tudható. A 30 másodperces scan nem LLM-hívási periódus.

Tervezési kapacitásmodell: `λ = N × stratégiai_hívások/actor/óra`; soros queue
közelítő kiszolgálási kapacitása `3600 / átlagos_hívás_másodperc` óránként.
Ez becslési képlet, nem mért benchmark. A token- és árparamétert a futáskor
rögzített providerkonfigból kell venni; az audit nem állít aktuális modellárat.

Előbb mockkal mérjünk 10/50/100 actor mellett event-lagot, CPU/RAM-ot,
DB-lockot, processzszámot és hiányzó wake-upot; utána külön budgetes valódi
provider-mérést. A 23.9 policy 64 aktív member- és 256 élettartam-belépési
korlátja tudatos MVP-guard, nem elért teljesítmény. Ez és a frozen-founder
kísérleti kohorsz M2/M3 előtt explicit döntést kíván.

## 8. Hiányok, kockázatok és kritikus értékelés

### 8.1. A legfontosabb hiányok

| Gap / prioritás | Cél és akadály | Ha elmarad | Architektúra / függőség / javítás |
| --- | --- | --- | --- |
| G01 P0 – fizikai életfenntartási kör | R05; in-memory needs és receiptalapú food külön él a normál avatártól | Nincs belső túlélési kereslet, botok egymás mellett termelnek | Meglévő engine/executor/clock; perzisztencia és hiteles adapter; magas integrációs kockázat |
| G02 P1 – önálló korlátos stratégia | R01; új célterv és inputpótlás megállhat | Ismert rutinon kívül emberi mikromenedzsment | Meglévő lease/queue/goal/envelope bővítése; közepes–magas komplexitás |
| G03 P1 – Business működési lánc | R05/R06; könyvelés, munka, WIP és manager nem közös futó kör | Pilotgazdaság és admin által kiosztott munka marad | G01/G02, existing treasury/roles/settlement; magas receipt-/custody-kockázat |
| G04 P0 – natív outcome-mérés | R11; nincs teljes keresleti/forráseredet- és kohorszadat | Nem dönthető el a társadalmi minimum teljesülése | G01/G03 események; meglévő riportadapterek, nem új analytics motor |
| G05 P0 – közös működési bizonyítás | R07/R12; nincs teljes hosszú társadalmi acceptance | Újabb „DONE” sorok mellett a vízió állapota ismeretlen | 15.1 + 24 acceptance, 24.8 később; G01–G04 utáni zárt demo |
| G06 P1 – tényleges utánpótlás | R04; a member még nem cselekvő avatar | A kezdő népesség kimerül, belépők statisztikai sorok | 23.9 lifecycle/identity + account/executor/skill/custody; magas abuse/migrációs kockázat |
| G07 P1 – intézményi és vagyonutódlás | R04/R06; őrizet van, működési öröklés nincs | Felhalmozódó zárolt vagyon, alapítófüggő vállalkozások | Estate/bank/treasury/Business/Property guardok; nagyon magas kereszt-domain kockázat |
| G08 P1/P2 – valódi heterogenitás | R02/R03; trait/potenciál hatása nem igazolt | Optimális azonos rutinok, dekoratív személyiség | Engine-XP hookup + célpolicy + kontrollmérés; közepes–magas |
| G09 P2 – társadalmi tagság és képviselet | R06; általános organization csak backlog | Business/Faction marad, család/céh/klán nem önálló intézmény | G07 jogok és treasury; korlátozott közös infrastruktúra; magas |
| G10 P1 M3 – emberi szabályparitás | R08/R09; adminfelület ≠ emberi társadalmi belépés | Az RP-platform külön ág lesz vagy jogokat kerül meg | G01/G03/G07, player-only actor és közös service; magas auth-kockázat |
| G11 P2 – mért kapacitás | R10; nincs száz/ezer agent bizonyíték | Növekvő várakozás, költség és elmaradó wake-upok | Előbb metrika; utána célzott queue/scan/runtime optimalizálás, nem előre cluster |

Minden gap konkrét feladata, függősége, sikerkritériuma és meglévő taskhoz
rendelése a roadmap G00–G11 csomagjaiban szerepel.

### 8.2. Kritikus válasz a hét termékkérdésre

1. **Társadalomszimuláció vagy bot/modding rendszer?** Mindkettőből valós
   elemek vannak. A végrehajtás továbbra is rs-sdk avatarautomatizálás; a
   tartós gazdasági actor, szerződés, memória és véges élet már társadalmi
   platformalap. A társadalom reprodukcióját végző közös életciklus hiányos,
   ezért a végtermék közelségét az infrastruktúra mérete túlbecsültetné.
2. **Elegendő alap az emergenciához?** Jó szükséges alapok: lokális tudás,
   véges erőforrások, jogosultság, tartós következmények, csere. Nem elégséges:
   az alapvető kereslet, önálló stratégiai váltás, egymásra utaltság és
   counterfactual mérés még nincs együtt igazolva.
3. **Mi maradt ki a tasklistákból?** Nem újabb itemlista, hanem az értékteremtés
   és végső felhasználás folyamatos actor-közi lánca, a cselekvő utód, a közös
   intézményi consent/vezetés és a személyiség mérhető döntési hatása. A célok
   többnyire szerepelnek a vízióban; végrehajtható integrációs acceptance hiányzik.
4. **Mi készülhetett túl korán?** A bűnözés/justice, részletes XP-attesztáció,
   tőke/logisztikai modellek és a 25–26-os adminplatform mélysége az első
   food/self-care society demo előtt kockázatos sorrend. Ezek nem értéktelen
   vagy törlendő modulok. Munkaidőadatok nélkül nem állítható, mennyi idő volt
   elpazarolt; azt állítjuk, hogy további bővítésük most kisebb termékbizonyító
   értékű, mint egy zárt megélhetési szelet.
5. **Milyen technikai döntés korlátozhat?** Player-only automatikus planner,
   névhez kötött sabloncélok, inputhiánynál leálló fallback, hardcoded source
   sémák az estate-ben, autonóm napi időkeret és külön simulation-time,
   több DB snapshoteltérése, in-memory effektmodellek és folyamatonkénti avatar.
   Ezek közül több javítható lokális adapterrel; nem mind alapvető újraírás.
6. **A legfontosabb 3–5 lépés?** G01 életfenntartás, G02/G03 döntés és
   gazdasági együttműködés, G04 mérés, G06/G07 generációs folytonosság,
   G08 valódi különbségek. A sorrendet a G05 demonstrációs kapu fogja össze.
7. **Legkisebb bizonyító kísérlet?** Négy szereplő két kereszt-actor ellátási
   függőséggel, valós alapélelmiszer-termelés/fogyasztás és bér/csere, véges
   inputok, egy beszállítói fennakadás, egy restart. A kontrollban nincs fennakadás.
   A trace mutassa meg, ki kinek a termékéből él és hogyan tervez újra;
   a pusztán párhuzamos botfutás vagy scripted siker nem teljesítés.

**Távolság a víziótól:** a műszaki alap jelentős, az első valódi társadalmi
kör és az M2/M3 viszont nem tekinthető teljesítettnek. A legnagyobb bizonyítási
adósság ma az összekapcsolt normál működés, nem a funkciók név szerinti száma.

## 9. Auditkorlátok és hiányzó ellenőrzések

Élő világot, költséges LLM-hívást, nagy szimulációt vagy állapotmódosító
üzemeltetési próbát ez az audit nem indított. Az alábbi szakasznapló az időközi
eredményeket is megőrzi; az aktuális tesztítéletet a 9.1., a fennmaradó
ellenőrzéseket a 9.2. fejezet adja.

### S1 – szakaszzárás

- Vizsgálva: player-autonómia hívási lánca, LLM-kapu, szükséglet/adottság
  fogyasztók keresése, estate/öröklés, népességbelépés és natív metrikák.
- Bizonyított: a fenti integrációk jelenléte és határai. A 15. fázis eredményét
  nem szabad hiányzónak minősíteni a szeptemberi audit alapján.
- Ellenőrizetlen: teljes gazdasági körforgás, intézményi döntési lifecycle,
  emberi játékos útvonal, hosszú skála és generációváltás élőben.
- Következő: gazdasági/emberi jogosultságok, mérési lefedettség, célzott
  teszteredmények, majd forgatókönyvek és függőségalapú prioritások.
- Tesztközi eredmény: a `society-audit-boundaries` csomag 173 PASS / 2 FAIL,
  13,895 s. Mindkét hiba `EPERM` az ideiglenes CapabilityGap JSON átnevezésénél;
  ekkor a termékhiba vagy sandboxhatás elkülönítése még nyitott volt;
  ezt az S3 diagnosztika később lezárta. Napló:
  `.local/verification/20261018-131715-902-society-audit-boundaries.log`.

### S2 – szakaszzárás

- Vizsgálva: Business/stock/WIP, bolt/NPC-migráció, halál→custody→öröklés,
  új belépő, natív metrika és benchmark-reprodukció; CI és vendorhatárok.
- Bizonyított: több valós, auditált tranzakciós domain létezik, de ezekből
  nem következik önfenntartó gazdaság vagy intézményi utódlás.
- Ellenőrizetlen: élő A–F forgatókönyvek, többgenerációs és nagyléptékű futás,
  a historical acceptance csomag összes forrásbizonylatának újravalidálása.
- Tesztek: domaincsomag 535 PASS / 25 FAIL, 127,078 s; boundarycsomag
  173 PASS / 2 FAIL, 13,895 s. Összesen 708 PASS / 27 FAIL, nem teljes regresszió.
  A hibák között temp-rename EPERM, ideiglenes Git-config írási tiltás,
  valamint XP-/hosszúfutás-assertionök vannak. Utóbbiak okát nem tekintjük
  automatikusan környezetinek. Naplók: `.local/verification/20261018-131715-902-`
  előtaggal `society-audit-domains` és `society-audit-boundaries`.
- Következő: szűk hibadiagnosztika, bizonyítékmátrix, A–F értékelés és konkrét
  fejlesztési csomagok. Teszthiba miatt termékkódot nem módosítunk.

### S3 – forgatókönyvek, metrikák és hibadiagnosztika

- Vizsgálva: A–F láncok normál futási előfeltételei, natív adatforrások,
  kontroll/reprodukciós határok és a korábbi teszthibák.
- Bizonyított: az összes korábban hibázó tesztet tartalmazó hétfájlos,
  sandboxon kívüli célzott csomag **157 PASS / 0 FAIL / 0 SKIP**, exit 0,
  **58,724 s**. Forrásmódosítás nélkül futott. Az eredeti hibás kimenetek
  megmaradnak; az eltérő temp/sandbox feltételt nem rejtjük el.
- Ellenőrizetlen: mai élő A–F, nagy népesség, hosszú/generációs társadalmi
  futás és fizetős provider. A technikai teszt ezekre nem helyettesítő bizonyíték.
- Következő: a roadmap végleges csomaghatárai, dokumentumkonzisztencia és linkek.

### 9.1. A most futtatott ellenőrzések jegyzőkönyve

Minden parancs a `scripts/invoke-verification.ps1` wrapperen át futott;
teljes log és gépi `.result.json` a helyi `.local/verification/` könyvtárban.
Az eredeti parancsok és tesztfájl-listák ezekben pontosan visszakereshetők.

| Run / lognév | Kör | Eredmény | Parancsidő |
| --- | --- | --- | --- |
| `20261018-131715-902-society-audit-domains` | 16 domain tesztkönyvtár: needs/food/attributes/clock/genesis/population/state/LLM/society/experiments/dependency/trade | 535 PASS, 25 FAIL, exit 1 | 127,078 s |
| `20261018-131715-902-society-audit-boundaries` | Autonomy/replan/recovery/envelope/contract/bank és Business/WIP/housing/tool/facility/logistics határok | 173 PASS, 2 FAIL, exit 1 | 13,895 s |
| `20261018-132112-937-society-audit-failure-diagnostics` | Négy hibás fájl, repón belüli TEMP/TMP/TMPDIR | 81 PASS, 18 FAIL, exit 1; archive-takarítás/symlink sandboxkorlát | 72,975 s |
| `20261018-132150-656-society-audit-skill-crime` | Skill/trial, thieving, provenance/transformation, sale/fencing/crime és engine shop/XP | 282 PASS, 18 FAIL, exit 1 | 34,098 s |
| `20261018-132356-479-society-audit-skill-diagnostics` | Framework/trials/XP workspace-temp mellett | 56 PASS, 2 FAIL, exit 1; maradó hardlink-tiltás | 2,039 s |
| `20261018-133121-389-society-audit-unsandboxed-diagnostics` | A hét fájl összes korábbi hibás esete, ugyanazon forrás, sandboxon kívül | **157 PASS, 0 FAIL, 0 SKIP, exit 0** | **58,724 s** |

A legutóbbi csomag: `framework.test.ts`, `trials.test.ts`,
`DiminishingXp.test.ts`, `replan-runtime.test.ts`, `estate.test.ts`,
`archive.test.ts`, `controller.test.ts`. A környezetváltás indoka az ismételt
EPERM/EACCES rename/link/symlink/Git-config/cleanup hiba volt. A nemfájlrendszeri
assertionök is sikeresek lettek a célzott újrafuttatásban. Ez erős bizonyíték a
környezeti okozatra; a sandboxviselkedés termékkódbeli javítása nem történt.

A csomagok átfednek, ezért a darabszámokat nem adjuk össze különböző sikeres
tesztként. Egyik parancs sem `verify:full`; sem a teljes suite, sem minden
upstream játékművelet friss PASS-át nem állítjuk. A full kihagyásának oka:
csak két új dokumentum módosult; a runtime-tesztek auditbizonyítékot gyűjtöttek,
nem kódváltozás regresszióját vizsgálták. Typecheck/content/client build nem
indokolt dokumentációs változtatásra.

### S4 – dokumentumellenőrzési checkpoint

- Vizsgálva: a két új Markdown-dokumentum szerkezete, fennmaradó placeholder,
  sorvégi whitespace és minden Markdown-fájlhivatkozás.
- Bizonyított: **119 helyi link, 0 hibás cél**, formázás PASS;
  `20261018-134109-412-society-audit-documents`, exit 0, 1,371 s.
  A későbbi szövegpontosítások az eredmény és a történeti szakaszok közti
  különbséget tisztázzák, új runtime-állítást vagy fájlhivatkozást nem adnak.
- Ellenőrizetlen: a 9.2. listája változatlan; működési acceptance nincs késznek
  állítva. A történeti riportok teljes forráshitelesítése külön vizsgálat marad.
- Következő: megállás a két dokumentumnál; implementáció vagy szimuláció
  csak a felülvizsgálat közös értékelése után.

A `20261018-134230-501-society-audit-final-format` kiegészítő parancs exit 1-et
adott: a `git diff --no-index` az új fájl és az üres bemenet különbségét jelzi,
whitespace-hibát nem írt ki. Ezt a futást nem nevezzük PASS-nak; a végleges
ellenőrzés az untracked fájlokat közvetlenül olvasó link-/whitespace-vizsgálat.

Végleges dokumentumellenőrzés: `20261018-134302-402-society-audit-final-documents`,
**PASS, exit 0, 1,214 s**; 119 helyi link, 0 hiba, páros kódblokkhatárok és
whitespace rendben. A munkafa termékforrásban változatlan; csak ez a két új
dokumentum került a verziózható kimenetbe. Commit/push nem történt.

### 9.2. Pontosan mely ellenőrzések hiányoznak?

**A teljes működési audit nincs teljesítve.** A következő tételek hiányát
nem fedi el a dokumentumok elkészülte vagy a célzott technikai tesztek sikere:

1. A jelenlegi commiton az A–F forgatókönyvek teljes, hiteles engine-/kliens-
   végrehajtása; csak részútvonalakhoz van teszt és történeti pilot.
2. Az összekötött food/needs/housing/tool gazdaság hosszú élő működési
   acceptance-e. A 24-es minimum teljes ablaka és minden forráskapuja nincs
   lefuttatva/igazolva; a normál runtime-integráció előtte fejlesztendő.
3. A hat nyitott 24.8 kezeléstípus élő kontroll- és kezelésfutása,
   ismétlései, hatásméretei és korlátai.
4. Többgenerációs újratermelés: aktív utódok, pénz/készlet/Business-öröklés,
   két tulajdonosi/vezetői váltás utáni tényleges szolgáltatásfolytonosság.
5. Valódi emberi játékos teljes gazdasági/social workflow-ja, normál
   játékosjogokkal; offline/sleep/delegation és finite-life szabályparitás.
6. Több száz/ezer agent terhelési, időzítési, memóriás és provider-költségpróba;
   sem mockterhelés, sem fizetős stresszteszt nem indult.
7. Valódi providerrel a személyiség-/adottságfüggő stratégiai döntések és
   hosszú életutak empirikus ellenőrzése. A mock és XP-képlet tesztje nem ez.
8. Teljes mai `verify:full`, valamennyi engine/content/client integráció,
   build és minden nem választott teszt. A dokumentációs hatókör nem indokolta.
9. A H01/H02 valamennyi mögöttes run/engine receiptjének friss, teljes
   forráshitelesítése. A helyi riportot és dokumentált tartalmi digest mezőit
   ellenőriztük, nem futtattuk újra a történeti kísérletet.
10. Minden upstream/vendor fájl és minden feature-dokumentum soronkénti
    átolvasása, valamint minden lehetséges mutációs út biztonsági auditja.
    A releváns rétegeket feltérképeztük és a célvízió fő határait céloztuk;
    ez nem teljes kód-/biztonság-/penetrációs audit.
11. Minden konfigurációban létező világpéldány aktuális bekötései és privát
    override-jai. Titkokat és teljes élő adatbázisokat nem olvastunk ki;
    a committed default kikapcsolt LLM-je nem bizonyít helyi runtime-tiltást.
12. Teljes engine RNG- és LLM-event stream visszajátszás és bitazonos
    világfutás. A meglévő archívum/riportreprodukció korlátozottabb garancia.

A hiányzó élő és költséges vizsgálatokat a feladat korlátai miatt nem
helyettesítettük nagy szimulációval. A következő biztonságos lépés G00–G05
review-ja és a konkrét kis futási terv elfogadása, majd implementáció külön
utasításra. Az audit során termékforrás, taskstátusz és meglévő vízió nem változott.
