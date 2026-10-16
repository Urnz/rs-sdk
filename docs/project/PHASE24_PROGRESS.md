# 24. fázis – eredmények

Az aktuális feladatsorrend és státusz egyetlen forrása a [TASKS.md](TASKS.md).
Ez a fájl a lezárt részfeladatok megvalósítási és ellenőrzési bizonyítékát őrzi;
a 24.2 és későbbi követelményeket nem emeli a 24.1 határába.

Követési pontosítás (2026-10-15): a 24.8 elnevezés a TASKS 24. fázisának
nyolcadik fő pontját, az összehasonlításokat jelöli. Az összehasonlító eszköz,
az XP-baseline és az első natív XP-számítás kötése ennek az implementáció
során kialakított előkészítő bontása volt, nem három külön eredeti
roadmap-követelmény. Ezek most külön `[x]` részfeladatként is szerepelnek a
TASKS-ban; a hat tényleges összehasonlítás változatlanul `[ ]`. Az ekkor
megadott, élő XP-kezeléspárra vonatkozó következő lépést a 2026-10-16-i
felhasználói döntés felülírta: előbb funkciófejlesztés, teljes társadalmi
működési ellenőrzés és hibajavítás, majd paraméterkísérletek. A 24.8 nem
blokkolja a 24.9 és későbbi funkciókat. A bizonyíték további korlátai önmagukban
nem jelölnek ki újabb infrastruktúra-feladatot. A korábbi bejegyzések
tesztadatai megvalósítási ellenőrzések, nem élő benchmarkeredmények.

## 24.1 – mérhető önfenntartási minimum kész (2026-10-14)

A `private-society-minimum@1.0.0` policy legalább 24 szimulációs óra bemelegítés
után hét teljes, egymást követő szimulációs napot követel, napi mérési ablakokkal
és legalább négy rögzített alapítóval. A minimum 17 mennyiségi követelménye az
élelemellátást, éhséget/fáradtságot, jogszerű lakhatási hozzáférést, eszközpótlást
és tényleges munkamegosztást fedi le. A nyolc kötelező integritási feltétel a
genesis alkalmazásától kezdve a bemelegítést is magában foglalja.

A `society-minimum` modul szigorúan validálja a konfigurációt, a meglévő véges
world profile-okhoz és a tényleges needs/housing/food/tool/clock policykhoz kötött
snapshotot készít, és digesttel védi a teljes mérési szerződést. Az azonos verzió
mellett megváltozott függőség is megváltoztatja a szerződés digestjét; a korábbi
kötés elutasított. Hiányzó bizonyíték vagy nulla kereslet/lehetőség nem lehet
sikeres mérési eredmény. Az élelem- és eszközkészlet felélése, külső import vagy
admin/fallback segítség nem minősül belső önfenntartásnak.

Az artifact explicit `unmeasured`; nem állítja, hogy egy társadalom már teljesítette
a minimumot. A 24.1 definíciót és szerződésvalidálást ad, nem runtime adatgyűjtőt,
injekciódetektort vagy benchmarkot. Nincs tartós séma-, gazdasági vagy élővilág-
módosítás. A konfiguráció/modul eltávolítása adatbázis-migráció nélkül visszavonható;
a későbbi kísérletek a saját pontos szerződésüket őrzik meg.

Részletes követelmények, bizonyítékforrások, döntési protokoll és rollback:
[Phase 24.1 society minimum](features/phase24-1-society-minimum.md).

Ellenőrzés:

- Fókuszált szerződéssuite: **13 pass / 0 fail / 0 skip**, root TypeScript PASS
  (`.local/verification/20261014-221342-415-phase24-1-initial-contract.log`).
- Érintett society/needs/loop-metrics/food/housing/item-lifecycle/population/genesis
  integráció: **182 pass / 0 fail / 0 skip**, root/engine/webclient TypeScript és
  format PASS
  (`.local/verification/20261014-222814-077-phase24-1-domain-quality.log`).
- Teljes `bun run verify:full` / `bun run check`: **1636 pass / 0 fail / 0 skip**,
  exit 0 (`.local/verification/20261014-223046-883-full.log`, külső wrapper:
  `.local/verification/20261014-223045-950-phase24-1-full-final.log`). A tesztekhez
  a tényleges helyi packed cache csak olvasható kiszolgálása történt; élő engine
  vagy bot nem indult.

A következő véges feladat a 24.2: bootstrap értékek genesis-eseményként kezelése,
runtime admin/fallback injekciók jelölése és opcionális clean-run érvénytelenítés.

## 24.2 – genesisértékek és runtime injekciós kapu kész (2026-10-14)

A `society-integrity` modul külön eseményként őrzi a deklarált pénz/tárgy
kiosztásokat, a Business kezdőtőkéjét és a ténylegesen megfigyelt nyitó vagyont.
Minden alapító mentése bekerül a nyitó pillanatképbe akkor is, ha nem kap új
kiosztást. A meglévő vagyon korábbi keletkezése explicit ismeretlen; történeti
termelési eredet nem keletkezik utólag. A bootstrap natív módosításai pontos,
egyszer használható engedélyt kapnak, a későbbi `creditGenesis` hívás nem válik
automatikusan bootstrap értékké.

Nyolc engine/gateway forrás jelöli a pénz/tárgy/XP admin hozzáadását, a treasury
és Business stock granteket, az item-cheateket, a privilegizált segítséget és a
default save fallbacket. A közös SimulationClock időbélyegei mellett az intent
megelőzi a natív módosítást, a hash-kötött lezárás pedig követi azt. Félbeszakadt
vagy bizonytalan művelet nem ad sikeres injekciós kaput. A valóban fedezett belső
kifizetéshez natív treasury foglalás, címzett/összeg-kötés és tényleges terhelés
kell. A bizonyítottan kompenzált inventory-hiba az eredeti settlement ID-val
újrapróbálható, és nem enged dupla pénzteremtést vagy idő előtti tiszta minősítést.

Az `invalidateOnInjection` beállítás alapértéke igaz, a run a választást rögzíti.
Kikapcsolásakor az esemény és a szennyezési jelzés megmarad. Restart és reset
nem törli a történetet. Régi alkalmazott social genesisnél a megfigyelés a
következő natív határon elindul, de a korábbi bizonyítékrés tartós marad.
Hitelesített, csak olvasható riport:
`GET /api/admin/world-genesis/:resultId/integrity`.

Az additív integritási tároló sémája v1; a régi gazdasági, AgentState és mentési
sémák változatlanok. A riport a megfigyelt injekciós kaput értékeli, nem a teljes
24.1 minimum teljesülését vagy minden forrás teljességét. Részletek, határok és
rollback: [Phase 24.2 society integrity](features/phase24-2-society-integrity.md).

Ellenőrzés:

- Érintett integráció: **72 pass / 0 fail / 0 skip**, root/engine/webclient
  TypeScript és format PASS
  (`.local/verification/20261014-230605-310-phase24-2-native-domain-final.log`).
- A teljes regresszió által feltárt JSON-mezősorrend-függő mentésösszehasonlítás
  kanonikus összehasonlítást kapott. Az új teszt az egy GP értékeltérést továbbra
  is elutasítja. Utána **30 pass / 0 fail / 0 skip** és minden typecheck/format
  PASS (`.local/verification/20261014-231559-016-phase24-2-canonical-native-final.log`).
- Egy köztes teljes futás régi estate tesztje 5000 ms időtúllépést kapott. A
  célzott eset **1/1**, az egész estate csomag **34/34** zöld az eredeti timeoutok
  és assertionök mellett
  (`.local/verification/20261014-232354-309-phase24-2-estate-timeout-recheck.log`,
  `.local/verification/20261014-232438-415-phase24-2-estate-suite-recheck.log`).
- Sikeres teljes `bun run verify:full` / `bun run check`: **1656 pass / 0 fail /
  0 skip**, exit 0 (`.local/verification/20261014-232548-842-full.log`, külső
  wrapper: `.local/verification/20261014-232547-972-phase24-2-full-confirmed-final.log`).
