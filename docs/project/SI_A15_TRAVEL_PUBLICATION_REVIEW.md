# SI-A15 – Natív utazási képesség publikációs jóváhagyása

Állapot: **külön emberi jóváhagyással publikálva, 2026-10-22 11:27**. A korábbi food-jóváhagyás
után felderített önálló útvonalhiányhoz új, külön képesség készült.
Ez a csomag a helyi/private rs-sdk világra vonatkozik.

## Pontos jelölt és korlátok

- Jelölt: `procedure.travel.native-sites@1.0.0`; draft `0.1.0`.
- Három engedett cél: konyha (2815,3161), móló (2924,3179), housing (2972,3331), mind földszint.
- Egy bounded művelet, legfeljebb 360000 ms, nulla automatikus ismétlés.
- Legfeljebb egy 30 GP-s natív hajóút/run; explicit utazási grant, a meglévő 700 GP-s összesített napi operatív kereten belül.
- Az új `1.3.0` fixture csak az exact pint és a négy actor skill-knowledge-ét egészíti ki. Az induló vagyon, étel, képességszintek, hunger/fatigue szabály és földrajz változatlan.

A művelet friss, élő karakterállapotot és tényleges megérkezést kér.
Ismeretlen cél, párbeszéd, emelet, tiltott vámáru vagy hiányzó viteldíj/keret
megállítja. A hajóút előtt lefoglalt futási keretet bizonytalanság esetén
nem adja vissza új próbálkozásra. A beragadt natív/skill-intent megmarad.

## Ellenőrzött csomag

[Teljes immutable JSON](../../.local/verification/si-a15-travel-publication-review-1792660408043.json)

SHA-256: `4057eea102b8c1e35870542ce74e22eca4cee2e1b81b07e15864071615c8ebe8`.

Trial: `2501e090-1f45-4d7b-939b-42d3077aec03`; verifier: `802507a6-5012-4eaa-8fda-a8ae912643b9`.
Approval digest: `a39598180913cf38f38da543d4081dc58fedc7907a542b56c1fe691d623172f8`.
Proposed fixture digest: `2094c0b60bd99c4a416fb6e85d3f84d6bd7c1621cdc75a6ef1c6090050c1a92e`.

Két független, normál backend trial-run a friss, külön utility világban:

- `b31662cd-6268-4a66-957c-00763f097f60`
- `afd78151-8ef9-4e3d-8023-a8e3b7445453`

A csomag a korábbi három célhely 2–2 sikeres élő útvonalát, a két irányból
bejárt hajóutat és az új forrásból végrehajtott, javított nyugati
konyha→housing útvonalat is megőrzi. A sikertelen utak és a korábbi külön
kézi reposition megmaradtak; az új javított út ezt már saját maga végzi.
Minden csatolt run-journalt és a friss forrás fájljait hash alapján újraolvastuk.

Teljes regresszió: `20261022-105415-204-si-a15-final-travel-and-fixture-full`,
**PASS**, 809.889 s. Format, root/engine/webclient
TypeScript, fő csomag és minden külön modulcsomag benne van. A wrapper és
gyermek tesztszámok összege nem egyedi tesztszám.

A teljes kör után a fixture travel-profiljának napi limitjét a meglévő közös
napló szemantikájához igazítottuk: a bérlet, étel és utazás együtt számít,
így az előzetes 180 GP-s limit a már kifizetett 500 GP bérlet után tévesen
blokkolna. A meglévő 700 GP-s actor-napkeret és a 30 GP/run plafon marad;
nincs külön 700 GP utazási juttatás. A nap az ISO döntési idő UTC dátuma.
Valódi AgentStateStore-ledgerrel ellenőrzött 500 GP bérlet + 30 GP út:
`20261022-111313-832-si-a15-travel-rent-budget-final-boundary`, **8 PASS**,
root TypeScript és formázás PASS, 30,528 s. E korlátozott profilérték és
tesztje miatt a teljes csomagot nem ismételtük; a DB és jogosultsági alap változatlan.
A trialban nincs autonóm profil aktiválva; a packet külön rögzíti a friss
trial és a későbbi autonóm profil forrásdigestjét.

## A jóváhagyás határa és a folytatás

A backend [publish útja](../../server/gateway/admin/routes.ts) külön
`confirmHumanApproval` megerősítést és exact approval digestet követel:
„A publikáláshoz külön emberi jóváhagyás szükséges.” A korábbi engedély
a három food skillre szólt; ez az új utazási képesség külön kérés.

A felhasználó külön jóváhagyta a fenti változatlan csomagot. A normál backend
publish válasza **201**, a trial `published`; a kiadott skill törzse pontosan
megegyezik a jelölttel, és változatlanul bekerült a verziózott katalógusba.
Audit: `20261022-112744-478-si-a15-approved-travel-normal-publication`, PASS,
1,499 s. A session a meglévő OS-vault jelszóval normál login útján újult meg.

Az [új fixture](../../config/fixtures/society-lobster-four-accelerated-test-native-travel-v1.json)
és a [hozzá tartozó terv](../../config/fixtures/society-lobster-four-technical-plan-native-travel-v1.json)
a jóváhagyott packetből változatlanul készült. A normál preflight mind az öt
publikált skill exact digestjét ellenőrizte. A trial világ paused maradt,
a stack szabályosan leállt: `20261022-112906-377-si-a15-approved-travel-fixture-and-trial-stop`,
PASS, 1,900 s. Az SI-A15 autonóm mechanikai kapui következnek.

A későbbi diagnosztikai baseline a housing keleti megközelítésének fizikai
akadályát is feltárta. A művelet implementációja északi ajtós megközelítést
kapott; a publikált skill törzse, három célhelye és GP-korlátja változatlan.
Az itt megőrzött régi verifier/source-hashok a publikáció előtti állapotot
bizonyítják. Az új implementáció külön regressziója és élő bizonyítéka a
[progressben](SOCIETY_INTEGRATION_PROGRESS.md) követhető, nem írja át a packetet.
Az SDK-n megfigyelt hajódíj önmagában nem kanonikus pénzügyi sink-receipt.
Az autonóm teljes food-lánc és bérek, fizikai sleep/logout/return, negatív
esetek, valódi in-flight restart, végső result-restore és a hajódíjak
kanonikus elszámolása még SI-A15 mérnöki munka. A paraméterkalibráció SI-C09.

A világóra paused, a próbastack szabályosan leállítva. A későbbi normál
bejelentkezéshez a külön disposable világ folytatási fiókjának jelszava az OS
titoktárban marad; nincs meglévő account-reset vagy hitelesítési megkerülés.

Migráció: új fixture-verzió és új világ, DB-séma vagy meglévő világ átírása nélkül.
Rollback: rendezett stop, megőrzött korábbi baseline/result új könyvtáras restore-ja;
a függő intenteket és a publikációs auditot meg kell őrizni.
