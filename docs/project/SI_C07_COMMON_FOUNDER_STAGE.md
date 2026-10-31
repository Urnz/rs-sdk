# SI-C07/3 – Közös founder-stage

2026-10-31. A három required utility eljárás publikálása után következő,
konkrét lépés: a közös indulóállapot tényleges alkalmazása. Ez a3. csomag
része; nem új P2-pont vagy SI-M3 eredmény.

## Alkalmazási és ellenőrzési terv

Hipotézis: a változatlan négy alapító, food/GP/harvest, clock és földrajzi
nyitóhelyzet mellé a kilenc exact verified tudáshivatkozás, egy csákány/hammer,
üres és0 GP-s workshop, normál worker/grant és négy packed ágy közösen,
egyetlen normál audited genesis útján alkalmazható.

Az1.3.0 forrásdefiníció változatlan. Az új1.4.0 származtatott definíció külön
fixture/world digesztet és eredeti forrás/specification/packed-bed kötést kap.
Az eredeti founder-javaslat genesis-digesztje terv; a tényleges stage genesis
az új fixture-digeszthez kötött, nem korábbi trial átvétele vagy átminősítése.

- CLI: `scripts/society-integration-fixture.ts create-founder-baseline`,
  `--fixture config/fixtures/society-lobster-four-accelerated-test-native-travel-v1.json`,
  `--output backups/si-c07-common-founder-20261031`, `--offline`.
- Csak új unpublished stage, offline forrás és normál integration adapter.
  A vékony próba a meglévő packed runtime-copy profilt használja, saját
  `packed-founder-stage-v1` source-jelöléssel és `finalBaselineEligible:false`
  értékkel. A végső baseline/result capture ezt kifejezetten elutasítja;
  A kizárás a fixture alapján is érvényes, a manifest címkéjének törlése nem
  kerüli meg. Új végső C07 világhoz külön teljes forrású run-definíció kell;
  ezt a diagnosztikai definíciót nem minősítjük át utólag.
  Sikertelen apply nem publikálható; rollback az új,
  még nem publikált stage eldobása. Meglévő világ reset/refill nem része.
- A natív subprocess maximum90s; inventory/copy/bootstrap/source-verify külön
  folyamatos provisioning fázisnaplóval. Nincs World.cycle, ratio-próba, hosszú
  gazdasági run vagy providerhívás;0 API-kérés/0 költség.
- A csákány az egyszer már applied genesis inventoryhoz kötött saját instance,
  durability100. Nincs új inventory, kézi damage vagy warmup-credit.
- Readonly seal/reopen ellenőrzi a native checkpointot, azonos genesis/population
  kötést, food bootstrap lineage-ot, pontos nyitókészletet és Fishing/Cooking/
  Mining/Smithing szinteket, worker/property/grant/knowledge/tool állapotot,
  négy config slotot, paused órát, provider/autonomy off állapotot.
- Negatív ellenőrzés csak másolatban: megváltozott knowledge/grant/tool/packed
  binding és meglévő világ adoptálása fail-closed. A valódi stage nem javítható
  vissza a seal átírásával.

## Pontos megmaradó housing-határ

Négy konfigurált slot nem négy igazolt alvás. A jelenlegi normál natív út
csak fizetett, külön tenant/landlord bérletből ad sleep witness-t.
A tulajdonos saját ingyenes slotjához még nincs megfelelő natív admission és
folyamatos observer-út. Nem készül önmagának fizetett ál-bérlet vagy kézzel
írt sleep receipt. Három valódi fizető tenant és egy valódi owner sleep,
mind4 útvonallal, még a3. csomag feltétele; addig a csomag nem zárható le.

Az új stage későbbi vékony housing-próbához kiindulóállapot. Az érintetlen
sealed opening megőrzendő; egy próbából megmaradó világ nem válik visszamenőleg
hosszú C07 baseline-ná. Warmup51+, ratio-validálás és SI-A14 későbbi kapuk.

## Eredmény