- A legutolsó kompenzált-kifizetés retry javítása után **22 pass / 0 fail /
  0 skip**, root és engine TypeScript PASS
  (`.local/verification/20261014-233155-539-phase24-2-funded-retry-final.log`).

A tesztek izolált tárolókat és csak olvasható helyi packed cache-t használtak;
élő engine, bot vagy önfenntartási benchmark nem indult. A következő véges feladat
a 24.3: food, tool/maintenance, housing és fő inputkategória self-sufficiency
mutatók és a szükséges forrásadapterek.

## 24.3 – önellátási mérési felület kész (2026-10-15)

A `society-metrics` meglévő natív SQLite naplókból készít csak olvasható,
digestkötött diagnosztikai riportot, explicit actorokkal és szimulációs ablakkal.
A food adapter a deduplikált fogyasztást és a ténylegesen eltárolt éhségdeltát
méri; az eszközadapter a kopást, javítást/pótlást, újraindult használati ciklust és
az ablakhatárok használható termelési kapacitását játssza vissza. Lakhatásnál
személyenként integrálja a dokumentált kezdeti foglalási időt, és kizárja a
konfliktusos időszakokat. A fizetős foglalás az első díjesedékességnél megáll;
egy arrears-kifizetés nem történeti hozzáférési engedély.

Öt konfigurálható, diszjunkt fő inputkategória marad látható: raw food, érc,
karbantartási fém, póteszköz és építőanyag. Tételenként megmaradnak a
fogyasztási closure-höz/javítási policyhoz/pótláshoz társított mennyiségek és
eseményhivatkozások; ezek nem kapnak kitalált natív fogyasztási időt vagy belső
eredetet. Hiányzó kategóriabizonyíték nem lesz nulla, és egy másik termék
többlete nem kompenzálja.

Az adapterek ellenőrzik a hash-láncot és a forrássorok összhangját; sérült vagy
nem támogatott séma `invalid`, hiányzó/konfigurálatlan adatbázis `unavailable`.
Nem futtatnak migrációt és nem hoznak létre hiányzó adatbázist. Az eseményablak
`(start,end]`, az intervallum `[start,end)`; a hányadosok lefelé kerekített BigInt
osztással, az eredeti számláló/nevező megtartásával készülnek.

A teljes eredet-, igény-, jogszerű hozzáférési és forráslefedettségi bizonyíték
ezekből a régi naplókból nem rekonstruálható. Emiatt a belső önellátási arányok
ismeretlenek, a teljes riport `inconclusive`; nem állítja a 24.1 minimum
teljesítését. A kapacitásveszteség és egyéb mért diagnosztika ettől függetlenül
látható marad. A source head/snapshot hash nem külső teljességi tanúsítvány;
actor/clock/run-kötést vagy megfigyeletlen történetet nem talál ki.

Elérhető a `bun run society:metrics` JSON CLI és az autentikált
`GET /api/admin/society/self-sufficiency` végpont. A forrásútvonalak kizárólag
szerverkontextusból vagy helyi CLI-ből adhatók, HTTP queryből nem. Nincs új
tartós séma, gazdasági mutáció, `.canvas.tsx`, import/export domain vagy élő
benchmark. Rollback: az új modul/config/CLI/route eltávolítható a natív naplók
módosítása nélkül.

Részletek és használat:
[Phase 24.3 self-sufficiency](features/phase24-3-self-sufficiency.md).

Ellenőrzés:

- Új modul + autentikált végpont: **19 pass / 0 fail / 0 skip** az érintett
  domain suite **139 / 0 / 0** tesztjében; root/engine/webclient TypeScript és
  format PASS
  (`.local/verification/20261015-170335-434-phase24-3-domain-quality.log`).
- Dokumentált CLI smoke: PASS, explicit `unavailable`/`inconclusive` JSON
  (`.local/verification/20261015-170621-686-phase24-3-cli-smoke.log`).
- Teljes `bun run verify:full` / `bun run check`: **1676 pass / 0 fail / 0 skip**,
  exit 0 (`.local/verification/20261015-170517-967-full.log`, külső wrapper:
  `.local/verification/20261015-170517-173-phase24-3-full-final.log`).

A következő véges feladat a **24.4**: explicit külső kereskedelmet engedő world
profile esetén külön import/export domain és mérés, végtelen NPC shop nélkül.

## 24.4 – külön, véges import/export domain kész (2026-10-15)

Az `external-trade` kizárólag valódi, lezárt helyi engine player trade-ekből mér
külső áru- és GP-forgalmat. A world profile csak pontos profile/version/digest és
policy/version/digest kötésen keresztül engedélyezheti; a szállított policy- és
kötéslisták üresek, ezért minden jelenlegi profil alapból tiltott marad.
Nincs NPC shop settlement, automatikus restock, készlet-/pénzteremtés vagy
gazdasági végrehajtó végpont.

A név szerint deklarált külső partnerek teljes futásra szóló, véges bruttó
trade-, GP- és termékenkénti import/export kvótákat kapnak. A visszaexport nem
újítja meg az importkeretet. A már lezárt, korlátot sértő cserét a mérés megőrzi
és megjelöli; nem tünteti el a forgalomból. A GP-adat tényleges 995-ös tétel,
nem az engine `fromValue`/`toValue` értékbecslése. A barter nem kap kitalált árat.

A natív trade-writer az új bizonylatokat a valódi közös SimulationClockhoz köti
event ID/digest, tick és commit wall time alapján, a forrássor publikálása előtt.
A hiányzó/hibás clock-kötés az exchange-t megőrzi, de időzítetlenként. Replay
nem talál ki utólagos szimulációs dátumot, és hiányzó világórát sem hoz létre.

A regisztráció natív applied genesishez, változatlan policyhoz, AgentState
actor/username-regiszterhez, clock/profile-hoz és forrásútvonal-digesthez kötött.
Az aktuális engine audit-prefix után kezd mérni; korábbi történetet nem gyárt.
Külön `external-trade-registration` clock-marker védi a teljes regisztrációt,
a már megfigyelt wall time használatával, szimulációsidő-előreléptetés nélkül.
Az import/export DB elvesztése vagy a regisztráció törlése ezért nem újíthatja
meg csendben ugyanannak a genesisnek a kvótáit.

Az új schema-1 journal atomi batch-ben, hash-lánccal és külön tail anchorral
őrzi a natív forrássuffixet. A GET egyetlen számviteli snapshoton belül ellenőrzi
a natív forrás- és clock-backinget. Sorhamisítás, suffix-törlés, megváltozott
időbélyeg/útvonal és nem támogatott séma fail-closed; túlcsorduláskor a teljes
megfigyelési batch visszagördül, a korábbi checkpoint megmarad. A natív trade,
clock és AgentState sémák nem változtak; a clock domének additív stamp-sorok.
Rollbackhoz az összetartozó journal/natív forrás/clock/genesis/AgentState mentést
kell megőrizni; marker törlésével nem lehet „javítani” vagy újranyitni a keretet.

A riport termékenként, partnerenként és agentenként tartja meg a forgalmat,
külön teljes-futási és `(start,end]` időablakos összesítéssel. Az időzítetlen és
nem regisztrált partnerű cserék külön maradnak; egy AgentState-en kívüli ember
nem válik automatikusan külső gazdasággá. Az extended ISO-évek összehasonlítása
kronológiai, fordított ablak elutasított. Látható a kimaradt kezdőprefix, az
utolérendő forrássorok száma és a regiszter eltérése is. Hiányos bizonyíték
`inconclusive`; a bizonyított szabálysértés ettől külön megmarad.

A teljes forráslefedettség továbbra is ismeretlen, a jelentés nem önellátási
minősítés. A zárt 24.1 szerződés most a külső policy-katalógusokat is pineli,
és külső kereskedelmet engedő kötelező profilra nem oldható fel. Az import soha
nem kap automatikusan belső termelési eredetet.

