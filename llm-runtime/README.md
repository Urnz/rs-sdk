# LLM runtime

Providerfüggetlen, biztonsági határ a stratégiai modell és a determinisztikus
agent-skill végrehajtó között. Az első use case egyetlen kezelt játékosügynök:
egy már aktív immediate célhoz választ egy ellenőrzött magas szintű skillt.

Az orchestration négy külön lépése:

1. a hívó összeállítja a korlátozott megbízható contextet, a chatet és más külső
   szöveget pedig `untrustedText` adatként elkülöníti;
2. a közös inference queue meghívja a konfigurált providert;
3. a validator csak az adott célhoz és az engedélyezett skillverziókhoz tartozó
   `execute_skill` javaslatot fogadja el;
4. a javaslat csak egyszer használható approval azonosítóval hajtható végre.

A `ScriptedMockProvider` determinisztikus teszteket tesz lehetővé hálózat és
API-kulcs nélkül. A minta-konfiguráció ezért alapértelmezetten ki van kapcsolva.
A valódi provider külön adapter lesz; nem kaphat engine-, fájl- vagy tetszőleges
kódfuttatási hozzáférést.

Az audit JSONL vagy memóriabeli sinkbe írható. A nyers context helyett hash,
modellazonosító, token-/költségadat, döntés, approval és végrehajtási eredmény
kerül a naplóba. A `runId` kívülről is megadható, így a teszt és a későbbi
visszajátszás ugyanahhoz a futáshoz köthető.
