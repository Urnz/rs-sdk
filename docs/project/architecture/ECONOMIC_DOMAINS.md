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

Az agent-state v7 tartós actor-linkje ugyanezt a három azonosítót használja, de
nem veszi át egyik gazdasági domain állapotának tulajdonjogát sem. Az agent
portfóliója read-only vetület: a pénzt a játékosállapotból, az ingatlant a Property
modból, a későbbi vállalkozást és factiontagságot pedig azok saját moduljából oldja
fel. Így a döntési context friss adatot kap anélkül, hogy párhuzamos főkönyv jönne
létre az agent-adatbázisban.

## Property mod

Tulajdonolja:

- a fizikai ingatlan definícióját és stabil azonosítóját;
- a tulajdonost, állapotot, belépési pontokat és használati jogosultságot;
- a vásárlás, átruházás, bérlet és használat domain-eseményeit;
- az ingatlanhoz tartozó alap karbantartási szabályt.

Nem tulajdonolja a dolgozókat, termelési recepteket, vállalati pénzügyeket,
adókulcsokat vagy állami kincstárt.

## Business manager mod

A business és faction közös treasury-portja már tartós `balance/reserved/available`
egyenleget, valamint idempotens `reserve/commit/release` megbízási tranzakciót ad.
Ez nem olvasztja össze a két domaint: a Business és a Governance később a saját
bevételi és kiadási szabályaival hívja ugyanazt a szűk wallet-határt.

Tulajdonolja:

- a vállalkozás identitását, tagságát, alkalmazottait és szerepköreit;
- a termelést, készletet, árképzést, megrendeléseket és üzleti célokat;
- a működési eredményt, béreket és vállalati szerződéseket.

A Phase 12 kezdeti modellje már tartós Business-identitást, külön owner agentet,
`active → dormant → active/closed` lifecycle-t és manager/worker jogviszonyokat
ad. A `closed` végleges, a hozzá tartozó aktív foglalkoztatások lezárulnak, de a
történeti rekordok megmaradnak. Egy aktív jogviszony opcionálisan exact
skillverziót és egy igazolt munka után járó GP-díjat deklarál. Ez még nem payroll:
nem foglal fedezetet, nem indít skillt és nem ír player- vagy treasury-egyenleget.

A business-subjecthez exact módon kötött institution agent a saját Business
vetületét az `inspect-assets` olvasási porton kapja meg. A
`propose-business-policy` írási port csak bounded, inert javaslatot tartósít:
üzemmódot, célt, megbízásonkénti GP-plafont és preferált exact skilleket. A plafon
nem lehet magasabb az agent napi operatív kereténél. A javaslat admin-jóváhagyásig
nem aktív; a jóváhagyás atomikusan superseded állapotba teszi a régi policyt, de
továbbra sem mozgat pénzt vagy játékost.

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
- A tényleges institution-pénzmozgást a közös, idempotens treasury-főkönyv hajtja végre.
- A modok közötti szerződés csak verziózott azonosítókat és eseményeket tartalmazhat.
- Egy modul kikapcsolása nem törölhet másik modul által hivatkozott domainadatot.

## Közös ajánlat- és szerződésledger

A Phase 12 első szerződéses rétege egyik fenti domain belső állapotát sem
tulajdonolja. Két persistent agent között `trade`, `work` vagy `service` ajánlatot
rögzít, mindkét fél GP-, tárgy- és szolgáltatás-kötelezettségével. A név szerinti
címzett elfogadásakor az ajánlat pontos, SHA-256 digesttel azonosított feltételei
egy változatlan aktív szerződésbe kerülnek.

Az ajánlat vagy szerződés önmagában:

- nem teremt pénzt vagy tárgyat;
- institution→player GP-vállalásnál elfogadáskor treasury-fedezetet foglalhat,
  de a másik fél hiteles teljesítése előtt nem fizethet;
- önmagában nem módosít player-save-, Property- vagy AgentState-egyenleget; a
  treasury csak az explicit fedezetfoglalási és settlement-porton változhat;
- nem tekinthető teljesítési bizonyítéknak;
- csak koordinációs és audit határ a későbbi hiteles skill-run, gazdasági esemény
  és idempotens settlement számára.

Az elfogadott szerződés addig `active`, amíg mindkét fél saját exact-avataros,
elfogadás utáni completed runjai nem igazolják minden vállalását. A GP és tárgy
csak exact-counterparty player-trade eseményből, a szolgáltatás csak előre
rögzített exact skillverzióból bizonyítható. Egyik fél naplója sem teljesíti a
másik fél szolgáltatását, és egy run nem használható másik szerződéshez.

Institution→player GP esetén az elfogadáskor foglalt treasury-fedezetet a másik fél
hiteles teljesítése után az idempotens engine reward settlement fizeti ki. A
player-oldali GP és tárgy továbbra is kizárólag exact-counterparty trade runnal
igazolható; előre foglaló inventory-escrow még nincs.

A közös treasury már biztosít külön institution→institution főkönyvi primitívet.
Ez egy stabil settlement ID alatt, egyetlen SQLite tranzakcióban commitolja a payer
korábbi foglalását, csökkenti a payer egyenlegét, növeli az exact payee egyenlegét,
és változtathatatlan transfer-rekordot ír. A pontos retry nem mozgat újabb pénzt;
eltérő payer, payee, összeg vagy reservation ugyanazzal az ID-val fail-closed.
Önutalás és a maximális egyenleg túlcsordítása tiltott.

Ez a primitív szándékosan még nem hívható meg pusztán egy ajánlat elfogadásából.
A szerződéses, adó- vagy banki orchestrátornak előbb hiteles domain-eseménnyel kell
igazolnia a teljesítési feltételt; így a treasury API nem kerüli meg a szerződés
teljesítési kapuját.

Tervezett függési irány:

```text
Business ───────► Property
Governance ─────► Property események
Business ───────► Governance szabályok
        mindhárom ─────► közös gazdasági főkönyv
```

Az eseményes kapcsolás miatt a Governance nem függ a Business belső modelljétől,
és a Property sem függ egyik magasabb szintű rendszertől sem.
