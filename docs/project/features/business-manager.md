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

## Ami még szándékosan nincs automatizálva

A `wageGp` jelenleg szerződéses szándék, nem kifizetés. A modell:

- nem von le pénzt treasuryből és nem ad pénzt playernek;
- nem indít automatikusan agent skillt;
- nem tekinti a skill ismeretét vagy futását teljesített munkának;
- nem ad Property-belépési jogot;
- nem számol termelést, készletet, árat, profitot vagy adót.

Ezekhez a következő szeletekben a Business manager allowlistelt read/write portja,
a player-megbízási queue, a treasury reserve/commit/release határa és a hiteles
skill-run események kapcsolódnak. Így ugyanaz a díj nem fizethető ki kétszer, és
az adminfelület sem válik közvetlen pénz- vagy item-grant csatornává.

## Adminfelület és audit

A Kísérletek fülön létrehozható és listázható vállalkozás, módosítható az
állapota, felvehető exact agent és lezárható a jogviszonya. Minden írás admin
hitelesítést és indoklást kér, majd sikerrel vagy hibával bekerül az auditnaplóba.
