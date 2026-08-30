# LLM runtime

Providerfüggetlen, biztonsági határ a stratégiai modell és a determinisztikus
agent-skill végrehajtó között. Az első use case egyetlen kezelt játékosügynök:
egy aktív immediate célhoz ellenőrzött magas szintű skillt választ, immediate
cél hiányában pedig a stratégiai célból szabályos cél-láncot javasol.

Az orchestration négy külön lépése:

1. a hívó összeállítja a korlátozott megbízható contextet, a chatet és más külső
   szöveget pedig `untrustedText` adatként elkülöníti;
2. a közös inference queue meghívja a konfigurált providert;
3. a validator csak az adott célhoz és az engedélyezett skillverziókhoz tartozó
   `execute_skill`, illetve a hiányzó horizontokat pontosan kitöltő célterv
   javaslatot fogadja el;
4. a javaslat csak egyszer használható approval azonosítóval hajtható végre.

A `ScriptedMockProvider` determinisztikus teszteket tesz lehetővé hálózat és
API-kulcs nélkül. Az alapkonfiguráció ezért kikapcsolt mock marad. Az
`OpenAIResponsesProvider` a Responses API-n strukturált, nem tárolt választ kér.
A valódi provider sem kap engine-, fájl- vagy tetszőleges kódfuttatási hozzáférést.

Az adminpanel szerverenkénti, gitből kizárt override-konfigurációt és write-only
helyi kulcstárolást is támogat. A modell `instructions` üzenete két rétegű: a
kódban tartott biztonsági és strukturált-output szerződés nem írható felül, míg a
RuneScape-szimulációs planner szerepleírása az adminpanelen szerkeszthető.

Az audit JSONL vagy memóriabeli sinkbe írható. A nyers context helyett hash,
modellazonosító, token-/költségadat, döntés, approval és végrehajtási eredmény
kerül a naplóba. A `runId` kívülről is megadható, így a teszt és a későbbi
visszajátszás ugyanahhoz a futáshoz köthető.

Az `LlmReplanEventGate` kizárólag jelentős domain-eseményt fogad; nincs tick- vagy
tile-szintű belépési pontja. A forráskulcs megakadályozza ugyanannak az eseménynek
az újrafeldolgozását, a cooldown pedig egyetlen agent eseményburstjét vonja össze.

A planner eredménye ezután determinisztikus capability-feloldáson megy át. Egyedi,
verified shared vagy már ismert találat esetén a rendszer rögzíti a feloldott skillt;
találat nélkül tartós, agentek között deduplikált `CapabilityGap` munkajegyet ír.
Az automatikus planner ugyanazon agent és stratégiai anchor aktív gapje esetén már
a modellhívás előtt megáll. Verified skillnél tartós, egyszer kézbesített wakeupot
kap; offline állapotban a kézbesítés később újrapróbálható. Ez még nem Skill Builder:
ez a capability-wakeup út önmagában nem készít vagy publikál skillt.

A külön Skill Builder worker az adminpanelen önállóan kapcsolható. A Responses API
felé `store: false` és strict JSON schema megy, toolok nélkül; a lokális validator
csak deklaratív draftot enged menteni. A gateway egyszerre egy gapet dolgoz fel,
intervallumot, cooldown-t, per-gap és napi költséglimitet vezet, a felhasználást
pedig külön JSONL ledgerben auditálja. A draft élő tesztje és publikálása továbbra
is elkülönített, kötelező következő lifecycle-lépés.
