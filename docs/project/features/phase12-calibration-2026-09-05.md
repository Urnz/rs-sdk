# Phase 12 – élő kalibrációs elfogadási próba

2026-09-05-én a helyi LostCity engine-ben hat kontrollált kohorszfutás fejeződött
be, összesen tizenkét sikeres agent-skill végrehajtással. A kézi profil és a két
előre rögzített rácspont összevetése a fail-closed admin API-n és az adminpanel
új kalibrációs felületén is sikeres volt.

Ez a 12. fázis technikai elfogadási bizonyítéka. Nem hosszú távú gazdasági
validáció és nem egy optimális XP-policy kiválasztása.

## Kísérleti terv

- Seed: `phase12-live-20260905`.
- Elkülönített avatárok és agentek: `p12miner1`, `p12miner2`.
- Mindkét agent két, azonos prioritású immediate célból választhatott: a verified
  `mining.varrock-east.copper-to-general-store@1.0.0` és
  `mining.varrock-east.iron-to-general-store@1.0.0` skillekből. Az adott seed
  minden futásban mindkét agentnek a vasérces skillt választotta.
- Agentenként öt érctermelés és értékesítés; futásonként összesen tíz vasérc és
  két shop-tranzakció. Külső LLM-hívás nem történt.
- Kézi profil: `phase12.live.manual@1.0.0`, Mining XP-szorzó: `1`.
- Előre kijelölt rács: `phase12.live.grid-low@1.0.0` (`0.5`) és
  `phase12.live.grid-high@1.0.0` (`1.5`); más profilparaméter nem változott.
- Respawn: `loc:2090`, `loc:2091`, `loc:2092`, `loc:2093`, egyenként négy tick.
- Rézérc shop buy/sell: `3/2` GP; vasérc: `6/4` GP. A készletértékelésben
  rézérc `2`, vasérc `4` GP. Az értékelő adapter itt köztes termékeken is
  ellenőrizhető, de a próba nem tartalmaz összetett késztermékgyártást.
- Diminishing XP lépcsők: `2, 3, 4, 5`; szorzók: `0.9, 0.7, 0.4, 0.15`;
  recovery: `60` perc. Páron belül csak a mod kapcsolója tért el.

## Eredmények

Az alábbi XP-adatok a kohorsz teljes, hiteles futásvégi XP-deltái, nem óránkénti
ráták. A kijelzett XP egészértékű, ezért a profilszorzók nem minden esetben adnak
pontosan lineáris egész számot.

- **Kézi, 1×:** kontroll `8750 XP`, kezelés `5514 XP`; kezelés mínusz kontroll
  **−3236 XP**.
- **Rács, 0,5×:** kontroll `4374 XP`, kezelés `2754 XP`; hatás **−1620 XP**,
  a kézi hatáshoz képest **+1616 XP**.
- **Rács, 1,5×:** kontroll `13124 XP`, kezelés `8274 XP`; hatás **−4850 XP**,
  a kézi hatáshoz képest **−1614 XP**.

Mind a hat futás pénzváltozása **+40 GP**, bruttó bevétele **40 GP**, kiadása
**0 GP**. A net készletérték-delta nulla, mert az összes kitermelt vasércet
eladták. A skill-, célpont- és régiódiverzitás, a céllezárás és a bevétel
páronkénti eltérése nulla. Ebből nem következik, hogy a diminishing XP hosszabb
távon sem változtatja meg a viselkedést: itt egyetlen előre kötött skillciklus
futott agentenként, és nem történt stratégiai alkalmazkodás.

## Visszakövethetőség

- Kézi kontroll: `17492fef-93cd-4e1a-a374-808d74cf0b28`.
- Kézi kezelés: `c98d915e-ad1f-4089-8152-26abe4ed8ba7`.
- 0,5× kontroll: `f9729062-3d34-4ad5-bb71-72af9646898e`.
- 0,5× kezelés: `c6f135f7-fbc7-47ca-a861-d25dda3735fa`.
- 1,5× kontroll: `cc3a7bc3-cc79-4618-888b-659383764847`.
- 1,5× kezelés: `ca9339eb-a930-4393-98c6-c0a24f50b001`.

A [géppel olvasható jelentés](phase12-calibration-2026-09-05.json) tartalmazza
a profilokat és digestjeiket, az időpontokat, az avatar-baseline digestjeit,
a tizenkét skill-run azonosítóját és a teljes összehasonlító választ.
A nyers rekordok a helyi `.local/admin/multi-agent-experiments.sqlite`
adatbázisban és `.local/phase12-live/` exportokban maradnak; az admin audit külön
őrzi az indításokat, összehasonlításokat és visszaállításokat. Hitelesítő adat
és játékosmentés nem része a verziózott jelentésnek.

A korábbi `1e9cc556-08d1-4841-851e-75c138b90197` előkészítési próba sikertelen:
a tized-XP egység miatt túl alacsony Mining-szinttel indult. A hiba után az
elkülönített avatárok javított mentéseiből indult a hat elfogadott futás.
A sikertelen rekord megmaradt, az összehasonlítás nem használja.

## Kontroll és korlátok

Minden elfogadott futás ugyanabból az avatar-mentésből indult. A bankot valódi
SDK-banknyitás tette ismertté; agentenként rögzített, engedélyezett teleporthely
adta az induló pozíciót. Mindkét agent baseline-digestje mind a hat futásban
azonos; a goal-snapshotok is megegyeznek. A futások között az engine újraindult,
és a kísérleti avatárok diminishing XP története leállított engine mellett az
üres baseline-ra állt vissza, a többi játékos adatait megtartva.

Az AgentState teljes történetét nem töröltük: a megfigyelési és memóriaelőzmények
megmaradtak. A mért, determinisztikus exact-skill választás nem használta ezeket;
a goal-baseline egyezését az összehasonlító kapu ellenőrizte. Ez nem általános
LLM-memóriával kontrollált kísérleti protokoll.

Egy seed, egy kohorsz és profilonként egy pár nem ad bizonytalanságbecslést.
A seed a goalválasztást vezérli, az engine véletlenfolyamát nem. A próba
bizonyítja a profilalkalmazás, a valós skillvégrehajtás, a mérés és az
összehasonlítás együttműködését; társadalmi optimumot nem bizonyít.

## Ellenőrzés és visszaállítás

`bun run check`: **609 pass, 0 fail**, mindkét TypeScript-ellenőrzés és a
formázásellenőrzés sikeres. A távoli collision-oracle teszt külső végpontja
nem volt elérhető, ezért annak élő összevetését a teszt kihagyta.
Node + Puppeteer alatt a tényleges adminoldal betöltése, a rácspont hozzáadása
és eltávolítása, majd mind a hat futás kiválasztása és az API-összevetés
végrehajtása is sikeres; page error nem jelentkezett.

A kísérlet nem módosít adatbázissémát. Az eredeti planner-konfiguráció és annak
projektalapértelmezett forrása, valamint az eredeti exact aktív world-mod
konfiguráció visszaállítása a gépi jelentés `restoration` mezőjében ellenőrizhető.
A kísérleti avatárok offline maradnak, a naplók és eredmények megőrződnek.
