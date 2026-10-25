# SI-C07 – Exact executor → natív Mining dispatch

2026-10-25. A [rögzített7 munkacsomag](SI_C07_REMAINING_WORK.md) első egysége.
SI-C07 nyitott27/45; nincs hosszú run, providerhívás vagy M3/MVS PASS.

## Végrehajtási és bizonyítéklánc

A bounded gather ugyanazt a source-backed demandet adja át a BotActionsnak,
minden retargethez új1..maxRetargets dispatchSequence értékkel. A SDK feloldja
a célpontot, szükség esetén egy tile szomszédságig odasétál, majd külön
`miningInteraction` akciót küld. Ebben nincs caller owner, source-path,
native receipt vagy szabadon megadott végrehajtási kód.

A hitelesített SDK session targetje mögötti gateway újraolvassa a reviewed
executor/run/step/operationSequence/args/checksum/marker/identity/grant/clock
forrásokat. Immutable sidecar rögzíti a pontos targetet és a dispatch-ordinalt:
`.local/agent-skills/mining-dispatches/<dispatchId>.json`. Az ID a demand és
ordinal függvénye; ugyanazon ordinal más targettel konfliktus. Ez nem grants
vagy sikernyugta. A meglévő open/close invocation és finally-seal megmarad.

A transport egy szűk, tokenvédett loopback HTTP natív parancs:
`/api/internal/admin/native-mining-interaction`, csak dispatchId és username
mezőkkel. A gateway a hitelesített targetet használja; az engine a sidecarból
és a tényleges pending intentből olvas. A legacy browser OPLOC bináris csomag
nem kap kölcsönvett, környezeti executor-identitást. A közös guardok változatlanok.

Az engine bounded tick queue-ja legfeljebb50 elemet tárol,10-et dolgoz fel
tickenként,5 s queue-lifetime-mal. Az eredeti executor deadline nem hosszabbodik.
A motor ellenőrzi a valódi online/active játékost, identity/óra/pending requestet,
az aktuális World locot, szomszédságot, copper/tin outputot, a reviewed név-
és Mine-option egyezést. Ezt követi a valódi packed OPLOC Mining script;
protected access, szuszpendálás és resume a normál player/script úton fut.
Nem kerül új tárgy közvetlenül a leltárba.

## Egyszeri kiküldés és kimenet

A saját `native_mining_dispatch_schema`/`native_mining_dispatch` tábla immutable
admissiont ír **a script előtt**, owner/target/level/sourceDigest/clock adatokkal.
Csak ezután kerül dispatchId a konkrét ScriptState-be és native action ID-ba.
Egy új raw OPLOC külön state-et kap, ebből nem örökölhet provenance-t.
Ugyanazon dispatch újraküldése a meglevő admissiont olvassa, nem futtat scriptet.

Az admission utáni hiba/crash bizonytalan végrehajtás marad. Az admission ACK
nem Mining-siker, önmagában nem indokol automatikus ismétlést. A gather csak
valódi `mined`/ore/wear/intent fulfillment nyugtával sikeres. Az új production
intent `nativeDispatchRequired:true`: a gateway és metrics reader ellenőrzi
az exact dispatch/demand/owner/context/target/level és canonical output kötést.
Másik ugyanazon-avatar raw Mining normál, nem kijelölt világon termelhet,
de nem teljesíti ezt az intentet. Régi optional-flag nélküli fixture/history
nem lesz utólag strict provenance-nek átminősítve.

A coverage selectionben szereplő founder támogatott bronze Mining útján
az azonosítatlan raw/unbound belépés naplózott **elutasítás**, ore/wear nélkül.
Az exact request `source-bound-request`; a régi `compatible-request` külön,
provenance nélküli résként olvasható. Hiányzó native ingress egy admitted
dispatchhez szintén gap. A teljes high-level demand nevező továbbra hiányos,
ezért `completeDemandCoverage:false`; az üres queue nem bizonyít nulla igényt.
Ez a2. munkacsomag assessment-feladata, nem a natív admission ACK tulajdonsága.

## Megszakítás és kompatibilitás

A bounded gather a teljes interakciót az eredeti deadline-nal és abortjellel
versenyezteti; a finally close friss cleanup-kerettel azonnal megindul. A SDK
a séta után, közvetlenül a Mining-küldés előtt újra ellenőrzi az abortot.
Az AbortSignal csak helyi vezérlés, nem szerializált API-mező. A késői queued
command cancel/seal/expired source mellett nem kap admissiont. Már elindított
script hatását a source-close önmagában nem vonja vissza; új intentet nem
teljesíthet, és sikertelen gather nem retryzható vakon.

Saját additív schema1; shared user_version, migrátor és gazdasági commit
változatlan. Új explicit tool-opening inicializálja az üres dispatch sémát,
így baseline után az első Mining nem ad DDL-t. Meglévő kötött világon explicit,
offline schema-előkészítés és új pin szükséges; command nem inicializál defaultsot.
DDL/verzióütközés rollback, idempotens init, immutable admission, readonly
újranyitás és selected C06 restore külön próbázott. A régi history nincs backfillve.

Rollbackhez a kijelölt világot előbb le kell állítani. Régebbi bináris nem
enforce-olja az új intent-flaget, ezért az ilyen folytatás nem használhatja az
új strict baseline-t. Pre-baseline visszaállítás vagy új explicit workspace/pin
szükséges; az additív táblákat/evidence-et nem töröljük, nem írjuk át.

Az archívum `.local/agent-skills` coverage-e a dispatch sidecarokat is viszi.
A saját dispatch tábla explicit required source-ként schema/world/clock
ellenőrzést és offline rereadet kap; az archívum state hash-e köti a byteokat.
Ez nem teljes-world/RNG visszajátszási állítás. Readerlimit100000 sor; a konkrét
hosszú terv forrás-row/byte és I/O-budgetje az5. munkacsomagban szükséges.

## Célzott ellenőrzés

Source immutability/replay/conflict, szereplő és deadline/seal; saját schema
upgrade/reopen/rollback/corruption; SDK exact request/abort/no raw Mining;
executor retarget/abort; valódi SDK-runtime→gateway→HTTP/tick→packed Mining;
raw same-avatar/old suspended action nem teljesít másik intentet, egyszeri
dispatch, késői cancel, offline/invalid target, token/method/extra-field guard;
coverage és outcome FAIL-megőrzés,3 selected source restore és preparer.
A közös SDK BotAction miatt root/engine/webclient TS érintett. Pontos check ID-k,
eredmények és idők a [rövid átadásban](SOCIETY_DEVELOPMENT_HANDOFF.md) szerepelnek.
