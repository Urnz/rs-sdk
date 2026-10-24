# SI-C03 – Natív bronzcsákány-javítás

2026-10-24. Ág: `codex/si-c03-native-tool-repair`;
baseline `a885bf644`.

Választott út: **repair**, a meglévő policy változatlan1 bronzrúd /600 s
szimulációs munka /Smithing1 /work-surface feltételével, +50 durability.
Hipotézis: actual Mining→break, belső copper+tin→packed bronze-smelt, protected
material escrow→natív munka→existing ItemRepairService→új actual Mining.
Nincs új általános WIP/durability/treasury-motor és nem állítunk replacementet.

Natív műhely: a meglévő Varrock east workshop facility work-surface capabilityje,
anvil3246,3404, level0. A tényleges loc2783 a `maps/m50_53.jm2` forrásban szerepel.
Smelt-furnace: loc2781,3226,3255 (`maps/m50_50.jm2`). Futáskor World.getLoc +
reachable és aktív Business-hozzáférés kell; az adapter nem spawnol berendezést.

Anyag/idő: meglévő PlayerInventoryEscrowStore, Business/job bindinggel védett
own-input. Az anyag native holdja és a javítási WIP ugyanazzal a canonical
Player checkpointtal commitol. Csak egymást követő, élő, jogosult, elérhető
engine-tickek közti SimulationClock-idő ad munkajóváírást. Restart/offline/
pause/source-drift nem ad utólagos időt. A munka alatt más protected job tiltott;
közbenső hiba esetén a WIP/input nem törölhető és nem refundolható újra.

A bronzrúd a meglévő recept szerinti120 szimulációs másodperc és legalább3
native tick után készül a valódi `[queue,smelting_ore]` scriptből. Az input a
munka alatt escrowban van; csak a tranzakción belül kerül vissza a scriptnek,
amely ténylegesen elfogyasztja a két ércet és hozzáad egy2349 bronzrudat.
A javításhoz a bronzrúd a WIP indításakor elfogy, a600 s aktív munka után a
meglévő ItemRepairService ad50 durabilityt ugyanannak az instance-nak.
Nincs pótlás, új provenance vagy új kapacitás a munkaidő előtt.

Az új service-WIP a meglévő escrow, lifecycle, repair és facility rendszert
kötő vékony adapter. A generic production-WIP item-output sémájába nem kerül
kitalált javítási tárgy: itt a tényleges kimenet service-capacity. Saját schema1,
append-only digest-lánc és audit-head, immutable intent/completion; actoronként
és toolonként egy aktív munka. Nincs közös DB-verzió/PRAGMA vagy transaction API
módosítás. Hiba esetén az inventory pontos object reference-je ÉS countja,
az XP és a checkpoint/capacity/event együtt gördül vissza.

Az aktív actor/lifecycle/clock és a natív Smithing1 külön ellenőrzött.
A workshop actual Property tulajdona a Businessé vagy annak tulajdonosáé;
az owner vagy a megfelelő aktív Business-role jogosít. A facility-loc és a
jogosultság minden munkaticknél újra ellenőrzött. Pending repair mellett a
tool nem adható át, az actor más protected munkát nem végezhet; Player-load
visszahozza az aktív munkafoglalást. Revocation/offline/stall/pause nem ad időt.

SDK: `tool-smelt-bronze` és `tool-repair`, exact args és executor-context.
A backend stabil, run/stephez kötött UUID-t képez, `wx` admittált intentet ment;
ugyanaz a run nem cserélhet actort/paramétert. Ez csak admission, nem completion.
A sikerhez a gateway és a verifier readonly újranyitja a canonical WIP-t és
az azonos commitban született native material/capacity eventet. Timeout vagy
küldési siker nem válik kész munkává, uncertain után nincs új-ID-s automatikus
retry. A publication előtti source recheck is megmarad.

Két új0.1.0 draft van, publikálás és automatikus megtanítás nélkül. Normál
használatkor külön megtanult verified1.0.0 kell. A legelső próbához a meglévő,
külön jóváhagyott draft-trial út ad szűk kivételt: a szerver újraolvassa a
pontos backend-intentet, a friss aktív CLI-marker draft-grantjét és a run-journal
admissiont; actor/run/step/parameters/checksum mind kötött. Eltűnt, lejárt vagy
módosult trial-forrás megállítja a munkát. A trial competence nem állít verified
learned procedure-t. Így a draft kipróbálható, és nem igényli saját későbbi
publikált verzióját. Az izolált teszt nem publikálási vagy live-trial bizonyíték.

