# SI-C07/3 – Közös founder-baseline: konkrét jelölt és nyitott feltételek

2026-10-30. **A3. csomag elkezdve, nincs lezárva.** A2. implementációs csomag
[11/11 kész](SI_C07_NATIVE_AGGREGATE.md). A3–7. öt nagy csomag még megmaradt;
27/45, SI-C07 nyitott, preflight NO-GO, SI-M3/MVS nem PASS.

[Géppel olvasható jelölt](SI_C07_FOUNDER_BASELINE.json), előállító:
`scripts/prepare-society-founder-baseline.ts`. A CLI a tényleges akadályok miatt
exit2-vel tér vissza; ez nem futtatási vagy telepítési hiba elrejtése.
`definitionComplete:false`, `installationImplemented:false`, world/baseline
kijelölés null, provider-engedély0. A jelölt nem válik az1.3.0 fixture új,
visszamenőlegesen értelmezett tartalmává.

## A közös indulócsomag tartalma

- A korábbi négy founder változatlan ID-val, eredeti Fishing/Cooking XP-vel,
  pénzzel, ételtartalékkal és szerepekkel. A courier komponálható Mining,
  smelting és karbantartási tudást is kapna, Mining/Smithing1 szinten.
  Nem készül új merev szakmaosztály, ötödik alapító vagy lecserélt névsor.
- Egyetlen bronze-pickaxe és hammer induló allocation a minerhez. Az új
  workshop Business eredeti founder tulajdonában,0 nyitópénzzel és üres
  inputkészlettel; valódi `varrock.east-workshop` Property, `work-surface`
  capability és exact repair-eljáráshoz kötött worker employment szükséges.
  A genesis-javaslat a meglévő validátoron ténylegesen átmegy; nem alkalmaztuk.
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

A régi két slot változatlan. A friss saját baseline konfigurációjába négy
slotot kell majd azonos forrásokhoz kötni: három fizető tenant és egy szabad
owner-slot. Egy üres sarok vagy feltételezett public/visitor jog nem kapott
capacity creditet. A config alkalmazása és a négy founder normál natív alvási/
hozzáférési útja a közös stage ellenőrzésének még hiányzó része; az owner
hozzáférése önmagában nem rental sleep receipt.

## Miért nem kész még a3. csomag?

Három exact required1.0.0 eljárás a kanonikus reviewed/shared olvasó szerint
nem elérhető verified állapotban:

- `procedure.mining.gather-tin` – új, két műveletre korlátozott0.1.0 draft
  elkészült: walk-to és egy source-bound `gather-loc`; nincs modellezett tickvezérlés.
- `procedure.metallurgy.smelt-bronze` – meglévő0.1.0 draft.
- `procedure.tools.repair-bronze-pickaxe` – meglévő0.1.0 draft.

A tervező mindhárom draft pontos operational digestjét rögzíti, de nem írja át
őket verifiedre. Az összesítő komponens-fixture nem helyettesíti az eljárások
saját, source-bound natív hitelesítését és normál review/promotion folyamatát.
A hat meglévő reviewed eljárás pontos checksumja és definíciója külön szerepel.

Ezután szükséges a fresh, saját közös stage tényleges összeállítása a jelölt
genesisével, négy-slot site overlayjel, verified knowledge/worker-grantokkal,
natív tool-openinggal és teljes housing/sleep úttal. A mostani eszköz csak
readonly jelöltet készít, nem tartalmaz telepítési ágat. Ezek az eredeti3.
csomag feltételei; nem új lezárási pontok és nem a már kész2. csomag újranyitása.

Az [óneljárás acknowledged natív próbája és canonical verifier útja](SI_C07_MINING_PROCEDURE_VERIFICATION.md)
elkészült komponensszinten: két külön Mining1 packed effect, negatív/readonly
ellenőrzés. Kontrollált mozgás/loc fixture, nem publikált eljárás vagy live trial.
Következő konkrét munka a fenti három eljárás tartós source-bound natív hitelesítése,
majd a közös friss stage alkalmazó/ellenőrző útja. A4. ratio-próba és a hosszú
run nem indul megkerülve ezt; SI-C08 sem indul.

## Ellenőrzés

- `20261030-145148-875-si-c07-p3-baseline-thin`:7 PASS1,891s; founder/genesis,
  változatlan erőforrások, capacity számtan, draft-védelem, determinisztikus
  readonly előállítás és tényleges CLI NO-GO.
- `20261030-145720-536-si-c07-p3-packed-sites`:7 PASS2,194s, immár a valódi
  négyslotos packed anchor-javaslattal.
- `20261030-145845-318-si-c07-p3-preflight-and-sites`:13 PASS4,401s; ezek
  részben átfednek. Új CRC/truncation/traversal/missing-entry negatív próbák,
  a meglévő C07 preparer közvetlen fogyasztóval. Teljes regresszió nem futott.

Nincs engedélyezett providerhasználat, live install/start/import/enrollment,
skill promotion/publication, új applied baseline vagy történeti payload DB-read.

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
