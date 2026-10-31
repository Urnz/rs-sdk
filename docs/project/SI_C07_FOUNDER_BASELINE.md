# SI-C07/3 – Közös founder-baseline: lezárt implementáció és mechanikai próba

2026-10-31. **A3. implementációs/integrációs csomag kész.** A2. implementációs csomag
[11/11 kész](SI_C07_NATIVE_AGGREGATE.md). Négy nagy csomag maradt,4–7;
27/45, SI-C07 nyitott, preflight NO-GO, SI-M3/MVS nem PASS.

[Géppel olvasható jelölt](SI_C07_FOUNDER_BASELINE.json), előállító:
`scripts/prepare-society-founder-baseline.ts`. A három exact eljárás publikálása
után a CLI exit0-val `definition-ready` specifikációt ad; ez nem futási engedély.
`definitionComplete:true`, `installationImplemented:true`, world/baseline
kijelölés null, provider-engedély0. A jelölt nem válik az1.3.0 fixture új,
visszamenőlegesen értelmezett tartalmává.

2026-10-31: [külön eljárás-trial](SI_C07_FOUNDER_TRIAL_STAGE.md) és
[három publikálási előnézet](SI_C07_FOUNDER_TRIAL_RESULT.json) már elkészült,
6 valódi útvonalas run +3 tartós review PASS. Ez külön declared trial opening;
nem ennek a közös founder-jelöltnek a telepítése. A három exact1.0.0 emberi
jóváhagyása és [normál publikálása](SI_C07_FOUNDER_PUBLICATION_RESULT.json) megtörtént.
A [közös genesis/housing/knowledge/workshop alkalmazója](SI_C07_COMMON_FOUNDER_STAGE.md)
és [valódi offline stage/readonly bizonyítéka](SI_C07_COMMON_FOUNDER_STAGE_RESULT.json)
is elkészült. Az1.4.0 külön jelölt diagnosztikai indulóállapot, végső C07
baseline-nak nem archiválható. Azóta a [négy founder valódi housing-próbája](SI_C07_FOUNDER_HOUSING_TRIAL.md)
és [független readonly eredménye](SI_C07_FOUNDER_HOUSING_RESULT.json) is PASS.

## A közös indulócsomag tartalma

- A korábbi négy founder változatlan ID-val, eredeti Fishing/Cooking XP-vel,
  pénzzel, ételtartalékkal és szerepekkel. A courier komponálható Mining,
  smelting és karbantartási tudást is kapna, Mining/Smithing1 szinten.
  Nem készül új merev szakmaosztály, ötödik alapító vagy lecserélt névsor.
- Egyetlen bronze-pickaxe és hammer induló allocation a minerhez. Az új
  workshop Business eredeti founder tulajdonában,0 nyitópénzzel és üres
  inputkészlettel; valódi `varrock.east-workshop` Property, `work-surface`
  capability és exact repair-eljáráshoz kötött worker employment szükséges.
  A genesis-javaslat a meglévő validátoron ténylegesen átmegy; az új1.4.0
  diagnosztikai stage saját forrásdigesztjéhez kötött normál genesis már applied.
- Réz és ón csak belső, prospektív Mining-outputból; a két tétel single-spend
  custodyja végig megmarad a smelt/bar/repair láncban. A bankból visszatöltött
  vagy bootstrap bronz nem lesz belső karbantartási input.
- Native harvest32, nyitó étel4, eredeti player/treasury GP változatlan.
  Az optimista no-burn keret36 adag, nominális8 nap32 adag +4 zárótartalék,
  headroom0. Ez nem mért fogyasztás és nem ígéret gazdasági PASS-ra; burn vagy
  rossz elosztás esetén a tényleges FAIL-t meg kell őrizni, nem készletet növelni.

A csákány100 kezdeti kapacitása és az50-es javítás összeegyeztetéséhez a jelölt
**51 tényleges warmup használatot** ír le. Az evaluation opening ekkor legfeljebb49;
49 további használat után az exact broken instance belső barból50-re javul,
egy új használat után49 marad. Így a retention az eredeti mérési ablakon belül
fenntartható lehet. A terv nem ír durability mezőt, nem kölcsönöz régi receiptet,
nem tolja el az1 nap warmup végét, és nem állítja, hogy a288:1 ratio mellett
mindehhez már elegendő a tartalomidő/travel. Ez a4. csomag natív validálása.

## Négy férőhely meglévő packed ágyakból

A korábbi konfiguráció két slotot sorolt fel, de a tényleges helyi packed
`l46_52` térkép további `brownbed` objektumokat is tartalmaz. A jelölt négy,
hídflag alapján is ground-floor anchorja:

- 2973,3328,0
- 2973,3330,0
- 2973,3332,0
- 2977,3332,0

