# SI-C07 – Tartós founder-eljárás próbák és review

2026-10-31. A3. közös baseline csomag része; a hét csomag és a P2-11/11
lezárás változatlan. A három exact1.0.0 verzió még nem publikált.

**A tényleges útvonalas folytatás is kész:** [külön F trial-stage](SI_C07_FOUNDER_TRIAL_STAGE.md),
6 normál SDK/Lite/SkillExecutor run és3 normál tartós review PASS4perc7s alatt.
[Publikálási előnézet](SI_C07_FOUNDER_TRIAL_RESULT.json): exact definition/run/report/
approval digest, native effect és readonly újranyitás. Publication még nincs;
nem közös founder-baseline vagy SI-M3 minimum-bizonyíték. Az alábbi eredeti
komponens-próba terve és diagnosztikája történeti bizonyíték marad.

## Natív ellenőrzési terv

Hipotézis: a teljes kétlépéses smelt/repair draft a normál SkillExecutor és
RsSdkSkillRuntime útján, valós aktív population, Business és natív Property
adatbázisból engedélyezhető. Két külön run mindkét eljáráshoz tényleges
packed smeltet, input-escrow fogyasztást és repair kapacitáshatást ad; ezeket
a tartós run/admission/report és újranyitható approval digest összeköti.

A vékony natív próba kizárólag saját eldobható workspace-t használ, Mining
és Smithing1 szinttel; a mozgás/loc elhelyezése kontrollált fixture. Nem
élő útvonal-, önfenntartási vagy közös-baseline bizonyíték. A szerszám
kezdeti sérülése explicit teszt-előfeltétel, nem C07 warmup-credit.
Óra: saját aktív populationhöz kötött288:1 SimulationClockStore; a munka
csak egymást követő natív engine tickeken haladhat. Maximum30s child és45s
wrapper,0 providerhívás. Hiányzó jogosultság/material/source, native FAIL
vagy limit megállít; sikertelen futás nem tűnik el és nem promótálhat.

A meglévő tin natív esethez ugyanaz a tartós review-út kerül, új
mechanikai mag helyett. Az új CLI csak külön draft-trial világot fogad el;
prepare nem indít játékot, nem ad tárgyat vagy jogosultságot, nem publikál.

## Elkészült normál út

`agent-skills/trial-review.ts` a normál admin verifier és publikálás közös
backendje. A korábbi, feltételes forrásonkénti recheck helyett ugyanazt az
egész eljárást, paraméterezést és aktuális natív gate-készletet ellenőrzi újra.
Kijelölt világ/checkpoint csak megbízható backendbeállításból jöhet.
Az adott trialhoz tartozó futások mellett újranyitja az executor admissiont,
az exact draft checksumot és a natív forrásokat. A tool effect saját
skill-checksumának is egyeznie kell: újrahash-elt admission nem írhatja át
egy régi natív végrehajtás eljárásverzióját.

A `persisted-evidence-binding` verifier-check a teljes run-tartalmat,
draft-checksumot és worldId-t köti a meglévő approval digesthez. Nincs új
adatbázistábla vagy dokumentumséma. A régi run/admission/trial fájlok olvashatók;
régi, az új kötés nélküli jelentés publikálása előtt friss review kell.
Rollback: leállított trial mellett kód-visszaállítás; a run/report fájlok
megőrzendők. Régi kóddal strict C07 futás nem folytatható.

A report-only review immutábilis jelentést és approval-előnézetet ír, de nem
ment verified skillt. Az `inspect` ugyanazt a jelentést és pontos futáslistát
olvassa újra, új jelentés vagy trial-állapot módosítása nélkül. Módosult run,
admission, report vagy canonical source új ellenőrzést igényel. Egy friss
emberi kattintás önmagában nem tehet érvényessé átírt bizonyítékot.
Az admin a korábban megfelelt trialnál is felkínálja a bizonyíték ellenőrzését.
A CSRF-, külön emberi jóváhagyási és approval-digest kapu megmaradt.

## CLI

A `scripts/society-founder-trials.ts` három parancsot ad:

- `prepare --root TRIAL --username USER --business-id WORKSHOP`: a három exact
  0.1.0 draft checksumát és paramétereit ellenőrzi, majd idempotensen capability
  gapet és ready trialt készít. Aktív population/player control kell; másik
  subject/paraméter nem foglalhatja el a meglévő próbát. Nem indítja a skilleket,
  nem teremti meg a hiányzó műhely-/anyag-/szerszámfeltételeket.
- `review --root TRIAL --trial UUID`: a normál futásnaplókból és natív forrásokból
  tartós review; elégtelen bizonyíték esetén megőrzött failed report és nincs approval.
- `inspect --root TRIAL --trial UUID`: a már megfelelt review readonly újranyitása.

Csak külön `draft-trial-only` bootstrap nyugtával rendelkező workspace-t fogad
el; integration receipt mellett elutasít. Nincs CLI publish parancs.
Forráskötés nélküli régi/másolt trial-világot nem adoptálunk C07 baseline-ként.

