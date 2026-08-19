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
- kizárólag engedélyezett operation és repeat lépései;
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

## Agent által létrehozott skill életciklusa

1. Az LLM később kizárólag JSON `SkillDefinition` javaslatot adhat.
2. Saját `authorId` alatt csak `draft` dokumentumot menthet.
3. A draft privát vagy megosztott tárba kerülhet, de más agent automatikusan csak
   ellenőrzött skilleket fedez fel.
4. A draft futtatása külön engedélyt, lokális botot és szigorú limiteket igényel.
5. Determinisztikus, majd élő teszt után egy megbízható verifier új, `verified`
   verziót tehet a forráskódban tárolt katalógusba.
6. A későbbi agent a registryből az egzakt vagy legfrissebb verziót tanulhatja meg.

Ez megakadályozza, hogy egy prompt injection vagy hibás agent tetszőleges kódot
terjesszen „skill” néven, miközben a felfedezett útvonal és stratégia valóban
megosztható marad.

## Megosztási kísérletek

- `shared-library`: minden agent felfedezheti a verified + shared skilleket;
- `isolated-discovery`: egy agent csak a saját maga által létrehozott skilleket látja.

A két mód ugyanazt a végrehajtót használja, ezért összehasonlítható lesz a közös
tudás hatása a felfedezési időre, erőforrás-felhasználásra és gazdasági specializációra.

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
