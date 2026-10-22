# SI-A15 – Food skillek publikációs jóváhagyása

Állapot: **emberi jóváhagyás után mindhárom publikálva, 2026-10-21**.
A normál backend mindhárom kérésre 201 választ és `published` státuszt
adott; napló: `20261021-195003-521-si-a15-human-approved-food-publication`.
A publikált definíciók változatlan másolata a reviewed source katalógusba
került; a production fixture preflight PASS. Az alábbi csomag az eredeti
jóváhagyási előnézetet őrzi. Mindhárom jelölt normál
engine/gateway/SDK futásokból, a tartós natív források újbóli ellenőrzésével
készült. Az új verziók csak a meglévő, külön emberi jóváhagyást kérő
publikációs úton válhatnak elérhetővé.

Világ: `srv-58f5d55a-ccd3-4e4f-8120-3db0e2c8a9a4`. A világóra paused. A teljes, definíciókat és
forrásdigesteket is tartalmazó [ellenőrzött csomag](../../.local/verification/si-a15-food-publication-review-1792604923983.json)
SHA-256: `64a1b9ba7b98d54ec808d0fd1feadf2a04d4f64d4feec4e674a25a615d250fac`.

## procedure.food.gather-lobster@1.0.0

Draft: `procedure.food.gather-lobster@0.1.0`; 8 független,
forrásból ellenőrzött sikeres run. Korlát: 1 művelet,
15000 ms. Egyszerre egy adag; nincs ár-/partner-/itembővítés.

Approval digest: `82694d1b37bf9e4e08590fc991a91e286e7ac01c3cc177b8c7892fa64ea78283`.
Trial: `e48a0d4f-62ca-4030-a3b5-539103dd93f9`; verifier report: `dafd04e3-d467-47d5-886c-d5987003f2c5`.

Bizonyítékok:

- `7c30489a-57d3-47f6-b4f9-9d7daab747d2`
- `cb80c6b5-aced-4aa7-971c-35e0c479b913`
- `2c640f88-0de7-404c-b2d0-b21b6fccdae3`
- `fdbf42f7-af13-4f52-b1ec-241023f0677b`
- `edccdbd7-5892-4900-9057-f0a5590c3180`
- `d6daa5e9-5eb8-4aee-bdd6-09e9b4c4691b`
- `61dfd10c-599c-4680-9172-28130d313f37`
- `43cb6f49-4603-4506-a15d-77c8542c31d8`

## procedure.food.cook-lobster@1.0.0

Draft: `procedure.food.cook-lobster@0.2.0`; 2 független,
forrásból ellenőrzött sikeres run. Korlát: 2 művelet,
90000 ms. Egyszerre egy adag; nincs ár-/partner-/itembővítés.

Approval digest: `4a69175dbc1967a1bfe5d7ab4c8cd75adfbb9cfc6b15cc71d057c26d9c55067e`.
Trial: `4a928730-f3e3-43de-ac41-edde8d00f0df`; verifier report: `458c86a5-6f3d-459c-a1d1-0bca373eb64e`.

Bizonyítékok:

- `8efaa044-3cd5-463b-a4f8-582d997c2d2f`
- `ec770002-73fa-4d7d-a4b7-c830d24cc5f0`

## procedure.food.consume-lobster@1.0.0

Draft: `procedure.food.consume-lobster@0.1.0`; 2 független,
forrásból ellenőrzött sikeres run. Korlát: 1 művelet,
15000 ms. Egyszerre egy adag; nincs ár-/partner-/itembővítés.

Approval digest: `250f5c49116309f3ddecd1fdef4d745a8b9073c12bcf57a9761e05378728be49`.
Trial: `47ef1d42-5318-4b94-b1f2-b50cae053209`; verifier report: `f805a4e3-645d-4476-87ae-00df81fc9d9c`.

Bizonyítékok:

- `26ffa738-f94d-4ec3-be1d-e00f67d41239`
- `84fe942e-9e75-4ecb-b8f2-a088a4cba66d`

A gyűjtés egy natív dobást végez; a sikertelen dobások megmaradnak. A
főzés csak a tényleges Brimhaven-range és exact, fizetett WIP mellett fut.
A fogyasztás az exact natív slotot ellenőrzi; a korábbi üres slot `no-use`.
Nincs utólagos ingyenes alapanyag, RNG-átállítás vagy kézzel gyártott receipt.

A publikációs kérés mindhárom fenti exact approval digestre és jelöltre
vonatkozik. A backend publikáláskor ismét ellenőrzi a natív bizonyítékot.
Az SI-A15 teljes autonóm futása és result-restore kapuja ettől még külön
hátralévő munka, és nincs teljes SI-M1 PASS állítás.
