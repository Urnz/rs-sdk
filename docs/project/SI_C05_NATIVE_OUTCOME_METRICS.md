# SI-C05 – Natív munka-, társas- és döntési outcome-mérés

2026-10-24. Ág: `codex/si-c05-native-outcome-metrics`;
baseline `0cf37107c1042e0f409131a5cdc433b47e67b844`.

Hipotézis: a meglévő native work/production/trade, AgentState goal/observer és
LLM-audit forrásokból readonly projection készíthető új központi social-score,
párhuzamos memória vagy kitalált idő-/költségadat nélkül.

Szerepek: registered recipe-responsibility HHI változatlan; külön physical
worker/output/proof és tényleges native credited simulation-time. A generic
Business shift/start/end wall-time nem automatikusan produktív simulation-time.
Natív idő nélküli munka durationje unknown; ugyanaz a receipt nem két output.
Offline/skill-idle nem unemployment. A teljes available-and-willing keresleti
nevező hiánya inconclusive; a bizonyított munkavégzés csak alsó korlát.

Social: kizárólag a backend által külön engedélyezett observer saját memóriája,
kapcsolata és commitmentje, valamint saját native trade-részvétele. Nincs másik
actor privát szövege, globális trust vagy trade→trust következtetés. Saját
belief/fulfilled/broken commitment külön a natív társas ténytől és időablaktól.

Goal: a successful-skill-runs progress külön a natív state predicate outcome-tól.
State evaluation eredménye a meglévő objektívvel/observation digesttel újra
ellenőrzött; hiányos/stale evidence unknown. Nem minden completed skill stratégiai
siker. Provider: audit-reported tokens/cost és megfigyelt wall latency; explicit
wall-window külön a SimulationClock-ablaktól, nincs időalap-becslés vagy új
providerhívás. Queue admission→run-start és provider-stage elapsed külön; a
backoff nélküli active service hiánya unknown.

Határ: backend-selected világ/source paths, scoped actor/observer export,
readonly schema/audit ellenőrzés és source digest. Nincs migráció/backfill vagy
gazdasági/clock/auth writer-változás. Hiány/truncation/foreign clock/sourcegap
nem sikeres nulla. A riport nem ment új eseményt és nem indít munkát.

Olcsó kapu: disposable valódi natív work/output checkpoint, kis kontrollált
munkahét/projection, két observer eltérő memóriája, natív state vs skill-success,
mock provider valódi auditja és queue ledgerje. Native child60 s/wrapper90 s,
provider0 USD, nincs live világ vagy történeti SI-A15 backup. Hiba után szűk
diagnosztika, nem új soak/full. Célzott outcome/evaluation/dashboard/source
fogyasztók, érintett TS és staged format; full csak konkrét shared alapváltozásra.

SI-C07 live adatokból történő újraolvasás, autonóm teljesítmény és SI-M3/MVS
nem e feladat mechanikai elfogadása.

## Elkészült mérési határ

`society-metrics/native-outcomes.ts` és a három `outcome-*` olvasó saját
perzisztencia nélkül ad projectiont. A DB-k readonly, táblánként legfeljebb
100000 sorral, fájlonként256 MiB-tal; az audit32 MiB. A source snapshot és a
visszaadott projection digestje külön szerepel. Nincs cross-DB atomikus olvasás,
teljes történeti vagy feltörhetetlen forrás-teljességi bizonyítás.

- **Felelős / munkás:** az eredeti recipe-responsibility HHI megmarad. Külön
  physical-stage receipt HHI, actual worker, output item/darab, javított capacity,
  audithoz kötött credited simulation-time, whole-job completion elapsed és
  noncredited elapsed. A person-time az ablakra vágott; nem minden receiptnek
  ismert a durationje. Business requester, assigned worker és tényleges worker
  külön; cook run/batch azonosítók kapcsolhatják össze őket. Business shift
  `actual_minutes` külön feljegyzés, nem produktív simulation-time. Start/end
  és queue-wait hiányában explicit null; noncredit nem automatikusan várakozás.
- **Munkaerő-nevező:** nincs teljes, tartós available-and-willing exposure
  forrás. A bizonyított credit alsó korlát; available/willing person-time,
  unemployed person-time és unemployment rate null/inconclusive. Offline,
  restart, skill-idle vagy ismeretlen intervallum nem munkanélküliség.
- **Social:** backend-engedélyezett observer saját relationship/commitment
  rekordja és saját evidence ID-ja; partner is a kiválasztott cohortból.
  Trust/affinity belief, fulfilled/broken commitment observer-reported
  cooperation/conflict. Ezek source-head memóriák wall idővel; nem kerülnek
  hamisan simulation-window alá. Saját native trade külön él, trustChange null.
  Nincs biography, megjegyzés, commitment-szöveg, epizód-, cél- vagy promptszöveg.
