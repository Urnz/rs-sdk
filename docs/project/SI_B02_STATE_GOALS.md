# SI-B02 – Állapotcél és korlátos tervelfogadás

2026-10-23: kész. Következő: SI-B03; az nem indult el.

## Működés

- `si-b02.v1` állapotcél: `food-reserve-at-least`, `cash-reserve-at-least`,
  `hunger-at-most`; legfeljebb három, különböző predikátum konjunkciója.
  A küszöböket az admin/server konfigurálja, az LLM nem írhatja át őket.
- Ételként jelenleg csak a saját avatar inventoryjában megfigyelt, kész
  lobster (379) számít; nyers alapanyag, banki készlet és más avatar tárgyai nem.
  GP: saját inventory, nem becsült bevétel. Éhség: kötött, tartós natív needs.
  Az observer-adapter ellenőrzi az account/avatar és population/clock kötést.
- Hiányzó, duplikált, idegen forrású, jövőbeli vagy elavult adatból nincs
  `satisfied`. Az observation legfeljebb 5 s-os; saját live inventory legfeljebb
  5 s-os, needs legfeljebb 30 s-os és az óra pontos headjéhez kötött.
  Más agent/binding és visszalépő observation-idő nem írhat felül célevidence-t.
- A `successfulRuns` mérőszám megmarad, de az állapotcél completion típusa
  `native-state`. Skill exit 0 önmagában nem zárja le a célt. A legacy,
  objective nélküli run-goalok szemantikája változatlan.
- `achieve`: az ellenőrzött állapot elérése lezárhatja a célt, aktív gyerekek
  nélkül. `maintain`: a cél aktív marad, külön satisfaction állapottal;
  romláskor nem kell lezárt célt újranyitni. Long-term csak maintain, immediate
  csak achieve lehet; current mindkettőt használhatja. Life goalhoz nem adható
  állapotpredikátum. Folyamatos megélhetéshez maintain current használható.

## Tervelfogadás és újratervezés

Az LLM továbbra is csak a hiányzó célhierarchiát és egy ismert skillt javasol.
Automatikusan kizárólag egy már megadott, aktív **current állapotcél egyetlen
immediate gyereke** fogadható el. Új long-term/current stratégia továbbra is
adminjóváhagyásra vár. A gyermek a szülő predikátumait örökli, achieve módban;
a modell címe/leírása nem helyettesíti a gépi teljesülési feltételt.

Az elfogadás újra ellenőrzi a szülő revisionjét és friss, elégtelen állapotát,
az aktív lease/policyt, emergency stopot, learned/exact verified skillt,
művelet- és időkeretet, paramétereket, exact item/partner/GP envelope-ot,
valamint a profile és grant napi költségkorlátját. A configot és a natív
megfigyelést inference után újraolvassa. A publikus grant nem bővült; nincs
új default allowlist vagy kiadási/publikálási engedély.

Proposal-ID, decision-ID, parent revision, policyversion, scope digest,
GP-reservation, goal/execution/event és adoption receipt egy tranzakcióban
állnak össze. Azonos proposal visszaolvasása idempotens; más scope visszautasítva.
Dispatchkor ismét ellenőrzött a lease, parent revision, paraméterdigest és az,
hogy nincs már függő futás. Leállás után egy dispatch nélküli elfogadott cél a
meglévő replan-útból folytatható; a tartós dispatch recoveryjét a meglévő runner
kezeli. Ez nem ad exactly-once garanciát tetszőleges új külső műveletre.

Ha sikeres futás után a friss állapot még elégtelen, `needsReplan` keletkezik.
A tervező a current szülőhöz tér vissza. Új, validált lépés elfogadásakor az
előző immediate `blocked` lesz, nem hamisan `completed`; függő natív futás
nem cserélhető le. Ismeretlen állapot nem jogosít automatikus cserére.
A friss, elégtelen self-care current megelőzi a munkacélt a következő lezárt
skillhatáron. Folyamatban lévő gazdasági tranzakciót ez nem szakít félbe.

Az admin `POST /api/admin/agents/:id/goals` út `objective` mezője ugyanazt a
típusos validációt használja. Például:

```json
{
  "policy": "si-b02.v1",
  "mode": "maintain",
  "purpose": "self-care",
  "predicates": [{ "kind": "food-reserve-at-least", "value": 2 }]
}
```

## Perzisztencia és rollback

