# SI-B06 – Stratégiai autonómia elfogadási próba

2026-10-23. **SI-B06 kész, SI-M2 korlátos stratégiai kapu PASS; SI-C01
elkezdhető.** Az első valódi providerpróba FAIL, a külön dokumentált v2 PASS.
Ez nem SI-M1 önfenntartási, MVS vagy realizmuskalibrációs minősítés.

## Előre rögzített futási terv

Hipotézis: a saját körülményváltozásból épített context alapján a planner
engedélyezett alternatívát választ, a meglévő B03/B05 út végrehajtja,
és a következmény kanonikus natív forrásig követhető. A scripted technikai
próba ezt a vezetékezést vizsgálja; a valódi provideres próba külön eredmény.

Négy ág azonos, frissen létrehozott helyi baseline-ból: kontroll,
megszűnt jövedelemforrás, nyersanyaghiány, új együttműködési lehetőség.
A baseline és a beavatkozás előtti/utáni állapot külön rögzül. A jelenlegi
mechanikai fixture nem SI-A15 többnapos gazdasági vagy önfenntartási mérés.

Natív határ: packed LostCity content → valódi Player/inventory/checkpoint,
SDK socket → gateway food adapter → immutable production/consumption receipt;
együttműködésnél B05 ajánlat → külön partnerdöntés → natív service proof →
treasury/reward. Csak eldobható fixture, új skillpublikálás és élő enrollment nélkül.
Azonosító: fixture-world / fixture-lifecycle / fixture-clock, profile `a×64`;
simulation time 2001-01-01, aktuális wall time. A manifest a forrást,
baseline-t, promptot, configot és minden próbát hashhez köti.

Opportunity set előre rögzített; a modell csak azonosítót választ.
Nem szabad kizárólag egy következő skillt előírva autonómiát állítani.
Minden modellválasz, hibás választás, várakozás és natív kimenet megmarad;
nincs kedvező futás kiválogatása vagy automatikus retry.