Elérhető az autentikált POST
`/api/admin/world-genesis/:resultId/external-trade/observe` és a csak olvasó GET
`/api/admin/world-genesis/:resultId/external-trade?from=...&to=...`. HTTP-ből
nem adhatók forrásútvonalak, tétellisták vagy hamis időbélyegek. Nem indult élő
engine/bot, nem történt profilengedélyezés vagy élő benchmark, és nem készült
`.canvas.tsx`.

Részletek, használat, bizonyítékhatárok és migration/rollback:
[Phase 24.4 external trade](features/phase24-4-external-trade.md).

Ellenőrzés:

- Érintett integrációs suite: **119 pass / 0 fail / 0 skip**, root/engine/webclient
  TypeScript és format PASS
  (`.local/verification/20261015-173326-651-phase24-4-final-domain-quality.log`).
- Végleges domain/admin regresszió az extended ISO-ablakkal és teljes futási
  összesítéssel: **25 pass / 0 fail / 0 skip**, mindhárom TypeScript és format PASS
  (`.local/verification/20261015-173843-866-phase24-4-chronological-final.log`).
- Teljes `bun run verify:full` / `bun run check`: **1701 pass / 0 fail / 0 skip**,
  exit 0, a végső dátumhatár-tesztet is beleértve
  (`.local/verification/20261015-173625-107-full.log`, külső wrapper:
  `.local/verification/20261015-173624-191-phase24-4-full-final.log`).

A következő véges feladat a **24.5**: gazdasági függőségi gráf hiteles
tranzakciókból és termelési eseményekből, agent-, Business- és termékszinten.

## 24.5 – megfigyelt gazdasági függőségi gráf kész (2026-10-15)

Az `economic-dependency` csak olvasó, determinisztikus gráfot képez a natív
engine trade auditból és az új, auditált Business WIP termelési bizonylatokból.
Agent-, Business- és termékprojekciót ad, minden mennyiségi élhez natív
eseményazonosítóval és digesttel. A trade mindkét tényleges tételirányt megőrzi;
a GP a 995-ös coin mennyisége, nem értékbecslés vagy kitalált barterár.

A natív WIP-lépés most ugyanabban az atomi készlettranzakcióban őrzi a pontos
elfogyasztott és létrehozott material ID-kat, előtte/utána mennyiségeket, Business-
és felelős actor-kötést, befagyasztott workflow/katalógust és a hash-láncos
bizonylatot, külön tail anchorral. Auditírási hiba minden készlet- és lépésváltozást
visszagörget. Exact replay és restart nem hoz létre új eseményt; natív sor,
actor/katalógus, mérleg vagy audit-tail sérülése fail-closed.

A valóban azonos köztes WIP lot köti össze a termelési lépéseket. A product-type
él osztályozás, nem oksági kapcsolat. Azonos item ID nem bizonyít Business-
tulajdont, termelésből későbbi player trade-be vezető lot-eredetet, végső
felhasználást vagy belső termelést. A nyitókészlet eredete ismeretlen marad.
A run actor a rögzített felelős, nem bizonyított fizikai skill-végrehajtó.

A trade agent-hozzárendelés időben érvényes natív PopulationMember-kötésből vagy
a trade előtt létrehozott, változatlan avatar-identitásból származhat. Hiányos
történeti hozzárendelés player node marad; hiányzó AgentState esetén a termelési
actor csak `actor-reference`. Későbbi tagság nem tölti vissza a múltat.

A riport explicit wall vagy simulation `(from,to]` ablakot használ. Szimulációs
időhöz pontos clock/profile és natív event-digest kötés kell; wall time nem
nevezhető át szimulációs idővé. Az új natív termelési writer a valódi közös
SimulationClockot használja, világórát nem hoz létre. Clockhiba időzítetlen
bizonylatot hagy; az esetleges árva clock-marker önmagában nem termelés.

A Business-adatbázis öt additív evidence táblát kapott schema 1 alatt; a közös
`user_version` és a trade/clock/AgentState sémaverziók nem változtak. A migráció
a régi lépésekből kizárólag ellenőrizetlen hivatkozáslistát őriz, nem talál ki
termelési múltat. A riport nem migrál és nem hoz létre adatbázist. Rollbackhoz
az összetartozó natív forrás/clock mentések megőrzése szükséges; az audit törlése
vagy régi lépések utólagos hitelesítése nem javítási eljárás.

Elérhető a `bun run economy:dependencies` CLI és az autentikált, csak olvasó
GET `/api/admin/economy/dependencies`. HTTP-ből nem választhatók forrásútvonalak.
A források külön konzisztens snapshotok; hiányzó vagy sérült csatorna látható,
nem válik kedvező üres méréssé. A lefedettség részleges, nem globális atomi
világállapot és nem önellátási minősítés. Nem indult élő engine/bot, nem történt
élő adatbázis-módosítás, és nem készült `.canvas.tsx`.

Használat, gráfszemantika, bizonyítékhatárok és migration/rollback:
[Phase 24.5 economic dependency](features/phase24-5-economic-dependency.md).

Ellenőrzés:

- 18 új gráfteszt + autentikált gateway teszt; az érintett domain suite
  **71 pass / 0 fail / 0 skip**, mindhárom TypeScript és format PASS
  (`.local/verification/20261015-180622-457-phase24-5-domain-quality.log`).
- Dokumentált CLI smoke: PASS, explicit `unavailable`, adatbázis-létrehozás nélkül
  (`.local/verification/20261015-181016-036-phase24-5-cli-smoke.log`).
- Teljes `bun run verify:full` / `bun run check`: **1720 pass / 0 fail / 0 skip**,
  exit 0 (`.local/verification/20261015-180855-839-full.log`, külső wrapper:
  `.local/verification/20261015-180851-733-phase24-5-full-final.log`).

A következő véges feladat a **24.6**: kritikus szereplők, single-point-of-failure
termékek, supply-chain mélység, termelési koncentráció és Business/agent kiesés
tovagyűrűző hatásának mérése. A 24.5 ezeket nem számolja.

## 24.6 – megfigyelt gazdasági sérülékenység kész (2026-10-15)

A `reportEconomicRisk` a 24.5 natív forrásokból újraellenőrzött gráfjára épül.
Termékenként méri a Business és a rögzített felelős agent termelési
koncentrációját: pontos mennyiségi részesedés, HHI és legnagyobb részesedés.
A gross termelési egységek nem árbevétel, kapacitás vagy munkatermelékenység.
Eltérő termékek és GP nem kerülnek közös mennyiségi összegbe. BigInt alapú,
decimális mennyiségek és pontos törtalak védik a nagy összesítéseket is.
Részben ismeretlen felelős actor mellett az agentkoncentráció nem számolódik
újra csak az ismert szereplőkre; null és külön ismeretlen mennyiség marad.

Single-point-of-failure jelölt csak az a termék, amelynek az ablakban egyetlen
megfigyelt termelő Business-e és valós WIP lotkapcsolattal bizonyított downstream
felhasználása van. Azonos item ID másik run nyitókészletében nem kapcsolat.
Ez megfigyelt jelölt, nem globális bizonyíték; a teljes világra vonatkozó verdict
mindig unknown. A supply-chain mélység a leghosszabb bizonyított, ablakon belüli
termelési lotút lépésszáma. A workflow sorrendi függősége önmagában nem anyagél;
ismeretlen/legacy vagy ablakon kívüli eredet külön boundary inputként látható.

Minden megfigyelt agent, termelő Business és termék külön feltételes kiesési
forgatókönyvet kap. Agent/Business esetén a rögzített szerepéhez tartozó
események maradnak el; termék esetén az azt igénylő lépések és az azt tartalmazó
trade-ek. Az eltűnt outputlot minden bizonyított fogyasztója tovább blokkolódik,
egy lépés több útvonalon is csak egyszer számolódik. A trade atomi: érintett
csere esetén minden áru- és coinláb kiesik, külön receipt- és flow-számmal.
Nincs kitalált továbbértékesítési vagy Business–player lotkapcsolat.

