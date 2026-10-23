# SI-B04 – Institution stratégiai admission

Állapot: **kész**, 2026-10-23. Ág: `codex/si-b04-institution-admission`.
Következő: SI-B05; az nem indult el.

A meglévő supervisor/inbox/queue és döntési ledger marad az egyetlen admission.
Csak exact Business institution, avatár nélkül. Explicit szerveroldali grant
előre rögzített policy/stock/ár/work opciókat enged; a modell csak ID-t választ.
Az alapértelmezett grantlista üres. Fizikai munka a meglévő typed player-request,
natív completion és reward-receipt útján megy. Nincs Faction AI vagy új publication.

Ellenőrzési terv: új admission/role/schema, cooldown, stop/lease/grant revokáció,
budget, idegen subject, event/restart/uncertain inference; a Business work és
stock/commerce közvetlen fogyasztói; root és érintett engine TS, formázás.
A saját additív receipt/selection táblák nem módosítják a közös tranzakciós
alapot, ezért célzott upgrade/reopen/conflict ellenőrzés kell, nem full.

Vékony integráció: kontrollált providerrel Business esemény → policyválasztás →
typed work request → meglévő kanonikus delivery/reward út. Eldobható temp DB-k,
fali óra, nulla providerköltség, max. 30 s tesztlimit, élő világ nélkül.
Elvárt bizonyíték: tartós választás/decision, exact work/request binding,
natív trade és engine reward-receipt, egyszeri treasury-terhelés. Process ACK
önmagában nem elegendő. Hibánál szűk reprodukció; limitet nem emelünk vakon.

## Megvalósítás és konfiguráció

- `institution-strategy-runtime.ts`: a gateway institution-ágában fut; nem
  ütemező. Az existing supervisor claim/settle/backoff/quarantine és durable
  inbox adja az eseménykezelést. Institutionnél az esemény nem kerüli meg a
  beállított következő ébresztést. A fix `society-livelihood` rutin megmaradt.
- `config/institution-strategy.json`: strict v1, alapból `grants: []`.
  Egy grant exact `agentId` + `businessId`, enrollment `policyId`/`policyVersion`,
  `maxGpPerDecision`, `maxGpPerDay`, legfeljebb 12 előre jóváhagyott opció.
  Nincs játékbeli vagy modell által létrehozható grant.
- Az opció pontos alakja az `InstitutionPolicyOption` típusban: `optionId`,
  `objective`, `mode`, `maxRewardGp`, `preferredSkills`, `stockPolicies`, `work`.
  A stock policy teljes validált definíció, már létező Business/item/policy ID-val,
  ellenőrzött skillreferenciákkal. A kiválasztott ár valódi commerce-admissionbe
  kerül. `work: null` policyválasztás; work esetén exact policy/employment,
  időtartam, paraméterek és delivery vagy már előkészített cook target kell.
  Új kitchen-custody/batch nem keletkezik szövegből vagy modellválaszból.
- A modell saját Business-készletet, foglalkoztatást, policyt, treasuryt és
  munkatörténetet lát. Más intézmény készlete/treasuryje nem kerül a contextbe.
  Az eseményszöveg külön untrusted adat; nem adhat jogosultságot.
- A role-specific LLM mód `choose-business-policy`, eszköz `select_business_policy`.
  A provider strict sémája csak policy-ID-választást/abstaint enged, `tool:null`,
  üres goals. Nincs `execute_skill`, authored goal, paraméter vagy treasury-tool.
  Ugyanaz a queue, globális LLM-budget, audit és emergency-stop kezelő fut.
- A profile napi döntés-/LLM-kerete előre foglalódik a meglévő decision ledgerben.
  Munka esetén az exact wage GP a profile és grant napi/per-decision keretén
  belül foglalódik, a tényleges pénzt a meglévő treasury/request/reward lifecycle
  kezeli. A policybeállítás önmagában nem GP-transfer vagy teljesített munka.
- Inference után friss grant, profile revision, lease-owner/expiry, stop,
  Business-context és foglalkoztatás ellenőrzés következik. Cooldown legalább
  60 s, illetve a profile hosszabb decisionInterval értéke. Nincs avatárindítás.

## Tartósság, migráció, rollback

AgentState v27→v28: saját additív `agent_institution_strategy` tábla és index.
Esemény/source/subject/context/grant/input/plan/status összekötve. Admission és
ledger ugyanabban a tranzakcióban. `prepared → inferring → decided → applying →
applied`; abstain/rejection vagy visszavont precondition `waiting`.
Az inference claim egyszeri. Bizonytalan providerterminal `inferring` marad,
újranyitás/új esemény nem küld új inference-t; a supervisor quarantine-olhatja.