- **Goal:** stored observation digestje, agentje, freshness/source predicateje
  és eredménye újraszámolt. A completion goal-event source digestje és a külön
  natív clock ledger stampje egyeztetett; csak így kerül transition az ablakba.
  A stored observation önállóan nem exact clock/profile stamp, és nem újranyitott
  történeti inventory. A goal completion / successful skill / tartós stratégiai
  siker külön fogalom; utóbbihoz nincs kitalált sikerráta.
- **Provider:** külön explicit wall-window. Admission→run-start, admission→plan
  completion, request→response elapsed megfigyelt; a provider stage backoffot is
  tartalmazhat, active service null. Audit-reported input/output tokens és
  costMicros, becsült ár nélkül. Azonos auditduplikátum nem dupláz; eltérő
  request/response, csonkolás, hiányzó response vagy audit nélküli admission
  nem teljes usage-total. A subtotal és az ismert recorded-run total külön;
  teljes audit/world coverage egyik esetben sem állított.

## Használat és hozzáférés

Export: `reportNativeOutcomes(scope, options)`, opcionális evaluation/dashboard
`nativeOutcomes`; admin context `nativeOutcomeOptions`. GET
`/api/admin/society/outcomes` ugyanazt a meglévő admin kaput használja. Defaultban
nincs export capability; a backend adja a world/workspace/source útvonalakat,
engedélyezett actorokat/observereket és a provider wall-windowt. Actor-widening
még az első olvasás előtt elutasított. HTTP `observer`, path és observations
paraméterek nem adnak jogot és nem választhatnak forrást.

Helyi CLI, kizárólag saját kiválasztott workspace-on:

```powershell
bun scripts/report-society-outcomes.ts --workspace <workspace> --world <world-id> --checkpoint <canonical-checkpoint.sqlite> --from <simulation-ISO> --to <simulation-ISO> --clock-id <clock-id> --clock-profile-digest <sha256> --actor <id> --actor <id> --observer <id> --wall-from <wall-ISO> --wall-to <wall-ISO>
```

A CLI explicit actor/observer kiválasztás a helyi export határa; az observer
actor is kell legyen. Wall pár nélkül nincs provider mérés. A checkpointot nem
találgatja, a hiányzó fájlt nem inicializálja. A `.local/agent-state`, simulation,
admin audit/queue és economy útvonalak a kiválasztott workspace-ból származnak.

## Ellenőrzés és korlátok

A [source-bound eredmény](SI_C05_NATIVE_RESULT.json) rögzíti a forrás-/packed
hash-eket és a végső natív receipt/credit bizonyítékot. Kontrollált kis munkahét:
két valódi Player, repair600000 ms, smelt120000 ms, külön Mining-output.
Az offline smelt intervallum200600 ms nem credit; elapsed320600 ms. Ez három
natív completion receipt egy egyhetes riportablakban, nem egy hét autonóm munka.
Repair capacity50, item-output0; smelt egy2349 bar; Mining egy436 ore,
ismeretlen durationnel. Foreign profile és önmagában helyes digestű, de más
clockra írt effect elutasított; fault injection csak eldobható fixture-ban.

Olvasói kapu: saját lifecycle a natív needs bindinggel azonos; két observer
ellentétes beliefje; cooperation/conflict; native trade; scoped Business
assignment; unsatisfied reserve sikeres skill után; külön state completion;
tampered evaluation; valódi mock-orchestrator + durable queue + JSONL audit;
duplicate/ambiguous/truncated/missing audit; backend auth/scope és CLI.
Mock input120/output30 token, audit cost0; valódi providerhívás/költés nincs.

A consumer gate-ben egy meglévő replan-teszt közös budgetet használt állandó
`gateway-plan` ID-val: `LLM budget run id was reused with different admission
data`. A szűk javítás opcionális backend-only `planning` infrastruktúra-injekció
(provider/queue/budget/audit), a tesztnek saját temp budget/queue/audit. Goal,
input, authorization és alapértelmezett runtime működés változatlan. Két külön
ismétlés bizonyítja az izolációt; közös budget/sorok törlése nem megoldás.

A korai fixture-validation, UUID/hierarchy/mock-goalId és TypeScript generic
return hibák logjai megmaradtak; a clock2 s előrehaladása a valós stamp szerint
ellenőrzött. Nincs assertion-gyengítés. Részletes gate-index az eredmény JSON-ban;
a részben átfedő tesztszámok/idők nem összeadandók. **Full nem indokolt:** readonly
projection és lokális DI; persistence/transaction/clock/auth alap nem módosult.

SI-C05 mechanikai zárás:26/45, következő SI-C06 új kérésre. SI-C07 live lánc,
available/willing történet, empirical calibration és SI-M3/MVS továbbra nyitott.
