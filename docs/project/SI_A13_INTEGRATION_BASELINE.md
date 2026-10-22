# SI-A13 – Négyavatáros fixture és offline baseline

## Induló állapot

Az alábbi nyitókészlet és 90 perces entitlement az eredeti 1.0.0 történeti
definíciója. Az aktuális **1.0.1** nulla nyers nyitókészletet és állandó
Property-backed facility-jogot használ; indok és kompatibilitás:
[SI-A14 fixture-revízió](SI_A14_NATIVE_RESTART_ACCEPTANCE.md).

A külön verziózott `config/fixtures/society-lobster-four-v1.json` a helyi
LostCity világ szűk homárláncát írja le. A korábbi hatavatáros Varrock forge
fixture és annak történeti acceptance-e változatlan. A kompozíció meglévő
identity, Skill[], Business, genesis/provenance, Property és needs modelleket
használ; nincs új profession-osztály vagy párhuzamos vagyon-authority.

- `sifisher`: Fishing 40, Cooking 1, egy lobster pot; gyűjtés és fogyasztás.
- `sicook`: Cooking 40, Fishing 1; konyhai feldolgozás és fogyasztás.
- `sicourier`: alap személyes skillek; szállítás és fogyasztás.
- `silessor`: alap személyes skillek; szállásadó, Business-tulajdonos és vevő.
- `si-kitchen-mind`: avatar nélküli intézményi identity, a `karamja-kitchen`
  Business irányításához. A két alkalmazás cook/delivery role, 25–25 GP bérrel.

Avataronként 700 GP és egy főtt homár, összesen 2800 GP és négy adag
bootstrap tartalék kerül a valódi natív inventoryba. A többi konténer üres.
A natív alapállapot Hitpoints 10; a Fishing/Cooking XP a tényleges engine
szintképletéből származik. A konyha 1000 GP treasuryt és két nyers homárt kap;
kezdeti készterméke nincs. A nyers beszerzési plafon 20 GP, a késztermék
fix ára 40 GP. A nyolcadagos minimális belső célhoz a véges treasury
beszerzési/bérfedezetét ellenőrizzük, de ebből nem következik élő siker.

A konyha címe `karamja.fishing-hut`, a két facility entitlement heat/storage,
legfeljebb a 90 perces ablak végéig. A szállás `falador.south-house`,
500 GP/periodus és **két egyidejű férőhely**; a fixture nem talál ki négy ágyat.
A valódi needs-policy és dynamics kezdőértékei, nulla remainderek és a pontos
lifecycle/world/clock/profile kötés a receiptbe kerülnek.

A normál óra 1:1, a baseline paused, kezdőideje
`2001-01-01T00:00:00.000Z`. A natív forrás egy run/world kulcson legfeljebb
32 gyűjtési outputot enged; nincs regeneráció vagy futás közbeni import.
A kimerült quota nem töltődik újra restartkor. Az engine world-config
`closed-society`, XP-szorzó 1 és debug false; a runtime környezetnek is ezt
kell megtartania. A society-integrity értékinjekció esetén invalidál.
Az induló étel auditált `bootstrap` eredetű, sosem belső termelési final use.

## Apply, replay és rollback

A `society-integration/bootstrap.ts` kizárólag új, digesthez kötött staging
workspace-et fogad el. Meglévő AgentState/óra/fixture journal nem adoptálható.
A `LocalLostCityWorldGenesisAdapter` és az eredeti `FixtureBootstrapStore`
alkalmazza és naplózza a nyitóértékeket. Az offline engine bridge valódi
`Player.save`, canonical checkpoint, food-opening lineage, Business/treasury,
Property és needs útvonalat használ; nem ír kézzel sikeres domain receiptet.
Az escrow a meglévő friss shared checkpoint authority markert kapja.

A kész receipt, a négy lifecycle, az összes natív SQLite tábla szemantikus
digestje és az elvárt nyitóvagyon sealje együtt ellenőrződik. Azonos replay
csak ezt olvassa vissza; nem ismétli a seedet, a genesis asseteket vagy a
granteket. Eltért pénz, inventory, `.sav`/checkpoint, clock, grant, receipt
vagy natív tábla esetén hibázik, és nem tölt fel semmit.

Sikertelen provisioningkor az atomi publish előtt a teljes új staging
könyvtár eldobható. Ez a rollback nem érint korábbi világot. Nincs új SQL
séma vagy meglévő világon futtatott migráció: a provisioning az eredeti
store-ok friss adatbázisait hozza létre. Egy használt világ visszagörgetése
nem egyoldalú inventory- vagy clock-visszamásolás.

## Capture és restore

A `society-integration/archive.ts` a meglévő offline archive útvonal-,
alias-, SQLite-integrity és atomi staging/publish primitívjeit használja.
A hosszú society benchmark időminimuma és archívumprotokollja változatlan;
a rövid fixture külön `society-integration-offline-v1` protokollt kap.