A közvetlen és propagált események, termékenkénti gross output-/trade-veszteség,
lot- és natív evidence-hivatkozások visszakövethetők. A kritikus szereplők
rangsora az érintett termelési eseményszámot, majd a kieső natív trade-receiptek
számát használja. Ez az adott ablak strukturális kitettsége: nincs készletpuffer,
helyettesítő beszállító/munkás, receptváltás, adaptáció vagy jövőbeli keresleti
modell. A riport nem előrejelzés és nem teljes gazdasági lefedettség.

Az eredeti gráf a digestelt riport része. Hiányzó/sérült forrás, azonosítatlan
agent és időzítetlen esemény megtartja a 24.5 bizonyítékhatárait; null mérés nem
válik kedvező nulla kockázattá. Ciklus, sérült artifact vagy túl nagy teljes
rangsor explicit hibával áll meg; nincs néma mintavétel vagy részleges scenario.

Használat: `bun run economy:dependencies --risk ...`; autentikált, csak olvasó
GET `/api/admin/economy/dependency-risk`. HTTP-ből nem választható forrásútvonal.
Nincs új tartós modell vagy séma, migráció nem szükséges; a származtatott analyzer
és belépési pontok eltávolíthatók a 24.5 forrásnaplók megőrzésével.
Nem indult élő stack/bot, nem történt élő adatbázis-módosítás vagy benchmark,
és nem készült `.canvas.tsx`.

Képletek, kiesési modell, korlátok, használat és rollback:
[Phase 24.6 economic risk](features/phase24-6-economic-risk.md).

Ellenőrzés:

- 21 új natív risk integrációs teszt + új autentikált admineset; az érintett suite
  **75 pass / 0 fail / 0 skip**, root/engine/webclient TypeScript és format PASS
  (`.local/verification/20261015-182348-190-phase24-6-final-domain-quality.log`).
- Dokumentált `--risk` CLI smoke: PASS, explicit unavailable, fájllétrehozás nélkül
  (`.local/verification/20261015-182413-222-phase24-6-cli-smoke.log`).
- Teljes `bun run verify:full` / `bun run check`: **1742 pass / 0 fail / 0 skip**,
  exit 0 (`.local/verification/20261015-182516-848-full.log`, külső wrapper:
  `.local/verification/20261015-182516-067-phase24-6-full-final.log`).

A következő véges feladat a **24.7**: a Phase 12 kísérleti infrastruktúrájára
hosszabb futásokat építeni azonos genesis seed, attribute-eloszlás, populáció és
world policy mellett. A 24.6 nem indított ilyen élő futást.

## 24.7 – kontrollált hosszú futásprogramok kész (2026-10-15)

A `society-experiments` véges, tartós futásvezérlőt ad a meglévő Phase 12
kohorsz-dispatch fölé. A ciklusok továbbra is a valódi coordinator/event gate,
budgetek, skill-dispatch és terminális journal útvonalán futnak. A program
bemelegítési és mérési szakaszt, órás/napi bucketeket, legkorábbi új dispatch
cadence-t, megfigyelési rés- és falióra-határidőket rögzít. Egy pusztán eltelt
nap vagy heartbeat nem sikeres agentmunka.

A prepared terv pontos genesis/result/profile digestet, seedet, natív finite
founder/avatar listát, lifecycle-időpontokat, kontrollbeállításokat, seedelt
attribute-inputokat és eloszlásdigestet, az összes root konfigurációt, az engine
aktív world-modjait és a Phase 12 paraméterprofilt köti. A kezdeti valódi
avatar/bank/skill és goal fingerprint az első dispatch előtt újraellenőrzött.
Ismétléshez ugyanazokat az expected digesteket kell megtartani és a baseline-t
visszaállítani; a start nem frissíti az elvárt értékeket az eltérés elfogadására.

A Phase 24.2 natív integritásnapló is kötött. Kontamináció, reset, forrás- vagy
policy-drift leállítja a programot; átmenetileg pending integritási művelet
visszatartja az új dispatch-et. A közös óra megállítása nem indít új munkát,
a véges falióra-határidőt viszont nem kerüli meg. Nincs óra-, agent- vagy múltbeli
bizonyíték-létrehozás hiányzó forrás helyett.

Az új dedikált `.local/admin/long-experiments.sqlite` schema 1 a teljes immutable
definíciót, hash-láncos eseményeket, külön tailt és világóránként egy aktív
program lockját őrzi. A claim a HTTP-dispatch előtt atomi; a hullám UUID-ja a
session/plan/index függvénye. Phase 12 exact explicit-ID replay nem dispatch-el
újra; párhuzamos natív kohorsz nem oszthat agentet. Bizonytalan HTTP-kimenet és
restart megtartja a claimet és a natív azonosítót, az ismeretlen pending
skill-dispatch újraindítása helyett határidő és explicit operátori vizsgálat van.

A clock markerek a teljes programdefiníció digestjét kötik. A sikertelen
journaltranzakció minden helyi head/claim/lock írást visszagörget; árva clockstamp
nem bizonyít munkát. A riport újraellenőrzi a natív clock- és lezárt Phase 12
backinget. Skill-journal csak exact avatar/run ID-val és helyes időbeli kötésben
fogadható el. A bemelegítési munka megmarad, de nem kerül a mérési bucketbe.

Bucket csak teljesen benne maradó, minden founderhez sikeres natív terminális
skillrekordot adó hullámmal fedett. A szimulációs idők claim/megfigyelési
envelope-ok; a terminális wall timestamp nem válik exact szimulációs dátummá.
A hiányzó ablakok nem tölthetők vissza catch-up dispatch-ekkel. A completed
státusz e végrehajtási protokoll teljesülése, nem önellátási minősítés.

Az attribute-domain generált profiljai itt deklarált, reprodukálható kísérleti
inputok; a Phase 12 nem igazolja az engine-oldali teljes körű alkalmazásukat.
A teljes engine RNG seedelése és teljes világállapot-replay sem állított.
A `provesSelfSufficiency` és `completeEconomyCoverage` false, a gazdasági
értékelés unassessed. A benchmark és kezelések összevetése külön későbbi scope.

Elérhető a `society:experiment` CLI prepare/start/step/report/stop művelettel,
opcionális véges `--run` ciklussal és az autentikált, csak olvasó
GET `/api/admin/society/long-experiments/:sessionId`. HTTP-ből nem választható
forrásútvonal. A Phase 12 új preflight/environment/exact-run kapui is
autentikáltak. A kliens csak helyi/private gatewayt és redirect nélküli kérést
fogad el. A stop nem öli meg a már indított skilleket.

Nincs régi futásból visszatöltött hosszúprogram-történet, nincs változó natív
forrássémaverzió. Rollbackhoz a programnapló, clock, Phase 12, AgentState,
genesis/integritás és releváns világállapot összetartozó mentése kell; a marker
vagy tail törlése nem javítás. Élő stack/bot, többnapos program vagy benchmark
nem indult, élő DB-migráció és `.canvas.tsx` nem készült.

Teljes protokoll, tervminta, parancsok, bizonyítékhatárok és migration/rollback:
[Phase 24.7 long experiments](features/phase24-7-long-experiments.md).

Ellenőrzés:

- A natív fixture egy teljes napot, 24 órás ablakot és 96 terminális skillt
  fedett; az érintett Phase 12/controller/admin suite **33 pass / 0 fail / 0 skip**,
  mindhárom TypeScript és format PASS
  (`.local/verification/20261015-185900-625-phase24-7-pre-full.log`).
- Csak olvasó CLI smoke: PASS, unavailable, journal-létrehozás nélkül
  (`.local/verification/20261015-185324-967-phase24-7-cli-smoke.log`).
