# SI-C07/4 – Natív időarány-kalibráció

2026-10-31. A4. csomag első mért határa: a meglévő, megőrzött natív adatok
különválasztják a wall-, simulation- és content-tick időt. Nem indul új világ,
provider vagy hosszú C07 run; a3. csomag lezárása megmarad.

Hipotézis: a288:1 óra valóban288 simulation-ms-t ad wall-ms-enként, de a
Mining és travel nem lesz ettől288-szor gyorsabb. A smelt kettős feltétele
120000 simulation-ms és legalább3 valódi tick; repair600000 simulation-ms.
Az eljárás futásideje és a natív műveleti idő külön mérés.

Források kizárólag: a sikeres housing E és procedure-trial F workspace, a
verziózott konkrét eredményeikhez/fixture/world/setup/source pinhez kötve.
Readonly SQLite, meglévő hash-láncos Mining-intent és tool-work olvasók,
kanonikus sleep witness és tényleges SkillRun. Nincs schema-init vagy backfill.
A releváns frozen producer/config bájtok az aktuális forrással is egyezzenek.
DB és minden nem üres WAL előtte/utána azonos; SHM és0 bájtos WAL metadata.
Legfeljebb100000 naplósor; sérült audit, drift, másik identity vagy regresszáló
idő elutasítás. CLI normál esetben10s diagnosztikai keret,0 USD.

A rapport nem minősíthet51 warmup-use-t két Mining-mintából. A projected
51×idő csak kockázatjelzés; nincs belőle matematikai lehetetlenség vagy PASS.
F repair-je deklarált trial-damage, nem gazdasági maintenance-credit. E travel
és F work külön világ: mérési skálák összevethetők, közös gazdasági történetté
nem vonhatók össze. Inventory/bank, XP/chance, útvonal és orkestráció is befolyásol.

Három még szükséges bizonyíték a4. lezárásához: tényleges51-use warmup az
eredeti indulóhelyről, food harvest/cook/meal ütem, valamint ezek needs/rest/
work-credit mellett összeálló időkerete. A kalibráció hiánya miatt a preflight
clock-ratio kapuja továbbra NO-GO; nem választunk automatikusan lassabb arányt.

Előállítás: `scripts/calibrate-society-ratio.ts`; gépi eredmény:
[SI_C07_RATIO_CALIBRATION_RESULT.json](SI_C07_RATIO_CALIBRATION_RESULT.json).
Az összehasonlítás forráskötött mérés, nem végleges ratio-engedély vagy M3-PASS.

## Mért eredmény és értelmezés

Két független readonly újranyitás ugyanazt az eredményt adta.4 sleep witness,
3 completed travel,2 fulfilled Mining-intent valódi outputtal/1–1 kopással és
4 completed, auditált natív tool-work. E/F source/config és a collector saját
forrásai is hash-kötöttek; DB és minden nem üres WAL változatlan maradt.

- Housing E első→utolsó sleep:197431 wall-ms,56860128 simulation-ms,351 tick.
  A tényleges arány pontosan288; az átlag562,481 wall-ms/content-tick.
  Ez a négy klienses terhelés mért üteme, nem garantált400ms-os engine-ütem.
- Mining F:12223/10271 wall-ms,30/25 tick, azonos288-as clock. Két külön
  actual natív ore-output és durability-decrement; nem kézzel léptetett óra.
- Smelt F:1203/1179 wall-ms,3–3 tick; a tényleges simulation-elapsed
  346464/339552ms, a capped credited work120000ms. A3 content-tick minimum
 288:1 mellett dominál a recept2 simulation-perces időigényén.
- Repair F:2390/2421 wall-ms,6–6 tick; elapsed688320/697248 simulation-ms,
  credited600000ms. A10 simulation-perces munkát nem600 wall-másodpercnek
  vagy a teljes eljárás útvonalas futásidejének értelmezzük.
- Tényleges published travel SkillRun: cook127299ms, fisher127320ms,
  courier179171ms. Az SDK-kapcsolódás/bed-approach külön, a mérésben nem olvad
  a natív munkaművelet idejébe. Ezek különösen nagy hányadai az ötperces napnak.

A két Mining-minta átlaga11247ms;51×átlag573597ms,9,56 wall perc. **Ez
előrevetítés, nem51 használat mérése és nem bizonyított288:1 lehetetlenség.**
XP/chance, készlet/bank, alku- és útvonal-orkestráció, food/rest még módosítja.
Az eredmény `incomplete`, a preflight `clockRatioCalibration` mezőjébe bekötött,
clock-ratio kapu blokkolt. Másik arányú jelölthöz `profile-mismatch`, módosult
producer/collector-forráshoz `stale`; hiányzó eredmény nem ad pozitív állítást.
Preflight közben egyetlen trial DB sem nyílik meg.

Következő konkrét mérés a teljes, normál SDK/executor útú51-use warmup az
eredeti courier-pozícióból, előre deklarált inventory/bank és needs/rest tervvel.
Mindegyik actual native output/clock/instance/wear kell. A300s ablakban mért
teljesítmény és a későbbi mintavétel külön eredmény legyen; nincs deadline-
eltolás, kézi damage, source-drift vagy a két F-minta warmup-creditként átvétele.
A food/meal és közös needs/rest/work-credit ütem a másik két fennmaradó mérés.
A4. csomag továbbra nyitott, négy nagy csomag maradt; nincs új lezárási pont.

## Ellenőrzés

Az érintett modul a readonly ratio collector/pure időszámítás és közvetlen
minimum-preflight fogyasztója. Csak ezek célzott tesztjei és root/script TS
szükségesek; clock, needs, persistence, engine és webclient kód nem változott.
Teljes regresszió nem indokolt. Új világindítás/providerkérés nincs.

Megőrzött toolinghibák: `20261031-135339-642`3 pure teszt PASS, collector FAIL:
F draft-trial markerje `food-trial-fixture.json`, nem a közös applied-baseline
marker. Javítás után `135356-379` readonly PASS1,797s. `135434-943`: a köztes
riport még nem tartalmazta az új collector-pineket; három fogyasztó FAIL, három
pure PASS, TS nem indult. A köztes fájl megmaradt `.local/verification/si-c07-ratio-first-readback.json`
alatt; a végleges séma explicit hiányzó-array őrt és friss collector-pint kapott.
Egyik hiba sem világfutás vagy clock/policy módosítás.

Végső `20261031-135503-484-si-c07-ratio-native-final` PASS21,164s: a két
független natív olvasás,6 közvetlen teszt és root/CLI TS. Eredmény-digest
`a28be2be8e32d7db19780c5b129337c9d8d60ed5db4810c133fa9aa733da29a1`.
A readonly-native mérés actual DB-adatokkal futott, a6 pure/consumer teszt
pedig nem függ a helyi backupok meglététől. Engine/webclient TS és full nem
ismétlődött, a változatlan részekre nem terjesztettük ki az ellenőrzést.
`135824-346`:artifact/link/policy/formázás PASS3,179s;246 aktuális source SHA,
eredeti minimum/policy és11/11 P2, egyező NO-GO, a régi common opening26
native fájlja változatlan. A preflight housing indoklása is frissült: a rövid
négyszereplős út már kész, a teljes1+7 access history továbbra külön feltétel.