Próba: disposable világ/clock/lifecycle; változatlan100/1 Mining és600 s repair.
Actual input/skill/facility hiány, korai finish, replay, két run ugyanarra a
toolra, restart, paused/offline credit, write-failure és native use-after-repair.
Native child60 s/wrapper90 s;0 providerköltség, nincs live enrollment/publication
vagy történeti backup. Első FAIL/deadline után szűk diagnosztika, nem új soak.
Ez mechanikai kapu; SI-C07 autonóm hosszú lánca és SI-M3/MVS nem e feladat eredménye.

Perzisztencia/migráció: saját additív repair WIP/event táblák a canonical DB-ben,
régi tool/binding/audit és közös user_version változatlan. Nincs régi broken
instance automatikus javítása. Rollback csak leállított runtime és összetartozó
checkpoint+instance+escrow teljes mentésével; folyamatban lévő WIP/audit megmarad.

Ellenőrzés: repair/lifecycle/escrow/facility komponensek, Mining és régi food/XP
közvetlen határok, typed skill/gateway request és verifier, root/engine TS,
changed-line format. Full nem taskzáró rutin: az új adapter default deny és
komponenssaját séma, a régi auth/transaction/migration alap nem változik.

## Eredmény és ellenőrzési index

**SI-C03 kész;24/45. Következő SI-C04, új kérésre.**
[Source-bound eredmény](SI_C03_NATIVE_RESULT.json):101 külön Mining-receipt;
100 use→broken0,98 bankolt rézérc, az utolsó réz+ón→egy actual bronzrúd;
repair600000 aktív szimulációs ms→50 durability, same-instance új Mining→49.
Az instance provenance változatlan, a lifecycle audit érvényes.

Az ellenőrzések teljes logja/resultja `.local/verification/<azonosító>.log`
és `.result.json`. A körök átfednek, számaik/időik nem összeadandók.

- `20261024-175145-022-si-c03-protected-loop-final`: **48 PASS /0 FAIL**,
  C03 native12 +food20 +XP13 és három wrapper; engine TS és format PASS,
  **48,641 s**. Végső működésbeli guard. A protected actor foglalását minden
  opcode előtt ellenőrzi, mert a script később is szerezhet második actort.
- `20261024-175403-585-si-c03-staged-native-format`:27 PASS /0, C03 native12 és
  Mining13 +két wrapper, staged format PASS,10,269 s. A közös fixture egy fölös
  EOF üres sorát eltávolítottuk; innen származik a végső source-bound natív adat.
- `20261024-174532-951-si-c03-draft-bootstrap`:33 PASS /0 FAIL,
  benne12 natív C03 eset, exact readonly authority/trial és SDK/verifier;
  root TS, engine TS, changed-line format PASS,88,831 s. Ezután csak az engine
  tool-foglalási guard pontosodott; a változatlan root kör nem ismétlődött.
- `20261024-173423-142-si-c03-mining-admin-types`:13 régi Mining és14 escrow
  plus natív C03 runtime PASS; root TS PASS. Az akkori összesített kör engine
  JSON-import/test-typing FAIL-lal állt meg; ezeket a végső gate javítva ellenőrzi.
- `20261024-173240-392-si-c03-consumer-types`: változatlan food20 és XP13 natív,
  framework, food-procedures, builder, authorization-envelope, repair-policy és
  facility fájlok PASS. Mining fixture cleanup `dirs` hivatkozás FAIL; külön
  javítva, a Mining kör fent ismételve PASS. Nem nevezzük az egész régi kört PASS-nak.
- `20261024-173847-340-si-c03-final-native-engine`:12 natív +wrapper PASS,
  engine TS és format PASS,35,860 s; a későbbi draft-trial bővítés előtt.
- Korábbi szűk diagnosztikák: első native2 PASS; kibővített próba actual
  rollback-count hibát talált. A fix őrzi az inventory tool object reference-jét
  és visszaállítja a mennyiséget; a kiesett tick utáni tesztet ugyanarra a
  failed tickre visszatérő retry javította, az időjóváírás szabályát nem lazította.

Teljes regresszió nem futott: a shared MarketStore transaction/save formátum,
clock alap és általános authorization gate változatlan. Az additive WIP és a
szűk native-tool draft kivétel saját reopen/rollback/proof és közvetlen fogyasztó
próbákat kapott. Nincs providerköltség, live indítás/enrollment/publication vagy
autonóm SI-C07/SI-M3/MVS minősítés. A teszt typed native loc-okat ad a vékony
portnak; a production út actual World.getLoc-ot ellenőriz, a két valódi mapforrás
hash és sor ellenőrzése az eredményhez kötött. A jogosultságok külön disposable,
valódi AgentState/Business/Property store-okon teszteltek.
