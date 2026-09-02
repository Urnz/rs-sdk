# Player inventory escrow

## Cél és jelenlegi határ

A Phase 12 player-oldali escrow alapja az engine moduljai között található
`PlayerInventoryEscrowStore`. A tároló valódi inventory-walletből képes előre
lefoglalni GP-t és tárgyakat, majd meghiúsuláskor ugyanannak a játékosnak
visszaadni őket. Közvetlen admin- vagy HTTP-végpontja nincs.

Ez a szelet még nem fizet exact másik játékosnak, és nincs az ajánlat elfogadásához
bekötve. A szerződések ezért továbbra sem foglalják automatikusan a player által
vállalt vagyont. A következő engine-adapternek kell az exact payer/payee kötést,
a címzett jóváírását és a szerződés settlement-állapotát összekapcsolnia.

## Normalizált eszközök

Egy escrow egy UUID, egy exact normalizált játékosnév és egy változatlan eszközlista:

- külön `gp` mező, amely az inventory `995`-ös coin tárgyát jelenti;
- legfeljebb 28 külön itemtípus;
- az ismétlődő item ID-k összevonva, ID szerint rendezve kerülnek a journalba;
- a coin ID nem szerepelhet újra az itemlistában;
- üres, negatív, nem egész vagy stack-limitet túllépő vállalás elutasított.

Az előellenőrzés minden érintett inventory-egyenleget lekér, és hiányzó fedezetnél
még journalbejegyzés vagy inventory-módosítás előtt leáll.

## Hold és release lifecycle

Az új foglalás előbb `pending` rekordot ír, majd determinisztikus sorrendben veszi
ki az eszközöket. Pontos siker után `held` lesz. Azonos UUID, játékos és eszközlista
újrahívása nem vesz ki újabb tárgyakat; megváltoztatott tartalom ugyanazzal az
UUID-val fail-closed.

A `release` csak a pontos eredeti játékos `held` foglalását adhatja vissza. A
sikeres visszaadás `released`, és pontos replay esetén nem ír jóvá ismét.

Részleges remove vagy add után a tároló megpróbálja visszafordítani az adott
műveletsort, majd minden érintett item egyenlegét újraméri:

- teljes kompenzációnál a sikertelen hold `rejected`, a sikertelen release ismét
  `held`, tehát utóbbi újrapróbálható;
- sikertelen kompenzációnál `reconcile` állapot marad, amelyből automatikus újabb
  vagyonmozgás nem indulhat;
- folyamatmegszakítás után megmaradt `pending` vagy `releasing` rekord szintén
  kézi egyeztetést igényel.

A tároló korlátozott listázást ad, hogy a későbbi adminfelület a félbemaradt és
egyeztetendő rekordokat fel tudja tárni.
