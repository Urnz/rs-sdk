# Célarchitektúra

## Kiinduló rendszer

Az upstream rs-sdk fő futási lánca:

`agent/bot script -> SDK -> gateway -> botclient/webclient -> game engine`

A projekt a forkot az `rs-sdk/` alkönyvtárban tartja. A munkatér többi része a saját
dokumentációt, agent skilleket és feature-terveket fogja össze.

## Tervezett bővítési pontok

- **Agent skillek:** validált, verziózott és megosztható, hosszú botműveletek az
  `agent-skills/` alatt. A reviewed katalógus Gitben, az agent által létrehozott
  draftok a `.local/agent-skills/` shared/private tárában élnek.
- **Játékmodok:** szerveroldali domain-logika, konfiguráció, kliens-visszajelzés és tesztek.
- **Agent runtime:** identity, célhierarchia, working/episodic/semantic/social memória.
- **Ingatlanrendszer:** az engine hiteles szerveroldali állapotára épülő tulajdonjog.
- **LLM adapter:** providerfüggetlen réteg, amely csak engedélyezett bot-eszközöket ér el.
- **Megfigyelhetőség:** közös futásazonosítóval összekapcsolt engine-, gateway-, bot- és LLM-naplók.

## Alapelvek

1. A game engine a játékszabályok és a tartós állapot egyetlen hiteles forrása.
2. A kliens nem dönthet pénzről, tulajdonjogról vagy jogosultságról.
3. Gazdasági művelet vagy teljesen végbemegy, vagy semmilyen részállapotot nem hagy.
4. Az LLM javasol és eszközt kér; egy determinisztikus réteg ellenőriz és hajt végre.
5. Minden hosszú futás limitált, megszakítható és auditálható.
6. Az LLM stratégiai skillt választ; a determinisztikus skill hosszabb ideig önállóan fut.
7. Agent vagy LLM tetszőleges kód helyett csak engedélyezett műveletekből álló
   `SkillDefinition` dokumentumot hozhat létre; más agent automatikusan csak
   ellenőrzött, megosztott verziót fedezhet fel.