- Teljes `bun run verify:full` / `bun run check`: **1772 pass / 0 fail / 0 skip**,
  exit 0, a végső avatar/időbeli terminális kapukkal együtt
  (`.local/verification/20261015-190034-990-full.log`, külső wrapper:
  `.local/verification/20261015-190034-194-phase24-7-full-final.log`).
  Az egynapos fixture 2,22 másodperc alatt futott. Egy előző, párhuzamosan indított
  célzott futás öt másodperces timeoutba futott; a fixture csak a tényleges natív
  konfigurációs függőségeit másolja, a 24 ablak/96 terminális rekord és minden
  állítás megmaradt, timeout nem emelkedett.
- Végleges soros controller/admin ellenőrzés: **30 pass / 0 fail / 0 skip**,
  root/engine/webclient TypeScript és format PASS
  (`.local/verification/20261015-190644-335-phase24-7-final-quality.log`).

A következő feladat a **24.8**: a felsorolt kontrollált kezelések összehasonlítása.
A 24.7 futásvezérlőt ad, élő többnapos benchmarkot nem állít teljesítettnek.

## 24.8 – összehasonlító eszköz kész, élő kezeléspárok nyitottak (2026-10-15)

Elkészült a `society-experiments/comparison.ts` natív összehasonlító és a csak
olvasó runtime, CLI és admin végpont. A TASKS hat kezelés-checkboxa változatlanul
`[ ]`: az eszköz nem helyettesíti a hiányzó élő futásokat és kezeléskötéseket.

A `diminishing-xp` tengely sikeres, lezárt Phase 24.7 programok teljes natív
napló- és receipt-backingjét ellenőrzi. Azonos genesis, founder, deklarált
attribute, policy, kezdeti avatar/cél és mérési protokoll szükséges. A Phase 12
első hullámpár-ellenőrzője csak a kikapcsolt → bekapcsolt XP modot engedi
eltérésként, az exact alkalmazott parameter profile és ismert bank mellett.
Minden későbbi hullám a saját változatlan környezetéhez kötött.

A relatív kiértékelési ablakok csak a teljes megfigyelési borítékukkal beléjük
férő hullámokat összegzik. Az additív metrikákhoz látható a mintaszám, native
digest, claim/settlement stamp és a terminális skill-azonosítók. A warmup és
határon átnyúló hullámok külön kizárási listában maradnak. Hiányzó, nem véges
vagy túlcsorduló metrika, ismételt terminális bizonyíték és megváltozott forrás
hibát ad; nincs szintetikus nullaértékű pótlás.

Azonos mintaszám mellett `descriptive-comparison` a státusz. Eltérő mintaszámú
ablak és az összesített különbség `null`, az eredmény `inconclusive`. A riport
nem állít oksági kezeléshatást: a repetition-state/egyéb rejtett engine-állapot
és engine RNG resetje nincs attesztálva, a snapshotok globális változásokat is
tartalmazhatnak, a hullámok közötti idő nem mért.

A másik öt tengely `unsupported`, konkrét hiányindokkal: alkalmazott
attribute/potential, facility és housing/needs kezeléskötés, finite blank-slate
és seeded kezdet, valamint hiteles mortalitás nélküli kontroll hiányzik. Ezek
nem válthatók ki profilcímke vagy policyfájl hashének átírásával.

Belépési pontok:

- `bun run society:experiment --command capabilities`
- `bun run society:experiment --command compare --control xp-control --treatment xp-treatment --axis diminishing-xp`
- Admin hitelesítés mögött:
  `GET /api/admin/society/long-experiment-comparison?control=xp-control&treatment=xp-treatment&axis=diminishing-xp`

HTTP-ről nem választható forrásútvonal vagy feltöltött bizonyíték. A natív
forrás hiánya `unavailable`, napló/óra létrehozása nélkül. Nincs sémaemelés,
új perzisztens modell vagy élő DB-migráció; rollbackhez elég a kód
visszaállítása. Élő stack, bot és benchmark nem indult; `.canvas.tsx` nincs.

Ellenőrzés:

- Célzott natív controller/admin suite: **35 pass / 0 fail / 0 skip**;
  root/engine/webclient TypeScript és format PASS
  (`.local/verification/20261015-221259-097-phase24-8-pre-full.log`).
- A kiegyensúlyozott fixture két napnyi tesztóra-protokollban 48 ablakot és
  192 terminális rekordot ellenőriz; egy további natív pár az eltérő
  mintaszámot és a `null` különbségeket igazolja. Ez nem élő engine-gazdaság.
- Csak olvasó CLI capability/compare smoke: PASS, hiányzó programokra
  `unavailable`
  (`.local/verification/20261015-221512-763-phase24-8-cli-smoke.log`).
- Az első teljes regresszió az egynapos fixture 5,8 másodperces futásával
  elérte annak változatlan 5 másodperces timeoutját; termékállítás nem hibázott
  (`.local/verification/20261015-221522-508-full.log`). A fixture natív
  lemezes Phase 12/programnaplója WAL módot használ, a szinkronizálási
  beállítások, 24 ablak, 96 terminális rekord és minden állítás megmaradt.
  Az ismételt célzott suite **35 pass / 0 fail / 0 skip**, format PASS;
  az egynapos teszt 3,23 másodperc
  (`.local/verification/20261015-222126-368-phase24-8-wal-target.log`).
- Végleges teljes `bun run verify:full` / `bun run check`:
  **1777 pass / 0 fail / 0 skip**, exit 0, mindhárom TypeScript és format PASS.
  Az egynapos teszt a teljes futásban 3,07 másodperc volt, változatlan timeouttal
  (`.local/verification/20261015-222203-995-full.log`, külső wrapper:
  `.local/verification/20261015-222203-162-phase24-8-full-wal-final.log`).

Részletes protokoll és bizonyítékhatárok:
[Phase 24.8 controlled comparisons](features/phase24-8-controlled-comparisons.md).
A 24.8 élő összehasonlításaihoz a fenti kezeléskötések és teljes kezdeti
állapot-visszaállítás igazolása, majd valódi lezárt futáspárok szükségesek.
A 24.9 többcélú társadalmi értékelése még nem indult.

## 24.8 – natív XP-baseline részfeladat kész (2026-10-15)

Az engine `DiminishingXpStore` új, csak olvasó snapshotja az aktuális natív
cohort-előzményt, konfigurációs és store digestet köti megfigyelési wall időhöz.
A közös `society-experiments/xp-state.ts` szerződés exact mezőket, cohortot és
countereket validál; a visszaadott objektum nem osztozik a belső állapottal.
Külső fájlmódosítás stale runtime hibát okoz, hiányzó fájl pedig létrehozás
nélkül olvasható üresként.

Elkészült az offline cohort reset/restore: exact command ID, compare-and-set,
native előkép, hash-láncos audit, atomikus fájlcsere és restart utáni ellenőrzés.
Az ismételt reset-kérés nem törli az időközben keletkezett XP-t. Restore csak
az eredeti natív resetből, azonos cohorttal és konfigurációval lehetséges;
megőrzi az eredeti timestampokat és rekordhiányt, a cohorton kívüli countereket.
A normál XP-képlet és decay szabály változatlan. Sikertelen mentés nem módosítja
a memóriában maradó állapotot, a stale writer nem írhatja felül az újabbat.

A gateway `/api/admin/society/xp-baseline` GET/POST végpontja admin hitelesítés
mögött van; az engine belső végpontja saját admin tokent igényel. Forrásútvonal
és feltöltött snapshot nem választható. Módosítás előtt minden cohort-tag
natív offline-save readiness kaput kap. Bootstrapping/observing társadalmi run
mellett a módosítás elutasított, így nem töröl előzményt egy aktív mérésből.
Az előkészítés az új genesis előtt történik.

A Phase 12 preflight az engine-től kéri és az aktív mod konfigurációjához,
valamint az exact avatarokhoz ellenőrzi a snapshotot. Az új nullable
`xp_initial_state_json` oszlop őrzi; a hosszú start definitionje is megköti.
Az első hullám `expectedXpCohortDigest` eltérése minden skill-dispatch előtt
hibát ad. A régi, oszlop nélküli Phase 12 forrás továbbra is csak olvasva,
azonos JSON-shape-pel és változatlan történeti run digesttel visszaolvasható.

