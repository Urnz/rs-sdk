# SI-C07/3 – Tulajdonos saját férőhelye és natív alvása

2026-10-31. Az owner free-slot út implementált és célzott natív próbával
ellenőrzött. Nem self-rent: nincs ár, GP-transzfer, tenancy vagy prepaid payment.
A3. csomaghoz azóta a [négy eredeti founder tényleges packed route/rent/sleep próbája](SI_C07_FOUNDER_HOUSING_TRIAL.md)
és [readonly natív eredménye](SI_C07_FOUNDER_HOUSING_RESULT.json) is elkészült. SI-C07 továbbra
nyitott,27/45, NO-GO; SI-M3/MVS nem PASS.

## Konkrét működés

- A trusted gateway az aktív PopulationMemberből számítja az owner életciklusát,
  a natív Property címből/verzióból és a szerver katalógusából a jogot és férőhelyet.
  Egy álló jogosultsági periódus a meglévő housing-unit egy napos időtartama;
  ismételt kérés az eredeti kötést adja vissza, nem hosszabbítja meg azt.
- Az owner külön, auditált foglalást kap a housing DB-ben. A normál paid
  reservation és a közvetlen legacy tenancy-create is ugyanazt a foglalást
  ellenőrzi. Két külön slot-ID sem jelenthet két férőhelyet azonos fizikai
  koordinátán/szinten. Foglalt ágy vagy actor nem osztható ki másodszor.
- A meglévő tokenes, typed belső engine-csatorna csak `owner-sleep`/
  `owner-wake` és `operationId` mezőket fogad. Posted jog, pozíció, ár,
  életciklus vagy sleep receipt nem belépési bizonyíték.
- A natív Player csak élő, megfelelő életciklussal, szabad állapotban és
  a saját ágy szomszédos járható mezőjén alhat. Ugyanaz a PlayerTime
  bed-entitlement, fáradtsági szabály és fizikai végrehajtási tiltás érvényes,
  mint a bérlőnél. Az engine checkpointjába tényleges, hash-láncos witness kerül,
  owner-kötéssel; a gateway ACK önmagában nem teljesítési bizonyíték.
- A folyamatos validátor újraolvassa a jogot, címet/verziót, katalógust,
  életciklust, órát, időhatárt és pozíciót. Érvénytelen jog ébreszt; az online
  cohort-observer érvénytelen vagy offline szereplőből nem gyárt pozitív lefedettséget.
  Explicit offline sleep fáradtsági története továbbra tartósan újraolvasható.
- A self-care gateway az ownernek saját rest/wake műveletet választ és
  a witness/PlayerTime forrásból egyeztet. Nincs másik actor vagy LLM-kérés.
  A readonly sleep-riport, Mining-demand coverage és housing-boundary/minimum
  olvasó is érti az owner-kötést. Az owner lefoglalt ágya fogyasztja a kapacitást;
  a jogot csak a hitelesített grant adja, nem egy másik képzelt szabad hely.

## Tartós adat, migráció és rollback

Komponens-saját, első sikeres owner-admission tranzakciójában létrejövő v1
`housing_owner_schema`, `housing_owner_reservation`, `housing_owner_head`.
Nem változik a housing DB közös `user_version` értéke, a meglévő tenancy/
paid journal, shared transaction/clock/needs formula vagy gazdasági ledger.
Az owner rekordok append-only-k, saját hash-lánccal. A schema teljes hiánya
régi világban readonly üres; részleges/idegen verzió vagy hibás head elutasított.
A megszakított első admission DDL-je és rekordja együtt rollbackel.

A natív sleep JSON meglévő auditált sorába opcionális `ownerBinding` kerül;
a régi paid witness változatlanul olvasható. Ez nem visszamenőleges backfill.
Rollbackhez az owner-admission előtti offline állapotot kell új könyvtárba
restore-olni. Owner-foglalást tartalmazó világot régi binárissal folytatni nem
szabad: az nem ismeri a lefoglalt férőhelyet. Naplót/történeti bizonyítékot
nem törlünk és aktív foglalást nem írunk át üresre. A jelenlegi komponens-próbák
saját ideiglenes világok, a meglévő sealed founder-stage érintetlen marad.

