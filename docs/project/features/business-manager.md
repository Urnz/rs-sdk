# Business manager MVP

## Cél és domainhatár

A Business manager a vállalkozás szervezeti állapotának első tartós modellje.
Nem része a Property modnak: egy vállalkozás opcionálisan `propertyId` alapján
hivatkozhat ingatlanra, de ettől sem tulajdon-, sem bérleti jog nem keletkezik.
Az ilyen jogot később a Property domain saját eseménye igazolja.

A vállalkozás fő mezői:

- stabil `businessId`, név és rövid leírás;
- exact persistent `ownerAgentId`;
- opcionális `propertyId`;
- `active`, `dormant` vagy végleges `closed` állapot;
- optimista revízió és létrehozási/módosítási idő.

Az owner külön tulajdonosi szerep, nem mesterséges alkalmazotti rekord. A későbbi
institution agent a Business subjectet képviseli majd; a tulajdonos agent és a
Business „agya” ezért nem szükségszerűen ugyanaz.

## Foglalkoztatás

Egy aktív vállalkozás exact persistent agentet vehet fel `manager` vagy `worker`
szerepben. A jogviszony tartalmazza a munkakör nevét, egy igazolt teljesítés után
járó GP-díjat és opcionális exact `skill.id@version` követelményt. Egy agentnek
egy vállalkozásnál egyszerre csak egy aktív jogviszonya lehet.

A jogviszony megszüntethető, de nem törlődik. A vállalkozás végleges lezárása
minden aktív jogviszonyt ugyanabban a lifecycle-műveletben lezár. A lezárt
vállalkozás nem nyitható újra és nem vehet fel új dolgozót; az adatok read-only
történeti állapotként megmaradnak.

## Policyvezérelt player-munka és kifizetés

A jóváhagyott aktív policy és a foglalkoztatás már a meglévő player-megbízási
queue biztonsági kapuja. A Business institution agent csak akkor küldhet munkát,
ha:

- a pontos Business subject aktív és van jóváhagyott aktív policyje;
- a címzett exact agentnek aktív foglalkoztatása van ennél a Businessnél;
- a díj pontosan a foglalkoztatás `wageGp` értéke, és nem lépi át a policy plafonját;
- a skill megfelel az opcionális munkaköri exact skillnek és a policy nem üres
  `preferredSkills` listájának.

Az ellenőrzés a treasury-foglalás előtt történik, ezért hibás megbízás pénzt sem
foglalhat. A helyes megbízás a már meglévő reserve/commit/release útvonalat használja:
a player külön elfogadja, exact skill-runt hajt végre, és csak az engine által
igazolt siker után kapja meg a lefoglalt díjat idempotens settlementtel.

## Ami még szándékosan nincs automatizálva

A modell:

- nem indít automatikusan agent skillt;
- nem tekinti a skill ismeretét vagy futását teljesített munkának;
- nem ad Property-belépési jogot;
- nem számol termelést, készletet, árat, profitot vagy adót.

Az automatikus műszakbeosztás és feladatgenerálás későbbi scheduler-réteg lesz;
nem kerül közvetlen pénz-, item- vagy playervezérlés a Business domainbe.

## Institution agent port és policy

A business institution agent csak akkor kap Business hozzáférést, ha a control
profile `subjectKind=business` és `subjectId` értéke pontosan egy létező Business
ID. A player-, service-, faction- és idegen business-agent fail-closed választ kap.

Az `inspect-assets` port a saját vállalkozás állapotát, foglalkoztatásait, aktív
policyjét és történeti policy-javaslatait adja vissza. A tömör Business-vetület az
agent megbízható döntési contextjébe is bekerül.

A `propose-business-policy` port legfeljebb húsz exact skillhivatkozást, egy
bounded célt, `balanced/growth/profit/survival` módot és megbízásonkénti GP-plafont
fogad. A plafon nem haladhatja meg az institution agent napi operatív keretét.
A stabil proposal ID pontos replaye idempotens, eltérő tartalmú újrafelhasználása
tiltott.

A javaslat kezdetben `pending`, ezért önmagában nem változtatja meg a működést.
Auditált admin-döntéssel lehet `approved` vagy `rejected`; új jóváhagyáskor a
korábbi aktív policy atomikusan `superseded`. Vállalkozás lezárásakor minden
függő javaslat elutasítva, a történet pedig read-only módon megmarad.

## Adminfelület és audit

A Kísérletek fülön létrehozható és listázható vállalkozás, módosítható az
állapota, felvehető exact agent és lezárható a jogviszonya. Minden írás admin
hitelesítést és indoklást kér, majd sikerrel vagy hibával bekerül az auditnaplóba.
A player-megbízási ablak Business agentnél csak a policynek megfelelő aktív
alkalmazottakat és skilleket kínálja fel, a munkadíjat pedig a jogviszonyból tölti.