Az összehasonlító `xpRepetitionState` mezője megkülönbözteti a natívan
megfigyelt, egyező üres snapshotokat, a régi bizonyítékhiányt és a nem egyező
üres kezdetet. `attestsExactDispatchState=false`: a snapshot és a tényleges
XP-végrehajtás közötti rés nincs lezárva. Az engine RNG, a többi rejtett
állapot és oksági kezeléshatás továbbra sincs attesztálva.

Az XP-fájl v1-kompatibilis olvasása megmarad; csak az első explicit
baseline-módosítás vált v2-re. A mod registry `1.1.0` / data schema 2 jelzést
kapott, a régi engine hot reloadja migrációs igényt jelez. A tervezett
kódfrissítéshez restart szükséges, v1-ből automatikus fájlátírás nélkül indul.
Teljes mentési, migrációs és rollback protokoll:
[Phase 24.8 XP baseline](features/phase24-8-xp-baseline.md).

Ellenőrzés:

- Érintett engine/WorldMods/Phase 12/admin/long-program integráció:
  **74 pass / 0 fail / 0 skip**, root/engine/webclient TypeScript és format PASS
  (`.local/verification/20261015-224124-477-phase24-8-xp-pre-full.log`).
- Végső natív snapshot/reset/restore és memóriaszigetelési suite:
  **15 pass / 0 fail / 0 skip**
  (`.local/verification/20261015-224456-297-phase24-8-xp-copy-final.log`).
- Az első teljes futás egy régi egynapos fixture-nél 5,095 másodperces
  teszt-timeouttal állt meg
  (`.local/verification/20261015-224522-023-full.log`). A natív lemezes teszt
  explicit 15 másodperces keretet kapott a többi hosszú fixture mintájára;
  24 ablak, 96 terminális rekord és valamennyi állítás megmaradt. Ez a Bun
  tesztvégrehajtási kerete, a termék wall/gap deadline-jai változatlanok.
- Végleges teljes `bun run verify:full` / `bun run check`:
  **1789 pass / 0 fail / 0 skip**, exit 0, root/engine/webclient TypeScript és
  format PASS. Az egynapos eset 1,17 másodperc alatt végigfutott
  (`.local/verification/20261015-225320-750-full.log`, külső wrapper:
  `.local/verification/20261015-225319-950-phase24-8-xp-full-budget-final.log`).

Élő XP-fájlt vagy adatbázist nem migráltunk; engine/bot és benchmark nem indult,
`.canvas.tsx` nincs. A TASKS élő kezeléspárjai nyitottak. Az XP-végrehajtás
kezdetének szorosabb natív kötése és a tényleges hosszú kontrollpár továbbra is
hátralévő munka; a 24.9 még nem indult.

## 24.8 – első natív XP-számítás kötése kész (2026-10-15)

Elkészült az `XpExecutionStore` és a `Player.addXp` által használt natív
XP-hookhoz kapcsolt runtime. A Phase 12 a tartós saját rekord létrehozása
után, a coordinator-dispatch előtt armolja az exact cohortot. Az engine
újraellenőrzi a snapshot és az aktív diminishing/XP-calibration policy
digestjét. Egy új indítás csak friss, még nem fogyasztott armot fogadhat el.

Minden player első arm utáni XP-számításánál közvetlenül a saját natív
előállapotát ellenőrzi. A másik cohort-tag szabályos korábbi XP-je nem
számít driftnek. A számítás előtt tartós pending marker készül; csak a
számítás és az utólagos snapshot ellenőrzése után jön observed esemény.
Baseline/policy drift előtt nincs számítás; a kísérleti hívás 0 XP-t ad.
Outcome-írási hiba vagy crash után pending marad, és egy későbbi hívás nem
helyettesítheti az elsőt. Az ismert hibás member nem kap sikeres bizonyítékot.

Egészséges journal mellett az unarmed és már megfigyelt player normál XP-útja
megmarad. Meglévő, sérült/olvashatatlan journal esetén a runtime nem talál ki
unarmed státuszt; bizonytalan ownership mellett 0 XP-s karantén lép életbe.
Nem létező journalból normál játék közben nem keletkezik új fájl.

A terminal skill-reconciliation és az azonnal terminális dispatch-ág sealeli
a natív ablakot, majd a Phase 12 rekordjába köti. Pending/rejected bizonyíték
sikeres skill-journalok mellett is failed kísérletet jelent. XP-t nem végző
member unobserved marad, a riport incomplete; nincs szintetikus esemény.
A natív cohort-ownership sealig megmarad, automatikus TTL nincs. Bizonytalan
hálózati válasz után az explicit admin seal a helyreállítási út.

A hosszú riport és összehasonlító a teljes Phase 12 receipt mellett újraolvassa
a natív XP-forrást is; a batch ellenőrzés csak olvas. A `xpCalculationState`
csak mindkét oldalon teljes, ellenőrzött és egyező üres előállapot esetén ad
`matching-empty-first-native-calculations` státuszt és
`attestsExactFirstCalculationState=true` értéket.

A bizonyíték a natív XP-számítás pontjára vonatkozik. A későbbi Player-stat
commit, XP-rate/cap, `allowMulti=false`, a skill-run közös engine-műveletazonosítója
és az RNG továbbra sincs attesztálva. `attestsExactDispatchState=false`,
`attestsPlayerStatCommit=false`, `causalEffectEstablished=false` megmarad.
Az élő kezeléspárok nem kaptak kész státuszt.

Új, explicit armkor létrejövő `.local/admin/xp-execution.sqlite`, séma 1,
WAL/FULL: immutable binding, hash-láncos események, független sequence/head,
seal marker és egyedi player-ownership. A Phase 12 két additív nullable
oszlopa `xp_execution_armed` és `xp_execution_json`; régi rekordok JSON-shape-je
és digestje változatlan. Az XP-counter fájl v1/v2 sémáját nem változtattuk.
Registry: mod `1.2.0`, data schema 2. Aktiválás tervezett engine/gateway-restarttal.

Admin hitelesítés mögött:

- Engine: `GET/POST /api/internal/admin/xp-execution`.
- Gateway: `GET /api/admin/society/xp-execution/<UUID>`.
- Gateway explicit helyreállító POST: ugyanazon útvonal, `action=seal`, indokkal.

HTTP-ről sem snapshot/outcome, sem forrásútvonal nem tölthető fel. Aktív ablakot
régi engine-nek benchmark-folytatásként nem adunk át; rollback előtt leállítás,
szabályos seal és összetartozó forrásmentés szükséges. Teljes protokoll:
[Phase 24.8 XP execution](features/phase24-8-xp-execution.md).

Ellenőrzés:

- Első teljes érintett integrációs kör: **88 pass / 0 fail / 0 skip**,
  root/engine/webclient TypeScript és format PASS
  (`.local/verification/20261015-231605-623-phase24-8-xp-execution-pre-full.log`).
- Végső célzott natív XP/controller/admin kör a friss arm és a production
  terminal-reconcile útvonallal: **69 pass / 0 fail / 0 skip**, mindhárom
  TypeScript és format PASS
  (`.local/verification/20261015-231910-175-phase24-8-xp-execution-final-quality.log`).
- Végleges teljes `bun run verify:full` / `bun run check`:
  **1804 pass / 0 fail / 0 skip**, exit 0, mindhárom TypeScript és format PASS
  (`.local/verification/20261015-232255-675-full.log`, külső wrapper:
  `.local/verification/20261015-232254-820-phase24-8-xp-execution-full-final.log`).
  Az XP-journalt is használó két egynapos összehasonlító fixture 13,50
  másodperc alatt sikeres volt; az egynapos alapfixture 2,86 másodperc.

Élő engine, bot, benchmark vagy adatbázis-migráció nem indult; `.canvas.tsx` nincs.