## Bizonyíték és következő határ

Mindhárom eljárás két teljes, külön run/admission naplózott SkillExecutor és
RsSdkSkillRuntime végrehajtással jut tartós reviewhoz. A két tin run most ugyanazon
workspace/owner/lifecycle alatt történik; ugyanannak a csákánynak100→99→98
kapacitása és két külön ore/output nyugtája marad meg. Smelt és repair a valódi
`NativeToolWorkAccessSource` population/Business/Property útját használja;
nem állandó fixture-engedélyt. Minden report újranyitható, és forrástampernél
elutasított. A külön UI-próba a normál API-n újraellenőriz, új digestet kér,
majd csak a saját izolált generic tesztverzióját publikálja emberi jóváhagyással.

Ezek továbbra kontrollált mozgás/loc komponens-próbák. Nem lett valódi saját
C07 trial-stage telepítve, nincs jóváhagyható élő háromeljárásos publikálási
csomag, és egyik szükséges1.0.0 eljárás sem lett publikálva. Nem kérünk ezekre
a fixture-reportokra élő publikálási vagy hosszú futási jóváhagyást.
**Következő: a friss, külön native procedure-trial stage alkalmazója és tényleges
útvonalas futásai; utána a review, emberi publikálás és közös founder-baseline.**
Az eredeti3. csomag ezen belül haladt; a3–7. öt nagy csomag még nyitott.

## Ellenőrzés és megőrzött diagnosztika

- `20261030-200724-111-si-c07-p3-review-and-preparer`:7 PASS2,719s;
  tartós normál review, readonly és utólagos run/admission/report változtatás,
  idempotens három-trial prep, hibás világ/subject/paraméter és tényleges CLI.
- `200603-666-si-c07-p3-native-reviews-final`:a módosított egy-workspace tin
  native eset +wrapper PASS5,174s; a kombinált parancs FAIL7,899s a másik
  eset sandbox atomikus capability-gap rename EPERM hibáján. A sikeres tin nem ismétlődött.
- `200628-749-si-c07-p3-tool-review-native-permissions`:4 tényleges normál
  tool run és review/reopen/tamper PASS10,171s. A korábbi full config/catalog
  fixture másolás miatt sikeres kör25,911s volt, abból14,5s cleanup; most csak
  két szükséges config és három draft másolódik. Nincs közös runtime/archive újratervezés.
- `201701-358-si-c07-p3-tool-review-final`:ugyanez az exact native-effect
  checksum negatív próbával PASS11,437s. Régi effectet új draft/admission checksum
  sem címkézhet át. A kiválasztott natív eset +wrapper egy esetként számolandó.
- `201022-557-si-c07-p3-publication-final`:a saját izolált generic UI/API
  publikálási szerződés PASS2,927s. Elutasított átírt report, normál verifier
  gomb/CSRF, új report/digest és külön emberi approval, majd helyi teszt-publikálás.
- `201825-091-si-c07-p3-review-direct-consumers`:28 PASS8,168s;
  review/preparer/trials/approval/admin-safety/preflight és két bootstrap belépési eset.
- `201140-481-si-c07-p3-review-types`:root TS PASS; kombinált parancs
  FAIL174,414s:engine behúzta a bootstrap→régi extensionless admin skill-catalog
  modulgráfot. Két változatlan state-path data-only modulba emelve, bootstrap
  reexportálja. Csak az engine ismétlődött:
  `201533-479-si-c07-p3-review-engine-types` PASS52,179s.
- `202010-097-si-c07-p3-review-artifacts`:217 aktuális source SHA,
  packed SHA/eredeti policy,11/11 P2,175 helyi link és egyező NO-GO artifact,
  changed-line formázás PASS2,620s. A három eljárás exact1.0.0 blockere megmaradt.

Korai hibák nem tűntek el: `200116-765` sandbox temp rename EPERM, saját
workspace-temp alatt ugyanaz a három eset `200130-269` PASS1,198s.
UI `200739-180`:nem megjelenített check-ID helyett a két elfogadott futás
látható állítását ellenőrzi; `200758-711`:a teszt közvetlen fetchéből hiányzott
a CSRF, ezért a normál UI verifierre váltottunk. `200857-691`, `200932-632`,
`200955-461`:lista-újrarajzolási verseny; a függő response ígéret maszkoló
PageClosed hibája helyett az eredeti detached DOM hiba megőrzött. Mindkét
lépés után friss nézetből történik a következő user-akció. Nincs termék- vagy
natív assertion elhagyás és nincs termék-timeout emelés.

**Nem teljes regresszió.** A módosított komponens a trial review/prep és annak
közvetlen admin/CLI/UI fogyasztója; a changed native határ külön bizonyított.
Meglévő JSON-store/séma/atomikus rename, clock és economic transaction alap
változatlan. Nincs globális role/auth változás; az emberi approval és CSRF megmaradt.
