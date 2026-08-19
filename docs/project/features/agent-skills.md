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
- világinterakció: `interactLoc`, `interactNpc`;
- eredménnyel igazolt gyűjtés: `gather-loc`, `gather-npc` (inventory vagy XP változás);
- bank: `openBank`, `depositItem`, `withdrawItem`, `closeBank`;
- időzítés: `waitForTicks`;
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