## 24.9 – többcélú társadalmi értékelés (2026-10-16)

A felhasználó döntése szerint a 24.8 élő paraméterkísérleteit a funkciók
elkészülte, a teljes társadalomszimuláció működési ellenőrzése és a feltárt
hibák javítása utánra ütemeztük. A TASKS új sorrendet és a 24.9 konkrét
megvalósítási bontását már a fejlesztés előtt megkapta. Nem indult újabb
XP-attesztációs előkészítés vagy élő hangolási futás.

Elkészült a tíz dimenzió explicit mérési szerződése és számítási API-ja:
túlélés; négy domainre külön bontott önfenntartás; receptenkénti termelési
szerep-HHI; holtversenyes átlagrangot kezelő vagyoni mobilitás; GP-Gini és
vagyonösszeg; fix kosár relatív ármozgása; dolgozni kívánó személyidőhöz
viszonyított munkanélküliség; üzembe helyezett új receptek és megvalósult
beruházás; igazolt sértetti eseményráta; legnagyobb egyedi strukturális kiesés.
BigInt törtek, külön egységek/irányok, tartalmi digestek. Nincs súlyozott
összpontszám, és az adathiány/nulla nevező nem ad kedvező nullaértéket.

Az új natív facade a meglévő önfenntartási és gazdasági függőségi olvasókat
használja, forrásdigestekkel és eseményhivatkozásokkal. A kiválasztott agentek
rögzített receptfelelősségét és a megfigyelt gazdasági ablak agent/Business
kieséseit számszerűsíti; az eltérő scope látható. A többi nyolc dimenzió
natív értéke még hiányos: az önfenntartási diagnosztikák megmaradnak, de a
teljes keresleti/eredet-, nyitó/záró vagyoni, ár-, személyidő-, commissioning-
és áldozati történet nem áll elő ezekből a forrásokból. Mind a tíz képlet
működik explicit megfigyeléseken; ez nem tíz teljes natív adatgyűjtő kész
státusza. A tiszta API nem ad natív attestációt a hívó által megadott adatoknak.

Elérés: adminhitelesített `GET /api/admin/society/evaluation/contract` és
`GET /api/admin/society/evaluation`, valamint `bun run society:evaluation`.
HTTP-ről sem forrásútvonal, sem mérési megfigyelés nem tölthető fel. Nincs
új tartós séma vagy gazdasági írás. SQLite olvasáskor üres WAL/SHM mellékfájl
keletkezhet; a natív teszt külön ellenőrzi a fő adatbázisok változatlanságát.
Eltávolítása adatbázis-visszaállítás nélkül lehetséges.

Szerződés, számítások, adatforráskorlátok és visszavonás:
[Phase 24.9](features/phase24-9-society-evaluation.md).

Ellenőrzés:

- Célzott képlet/natív/admin suite: **17 pass / 0 fail / 0 skip** és root
  TypeScript PASS (`.local/verification/20261016-144105-989-phase24-9-focused-fixed.log`).
- Érintett society-metrics/minimum/economic-dependency/admin integráció:
  **89 pass / 0 fail / 0 skip**, format, root/engine/webclient TypeScript és
  a szerződés-CLI PASS
  (`.local/verification/20261016-144428-034-phase24-9-affected-quality.log`).
- Az első teljes kör root suite-ja **1168 pass / 6 fail** lett: a hat régi
  Lite webclient/cache/collision teszt a nem elérhető `localhost:8888` miatt
  állt meg. A típus- és formátumellenőrzések sikeresek voltak; a további
  suite-okat a check parancs itt még nem futtatta
  (`.local/verification/20261016-144714-805-full.log`, wrapper:
  `.local/verification/20261016-144714-134-phase24-9-full-final.log`).
  Az ismétléshez a meglévő `.local/verification/phase23-7-static-cache.ts`
  segédet használtuk: a valódi helyi packed cache CRC-ellenőrzött archívumait
  szolgálja ki ideiglenes loopback porton, engine/bot nélkül. A tesztek
  állításai változatlanok, és a kiszolgáló a parancs végén leáll.
- A cache-kiszolgálóval a root **1190/1190** és az új értékelési suite is
  sikeres volt. A teljes check később két meglévő 24.8 XP-fixture
  **15000 ms** időkeretén állt meg (18,26 és 15,43 másodperc):
  `.local/verification/20261016-145202-060-full.log`, wrapper:
  `.local/verification/20261016-145201-205-phase24-9-full-local-cache.log`.
  Külön, változatlan suite-tal újraellenőrizve **38 pass / 1 fail / 0 skip**;
  a két esetből a teljes natív XP-nappárt építő teszt ismét időtúllépéses
  volt (19,33 másodperc, változatlan 15000 ms limit):
  `.local/verification/20261016-145848-924-phase24-9-regression-remainder.log`.
  A teljes `verify:full` így nem kapott zöld exitet. Tesztállítást,
  fixture-méretet, időlimitet és termékviselkedést nem változtattunk emiatt.
- A checkből az időtúllépés miatt kimaradt további 21 üzleti/gazdasági/
  bűnözési suite külön futtatva **355 pass / 0 fail / 0 skip**, exit 0:
  `.local/verification/20261016-150016-941-phase24-9-remaining-modules.log`.
  A teljes check 31 tesztparancsának legutóbbi eredményeit suite-onként,
  ismétlés nélkül összesítve **1819 pass / 1 fail / 0 skip**. A megmaradt
  hiba a fenti meglévő 24.8 időlimit; a 24.9 érintett suite-ja 89/89 PASS.
  Ez soros ellenőrzési lefedettség, nem egyetlen sikeres `verify:full` futás.

Élő engine/bot/benchmark nem indult; `.canvas.tsx` nincs. A 24.8 nyitott és
későbbre ütemezett. A következő fejlesztési pont a 24.10 eseményekig lefúrható
dashboard; a teljes társadalom működőképessége továbbra sincs élő futással igazolva.

## 24.10 – eseményekig lefúrható dashboard (2026-10-16)

Elkészült a meglévő adminfelület **Társadalom** füle. A 24.9 tíz dimenzióját
mutatja, összpontszám nélkül, az adathiány megtartásával. A natív eseménnyel
alátámasztott mutatóktól a releváns termelési/trade bizonylatlistáig, majd az
eredeti natív rekordig lehet lefúrni. A saját digest, natív sorszám, pontos
SimulationClock-kötés, gráfkapcsolatok és mutatókapcsolat kiolvasható.

Agent-, Business-, termék-, régióállapot- és időszűrés, legfeljebb 24
időoszlop és snapshothoz kötött lapozás készült. Egy kétirányú trade egy
bizonylat marad, minden eredeti lábával. A listaszűrők nem írják át a
riport alap-scope-ját vagy nevezőit. Nem igazolt szereplőreferenciából nincs
kitalált agent/Business-hozzárendelés. A történeti régiót a jelenlegi
források nem rögzítik; ez ismeretlenként látszik, mai helyből nem pótoljuk.

A natív források és a belőlük képzett értékelés/gráf közös belső gyűjtésből
származnak. Az első riport snapshot digestje kell a további oldalakhoz és
az eseményrészlethez. Módosult natív forrás: 409 és újratöltés, más scope/
szűrés eseménye: 404, hibás bemenet: 400. A források külön snapshotjai nem
kapnak hamis közös atomi vagy teljes gazdasági lefedettségi állítást.
Késői HTTP-válasz nem írja felül az újabb szűrést vagy részletválasztást.

Adminhitelesített, csak GET elérés:
`/api/admin/society/dashboard` és `/api/admin/society/dashboard/events/<id>`.
HTTP-ről forrásútvonal/riport/bizonylat nem tölthető fel. A natív szöveg és
JSON escaped; a böngészős próba XSS-szerű tárgynevet is ellenőriz.
Nincs új tartós séma, adatbázis, gazdasági írás vagy clock-léptetés.
A meglévő 24.9 és függőségi riport JSON/digest-szerződése megmarad.

