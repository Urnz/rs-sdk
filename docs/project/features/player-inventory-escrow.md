# Player inventory escrow

## Cél és jelenlegi határ

A Phase 12 player-oldali escrow alapja az engine moduljai között található
`PlayerInventoryEscrowStore`. A tároló valódi inventory-walletből képes előre
lefoglalni GP-t és tárgyakat, majd meghiúsuláskor ugyanannak a játékosnak
visszaadni, vagy teljesítéskor egyetlen exact címzettnek átadni őket.

Közvetlen publikus vagy böngészőből hívható adminfelület nincs hozzá. A gateway
csak a közös `ENGINE_ADMIN_TOKEN` birtokában küldhet hold/release/commit parancsot
a belső engine-végpontra, az inventory-módosítás pedig a world tickben fut le.

Ez a szelet még nincs az ajánlat elfogadásához és a szerződés hiteles
teljesítéséhez bekötve. A szerződések ezért továbbra sem foglalják automatikusan
a player által vállalt vagyont. A következő orchestrátornak kell a foglalást az
elfogadáshoz, az exact payee commitot az igazolt teljesítéshez, a release-t pedig
a szabályosan meghiúsult szerződéshez kapcsolnia.

## Normalizált eszközök

Egy escrow egy UUID, egy exact normalizált játékosnév és egy változatlan eszközlista:

- külön `gp` mező, amely az inventory `995`-ös coin tárgyát jelenti;
- legfeljebb 28 külön itemtípus;
- az ismétlődő item ID-k összevonva, ID szerint rendezve kerülnek a journalba;
- a coin ID nem szerepelhet újra az itemlistában;
- üres, negatív, nem egész vagy stack-limitet túllépő vállalás elutasított.

Az előellenőrzés minden érintett inventory-egyenleget lekér, és hiányzó fedezetnél
még journalbejegyzés vagy inventory-módosítás előtt leáll.

## Hold, release és commit lifecycle

Az új foglalás előbb `pending` rekordot ír, majd determinisztikus sorrendben veszi
ki az eszközöket. Pontos siker után `held` lesz. Azonos UUID, játékos és eszközlista
újrahívása nem vesz ki újabb tárgyakat; megváltoztatott tartalom ugyanazzal az
UUID-val fail-closed.

A `release` csak a pontos eredeti játékos `held` foglalását adhatja vissza. A
sikeres visszaadás `released`, és pontos replay esetén nem ír jóvá ismét.

A `commit` csak `held` állapotból indulhat, az eredeti fizető azonosítójával és
egy tőle különböző exact payee névvel. A címzett neve a jóváírás megkezdése előtt
tartósan bekerül a journalba; siker után `committed`, azonos replay pedig nem ír
jóvá másodszor. Más címzettel ugyanaz az escrow ID elutasított. A jóváírás előtt
a címzett érintett inventory-egyenlegei és a stack-túlcsordulás is ellenőrzöttek.

Részleges remove vagy add után a tároló megpróbálja visszafordítani az adott
műveletsort, majd minden érintett item egyenlegét újraméri:

- teljes kompenzációnál a sikertelen hold `rejected`, a sikertelen release vagy
  payee-commit ismét `held`, tehát utóbbi kettő újrapróbálható;
- sikertelen kompenzációnál `reconcile` állapot marad, amelyből automatikus újabb
  vagyonmozgás nem indulhat;
- folyamatmegszakítás után megmaradt `pending`, `releasing` vagy virtuális
  `settling` rekord szintén kézi egyeztetést igényel.

## Engine boundary

A gateway `requestEnginePlayerEscrow` portja csak a művelethez szükséges mezőket
továbbítja. Az engine belső végpontja tiltja az ismeretlen mezőket és külön alakot
követel mindhárom művelethez. Hold és release alatt a payernek, commit alatt a
payee-nek kell online lennie; a sikeresen módosított karakter azonnali autosave-et
kap. A queue parancsai rövid lejáratúak, és shutdown vagy túlterhelés alatt nem
indítanak inventory-mozgást.

A tároló korlátozott listázást ad, hogy a későbbi adminfelület a félbemaradt és
egyeztetendő rekordokat fel tudja tárni.
