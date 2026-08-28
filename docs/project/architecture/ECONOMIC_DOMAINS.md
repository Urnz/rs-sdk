# Gazdasági domainek és modhatárok

## Alapelv

Az ingatlan, a vállalkozás és az állam/faction három külön domainmodul. Nem
öröklési hierarchiát alkotnak, hanem stabil azonosítókkal és eseményekkel
hivatkoznak egymásra. Egyik modul sem írhat közvetlenül a másik belső állapotába.

Közös hivatkozási forma az `EconomicActorRef`:

- `player`: természetes személy/agent;
- `business`: vállalkozás, céh vagy más gazdálkodó szervezet;
- `faction`: királyság, város, uradalom vagy más közjogi szervezet.

Az MVP-ben csak játékos vásárol közvetlenül. A tulajdonmodell már most elfogadja
a további alanytípusokat, hogy később ne kelljen adatot újraértelmezni.

## Property mod

Tulajdonolja:

- a fizikai ingatlan definícióját és stabil azonosítóját;
- a tulajdonost, állapotot, belépési pontokat és használati jogosultságot;
- a vásárlás, átruházás, bérlet és használat domain-eseményeit;
- az ingatlanhoz tartozó alap karbantartási szabályt.

Nem tulajdonolja a dolgozókat, termelési recepteket, vállalati pénzügyeket,
adókulcsokat vagy állami kincstárt.

## Business manager mod

Tulajdonolja:

- a vállalkozás identitását, tagságát, alkalmazottait és szerepköreit;
- a termelést, készletet, árképzést, megrendeléseket és üzleti célokat;
- a működési eredményt, béreket és vállalati szerződéseket.

Egy vállalkozás `propertyId` alapján birtokolhat vagy bérelhet műhelyt, boltot,
farmot, bányát, fogadót vagy raktárt. Az ingatlan típusa lehetőséget jelez, de
önmagában nem hoz létre vállalkozást.

## Faction / governance mod

Tulajdonolja:

- a királyságokat, városokat, uradalmakat és más joghatósági egységeket;
- a területi tagságot és hierarchiát;
- az adó-, vám-, illeték- és támogatási szabályokat;
- a közpénztári költségvetést és közjogi jogosultságokat.

Az uradalom elsősorban joghatóság, nem ingatlan. Hivatkozhat egy központi várra,
birtokolhat több Propertyt, és területén adót szedhet. A vár ettől még külön
ingatlan marad, amelynek belépési és használati szabályait a Property mod kezeli.

## Integrációs szabályok

- A Property mod tulajdon- és használati eseményt publikál; nem számol adót.
- A governance mod az esemény és a területi szabály alapján adókötelezettséget állapít meg.
- A Business mod bérleti vagy tulajdoni hivatkozással használ ingatlant; nem írja át a tulajdonost.
- A tényleges pénzmozgást egy későbbi közös, idempotens gazdasági főkönyv hajtja végre.
- A modok közötti szerződés csak verziózott azonosítókat és eseményeket tartalmazhat.
- Egy modul kikapcsolása nem törölhet másik modul által hivatkozott domainadatot.

Tervezett függési irány:

```text
Business ───────► Property
Governance ─────► Property események
Business ───────► Governance szabályok
        mindhárom ─────► közös gazdasági főkönyv
```

Az eseményes kapcsolás miatt a Governance nem függ a Business belső modelljétől,
és a Property sem függ egyik magasabb szintű rendszertől sem.