Elérés, dimenziók, korlátok, aktiválás és visszavonás:
[Phase 24.10](features/phase24-10-society-dashboard.md).

Ellenőrzés:

- Első natív/admin és korábbi értékelési kör: **14 pass / 0 fail / 0 skip**,
  root TypeScript PASS
  (`.local/verification/20261016-151325-641-phase24-10-dashboard-focused.log`).
- Végső célzott natív/böngészős kör a clock-bizonylat és a késői válaszok
  kezelésével: **11 pass / 0 fail / 0 skip**
  (`.local/verification/20261016-152030-178-phase24-10-final-focused.log`).
- Érintett society-metrics/minimum/economic-dependency/admin/biztonsági és
  böngészős integráció: **110 pass / 0 fail / 0 skip**, format és
  root/engine/webclient TypeScript PASS
  (`.local/verification/20261016-152141-981-phase24-10-affected-quality.log`).
- Valódi Chrome komponensképek, helyi natív tesztadatokkal:
  `.local/verification/phase24-10-dashboard-desktop.png` (1440 px) és
  `.local/verification/phase24-10-dashboard-mobile.png` (390 px).
  Vizuálisan ellenőrizve; mobilon nincs dokumentumszintű vízszintes túlcsordulás.
- Teljes `bun run verify:full` / `bun run check`: **1830 pass / 0 fail / 0 skip**,
  exit 0, format és mindhárom TypeScript PASS, a meglévő csak olvasó helyi
  packed-cache kiszolgálóval. A korábbi XP-időlimiteket nem módosítottuk:
  `.local/verification/20261016-152546-049-full.log`, wrapper:
  `.local/verification/20261016-152545-238-phase24-10-full-local-cache.log`.

A teljes kör utáni forrásellenőrzésben a holtversenyes legnagyobb kiesés
számlálóját pontosítottuk: egy determinisztikusan választott forgatókönyv
tanúeseményeihez kötjük, nem több azonos maximum összevont eseményeihez.
A választott target látható, és a projekció protokollja is snapshot-kötött.
Két független termelési lánccal külön natív regressziós eset ellenőrzi, hogy
a 2/4 kiesési mutatóhoz pontosan két számlálóbeli bizonylat tartozzon.
Az utolsó pontosítás után megismételt teljes érintett natív/admin/biztonsági/
böngészős kör **111 pass / 0 fail / 0 skip**, format és mindhárom TypeScript
PASS: `.local/verification/20261016-153433-282-phase24-10-final-tied-withdrawal-quality.log`.
A nagy teljes regressziót nem futtattuk újra ezért a szűk dashboard-változásért;
azt a végső érintett kör és az új holtversenyes regressziós eset ellenőrizte.

Élő engine/gateway/bot és hosszú benchmark nem indult; `.canvas.tsx` nincs.
A gateway új route-jai a következő gateway-indításkor aktiválódnak.
A 24.8 továbbra is későbbre ütemezett, a következő fejlesztési pont a 24.11
benchmark/export/visszaállítás/reprodukció támogatása.

## 24.11 – benchmark és reprodukció támogatása (2026-10-16)

Elkészült az opcionális `society:benchmark` CLI és az offline archívum v1.
A 24.7 véges futtatót használja; nem indult hosszú társadalmi vagy 24.8
paraméterkísérlet. A teljes társadalom működése továbbra sincs empirikusan igazolva.

A baseline/eredménycsomag a tényleges dirty/untracked forrást, konfigurációt,
lockfile-okat, packed cache-t, mentéseket és az alapértelmezett társadalmi
állapottárakat rögzíti SHA-256 inventoryval. A commit csak referencia;
a tényleges forrásazonosság külön digest. Titkos/környezeti fájlok, `.git`,
függőségtelepítés és helyi botkönyvtárak külön kezelendők. Nem általános
gépmentés; az egyedi külső storage-útvonalakat nem igazolja teljesnek.

Offline állítás és Windows PID/listener/parancs-probe szükséges; a bemenet
teljes másolás előtti/utáni inventoryja változásnál elutasít. Baseline-hoz
pontos genesis/cohort/policy kötés, szünetelő clock, új session, szabad
hosszúfutás-lock és függő Phase12 hiánya kell. Az online avatar-preflight
továbbra is indítási feltétel. A natív pause/resume az offline időszakon át
megőrzi a baseline szimulációs idejét, hiányzó clockot nem hoz létre.

A restore kizárólag nem létező célba, ellenőrzött stagingen át történik.
Hash/méret/útvonal/case/link és nem listázott payload ellenőrzés előzi meg;
SQLite quick-check a visszaállított másolaton fut. Élő állapotot nem ír felül.
Az eredményrestore a helyreállított Phase12/clock/XP adatból újraszámolt
riporttal veti össze az exportot; nincs élő forrásra visszaesés vagy HTTP
bizonyítékfeltöltés. Sérült XP-journalra a natív próba elutasít.

A 24.9 diagnosztikai értékelés a megfigyelt értékelési ablakot használja;
a hiányzó food/tool/housing kötés és a többi mérési rés látható marad.
Nincs társadalmi sikerállítás vagy determinisztikus jövőbeli engine/LLM replay.
Baseline és eredmény manifestjét együtt kell megőrizni/összevetni.

Folyamat, parancsok, időbecslés, forrás-Git újralétrehozás, kizárások,
visszavonás és reprodukciós korlátok:
[24.11 protokoll](features/phase24-11-society-benchmark.md).
Nincs új runtime DB-séma vagy gazdasági írás; nincs `.canvas.tsx`.

Ellenőrzés:

- Végső célzott kör: **21 pass / 0 fail / 0 skip**, a controller fájl további
  39 esete név szerint szűrve; root TypeScript PASS:
  `.local/verification/20261016-155311-383-phase24-11-final-focused.log`.
  A teljes kör később a szigorított case-ütközési capture-próbát is lefuttatta.
- Korábbi érintett minőségi kör: **19 pass / 0 fail / 0 skip**, root/engine/
  webclient TypeScript, PowerShell syntax/helper és format PASS:
  `.local/verification/20261016-155054-698-phase24-11-focused-quality.log`.
- Egyszeri teljes `verify:full`: format és mindhárom TypeScript PASS;
  a `test:society-experiments` pontig **1496 pass / 1 fail / 0 skip**.
  Az egyetlen hiba a régi `native completed day pairs yield bounded, traceable
  descriptive XP comparisons and reject confounded evidence` 15 s időkorlátja
  (15.805 s). Az új 24.11 tesztek itt is PASS.
  `.local/verification/20261016-155708-779-full.log`, wrapper:
  `.local/verification/20261016-155708-034-phase24-11-full-local-cache.log`.
  Ugyanez a régi teszt az első érintett körben is timeoutolt (20.425 s;
  54 pass / 1 fail):
  `.local/verification/20261016-154805-920-phase24-11-native-roundtrip.log`.
  Az eredeti tesztet, assertionjeit és időkorlátját nem változtattuk meg.
- A teljes parancslánc emiatt kimaradt 21 további modulköre külön lefutott:
  **355 pass / 0 fail / 0 skip**, exit 0:
  `.local/verification/20261016-160356-825-phase24-11-remaining-regression.log`.
  A két kör együtt **1851 pass / 1 régi XP-timeout / 0 skip**, 1852 teszt;
  ez nem egyetlen sikeres teljes `check` exit, az eredeti FAIL megmarad.
- Végső source-case/manifest-határ pontosítás után root TypeScript és format
  PASS: `.local/verification/20261016-160511-328-phase24-11-final-code-quality.log`.

A TASKS.md 24.11 státusza `[x]` a támogatási funkciókra vonatkozik.
A 24.8 empirikus összehasonlítás és a fázis társadalmi elfogadási próbája
továbbra is nyitott. A következő fejlesztési pont a TASKS.md Phase 25 első,
engine-től független admin control plane feladata; ezt e körben nem kezdtük el.
