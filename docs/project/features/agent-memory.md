# Agent identitás és memória – tervezési vázlat

## Tartós agentmodell

- **Identity:** név, háttértörténet, személyiség.
- **Goals:** életcél, hosszú távú, aktuális és azonnali cél.
- **Memory:** working, episodic, semantic és social memória.
- **Relationships:** bizalom, kötelezettségek és fontos társas állapot.
- **Assets:** pénz, ingatlan, vállalkozás, követelés és tartozás.
- **Skills:** ismert/engedélyezett magas szintű képességek.

## Context-stratégia

Minden döntéshez jár egy nagyon rövid core identity, az aktuális helyzet és cél.
A nagyobb emléktárból csak relevancia, frissesség, érintett szereplő és cél alapján
kerülnek elő elemek. Céltartomány: nagy élettörténet mellett is körülbelül
1000–3000 token releváns context egy stratégiai döntéshez.

## LLM előtti teszt

A sémát, perzisztenciát, visszakeresést és konszolidációt először szabályalapú
plannerrel kell bizonyítani. Így az LLM nem rejti el az állapotkezelési hibákat.