[Gépi nyugta és bizonyíték](SI_C07_COMMON_FOUNDER_STAGE_RESULT.json):
`backups/si-c07-common-founder-20261031/workspace`, fixture1.4.0,
world `srv-0c8d5093-61c9-469f-8751-07152f4ea6d4`.
Genesis `e22500724a65ba428557a2eb3e6ee178df8330cd9f79cb29af32c7292348ed43`,
seal `5ae0358e746a98beb14d5344444109088f617155a4448fc2f07a84b2b54884fe`,
tool `d26a50b9-140f-4b6a-8324-ccba5d840d59`.

Az eredeti tervezett genesis a régi1.3.0 fixture-t nevezte meg; a tényleges
genesis az új1.4.0-ra kötött, az eredeti tervvel azonos erőforrásokkal és kohorttal.
A treasury0 normál genesisnél nincs szükség0 összegű allocationre vagy új
treasury-sorra; a readonly ellenőrző a hiányzó sort vagy tényleges0/0 állapotot
fogadja el. Ez az új komponens ellenőrzési javítása, nem gazdasági engedmény.

- Natív packed apply `20261031-111547-446` PASS102,638s:1905 copy input,
  1909 lezárt source rekord, egyetlen normál applied genesis. Ticks és provider nélkül.
- Readonly `20261031-111855-033` PASS2,628s: azonos eredeti seal, minden source
  és native DB/WAL/save SHA változatlan; a normál `NativeToolWorkAccessSource`
  az exact published smelt/repair tudást és workshop-jogot ténylegesen elfogadja.
- Nyolc negatív próba kizárólag külön másolatban: hiányzó ón-tudás, workshop
  entitlement,99-es nyitó durability, másik inventory slot, átírt setup,
  módosult packed bájtok és a két final archive út a manifest címkéje nélkül.
  Mind elutasított, final archive output nem keletkezett. Shared-memory lockfájl
  nem tartós értékadat; a SQLite DB és WAL bájtokat együtt őrizzük/ellenőrizzük.

Megőrzött diagnosztikai hibák és irányváltás:

- `110615-963`: a tesztútvonalak elejéről elmaradt `./`, ezért Bun szűrőként
  régi mentések tesztjeit is kiválasztotta. Parancshiba, nem teljes regresszió;
  ezután kizárólag explicit `./...test.ts` fájlok futottak. A mentett runtime-config
  tesztek saját ideiglenes állapotot használnak; történeti adatbázis nem célpont.
- `110702-360`:20 pontos teszt PASS8,01s, de a sandboxos Bun típusellenőrzés
  `CouldntReadCurrentDirectory` launch hibát adott. Natív TS később PASS.
- `110921-520`:30 PASS, a fixture-teszt saját temp Git-initjét a sandbox
  blokkolta. Ugyanaz a19 fixture-eset natív jogosultsággal PASS.
- `111012-967`: az offline guard a még futó saját típusellenőrző miatt megállt;
  nem indult apply, a guard nem változott.
- `111102-419`: a teljes,14659 Git-fájlt számláló forrásleltár240,513s után
  szándékosan megszakítva, még a copy/bootstrap előtt. Nem publikált világ;
  a már azonosított treasury0 ellenőrzés javítása után a meglévő reduced packed
  út adta a megfelelő vékony próba határát. Ez külön IO-idő, nem regresszió.
- `111804-621`: az eredeti stage readonly vizsgálata sikerült, a negatív
  próbamásolatból viszont kimaradt a checkpoint WAL, ezért hiányzó food-lineage
  táblát látott. A másoló segéd javítva: DB és WAL együtt, az eredeti változatlan.

- `111945-256-si-c07-p3-common-founder-final-consumers`:27 pontos teszt PASS6,67s,
  root és engine TS is PASS; teljes wrapper152,164s. Az előző8 candidate és4
  runtime-config eset is PASS; az archívum végső változása miatt azok nem ismétlődtek.

Az installer/archívum közvetlen fogyasztói és a két érintett TS-projekt célzott
ellenőrzése elég: nincs változás a közös transaction/clock/economic
alapban vagy globális authorizationben, ezért teljes regresszió nem indokolt.
Minimum17/8 és a policy változatlan; SI-C07 továbbra NO-GO, SI-M3/MVS nem PASS.
