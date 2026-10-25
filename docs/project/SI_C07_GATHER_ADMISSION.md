# SI-C07 – Hitelesített gather-loc igénybekötés

2026-10-25. A korábbi tartós Mining-komponens production admission/start/close
bekötése elkészült. SI-C07 továbbra nyitott,27/45; preflight NO-GO, M3 nem PASS.

## Natív út és bizonyíték

Az executor minden réz/ón `gather-loc` végrehajtási példányának külön
`operationSequence` értéket ad. A demandId a run/step/sequence hármasból készül:
ugyanaz a repeat-step vagy új próbálkozás nem használhatja egy korábbi érc receiptjét.
Retarget ugyanazon gather-kérésen belül megtartja az igényazonosságot.

A CLI executor az SDK-hívás előtt megvárja a saját immutable művelet-admission
fájljának és aktuális markerének kiírását. A gateway és az engine újraolvassa:

- a kiválasztott avatar aktív population/control/lifecycle/world/clock kötését;
- a tanult és verified pontos skill-verziót és aktuális katalogizált checksumot;
- a run admission username/skill/checksum és feloldott parameters digestjét;
- az executor aktuális operationSequence/step/args/admission digestjét;
- a friss active-skill heartbeatet, a művelet deadline-ját és lezáratlanságát.

A request szűk: open/close, ismert réz/ón gather-argumentumok és executor-context.
Nincs benne caller-supplied owner, path, clock vagy receipt. A gateway az
autentikált SDK-session targetjét használja; observe mód és meglévő avatar-
korlátozások a dispatch előtt megmaradnak. A belső engine végpont a meglévő
token/method/JSON/commandId ellenőrzés mögött, új saját mezőlistával működik.
Nincs közös auth-guard vagy szerepkör átírás.

Út: `SkillExecutor` → `RsSdkSkillRuntime` → SDK `miningDemand` → gateway saját
source-reader → belső `native-mining-demand` HTTP → bounded engine queue/tick →
normál packed Mining → natív event/intent fulfillment → readonly gateway proof.
A pozitív gather eredményhez valódi, ehhez az igényhez rendelt érc-receipt kell.
Inventory/XP/animáció vagy sikeres transport ACK önmagában nem elég.

Az engine a nyitáskor rögzíti a Mining-attempt ledger cursorát. Csak később
**elsőként befogadott** natív akció teljesítheti a kérést. Egy korábban suspended
Mining késői kimenete normál érc marad, de nem válik egy új igény bizonyítékává.
Az új index ezt a request-lookupot támogatja; nincs extra érc vagy wear.

## Lezárás és bizonytalan helyzetek

Az abszolút expiry az executor admission idejéből származik, a dispatch-várakozás
nem hosszabbítja. A natív tracker a tényleges hátralévő időt köti a rekordhoz,
az SDK pedig legfeljebb eddig vár. A felső native lifetime300000 wall ms marad.

Abort/timeout/eredmény/hiba esetén külön, friss és bounded cleanup-kérés fut;
az abortált work-signal nem akadályozhatja a close-t. A gateway a close-dispatch
előtt immutable cancellation tombstone-t ír. A későn beérkező open ezt már
elutasítja. Az executor saját finally-ága külön műveletsealt ír, így SDK-kapcsolat-
vesztés után a natív observer HTTP-válasz nélkül is lezárhatja a kérést.

Ha marker/engedély/forrás elveszik, unknown coverage marad; nincs feltételezett
nulla. Lezárt, lejárt vagy visszavont invocation későbbi native outputot nem
kaphat. Bizonytalan ACK vagy hiányzó fulfillment esetén nincs vak automatikus
újrapróbálás; ugyanaz a művelet egyeztetendő. A létező natív Mining gazdasági
szemantikája nem módosult, az observer nem bányászik vagy javít automatikusan.
Minden sikertelen bekötött gather `retryable:false`, nyugtázott cancel utáni
timeout esetén is: a cél lezárása nem bizonyítja a már elküldött játékcsomagok
visszavonását. A normál retarget ugyanazon kérésen belül megmarad.

## Saját perzisztencia és rollback