Valódi provider: OpenAI Responses, `gpt-6-luna`, `medium`, a futás manifestjében
rögzített prompt/config. A felhasználó 10 USD feltöltött egyenleget jelzett,
olcsó Luna/medium indulást kért és az ár/érték döntést ránk bízta.
Ehhez a próbához legfeljebb **50 000 microUSD = 0,05 USD**, legfeljebb 8 kérés,
kérésenként 8192 byte planner-payload, további konzervatív 8192 byte
schema/message envelope és 2000 output-token, 30 s, teljes próba 180 s.
Standard díj: 100 000 / 500 000 microUSD millió input/output-tokenenként.
Forrás: [hivatalos modelloldal](https://developers.openai.com/api/docs/models/gpt-6-luna).
A keretfoglalás a teljes felső becslést számolja, bizonytalan válasznál nem
szabadítja fel automatikusan. Nincs modellváltás vagy titok-fallback.

Stop: hiányzó kulcs, provider/budget/preflight hiba, idő- vagy híváskeret,
forrásazonosság-változás, tiltott modellkimenet vagy natív bizonytalanság.
Providerhiány `not-tested`; mockból nem keletkezhet valós-LLM PASS.
A teljes SI-M2 kapuhoz mind a négy ág és a stratégiai szemantika szükséges:
bevételvesztés után eltérő terv/munka, hiánynál tényleges acquisition/alternatíva,
együttműködésnél önálló kezdeményezés és külön partner-consent.
Rutinfolytatás, sikeres retry, ACK vagy exit 0 önmagában FAIL.

## Előellenőrzés és tesztscope

`20261023-214449-510-si-b06-provider-status`: PASS, 1,771 s.
Szerver-override: enabled, mock/deterministic-scripted-v1, napi és híváskeret 0;
OS titoktárban a credential configured=false. Titok nem került kiolvasásra.
A 10 USD kredit nem helyettesíti a szerverhez beállított API-kulcsot.

Érintett komponens: society-experiments elfogadási riport/korlátos próbafuttatás,
meglévő natív food fixture és közvetlen gateway wrapper. Célzott tesztek,
érintett root/engine TS és változott sorok formázása elegendő; közös runtime,
perzisztencia- vagy authorization-invariáns módosítása nincs, full nem indokolt.

## Implementáció és használat

`society-experiments/strategic-acceptance.ts` a meglévő orchestrator,
InferenceQueue (429-retry=0), LlmDailyBudgetStore és OpenAIResponsesProvider
fölötti kicsi próba-/riportadapter. A valódi hívások a meglévő
`lostcity-local` költségledgerben is 5000 microUSD előfoglalást kapnak;
bizonytalan kérés foglalása nem szabadul fel automatikusan. A providerkulcs
kizárólag a Helyi szerver Windows titoktárából érkezik; nem environmentből
vagy fájlból. A saved server configot nem írja át a próba saját configja.

```powershell
pwsh -NoProfile -File scripts/invoke-verification.ps1 -Name si-b06-scripted -CommandText 'bun ./scripts/run-strategic-acceptance.ts --provider scripted'
# Csak külön, engedélyezett provideres mérésként:
pwsh -NoProfile -File scripts/invoke-verification.ps1 -Name si-b06-real -CommandText 'bun ./scripts/run-strategic-acceptance.ts --provider openai'
```

Minden új attempt saját, felül nem írható
`.local/experiments/si-b06/<timestamp-provider-id>/` könyvtárat kap.
Manifest/config/prompt/opportunity set, Git revision+dirty diff, untracked
források és packed server/client/cache digest, tényleges baseline-projekció,
observer/inbox/AgentState/Business/contract/treasury/needs/checkpoint DB-k,
request/response/audit/trace és natív skill/receipt maradnak meg.
A publikus JSON csak a helyi collector kimenete; feltöltött `nativeVerified`
boolean nem forráshitelesítés. Nem új optimizer vagy scheduler, nincs migráció.

A két Player-alternatíva tényleges natív gather és saját cooked-food consume,
tesztben ismert/verified 0.1.0 definíciókkal; a live katalógus nem változik.
Egységes baseline: pot1, raw1, cooked2, GP20, aktív 5 GP-s employment,
Business raw1/treasury25, saját trust30/20. A baseline-projekció nem a teljes
SI-A15 archívum helyettesítése. A későbbi inputhiány most csak ismert
gather/cook procedure-rel rendelkező Player saját friss 377-készletéből ébreszt;
ismeretlen/idegen/stale inventory nem lesz nulla készlet.

## Első valódi provideres eredmény – változatlanul megőrizve

[Kompakt mérési bizonyíték](SI_B06_LUNA_ATTEMPT_1.json).
Teljes helyi attempt:
`.local/experiments/si-b06/2026-10-23T20-21-24-389Z-openai-e141f939/`.
Run ID `7b640859-799f-450a-8e04-240ec010b760`, source digest
`2220a9d9a6b9d07900de75fe13f5907767c0c57f45ebd135ffb5aa6e573548d9`.

- **5 valódi kérés, 1795 microUSD = 0,001795 USD**, 11 986 microUSD
  konzervatív saját foglalás; uncertain=0. Mért provider/native program
  33,348 s; wrapper 38,822 s. Model `gpt-6-luna`, reasoning `medium`.
- Kontroll: gather, kanonikus raw+1. Income-loss: ugyanaz a gather és
  approved-policy forrás, raw+1/GP+0; **nincs igazolt stratégia-/munkaváltás**.
- Raw-scarcity: natív készletváltozás→observer/inbox→model→adopted run→raw+1.
- Együttműködés: Player saját, tartós 5 GP-s work-proposal; külön Business
  döntés **4 GP-s ellenajánlatot** hozott létre. A v1 futtató két fél egy-egy
  döntése után lezárta ezt az ágat, így contract/performance/payment nem volt.
- A Bun harness négy esete lefutott; az elfogadási CLI helyesen **exit 1 /
  realLlm=fail**. Ez nem négy sikeres autonóm elfogadás. A scripted technikai
  PASS nem írja felül. Nem indult automatikus fizetős retry, erősebb modell
  vagy kedvező próbák kiválogatása.

A kontrollban hunger=0, consume csökkentené a food reserve-öt; a gather a
felkínált két lehetőség közül az egyetlen hasznos megélhetési alternatíva.
Azonos választásból ezért itt **nem dönthető el**, hogy a modell nem reagált
az income-loss tényre, vagy a kínálat nem engedett értelmes másik munkát.
A bukás nem indokol erősebb modellt vagy prompttal előírt választást.
Következő mérés előtt valóban végrehajtható, eltérő bevételi/work-source
alternatívákat kell adni azonos, őszinte kontrollhoz. Csak ilyenkor érdemes
új fizetős, előre deklarált összevetést futtatni.

## A mérésből következő javítások és fennmaradó kapu

- Az admin formot a mentett LLM-settings betöltéséig nem lehet menteni;
  a saját settings betöltése elkülönül más dashboardvégpont hibájától.
  Bootstrap-retry nem írja felül a már megkezdett szerkesztést/kulcsot.
  A felhasználó a Helyi szerveren mentette a kulcsot; a régi `test` instance
  nem módosult. Csak control plane és gateway indult, játékszerver nem.
- Az együttműködési context most külön tartalmazza a **tényleges saját
  elérhető GP-t** és a vállalási limitet. A modell korábban csak az 5 GP-s
  limitből következtetett a pénzhelyzetre, miközben a treasury25 volt.
  Idegen inventory/treasury és privát trust ettől sem válik láthatóvá.
- A technikai folytatás legfeljebb négy, új offerhez kötött, külön
  döntési fordulót enged. Nem küldi újra a korábbi inference-t. Megtartja az
  eredeti 60 s cooldown-t; a scripted fixture órája kizárólag a tárolt
  `nextEligibleAt` határra lép, a valódi ág valódi időt várna. A teljes próba
  ideje monoton óráról mért. Nincs cooldown- vagy termék-timeout gyengítés.
  A scripted próba most az ellenajánlat→külön elfogadás→B03-adoption→natív
  gather→4 GP díj utat is ellenőrzi, egyetlen foglalásból.

E pont a v2 előtti történeti állapotot rögzíti. Az első eredmény és annak
régi source/config digestje változatlan; a külön v2 terv és eredmény lent
szerepel. Az első FAIL-t nem minősítettük át.

## Ellenőrzési index

- `20261023-215943-621-si-b06-provider-configured`: státusz PASS, 1,740 s,
  kulcs configured=true, OpenAI/Luna, napikeret50 000. Titok nem íródott logba.
- Az első olcsó helperpróbák hibás allowed-skill fixture-t és hiányzó nyers
  model-response mentést fogtak; javítva, az eredeti FAIL logok megmaradtak.
- `20261023-220414-178-si-b06-native-first`: baseline FAIL, 7,333 s;
  nem stackelt két cooked item összesítése javítva.
- `20261023-220447-652-si-b06-native-baseline`: protokoll FAIL, 5,199 s;
  tényleges NeedsStore-admission és helyes Business DB-kötés pótolva.
- `20261023-220632-247-si-b06-native-source-bindings`: négy scripted PASS,
  6,234 s; ez még a később erősített B03 cooperative-adoption előtti kör.
- `20261023-220928-931-si-b06-native-browser-types`: öt runtime PASS,
  engine TS FAIL, 81,551 s. Eltérő TS-projekt dinamikus titoktár-határa és
  két fixture-típus javítva; root TS ekkor már PASS volt.
- `20261023-221503-295-si-b06-final-technical`: **47 PASS + root/engine TS +
  format**, 94,838 s; közös fixture régi húsz natív esete és közvetlen
  goal/replan fogyasztók is. Új native wrapper nem új full-trigger.
- `20261023-221810-832-si-b06-provider-stop-types`: **13 PASS + root/engine
  TS + format**, 69,770 s; stock scope, provider stop és usage megőrzés.
- `20261023-222012-493-si-b06-no-retry-scripted`: **5 PASS**, 9,285 s,
  külön 429/no-retry negatív eset és négy native scripted ág.
- `20261023-222122-046-si-b06-final-types`: root/engine TS + format PASS,
  69,113 s. Párhuzamosan a fenti valódi mérés, nem összeadandó összidő.
- `20261023-222122-500-si-b06-luna-real-attempt-1`: **stratégiai FAIL**,
  38,822 s; a négy harness-case végrehajtása önmagában nem kapu-PASS.
- `20261023-222850-958-si-b06-funding-counteroffer`: 21 B05 PASS; a native
  folytatást az eredeti cooldown megállította, 28,255 s. Nem lett csökkentve
  a termék cooldownja, nem lett vakon megemelve a régi timeout.
- `20261023-223105-024-si-b06-counteroffer-cooldown`: **5 PASS**, 4,521 s;
  négy scenario + gateway wrapper, scripted óra, ellenajánlat és 4 GP kifizetés.

A wrapper a gyermek kimenetét hiba esetén megismételheti: az ilyen duplikált
FAIL-sorok nem további önálló tesztesetek. A körelemek átfednek, nem adhatók
össze egyetlen egyedi tesztszámmá. **Teljes regresszió nem futott.**

## V2 előre rögzített diagnosztikus terv

Az első valós FAIL után a mikrobaseline valódi, már fedezett, egy-egy exact
natív gather invocationt vállaló 5/4/3 GP-s munkaszerződést kap. Mind a négy
ág ugyanebből indul. A források offer/contract ID-ja a négy fixture között
stabil, így azonos skill másik work-source-ból való végrehajtása mérhető.
Az income-loss beavatkozás az eredeti 5 GP-s munkaviszonyt és kapcsolt
szerződést szünteti meg; annak fedezete szabályosan felszabadul. Két
végrehajtható, külön díjazású munkaforrás marad. Kontrollban és income-lossban
is valódi natív GP-jóváírás szükséges a kapcsolt, forráshitelesített service után.
Nincs kamu shop vagy előírt következő skill, nincs új bevételi domén.

Az új együttműködéshez a baseline-ban ismert, külön Business partner
25 GP-s saját treasuryt kap; a meglévő szerződésekre már elkötelezett régi
Business nem új ajánlattal kerüli meg a vállalásait. A stratégiai döntés az
új partnerhez irányuló, kétféle typed ajánlat és annak önálló fogadtatása;
elfogadás után a végrehajtási fázis az elfogadott exact commitment scope-ját
teljesíti a meglévő B03-adoptionnal. A többi alapállapot megegyezik.

A model request csak az ismert skillek id/version/name/description mezőit
kapja, a teljes mechanikus lépéssor nem kerül az alternatívaválasztás mellé.
A meglévő 8192 byte payloadkeret marad. Ez egy új v2 opportunity set és
baseline, nem az első futás utólag átminősítése. Scripted preflight után
egyetlen külön v2 valós összevetés engedhető meg az eredeti 50 000 microUSD
összkeretből már felhasznált 1795 levonásával; napi shared ledger is érvényes.
Model/prompt/reasoning/token/híváskeret változatlan. Minden kimenet megmarad.

## V2 eredmény és feladatzárás

[Teljes kompakt v2 bizonyíték](SI_B06_LUNA_ATTEMPT_2.json), helyi forrás:
`.local/experiments/si-b06/2026-10-23T20-53-39-749Z-openai-627ef277/`.
Run `df8b68de-ccaa-4972-b511-748a2000152a`, source digest
`34e2c8afb56fd929fcff693df588c334e9ad89595f1b086f86edb9df108d8acf`,
baseline digest `39b8f10af2a90ebe6982ba52e42a27bd3e89f1182a060078ccbc8c2b3e8f4fcc`.

- **Kontroll:** modell az 5 GP-s szerződést választotta a 4/3 GP-s és consume
  lehetőségek közül; native raw+1, wallet20→25, treasury25→20.
- **Income-loss:** megszűnt a régi jövedelem és szerződés; a modell a két
  megmaradt fizető útból a 4 GP-s munkát választotta. Eltérő, stabil contract-
  obligation source ID, elfogadott B03 terv, native raw+1 és wallet20→24.
  Ugyanaz a Skill[]-mechanika valóban más munkaforrást teljesített.
- **Raw-scarcity:** tényleges saját raw377 készlet1→0, observer/inbox source,
  észlelt hiány, választott terv, source-backed raw+1 és 5 GP kifizetés.
- **Cooperation:** a Player önálló 5 GP-s typed javaslatot tett az ismert
  új partnernek; a Business saját külön modellválasszal elfogadta. Ezt
  bounded B03-adoption, valódi SDK/packed gather és egyszeri 5 GP settlement
  követte. Az elfogadást nem szimuláltuk és nem kényszerítettük ki.

Mind a négy valódi ág **PASS**, 6 modellkérés; 2046 microUSD = 0,002046 USD,
uncertain0. A provider/native program36,652 s, wrapper39,225 s. A két valódi
attempt együtt **11 kérés / 3841 microUSD = 0,003841 USD**, az engedélyezett
0,05 USD alatt. Ez a futáskor számolt, cache-írás nélküli összeg; a korrigált
összeg **4235 microUSD = 0,004235 USD**, az alábbi egyeztetés szerint.
Nincs harmadik valódi futás és nincs erősebb modellre váltás.

A külön readonly egyeztetés mind a négy ágon összekötötte a natív skill run,
contract evidence, settlement és PlayerRewardStore ID-ját. Egyetlen committed
reward jut ágonként a megfelelő szerződésre; a walletváltozás megegyezik a
natív rewarddal. A két Business teljes egyenlege + a Player coinállománya
minden záráskor **70 GP**, a fedezet nem számítódik másodszor pénznek.
Az eredeti munka megszüntetésekor visszaengedett hold nem Player-jövedelem.

A szolgáltatás továbbra is **egy natív invocation**, nem Businessbe szállított
alapanyag vagy élelem. A szabad szöveges modellindok nem új forrásállítás;
a numeric verdict a kanonikus receiptből és pénzledgerből származik.
A food reserve cél a nyers outputtól helyesen nem lesz completed.
Ez kis, eldobható natív fixture-ben végrehajtott valódi modell-elfogadás,
nem többnapos gazdasági/önfenntartási vagy live enrollment/publication PASS.

További ellenőrzések:

- `20261023-223905-851-si-b06-close-focused`: 3 helper PASS és root/engine TS
  PASS, csak a handoff utolsó üres sora miatt format FAIL, 89,631 s; javítva.
- `20261023-224150-019-si-b06-native-offer-audit`: readonly v1 source audit
  PASS, 0,491 s; két tényleges open offer és két applied model-action.
- `20261023-224859-970-si-b06-v2-funded-baseline`: v2 fixture FAIL, 10,487 s;
  a meglévő baseline-contractot nem szabad új partner-consentnek tekinteni.
  Partnerhez kötött contract selection és negatív riportőr pótolva.
- `20261023-225110-953-si-b06-v2-source-boundaries`: **7 PASS + root/engine
  TS + format**, 91,003 s; három helper és négy friss scripted ág.
- `20261023-225338-609-si-b06-luna-real-attempt-2-v2`: **négy valódi
  stratégiai PASS**, 39,225 s, 6 kérés / 2046 microUSD.
- `20261023-225715-049-si-b06-v2-native-money-audit`: **readonly pénz/run/
  contract egyeztetés PASS**, 0,551 s; négy zárt 70 GP-s pénzegyenlet.
- `20261023-230242-672-si-b06-docs-final`: **dokumentáció/JSON/link/roadmap és
  staged formázás PASS**, 1,710 s; 21/45 kész, következő SI-C01,
  a két attempt 11 kérés /3841 microUSD összesítése egyezik.

SI-B01–SI-B06 kész, a SI-C fázis megkezdhető. Következő **SI-C01**;
e kérés részeként nem kezdjük el. A történeti SI-A gazdasági hiányok és
SI-C09 realizmuskalibráció továbbra is külön, nyitott ügyek.

## 2026-10-24 – Cache-díj egyeztetése, új modellhívás nélkül

A lezáró audit a valódi válaszok `input_tokens_details.cache_write_tokens`
mezőjében cache-írást talált. A [hivatalos cache-szabály](https://developers.openai.com/api/docs/guides/prompt-caching)
szerint a modern modellek default30m írása 1,25× inputdíj, a Luna cache-read
0,1× inputdíj; a 12h opciót a provider nem kéri. Ezt a meglévő provider
usage-konverziója és a trial saját számlálója korábban nem számolta.

Az új `calculateOpenAIUsage` a normál input/cache-read/cache-write részt
elkülönítve, egyszer árazza, válaszonként egész microUSD-re felfelé kerekítve.
A trial worst-case foglalása most a teljes inputra a cache-write felső díjat
használja. Hiányzó usage-nál nem enged nullás költséggel felszabaduló foglalást.
Régi modelleknél a konzervatív full-input cache-read becslés megmarad;
ismeretlen write-árazás és ellentmondó tokenbontás hibát ad.

A mentett 11 HTTP-válasz offline mock-transportos visszajátszása azonos
választásokat adott, és **1795→1957**, illetve **2046→2278 microUSD** díjat
számolt. Összesen **3841→4235 microUSD**, a különbség394 microUSD.
Ez usage és Standard tarifa szerinti, kerekített számítás, nem letöltött
számlakivonat. Minden válasz `service_tier=default`, modellje `gpt-6-luna`.

A régi mérési JSON/audit/sorok változatlanok; a két publikus bizonyíték
`billingReconciliation` része és a helyi `billing-reconciliation.json` adja
a korrigált számokat. A meglévő budgetledgerben egy hozzáfűzött, stabil ID-s,
auditált394 microUSD korrekció rögzült2026-10-24-én, régi sor átírása nélkül:
`si-b06-cache-correction-b338f0f35d0294f3326ea0f0`. Ez könyvelési admission,
nem új API-hívás; az API-kérések száma továbbra is11. A SI-M2 verdict és
a natív eredmények nem változtak, nem indult új valódi vagy natív futás.

Érintett határ: `calculateOpenAIUsage` → provider `usage.costMicros` →
orchestrator/budget/dry-run/trial. A ledger tranzakció-, migráció- és
reservation/reconcile szemantikája nem változott, ezért célzott kör elegendő.

- `20261024-120041-850-si-b06-cache-pricing-boundary`: **30 PASS + root/engine
  TS**, 156,574 s; öt közvetlen tesztfájl, nincs modellhívás vagy full regresszió.
- `20261024-120303-797-si-b06-cache-offline-replay`: **11 rögzített válasz
  offline újraszámolása PASS**, 0,502 s, változatlan model-output.
- `20261024-120440-302-si-b06-cache-ledger-reconciliation`: **auditált,
  hozzáfűzött budget-korrekció PASS**, 0,648 s.