A Git HEAD mellett minden ténylegesen másolt tracked/untracked forrásfájl,
konfiguráció, helyi shared skill, packed cache és a generált world-config
saját SHA-256 digestet kap. A dirty source önmagában nem válik tiszta
commitbizonyítékká. Bun-verzió, platform, effective source digest, runtime-env,
fixture/genesis/profile/skill checksum és a tényleges natív baseline együtt
marad. A capture a bootstrap óta módosult forrást/cache-t elutasítja.

A snapshot előtt és után offline probe és forrásellenőrzés van. A DB-k,
meglévő WAL/SHM oldalfájlok, player save-ek és natív/domain journalok együtt
kerülnek a csomagba. A credentials, bot könyvtár, `.env`, privát kulcsok,
engine auth `db.sqlite`, node_modules és a Git könyvtár kizárt. A bootstrap
engine-importjához szükséges ideiglenes helyi RSA-kulcs törlődik; nem része
a baseline-nak. Az archívum nem login-credential provisioning.

A verify ellenőrzi a manifestet, fájlméreteket, hash-eket, hiányzó/többlet
payloadot és case-collision/alias határokat. A restore **új könyvtárban**
SQLite-integrityt és tényleges readonly natív seal/nyitóérték ellenőrzést is
végez, és csak ezután publikál. Nem resetel korábbi világot és nem indít
engine-t/gatewayt. Az identity megmarad; a helyreállított baseline indítása
előtt a managed workspace és a receiptben rögzített runtime-env kötendő be.

```powershell
bun run fixture:integration preflight
bun run fixture:integration create --output C:/Projects/OSRS/si-a13-new --offline
bun run fixture:integration capture --root C:/Projects/OSRS/si-a13-new/workspace --output C:/Projects/OSRS/si-a13-bundle --offline
bun run fixture:integration verify --bundle C:/Projects/OSRS/si-a13-bundle
bun run fixture:integration restore --bundle C:/Projects/OSRS/si-a13-bundle --output C:/Projects/OSRS/si-a13-restored
```

A `create`/`capture` íróstopot és az explicit `--offline` állítást követeli;
a Windows probe nem állít le folyamatokat. A fenti outputoknak új helyeknek
kell lenniük. A preflight readonly és skillhiánynál exit 2-t ad.

## Ellenőrzés és az élő futás kapui

A szerződéstesztek a fixture/reference/kapacitás, clock/skill mismatch,
offline hiba, részleges staging rollback és a valódi CLI publication gate
határát ellenőrzik. Az izolált natív suite valódi Player/cache/genesis,
cash/inventory/XP, Property, treasury, employment/grant, needs és escrow
adatbázisokat hoz létre, sealel, újranyit, capture-öl és új helyre állít vissza.
Külön drift, replay, credential, source-change és payload-tamper esetek vannak.
A mentésolvasó a tényleges 8-as natív formátumot is elfogadja; pending recovery
asset esetén hibázik, így nem ad hiányos vagyonképet.

A natív tesztben kizárólag a skill-publication elérhetősége szimulált,
validált definíciókon, megnevezett resolver porton. A termelési kód nem
publikál automatikusan draft procedure-t. Az archive teszt forrásjegyzéke
megnevezett technikai részhalmaz; a cache és az összes natív adatbázis valódi.
Az engine nem futtat élő hálózati vagy gameplay demonstrációt.

A tényleges repository readonly preflight **BLOCKED**: a három food procedure
még draft, a trade skill verified. Nem készült publikált operátori baseline,
nem indult enrollment, provider vagy SI-A15 futás, és a meglévő világ
natív forrásai nem változtak. A normál review/publication folyamat szükséges.

További SI-A15 kapuk: a meglévő átadó skill Lumbridge-re sétál, míg a
forrás/konyha Karamján, a szállás Faladorban van; valódi útvonal/utazás és
kapacitás-ütemezés bizonyítandó. A normál hunger-ráta és önellátási küszöb
mellett a két fogyasztás/avatar és 95%-os demand-arány sem állítható
pusztán a bootstrapból. Ezeket a preflight korlátként őrzi meg; nincs
teleport, automatikus publikálás, needs-gyorsítás vagy újabb ételtartalék,
amellyel sikernek látszana egy nem teljesített demonstráció.

Az ellenőrzés pontos naplói, időtartamai és eredményei a
[progress fájlban](SOCIETY_INTEGRATION_PROGRESS.md) szerepelnek.
A széles regresszióban talált SI-A12 capability-jegyzékhiány is javítva:
a meglévő dashboard képesség két további readonly GET művelete regisztrált,
a jogosultsági viselkedés változatlan.
