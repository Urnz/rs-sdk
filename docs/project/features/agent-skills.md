# Agent-skill keretrendszer

## Cél

Az agent skill ne egy bothoz másolt script legyen, hanem önálló, verziózott és
megosztható tudáselem. Ha egy agent megtalál egy jó Karamja–bank útvonalat, azt
szabványos skillként elmentheti; megosztott módban a következő agent felfedezheti
és megtanulhatja ugyanazt a verziót. Izolált kísérletben a közös könyvtár egyetlen
kapcsolóval kikapcsolható.

## Határok

```text
Agent / későbbi LLM
        │  SkillDefinition (adat, nem kód)
        ▼
validálás → registry → AgentSkillBook → végrehajtó → rs-sdk adapter
                 │              │              │
          shared/private   limit + audit   engedélyezett API
```

Az engine továbbra is a világ hiteles forrása. A skill keretrendszer nem módosít
save fájlt, szerveradatbázist vagy játékszabályt, és nem kap általános fájl-, hálózati
vagy shell-hozzáférést.

## V1 szerződés

Minden skillnek van:

- stabil `id` és szemantikus `version`;
- `draft`, `verified` vagy `deprecated` állapota;
- típusos bemeneti paraméterei;
- végrehajtás előtt ellenőrzött preconditionjei;
- kizárólag engedélyezett operation, repeat és egzakt verziójú skill-call lépései;
- futásidő- és műveletszám-korlátja;
- szerzője, létrehozási ideje és opcionális származási skillje;
- `shared` vagy agenthez kötött `private` láthatósága;
- egységes `SkillRunResult` kimenete és eseménysora.

A CLI-futtató a teljes eredményt és eseménysort változtathatatlan JSON-ként menti
a `.local/agent-skills/runs/<run-id>.json` könyvtárba.

Az `id@version` tartalma megváltoztathatatlan. A javított útvonal új verzió lesz,
így a korábbi futások reprodukálhatók.

## Engedélyezett rs-sdk felület az első változatban

- mozgás: `walkTo`;
- területre érkezés igazolása: `wait-for-area`;
- világinterakció: `interactLoc`, `interactNpc`;
- párbeszéd és utazás: `talk-to-npc`, engedélyezett válaszokra korlátozott
  `navigate-dialog`;
- eredménnyel igazolt gyűjtés: `gather-loc`, `gather-npc` (inventory vagy XP változás);
- termelés: `smith-at-anvil`;
- bolt: `open-shop`, `buy-from-shop`, `sell-to-shop`, `close-shop`;
- pontos címzettű, mennyiségkorlátos átadás: `trade-give-item`;
- bank: `openBank`, `depositItem`, `withdrawItem`, `closeBank`;
- időzítés: `waitForTicks`;
- koordinátával pontosítható, betöltésre és műveletre váró location interakció;
- feltételek: inventory telítettség/tartalom, szabad hely, minimum játékskill-szint.

Új primitív csak adapterrel, validálással és teszttel kerülhet a listára. A meglévő
magas szintű rs-sdk metódusokat használjuk; nem építjük újra a pathfindingot,
bankolást vagy interakciós protokollt.

## Paraméterezett kompozíció

A `call` lépés egy másik skill pontos `id@version` kiadását hívja meg, és a szülő
paramétereiből típusosan tölti ki annak bemeneteit. A hívott definíció ugyanabban
a registryben marad, ezért önállóan verziózható, megosztható és auditálható.
A futtató indulás előtt feloldja a teljes hívási gráfot, és művelet nélkül leáll,
ha egy függőség hiányzik, nem látható, más verziót ad vissza, draft/deprecated,
ciklust alkot vagy nyolcnál mélyebb láncot hoz létre.

A gyökérskill idő- és műveleti kerete az egész kibontott futás közös korlátja;
egy részfolyamat saját nagyobb limitje sem emelheti meg. Az események névterezett
lépésazonosítót kapnak, például `bank/deposit-item`, így az auditból látszik, melyik
híváson belül történt a művelet. A verifier a publikálás előtt csak exact-version,
`verified` függőségeket fogad el, ciklust ellenőriz, majd a repeat- és retry-határokkal
együtt a teljes gráf névleges műveleti felső korlátját számolja.