## Ellenőrzési határ

Valódi engine Player/save, normál natív executor, tartós SQLite források,
PlayerTime/Needs és gateway modulok kontrollált komponens-próbája. Ez nem
négy founder SDK/Lite útvonala a packed világon, nem warmup vagy M3 run.
Nincs provider, autonómia-bekapcsolás, értékimport vagy hosszú gazdasági próba.

A közvetlen fogyasztók: native housing executor/runtime és typed HTTP csatorna,
owner/paid/legacy tenancy admission, self-care source/reconciliation, readonly
sleep-riport, Mining cohort coverage, housing-boundary és minimum projection.
Csak ezek konkrét tesztfájljai/esetei és a root/engine TS projektek ellenőrizendők;
teljes regressziót nem indokol az owner komponens saját additív naplója.

- `20261031-120654-682-si-c07-owner-sleep-final-native`:50 célzott eset PASS
  (31 engine eset és19 közvetlen gateway/napló eset),25,46s tesztidő.
  Root és engine TS is PASS; teljes wrapper196,550s.
- `120500-128-si-c07-owner-sleep-reader-and-tenancy`:17 PASS15,104s.
  A nagy native-reader fájlból csak a két pontos housing-eset futott,
  171 másik szűrt. Owner+paid és a változatlan paid ág is readonly újranyitható;
  hiány, rossz fizetési forrás és idegen admission továbbra nem ad PASS-t.
- A végső riport world-binding feltétele után kizárólag az érintett owner-eset
  ismétlődött: `121201-448` PASS2,709s. Idegen world sleep nem kerül a pozitív riportba.
- Korai `115735-868` FAIL25,338s: a közvetlen engine-tesztet hibás cwd-vel,
  a normál ideiglenes login-key host nélkül indítottuk. A normál
  `runNativeFoodIntegration` út helyreállította a környezetet; `115838-840`
  32 PASS13,389s, később a kibővített owner/fatigue próbák is PASS.
  A hibás indulás saját4096 bájtos root `db.sqlite` fájlja a
  `.local/verification/20261031-115735-native-direct-startup.sqlite` útvonalon
  megőrzött; nem account-import vagy történeti világ.
- `120302-209` root TS FAIL69,402s: az új opcionális owner-field az eredeti
  HousingAccessPoint és a collector inferred return típusa között eltért.
  Javítva: owner nélküli régi snapshot alakja változatlan, az új field opcionális.
  A végső root/engine TS PASS; nincs típusassertionnel elrejtett hiba.

- `121451-366` artifact/preflight ellenőrzés PASS8,127s, további3 konkrét
  preflight eset PASS. Aktuális source SHA-k, változatlan minimum/policy és P2
  checklist, helyi linkek/formázás, valamint az előző sealed founder-opening
  DB/WAL/save SHA és pontos derivált fixture-kötés is egyezik.

Összesen70 különböző célzott eset eredménye PASS; az ismételt részpróbák nem új
funkcionális esetek. A fizetési/GP és eredeti minimumképlet változatlan.

## A következő próba eredménye

Új saját E-stage az eredeti négy alapítóval, változatlan openinggel:
három normál paid rent, egy owner reservation, mind4 valódi SDK/Lite route,
stabil bed-arrival és natív sleep witness PASS. Clean stop/paused, független
kétszeri readonly ellenőrzés;241,609s live wrapper és1,418s reader. A korábbi
sealed opening érintetlen. A3. csomag lezárt; következő a4. ratio-validálás.
SI-A14/végső forráskijelölés és a külön jóváhagyandó hosszú run későbbi kapuk.