AgentState v25→v26: három saját additív tábla: `agent_state_objective`,
`agent_state_evaluation`, `agent_plan_adoption`. A régi célokat nem alakítja
át és senkit nem enrollol automatikusan. A natív observation digestje és
forrásbindingje visszaolvasható; ez célevidence, nem transfer receipt.
Az új táblák létrehozása és user_version váltás tranzakciós; táblanévütközéskor
v25 marad, részleges új séma nélkül. Jövőbeli schema fail-closed.

Éles upgrade előtt állítsd le az érintett gateway/agent írókat és mentsd a
teljes AgentState DB/WAL állapotát a meglévő backup/restore eljárással. Rollback:
leállított runtime mellett az upgrade előtti összetartozó mentés és kód együtt
állítandó vissza. Aktív v26 adatbázison ne csökkentsd kézzel a user_versiont és
ne töröld az adoption receiptet: ettől újra aktiválhatóvá válhatna egy terv.
Ebben a fejlesztésben csak eldobható fixture-adatbázisok migrálódtak.

## Ellenőrzés és korlátok

Komponens: AgentState goal/proposal, state predicate, planner/context, LLM
validator/planning, gateway replan és admin goal route. Közvetlen fogyasztók:
legacy goal/execution, observer, goal event recovery, templates, deterministic
learning, skill parameter/policy/envelope és a natív food adapter.

- `20261023-140209-272-si-b02-component-consumers`: **93 PASS / 1 FAIL**, 8,721 s.
  A felsorolt közvetlen fogyasztók sikeresek; az új gateway-fixture lease-je
  volt hibás. A sikeres teszteket emiatt nem ismételtük mind újra.
- `20261023-140312-092-si-b02-gateway-native-types-retry`: a javított valódi
  gateway→model proposal→adoption→dispatch és az új native eset **2 PASS**;
  root TS PASS. Engine TS a teszt túl tág gateway-importján bukott.
  A policy/adoption és a változatlan paramétervalidátor külön modulba került;
  a régi exportok megmaradtak. A grant/envelope algoritmus nem változott.
- `20261023-140640-900-si-b02-final-boundaries-types`: **31 PASS / 1 FAIL**,
  4,514 s. A process-crash, replacement, authority és költségpróbák is PASS;
  az új admin-teszt a sikeres létrehozás 201 válaszát tévesen 200-nak várta.
- `20261023-140703-390-si-b02-admin-native-types-final`: a javított admin-route
  és natív eset **2 PASS + root TS + engine TS + format PASS**, 31,186 s.
- `20261023-141150-349-si-b02-docs-scope-final`: **PASS**, 1,341 s;
  roadmap/next task, helyi linkek, formázás és gépi összevetés szerint a
  kiemelt skill-policy és paramétervalidátor algoritmusa változatlan.

Az új natív próba valódi scripted model döntésből ad immediate tervet,
elfogadja, tartós dispatchot ír, és a SkillExecutor→SDK socket→gateway→packed
engine halászatát futtatja. A raw output és sikeres skill mellett a cooked-food
cél elégtelen marad. Egy valódi packed főzés után az observer készételt lát és
lezárja az achieve gyereket, a maintain szülő aktív marad. A verified definíció
tesztfixture; ez nem új draft publication vagy élő stratégiai igazolás.

Külön child process **close/finally nélkül kilép** proposal, adoption,
dispatch, outcome és evaluation után; minden barrier után új process/store
olvassa vissza a WAL-t. Az adoption tranzakción belüli hibát SQL abort injektálja:
goal/event/receipt/reservation együtt gördül vissza, a retry egyszer aktivál.

A korábbi sikertelen körök teljes logjai `.local/verification/` alatt maradtak.
A `20261023-135629-363` indítás explicit `./` nélküli Bun útvonalai
mentésbeli tesztmásolatokat is kiválasztottak; ez hibás tesztkijelölés volt,
nem szükséges regresszió. Az érintett 17 régi native eset sikeres volt;
a javított új esetet utána pontos névfilterrel ismételtük. Az összesített
tesztszámok átfednek; a sikertelen köröket nem minősítjük utólag PASS-nak.

**Teljes regresszió nem futott.** Saját additív goal/proposal adatok és az
érintett tervelfogadási út változott; a változatlan közös economic commit,
clock, runtime-függőségek és független domain suite-ok ismétlése nem indokolt.
SI-B03 alternatívaválasztás és SI-B06 élő E2E, SI-M1/SI-M2 autonóm eredmény
nincs igazolva. Élő világ és fizetős provider nem indult.