`society-experiments/packed-housing-sites.ts` a tényleges server loc.dat/loc.idx
és maps-server.zip forrásokat nyitja meg, ellenőrzi az entry méretét/CRC-jét,
dekódolja a location és land/bridge flag adatokat, és hash-eli a forrásbájtokat.
Nem indul World, nincs új spawn, ZIP extraction, dependency vagy synthetic map.
Ez anchor-bizonyíték, **nem útvonal-, title-, sleep- vagy futási bizonyíték**.

A régi két slot konfigurációja változatlan. A külön új1.4.0 diagnosztikai stage
már négy slotot köt az azonos packed forráshoz. Három fizető tenant és egy
szabad owner-slot tervezett; bérletet vagy sleep receiptet nem bootstrapelünk.
A [négy founder tényleges SDK/Lite útja](SI_C07_FOUNDER_HOUSING_TRIAL.md) is kész:
három valódi paid rent és published travel, egy owner reservation, négy fizikai
stabil bed-arrival és natív sleep witness, mentett pozíció/PlayerTime readback.
Az [owner saját natív sleep/observer útja](SI_C07_OWNER_SLEEP.md) ugyanebben a
közös nyitású E-világban is működött. Ez nem95% időbeli exposure bizonyíték.

## A3. csomag lezárása és a következő határ

A három exact required1.0.0 utility eljárás már verified/shared és publikált.
A normál genesis, learned knowledge, worker/grant, szerszámkötés és négy-slot
overlay közös offline alkalmazása és readonly seal is kész.

Az eredeti megmaradó feltétel, a négy founder valódi route/rent/sleep útja
[elkészült](SI_C07_FOUNDER_HOUSING_RESULT.json): E-live241,609s, két független
readonly natív olvasás1,418s. Négy eredeti lifecycle, három500 GP rent,
egy ingyenes owner reservation, két30 GP komp; záró GP2740, eredeti négy étel
és durability100 megmaradt. Nincs önmagának fizetett ál-bérlet vagy kézi receipt.
Az A/B/C hibák és a szűk D diagnosztika megőrzöttek; a Lite current-tile stop
és az exact elérhető szomszédválasztás javítva. A rögzített3. csomag lezárt.

Következő a4. natív ratio-validálás:288:1 mellett travel/content tick/harvest/
food/needs és az51 valódi warmup tool-use időkerete. Az eljárás-trial deklarált
tool-damage nem M3-credit; a hosszú gazdaságban a tényleges belső inputú repair/
reuse és reserve-retention még bizonyítandó. A végső teljes-source baseline
kijelölése és külön hosszú-run jóváhagyása az5. kapuhoz tartozik. SI-C08 nem indul.

## Ellenőrzés

- `20261030-145148-875-si-c07-p3-baseline-thin`:7 PASS1,891s; founder/genesis,
  változatlan erőforrások, capacity számtan, draft-védelem, determinisztikus
  readonly előállítás és tényleges CLI NO-GO.
- `20261030-145720-536-si-c07-p3-packed-sites`:7 PASS2,194s, immár a valódi
  négyslotos packed anchor-javaslattal.
- `20261030-145845-318-si-c07-p3-preflight-and-sites`:13 PASS4,401s; ezek
  részben átfednek. Új CRC/truncation/traversal/missing-entry negatív próbák,
  a meglévő C07 preparer közvetlen fogyasztóval. Teljes regresszió nem futott.

A fenti korai ellenőrzéskor nem volt publication vagy live trial. Azóta a külön
F-trial és a három konkrét emberi jóváhagyás/publikálás elkészült. Providerhasználat,
végleges teljes forrású C07 baseline vagy történeti payload DB-read nincs.

- `20261030-150109-935-si-c07-final-types-and-consumers`:18 runtime PASS,
  wrapper a két külön collector-típushiba miatt FAIL; azok javítva.
- `20261030-150412-079-si-c07-types-final`:root TS PASS66,789s.
- `20261030-150939-136-si-c07-final-runtime`:7 native/history/ZIP eset PASS55,228s.
- `20261030-150958-155-si-c07-final-artifacts`:baseline és preflight azonos
  candidate digesttel, várt NO-GO/3 exact procedure blocker PASS1,538s.
- A katalógus közvetlen consumerének sandbox hardlink EPERM hibája megőrzött:
  `20261030-151105-850` és workspace-temp `20261030-151143-984`. Ugyanaz az1
  változatlan teszt natív Windows-jogosultsággal PASS1,025s:
  `20261030-151156-915-si-c07-catalog-native-permissions`. Nincs kód- vagy assertion-waiver.

- `20261030-151503-161-si-c07-artifacts-format-final`:203 aktuális source SHA,
  packed source SHA, változatlan eredeti policy,11/11 checklist,296 helyi link,
  egyező NO-GO artifact és changed-line formázás PASS2,997s. A dokumentációs
  eredménybejegyzés nem indokol új runtime/typecheck ismétlést.