Az első újrahasználható eljárások:

- `procedure.gather-loc-until-full@1.0.0`;
- `procedure.bank.deposit-item@1.0.0`.

A `resource.gather-loc-to-bank@0.1.0` draft ezeket kombinálja. Az eszköz, a
lelőhely koordinátái és neve, az interakció, a termelt item, a játékbeli skill és
a célbank mind paraméter. Emiatt a réz, vas vagy későbbi erőforrás útvonalához nem
kell automatikusan új programlogika; csak akkor indokolt külön skill/verzió, ha a
folyamat szerkezete is eltér. Az új paraméterkombinációt a szokásos külön tesztbot
és élő evidence életciklus igazolja.

## Agent által létrehozott skill életciklusa

1. Az LLM később kizárólag JSON `SkillDefinition` javaslatot adhat.
2. Saját `authorId` alatt csak `draft` dokumentumot menthet.
3. A draft privát vagy megosztott tárba kerülhet, de más agent automatikusan csak
   ellenőrzött skilleket fedez fel.
4. A draft futtatása külön engedélyt, lokális botot és szigorú limiteket igényel.
5. Determinisztikus, majd élő teszt után egy megbízható verifier új, `verified`
   verziót tehet a forráskódban tárolt katalógusba.
6. A későbbi agent a registryből az egzakt vagy legfrissebb verziót tanulhatja meg.

### Automatikus verifier és promóció

Az automatikus verifier csak `agent` eredetű, kifejezetten `shared` draftot fogad.
A statikus ellenőrzés feloldja a paramétereket, kiszámolja a deklarált ciklusok
névleges műveleti felső korlátját, és új szemantikus verziót követel. Ezután
legalább két külön, változtathatatlan journalból származó élő futást ellenőriz:

- pontosan ugyanazt a draft `id@version` párt futtatták;
- azonos feloldott paraméterekkel indultak;
- valódi botnévhez tartoznak, hajtottak végre műveletet és `completed` állapotúak;
- a lezáró esemény run ID-ja, skillhivatkozása és időbélyege is konzisztens.

Minden döntés külön, felül nem írható verification reportba kerül. Csak az összes
ellenőrzés sikere után jön létre új, `system` eredetű `verified` verzió, amelynek
`derivedFrom` mezője az eredeti draftra, provenance megjegyzése pedig a bizonyító
run ID-kra mutat. A lokálisan promótált skill automatikusan felfedezhető a közös
skill-könyvtárban, de forráskódba emelése továbbra is emberi Git-review döntés.

Ez megakadályozza, hogy egy prompt injection vagy hibás agent tetszőleges kódot
terjesszen „skill” néven, miközben a felfedezett útvonal és stratégia valóban
megosztható marad.

## Megosztási kísérletek

- `shared-library`: minden agent felfedezheti a verified + shared skilleket;
- `isolated-discovery`: egy agent csak a saját maga által létrehozott skilleket látja.

A két mód ugyanazt a végrehajtót használja, ezért összehasonlítható lesz a közös
tudás hatása a felfedezési időre, erőforrás-felhasználásra és gazdasági specializációra.

Az első determinisztikus összehasonlító kísérlet 12 agenttel, agentenként 10
feladattal és 20 párosított triallal fut. Mindkét mód trialonként ugyanazt a
seedelt workloadot kapja. A mérési egység becsült skill-művelet: a végrehajtási
költség a deklarált lépések névleges korlátja, az első izolált felfedezés pedig
ennek háromszorosa. Ez modell, nem mért játékidő vagy LLM-tokenfelhasználás.

Baseline (`seed=phase5-baseline`, workload fingerprint
`1678eb3da21fe26bd822d5adafd00cf701a0e9525b065a1e0b0f525a13815415`):

- shared-library: átlagosan 2 564,5 becsült művelet/trial;
- isolated-discovery: átlagosan 5 980,9 becsült művelet/trial;
- megtakarítás: 3 416,4 művelet/trial, az izolált költség 57,12%-a;
- elkerült önálló felfedezés: 53,4/trial;
- ebből elkerült, más agent által már megismételt felfedezés: 48,4/trial.

A teljes trial- és agentbontású JSON riport a `skill:experiment` paranccsal
azonos seed mellett újragenerálható, és az admin kísérleti könyvtárába kerül.

