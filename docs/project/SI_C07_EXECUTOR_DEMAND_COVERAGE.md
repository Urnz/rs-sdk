# SI-C07 – Prospektív executor-igény és natív lefedettség

2026-10-26, a2. munkacsomag része. SI-C07 nyitott,27/45, NO-GO; SI-M3/MVS
nem PASS. Továbbra [6 csomag maradt](SI_C07_REMAINING_WORK.md),17/17 részleges
adapter és8 még hiányos integrity gate. Nincs új baseline vagy hosszú futás.

## A natív admission előtt is megmaradó kérés

Az executor `persistMiningOperationAdmission` útja a kiválasztott producer-
naplóba **a step-sidecar kiírása és minden runtime/network dispatch előtt**
ír. A natív admissiont el nem érő kérés így nem tűnik el. A durable finally-seal
után closed esemény készül; a lezárás nem output-, siker- vagy availability-proof.
A repeat új operationSequence/demandId, a retarget ugyanaz a kérés marad.

Az új `native_mining_request_selection/event/head` saját sémája1, immutable
selectionnel és hash-láncos append-only eseményekkel. Minden rekord az eredeti
owner/world/clock/lifecycle, exact args/context/checksum/admission/deadline
azonosságokhoz kötődik. A natív source-backed authorization a kiválasztott
producerből is visszaellenőrzi az aktív kérését; régi sidecar önmagában nem
helyettesíti az új kiválasztott request source-ot. A hot-path get/append és
head ellenőrzés indexelt; a teljes export legfeljebb100000 eseményt validál.

Explicit offline előkészítés: `installMiningExecutorSource(workspace,
checkpointPath,selection)`. A checkpointnak már léteznie kell. A helper saját
tranzakcióban telepíti a táblákat, majd immutable
`.local/agent-skills/mining-request-source.json` descriptort ír. Ez a pontos
checkpoint relatív útját és a selection digestjét köti. Nincs avatar/HTTP
install, live automatikus migráció vagy történeti backfill. A közös
`user_version`, gazdasági tranzakció és native tool-state változatlan.
Managed módban a path-guard a tényleges srv ID/workspace és engine/data
checkpoint kötését ellenőrzi; nincs legacy world-ID fallback. A retained
failure csak a kijelölt cohortra hat, nem terjeszt új korlátozást más actorra.

## Natív pontok, pozitív opportunity és időkorlát

Az új cohort selection a producer digestjét és az üres nyitó executor-headet
is pineli. Az engine tick a request-prefix headet és a tényleges descriptor/
checkpoint rendelkezésre állását is rögzíti, üres native queue mellett is.
Producer-írási hiba után sticky `.failed.json` witness marad; későbbi jó DB-
írás vagy újranyitás nem törli, és a natív probe nem állíthat tiszta forrást.
Oversize checkpoint szintén unavailable. A producer és a failure witness
teljes IO-kiesése nem helyettesíthető memóriával; a run source/IO-integrity és
felügyeleti stop proofja továbbra külön, még nem lezárt gate.
Egy hiányzó producer, hibás head/prefix/roster, observer tick/session/clock gap,
raw/legacy ingress, offline vagy restricted founder nem ad teljes lefedettséget.
Régi selection vagy hiányzó új producer-pin továbbra unselected/inconclusive.

A reader a natív intenteket visszaköti az executor admissionhöz, de az
executor-kérést nem dobja el attól, hogy nincs hozzá native intent. A natív
watermarkok és az admission wall ideje konzervatívan közrefogják a teljes
outstanding időt. Nem interpolálunk wall→simulation időt. Hiányzó zárásnál az
evaluation végéig tartó lehetőség marad; közös actor átfedő/szomszédos kéréseinek
uniója számít, a cancel/reopen nem nulláz egy lehetséges folyamatos várakozást.
Más actorok idejét nem adjuk össze.

Csak tiszta, eredeti cohorthoz kötött teljes scope, a minimum szerinti
gap-limitek és **pozitív requested-use opportunity** mellett adható upper bound
a `tool-unusable-demand-time` cellához. A teljes outstanding életidő felső
korlátja az unusable rész idejének is felső korlátja, availability állítás nélkül.
Rövid upper ezért PASS-t bizonyíthat e feltételre; hosszú upper önmagában nem
FAIL. A meglévő igazolt unusable lower és scoped FAIL megmarad. Az egyező
lower/upper egy cellába kerül; ellentmondó upper nem törli a hiteles lowert.

Üres, egyébként végig megfigyelt producer lehet covered, de zero opportunity:
nincs automatikus0 idő vagy minimum-PASS. A `completeDemandCoverage` itt a
kiválasztott executor requested-use útjára vonatkozik; absztrakt cél, planner-
vagy queue-várakozás nem minősül automatikusan használhatatlan toolra várásnak,
és ebből nem keletkezik teljes source-universe integrity PASS.

## Archívum, rollback és ellenőrzés

A C06 explicit required-table listájába felvett request source teljes
selection/audit/head validálást kap. A mechanikai restore külön workspace-ből
ugyanazt a selectiont és descriptort olvassa vissza; sérült prefix új pinje
elutasított. A konkrét C07 descriptor/source-lista és megfigyelési budget
előzetes pinje még az5. csomag feladata.

Saját install/reopen/rollback/immutability, sticky írási hiba és prefix-próbák, valódi executor
admission/seal/authority, sidecar-írás előtti hiba megőrzése, valódi engine
tick-hook és packed legacy Mining, minimum upper/lower/zero/conflict/policy
védelem, source-backed SDK→native fulfillment és offline restore ellenőrzött.
Root és engine TypeScript érintett; webclient és SDK wire-format nem változott.

Rollback a megőrzött additív táblákkal lehetséges, de régi binary nem állítja
elő az új producer-witness mezőt, így ilyen folytatás nem complete coverage.
Új strict source selection új explicit baseline/pin; történeti adatot nem
törlünk és nem töltünk vissza. Nincs live install, providerhívás/költség vagy
történeti backup DB-read. Full regresszió nem szükséges: a változás Mining-
komponenshez kötött producer/source-protokoll, nem közös auth/clock/transaction.

Következő: a megfigyelt alvó/restricted állapot és az ismeretlen offline/identity
szétválasztása, majd a további source coverage, mortality/enforcement,
maintenance origin és8 integrity adapter. A hosszú próba nincs engedélyezhető
állapotban. Eredmény-ID-k/idők a [rövid átadásban](SOCIETY_DEVELOPMENT_HANDOFF.md).