Új, immutable executor step-sidecarok a meglévő run-directoryban:
`<runId>.mining-<sequence>.admission.json` és `.admission.closed.json`.
Backend-owned invocation/tombstone: `.local/agent-skills/mining-demands/`.
A meglévő run admission/journal formátuma és a közös DB user_version változatlan.
Az archívum meglévő `.local/agent-skills` rootja ezeket is tartalmazza.

Az intent JSON opcionális `attemptSequenceAtAdmission` mezőt kapott; a régi
rekordok bytejai/digestjei nem íródnak át. Hiányzó cursorból nincs friss-admission
állítás vagy új fulfillment. Az attempt saját séma1-táblájához additív, valid
JSON-ra szűrt request-index jött; adat-visszatöltés és közös migráció nincs.
Ezt és az üres intent-sémát a baseline előtt kell inicializálni/pinelni.

Rollbackkor a writer leállítása és az összetartozó runtime/SDK forrásverzió
visszaállítása szükséges; az új sidecarokat/indexet/rekordokat bizonyítékként
meg kell tartani. Régi runtime idejére coverage nem következtethető. Nem futott
live migráció, történeti payload-megnyitás vagy régi bundle-módosítás.

## Ellenőrzés és maradó korlát

Valódi packed Mininggel, a source-backed authorizerrel és tényleges belső
HTTP/tick handlerrel ellenőrzött a fenti út; a SDK oldali tesztport a gateway
azonos source-handlerét hívja. Külön eset: ismétlés, retarget, in-flight abort,
disconnect, close-before-late-open, régi suspended output, visszavont/sealed
forrás, valamint token/method/mezőlista. A fixture reviewed subsetet használ,
nem publikál új skillt, és nem minősít gazdasági önfenntartást.

A teljes cohort/source coverage, régi közvetlen `interact-loc`, unbound/missing
identity utak és a kötelező baseline source-lista még nem igazoltak. A17 eredeti
minimum requirement/8 integrity gate teljes assessmentje, housing exposure,
founder tool/food/housing baseline, valódi ratio és SI-A14 még belépési feltétel.
Nincs teljes minimum PASS vagy új futási/provider-költési engedély.

Külön tesztfuttatási diagnosztika: a C06 összetett result/report/restore teszt
a consumer-körben6,876 s után a generikus5 s timerbe ütközött. Változatlan
kerettel izoláltan PASS; fázisnaplóval2,128 s (fixture470 ms, baseline-capture203,
result-capture245, hibás-report restore172, normál restore137, második fixture381,
második capture224; további prepare/compare/verify szakaszok is naplózottak).
Ez az egy, három capture/több restore/SQLite világot tartalmazó teszt explicit
15 s I/O-keretet kapott; assertion, runtime/clock és hosszú-run limit nem lazult.
A sikeres169 ellenőrzést e diagnosztika miatt nem futtattuk újra.

Végső type/fixture kör: `20261025-113401-579-si-c07-mining-shared-fixture-and-types`,
18 source/runtime/native ellenőrzés és root+engine+webclient TS PASS183,099 s
(runtime5,69 s). Az engine NodeNext és root bundler közös fixture-je statikus
JSON-importot használ; a korábbi type-import/fixture hibák naplói megmaradtak.
`20261025-114216-650-si-c07-mining-admission-preflight-copy`:3 preparer próba,
friss NO-GO és sourcehash/link PASS1,709 s. A másolt negatív fixture source-
filtere az új agent-skills kódot is megtartja; a9500→9400 lazítás blocked.
`20261025-114922-832-si-c07-mining-timeout-no-retry`:14 célzott ellenőrzés és
root/engine TS PASS244,154 s, runtime33,87 s. Külön negatív eset igazolja, hogy
nyugtázott goal-cancel után sem retryzható automatikusan a sikertelen gather;
a korábban PASS webclient és169 fogyasztó nem ismétlődött.
Végső artifact: `20261025-115804-236-si-c07-mining-admission-final-artifact`,
NO-GO/sourcehash/digest/link PASS3,873 s; ez nem futási engedély vagy M3 PASS.
