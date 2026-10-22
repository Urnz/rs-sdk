# SI-A15 – Normál runtime próbák, 2026-10-21

Állapot: folyamatban. Ez a dokumentum valódi engine/gateway/SDK próbákat
rögzít; a teljes autonóm technikai demonstráció még nem kapott PASS eredményt.
A gazdasági kalibráció külön [SI-C09 feladat](SOCIETY_REALISM_CALIBRATION.md).

## Elkülönített próbavilág és tényleges helyszínek

A `create-food-trials` külön, eldobható világot készít. A három food skill
draftként indul; nincs integration baseline seal, autonomy enrollment vagy
automatikus verified státusz. A production factory továbbra is elutasítja
a nem publikált exact skillverziókat. A próbavilág nem fogadható örökbe
production baseline-ként.

Próbavilág: `backups/si-a15-food-trials-20261021-1520/workspace`.
Fixture digest: `58f5d55accd3be4f31203db0e2c8a9a4768cdd1b33113c5e8d14783477e4bdd5`.
Világ: `srv-58f5d55a-ccd3-4e4f-8120-3db0e2c8a9a4`.
A seed véges: négy kezdeti adag, 32 natív harvest, 3800 GP; nincs utólagos
genesis-jóváírás. A külön trial runtime normál engine, gateway és négy Lite
kliens; a tokenek/jelszavak nem bizonyítékfájlba kerülnek. A botjelszavakat
a szokásos operációsrendszer-titoktár kezeli.

A packed map ténylegesen nem tartalmazta a régi, `2926,3180` ponton várt
`loc_2729` tűzhelyet. Az új, opt-in 1.2 fixture natív profilja a brimhaveni
`loc_2728` tűzhelyet (`2814,3161,0`) és a két tényleges faladori `brownbed`
ágyat (`2973,3330,0`, `2973,3332,0`) köti digesthez. A régi fixture és az
operátori konfiguráció változatlan; az új helyszínek csak friss stagingben
alkalmazhatók. A bootstrap packed-map ellenőrzést végez, nincs loc-injekció.
A főzési draft új `0.2.0` verziója a tényleges range-hez sétál.

## Működés közben feltárt hibák és javítások

- A World import háttér-workerjei nyitva tartották a bootstrap CLI-t.
  A rendezett store-zárás után a CLI kilép; a szülőnek 90 másodperces
  határideje van. A korábbi sikertelen stagingek nem lettek baseline-ok.
- Az önálló runtime-nak szüksége van a tényleges `data/raw/wordenc` fájlra;
  a workspace factory ezt is másolja. A lokális runtime saját RSA-kulcsot
  használ, meglévő világ kulcsát nem veszi át.
- A párhuzamos clock/needs/health forrásolvasók rövid SQLite writer lockot
  hibaként kezeltek. A kapcsolatok az első sémaolvasás előtt 5 másodperc
  busy timeoutot kapnak. A clock aktuális megfigyelése a writer lock után
  kap időbélyeget; történeti regresszió továbbra is tiltott. Resume után a
  needs az új szegmens tényleges natív watermarkjaira vár.
- A fishing content csak a pontos `action_delay == map_clock` tickben dob.
  A már auditált előkészítést most az engine ugyanazzal az action ID-val
  ütemezi. Elveszett/resetelt előkészítés és sikertelen dobás tartós
  `food-no-output`, nem automatikus újabb dobás vagy bizonytalan siker.
- A commerce grant verifier író BusinessManagerStore-t nyitott a saját
  writer tranzakciója alatt. Az új `readBusinessFacilityGrant` csak olvas,
  ugyanúgy ellenőrzi a policyt, employmentet, szerepet és entitlementet.
  Valódi nyitott writer tranzakció alatti teszt védi a javítást.
- A livelihood korábban a consume draft `0.1.0` verzióját égette be és a
  már `running` állapotú kereskedő peert kihagyta. Most az actor tényleges
  exact skilltudását választja; a dispatch továbbra is megköveteli a normál
  publikációt/jogosultságot. A desired és running peer is választható.

Nincs új domain séma, adatátírás vagy inventory-helyreállítás. A busy
timeout/atomikus clock és readonly grant javítás új kapcsolatnyitáskor
érvényesül. Rollback előtt rendezett íróstop és egyező teljes világmentés
szükséges; a már keletkezett native intent/receipt/audit nem törölhető.
Az eldobható trial clone forrásfrissítései offline történtek és hash-naplózottak;
ez a világ emiatt sem nevezhető immutable integration baseline-nak.

## Már ténylegesen megfigyelt bizonyíték