A Business DB külön saját v1 markerrel három additív táblát kap az első sikeres
alkalmazáskor: `business_institution_schema`, `business_institution_application`,
`business_institution_selection`. Policy approve/supersede, selection és
append-only alkalmazási audit egy tranzakció. Az audit tárolja a stock payloadot
és hashét is; a natív olvasó összeveti a projectionnel, hiány/eltérés/future séma
hibát ad. Egy későbbi explicit policy supersede-je megszünteti a régi override-ot;
a történeti napló megmarad. A kiválasztás nem írja át a configfájlt.

Félbeszakadt `applying` outboxot a következő existing supervisor-ébresztés az
eredeti decision ID-val folytatja. Az order/request/reservation stabil ID-val
idempotens; nincs új providerkérés vagy új foglalás. Bizonytalan pénzügyi/native
eredményre nincs refund vagy fiktív completion. Az aktív override-ot a commerce
quote/dispatch újraellenőrzi; már committed csere történeti, pinned policyvel
rendeződik a meglévő natív receipt alapján.

Rollback: futás előtt DB-mentés, majd leállított gateway/engine mellett az
upgrade előtti kód és DB együtt állítható vissza. Éles v28 DB `user_version`
visszaírása vagy az alkalmazási/decision audit kézi törlése nem rollback.
Függő inference/work/settlement előbb explicit reconciliationt igényel.
Az új tábla saját upgrade/reopen/future/conflict rollback próbát kapott; a
v25/v26 tesztfixture-ök a későbbi saját táblát is eltávolítják visszaalakításkor.

## Bizonyíték és korlát

- `20261023-151739-802-si-b04-first-boundary`: **38 PASS / 2 FAIL**, 70,946 s.
  A teljes Business-work fájl sikeres, benne a vékony Business→modell→request→
  trade/reward út. Új negatív teszt öt fixture-t egy 5 s esetbe vont: szétbontva
  külön esetekre. Az inbox-fixture UUID helyett szöveges eventId-t használt:
  javítva. Nem a runtime limitje vagy assertionje gyengült.
- `20261023-151940-850-si-b04-admission-fix-types`: **15 PASS**, majd root TS
  FAIL, 56,522 s. A Bun transaction `.immediate()` típus szerint void;
  a publikus port ezután külön olvassa vissza a commitált policyt.
- `20261023-152209-264-si-b04-recovery-native-types`: **42 PASS**, root és
  engine TS PASS, 103,834 s. A 42 tartalmazza a 24 belső packed native-commerce
  esetet és külső wrapperét; nem 42 külön engine case. Új ár befolyásolja a
  BOTH_MOVEINV cserét, régi nem committed quote stale lesz; egyszeri settlement.
  Request-írási hiba után új supervisor event folytatja ugyanazt az outboxot.
- `20261023-152525-120-si-b04-direct-consumers`: **107 közvetlen fogyasztó PASS**
  14 fájlban, majd saját fájlban 14 PASS / 2 timeout FAIL; összes wrapper
  92,861 s. Két további, egyenként öt fixture-t összefogó negatív eset a lemez-
  műveletekkel 9,411 és 6,220 s lett: tíz külön esetre bontva, változatlan 5 s
  leaf limit és assertionök. A 107 sikeres fogyasztó nem ismétlődött újra.
  Az új atomikus selection/audit/future-schema próba ebben a körben PASS.
- `20261023-152749-061-si-b04-final-boundaries`: **37 PASS**, root + engine
  TS és format PASS, 112,902 s. Tíz külön negatív eset, egy helyreálló
  Business→modell→work→player→reward eset, 24 belső natív commerce és két külső
  wrapper/backend eset. A körök átfednek; számaik nem adhatók össze egyetlen
  különálló teljes regresszióként.

- `20261023-153152-327-si-b04-docs-final`: **PASS**, 1,547 s; roadmap 19 kész /
  következő SI-B05, helyi Markdown-linkek, 24 native case/wrapper-leltár,
  staged fájlkör és formázás. Dokumentáció után runtime-próba nem ismétlődött.

**Teljes regresszió nem futott.** Csak az új komponens saját táblái és a
felsorolt role/port/stock/commerce fogyasztók változtak; a meglévő gazdasági
commit, SimulationClock, treasury- és reward-tranzakciók alapja nem változott.
Dokumentációzárás és push miatt a sikeres runtime/TS kör nem ismétlődik.

A mechanikai integráció kontrollált/scripted providerrel és eldobható DB-kkel
igazolt. A Business-work bérpróba a kanonikus TradeEvidenceStore/PlayerRewardStore
receipt lifecycle-t használja; a külön native-commerce próba valódi packed
engine-inventory cserét hajt végre. Ez nem élő gazdasági trajectory vagy valódi
provideres intézményi teljesítmény-PASS. Nincs publication vagy providerköltés.
Faction-politika és önálló gazdasági partnerkezdeményezés nem e task része.
