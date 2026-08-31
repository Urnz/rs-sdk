# LLM-integráció – tervezési vázlat

## Első use case

Egyetlen kezelt játékosügynök kapja meg az aktív célhierarchiáját és tömör
játékállapotát. Ha van immediate cél, a modell ahhoz választ skillt. Ha nincs,
az élet-, hosszú távú vagy aktuális célból szabályos, immediate célig vezető
cél-láncot javasol. A modell a bot által ismert, nem blokkolt és a megbízható
katalógusban elérhető magas szintű agent skillek közül választhat. A döntés
először csak javaslat; a determinisztikus végrehajtó kizárólag egyszer használható
approval azonosítóval indíthatja el.

A dry-run a validált céljavaslatot módosíthatatlan snapshotként menti, de nem
hoz létre skillt, nem ír memóriát és nem kap alacsony szintű engine-, fájl-
vagy kódfuttatási eszközt. A célok és az opcionális skill csak külön admin
jóváhagyás után kerülnek végrehajtási állapotba.

## Rétegek

1. **Megfigyelés:** releváns játékállapot strukturált összefoglalása.
2. **Tervező/model adapter:** providerfüggetlen kérés és válasz.
3. **Policy/validator:** jogosultság, séma, költség-, idő- és lépéshatár.
4. **Végrehajtó:** szűk rs-sdk eszközök; közvetlen fájl- vagy engine-hozzáférés nélkül.
5. **Audit:** futásazonosító, modell, eszközkérés, eredmény, idő és hibakód.

## Elkészült 11A alap

- `llm-runtime/types.ts`: provider-, kérés-, döntés-, limit- és audit szerződések.
- `llm-runtime/planning.ts`: az agent snapshot, releváns memória és ellenőrzött
  skillkatalógus összekötése; a nem megbízható epizódok elkülönítése.
- `llm-runtime/orchestrator.ts`: közös inference queue, szigorú output-validáció,
  költség- és időkorlát, egyszer használható approval és emergency stop.
- `llm-runtime/mock-provider.ts`: hálózatmentes, determinisztikus provider a
  regressziós tesztekhez.
- `llm-runtime/audit.ts`: memóriabeli és JSONL audit sink; a nyers context helyett
  kérés-hash és korlátozott metaadat kerül a naplóba.
- `config/llm-runtime.json`: alapértelmezetten kikapcsolt mock konfiguráció.

## Elkészült 11B előnézet

- Az Agentek adminfülön külön `LLM dry-run` gomb kér friss, legfeljebb öt
  másodperces online botállapotot.
- A felület külön mutatja a célt, a trusted contextet, a nem megbízható adatot,
  a szűrt skilllistát, a mock modell döntését és annak futásazonosítóját.
- A dry-run önmagában szimuláció, de a validált `propose-goal-plan` eredményt
  az AgentState v14 adatbázis tartós, revíziózott proposal rekordként megőrzi.
- Az orchestration audit külön `.local/admin/llm-audit.jsonl` naplóba kerül; a
  szokásos admin audit csak a futásazonosítót, státuszt, döntést és usage adatot
  tartja meg.
- A gateway a skillfolyamat befejezését vagy hibáját, az immediate cél
  létrehozását és státuszváltását, az új trade-kérést, a halálátmenetet és a
  küszöbértéket átlépő aggregált gazdasági változást domain-eseménnyé alakítja.
- A tickek csak átmenetet érzékelnek: változatlan világállapotból nem keletkezik
  modellhívás. A forráskulcsos deduplikálás és cooldown a zajos ajánlat- és
  gazdasági burstöket összevonja, míg a skill-, cél- és halálesemények sürgősek.
- Az automatikus eredmények a `.local/admin/llm-replans.jsonl` fájlba kerülnek,
  és a `/api/admin/llm-replans` helyi admin végponton lekérhetők. Ezek továbbra
  is csak mock javaslatok: automatikus skillvégrehajtás nincs.
- Immediate cél hiányában a planner a legmélyebb aktív stratégiai célt választja
  horgonynak. A mock előnézet egyetlen kérésben pontosan a hiányzó horizontokat
  (`long-term`, `current`, `immediate`) javasolja, és az utolsó célhoz legfeljebb
  egy, már ismert és ellenőrzött skillt rendel.

## Elkészült 11C célterv-jóváhagyás

- A böngésző nem küldi vissza a modell céljait vagy skilljét: csak a szerveren
  tárolt proposal azonosítóját és várt revízióját. Így a jóváhagyott tartalom
  pontosan a korábban validált snapshot.
- A teljes hiányzó célhierarchia egyetlen SQLite-tranzakcióban jön létre. Ütköző
  célazonosító, megváltozott stratégiai horgony vagy elveszett skillismeret
  esetén sem marad félkész lánc.
- A kiválasztott egzakt skillverzió csak exact player-avatar kötésen, online,
  credentiallel rendelkező és szabad boton indulhat. A rövid életű approval
  egyszer használható; a futásazonosító még a supervisor hívása előtt tartósan
  elfogyasztja.
- Ha nincs alkalmas skill, a jóváhagyás csak a célokat hozza létre. A későbbi
  capability-gap és Skill Builder folyamat ettől elkülönítve marad.

## OpenAI provider helyi beállítása

Az OpenAI adapter a Responses API-t használja `store: false` és szigorú JSON
sémás kimenettel. A kulcs kizárólag az `OPENAI_API_KEY` környezeti változóból
olvasható; JSON-ba, adatbázisba és auditnaplóba nem kerül. Az adapter a HTTP
hibákat a válasz és a kulcs visszaidézése nélkül jelenti.

1. A `config/llm-runtime.openai.example.json` tartalmát másold a
   `config/llm-runtime.json` fájlba. A példa `gpt-5.6-terra` modellt, egyetlen
   modellkérést és 0,05 USD futásonkénti utólagos költséghatárt használ.
2. Ugyanabban a PowerShell ablakban, amelyből a gateway indul, állítsd be:
   `$env:OPENAI_API_KEY = "sk-..."`.
3. Indítsd újra a gatewayt. Az admin `LLM dry-run` valódi modellhívást végez,
   de továbbra sem ment célt és nem indít skillt.

A mintában az `automaticReplanning` értéke `false`: így csak a kézzel indított
dry-run kerül pénzbe. Az eseményvezérelt automatikus modellhívások csak ennek a
kapcsolónak a tudatos `true` értékre állítása és gateway-újraindítás után indulnak.

Az ármezők modellváltáskor kézzel frissítendők a szolgáltató aktuális díjaihoz.
A gateway a válasz tokenhasználatából számolja a becsült `costMicros` értéket;
API-hívás előtti teljes költséggarancia nincs, ezért a szolgáltatói projekt- és
felhasználási limitet is alacsonyan kell tartani.

## Biztonsági alapok

- A játékchat és minden külső szöveg nem megbízható adat.
- Titok nem kerülhet promptba vagy naplóba.
- A modell nem kap tetszőleges kódfuttatást az első verzióban.
- Minden futásnak van maximális lépésszáma, ideje és költségkerete.
- Vészleállítás után újabb modell- vagy eszközhívás nem indulhat.
- A tesztek alapértelmezetten determinisztikus mock modellt használnak.
- Az OpenAI provider tesztjei injektált helyi HTTP-válaszokat használnak, ezért
  nem olvasnak valódi kulcsot és nem fogyasztanak API-egyenleget.