- Bootstrap packed-site ellenőrzéssel: `20261021-151922-112-si-a15-actual-native-site-trial-world`.
- A zárási/content javítások utáni 45 perces normál runtime rendezett
  befejezése: `20261021-155425-544-si-a15-native-runtime-readonly-contention-fixed`.
  Ez működési megfigyelés, nem az autonóm demonstráció acceptance-e.
- Valódi Port Sarim → Karamja hajóút, kiszállás és pontosan 30 GP díj:
  `20261021-191650-440-si-a15-resumed-state-audit`.
- A futár valódi brimhaveni megérkezése:
  `20261021-191831-409-si-a15-courier-brimhaven-arrival`.
- Két független gather run: `7c30489a-57d3-47f6-b4f9-9d7daab747d2`,
  `cb80c6b5-aced-4aa7-971c-35e0c479b913`; külön natív action/receipt,
  újraolvasott kanonikus forrás. A korábbi zsákmány nélküli futások megmaradnak.
  Normál verifier PASS: `20261021-192209-726-si-a15-gather-normal-verifier`.
- Két fizetett natív felvásárlás, darabonként 20 GP, majd külön WIP-reservation:
  `20261021-192522-297-si-a15-paid-native-raw-procurement-fixed` és
  `20261021-192554-076-si-a15-paid-native-raw-procurement-two`.
- Főzés: az első run `76d0fc72-79f1-4378-9792-c55564b66443` szabályos
  `food-burnt`; a második `8efaa044-3cd5-463b-a4f8-582d997c2d2f` completed.
  Eladás 40 GP-ért: `20261021-192956-170-si-a15-paid-native-cooked-sale`.
- Első valódi fogyasztás: `26ffa738-f94d-4ec3-be1d-e00f67d41239`.
  A későbbi, már üres slotra küldött próba `food-no-use`; nem elfogadott
  második bizonyíték. A verifier ezért helyesen verification-failed.
- A gateway normál needs-loopja az első étkezést egyszer alkalmazta:
  hunger `9664 → 7264`, relief `2400`, azaz egy játéknap. A későbbi
  `no-use` reliefje nulla, a pending projekciók száma nulla. Forrásból
  újraolvasás: `20261021-194035-583-si-a15-live-needs-source-observation`.
- A további véges inputgyűjtés és fizetett felvásárlás után a második
  sikeres főzési run `ec770002-73fa-4d7d-a4b7-c830d24cc5f0`. A köztes
  `food-burnt` eredmények is megmaradtak; összesen hat darab
  alapanyag került megvásárlásra, kettő lett cooked, négy burnt.
  Második, 40 GP-s eladás és valódi fogyasztás:
  `84fe942e-9e75-4ecb-b8f2-a088a4cba66d`.
- A cook és consume normál verifier PASS, mindkét publication-approval
  előnézet elkészült: `20261021-194636-561-si-a15-cook-and-consume-publication-candidates`.
  A világóra utána paused. A gather ellenőrzésének frissítése külön
  művelet, mert a további valódi inputgyűjtések új runokat adtak a historyhoz.

Az SDK elküldött művelete önmagában nem bizonyíték: csak a tartós
run/intent és a hozzá illeszkedő natív source számít. Az útvonalak közt
valódi elakadás is megmaradt a `2805,3177` ajtónál; a következő próba másik,
ténylegesen bejárt úton került, nem admin teleporttal.

## Fennmaradó lezárási kapuk

A normál publication 2026-10-21 19:50-kor megtörtént a felhasználó exact
csomagra adott külön jóváhagyásával: [approval és verziók](SI_A15_FOOD_PUBLICATION_REVIEW.md).
A többi útvonal,
bér/alvás/logout/return, előre rögzített autonóm technikai futás negatív
esetekkel és in-flight restarttal, majd a tényleges eredmény offline
capture/restore/újraolvasása. A statikus `society-integration-technical-v2`
terv önmagában nem futási bizonyíték: három játéknap, gyorsított profillal
16 perces keret, változatlan natív menetidők és külön gazdasági kimenet.

A normál publication út konkrét verifier-reporthoz kötött approval digestet
és `confirmHumanApproval: true` értéket kér. A publikálható előnézetek
összeállítása még nem publikálás, a draft státusz átírása nem helyettesíti.
A három tényleges POST 201 választ adott; a production fixture változatlan
publikált definíciókat használ. Az első normál autonóm próba és a feltárt
technikai akadályok a [lezárási állapotban](SI_A15_TECHNICAL_CLOSURE.md) szerepelnek.
