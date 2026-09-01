# Multi-agent gazdasági kísérletek

## Első Phase 12 szelet

Az adminpanel `Kísérletek` füle legalább két player-agentből seedelt kohorszt
indít. Ez nem külön szimulált világ: minden résztvevő a gateway ugyanazon élő
játékvilágában marad, miközben identitása, céljai, memóriája, döntési ledgere és
skill-runja továbbra is a saját stabil `agentId` és exact avatar alatt él.

A teljes futás írás előtti preflightot kap:

- minden agentnek léteznie kell;
- csak `player` szerep és exact `player` subject–identity–avatar kötés fogadható el;
- minden avatárnak egyedinek és legfeljebb öt másodperces friss online állapotúnak
  kell lennie;
- egy hibás résztvevő az egész kohorszt elutasítja, így nem keletkezik részleges
  kísérlet vagy véletlen skillindítás.

Sikeres preflight után a résztvevők ugyanabban az időablakban, `Promise.all`
dispatch-csel kerülnek a Phase 11-ből származó autonóm event gate-re. Ettől még az
LLM inference queue, az agentenkénti napi döntési keret és az exact skill-policy
változatlanul érvényes. A kohorsz nem ad új jogosultságot, csak több elkülönített
agent meglévő biztonságos ciklusát koordinálja.

## Determinizmus és perzisztencia

A futás definíciója a normalizált név, seed, célleírás és rendezett agentlista
SHA-256 digestje. A dispatch sorrend a `seed + agentId` hashből származik, ezért a
beviteli lista sorrendje nem változtatja meg. Minden indítás új kísérletazonosítót
kap, de azonos definícióhoz azonos digest és résztvevősorrend tartozik.

A `.local/admin/multi-agent-experiments.sqlite` megőrzi:

- a definíciót, seedet, digestet és státuszt;
- az indítás előtti közös gazdasági baseline-t;
- a dispatch lezárása utáni közös pillanatképet;
- agentenként az event gate teljes rekordját, planner státuszt, indokot és
  esetleges skill-run azonosítót;
- a `runId`-hoz tartozó hiteles, terminális skill-naplót;
- minden résztvevő lezárása után a közös végső gazdasági pillanatképet és az abból
  számolt pénz-, XP-, session-XP-, online- és legfeljebb száz készletdeltát.

A második snapshot továbbra is külön dispatch-állapot: a kísérlet addig `running`,
amíg minden `executing` résztvevőhöz meg nem érkezik a skill-exit és a hiteles
napló. Sikeres process-exit napló nélkül fail-closed hibának számít. Az ismételt
exit esemény nem írja felül a terminális rekordot és nem készít új snapshotot.

Ez a szelet már a teljes kohorsz tényleges futási ablakát méri. A kontrollcsoportos
replay, az ár-/kereskedelmi események és a hosszabb idősoros metrikák továbbra is a
12. fázis következő részei.