## Első példa

Az `agent-skills/catalog/mining.varrock-east.copper-to-bank@0.1.0.skill.json`
megőrzi az első draftot. Az ebből származó `1.0.0` verzió két sikeres élő ciklus
után `verified`: a bot banktól bányáig sétált, 8 rézércet gyűjtött, visszatért,
bankot nyitott, minden ércet lerakott, majd bezárta az interfészt. A két auditált
run ID a verified dokumentum provenance mezőjében található.

## Első öt verified skill

A katalógus első lezárt készlete:

- `mining.varrock-east.copper-to-bank@1.0.0`;
- `fishing.karamja.lobster-to-draynor-bank@1.0.0`;
- `production.varrock.bronze-daggers@1.0.0`;
- `shopping.lumbridge.buy-hammers@1.0.0`;
- `trade.lumbridge.give-item@1.0.0`.

Mindegyik megtartja a forrásául szolgáló `0.1.0` draftot, a verified provenance
pedig tartalmazza a sikeres élő futások azonosítóit.

## Phase 12 bevételtermelő skillek

A `mining.varrock-east.copper-to-general-store@0.1.0` és
`mining.varrock-east.iron-to-general-store@0.1.0` skill egy korlátozott mennyiségű
ércet gyűjt a Varrock keleti bányában, majd az exact `Shop keeper` NPC-nél eladja
az adott érctípust. A célmennyiség alapértéke 5, maximuma 20; a vas változat 15-ös
Mining szintet követel. Mindkettő megőrzi az agent-eredetű `0.1.0` draftot, de a
közös katalógus legfrissebb változata már verified `1.0.0`.

Az admin Skills fül külön fejlesztési katalógusban mutatja őket. A próbafuttatás
csak credentiallel rendelkező, friss online és tétlen botra indulhat; a paraméterek
sémával ellenőrzöttek, a kezelőnek a valódi bányászat és tárgyeladás kockázatát
külön meg kell erősítenie, az indítás pedig auditbejegyzést kap. Publikálás után
a történeti draft eltűnik ebből a futtatható listából és közvetlen draftindítással
sem érhető el.

Ferrye14 mindkét változatból két független, 5 érces élő kört teljesített. A réz
runok `28886c31-1e8d-47b1-a199-93917e8dc94f` és
`7d911a32-0ab6-4cf0-a041-f553e104cfd6`, a vas runok
`6f3a6981-3a34-4112-824b-798388c0862a` és
`872eaa51-e440-400e-a470-102ef5e2d2cd`. Mindegyik hiánytalan eladással zárult;
a két rézkör 3–3, a két vaskör 26–26 gp bevételt adott. A verifier mindkét
skillnél minden ellenőrzést elfogadott, beleértve a 84/90 névleges műveleti
korlátot és az azonos paraméterezést.

A kezdeti autonóm policy verified, exact allowlistelt és limiteken belüli skillben
enged `sell-to-shop` műveletet. A vásárlás és a másik szereplőnek történő
itemátadás továbbra is tiltott. A két verified skill autonóm végrehajtásához ettől
függetlenül exact allowlist és az agent saját ismert-skill állapota szükséges.

## Karamja fishing

A `fishing.karamja.lobster-to-draynor-bank@0.1.0` draft végrehajtja a Port Sarim
→ Karamja kompútvonalat, a mozgó fishing spot újracélzását, a vámvizsgálat
engedélyezett válaszait, a visszautat és a Draynor bankolást. A komp mindkét
irányban a felső fedélzetre érkezik; az érkezési üzenet biztonságos bezárása után
közvetlenül a gangplank használható, létra nem szükséges.

Az első teljes élő kör 16 skill-művelettel, 18 fishing-spot újracélzással sikerült:
`e0415a5f-bb64-4607-8c8c-f67f0973c170`. A második teljes auditált kör
`1f149254-9397-4437-ab9c-c5fd9db891e0`; ennél 45 újracélzás kellett, ami igazolta,
hogy a korábbi 20-as plafon kevés. A verified skill időkorláton belül legfeljebb
60 újracélzást enged, és továbbra is csak inventory- vagy XP-változást fogad el
sikernek.
