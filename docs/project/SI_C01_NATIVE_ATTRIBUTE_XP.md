# SI-C01 – Natív attribute/potential XP

Állapot: **kész / mechanikai PASS**, 2026-10-24.
Ág: `codex/si-c01-native-attribute-xp`, kiinduló commit `cef67876d`.

Hipotézis: azonos natív Player.addXp workload eltérő, életciklushoz kötött
immutable profilból eltérő tartós XP-t eredményez a négy bevezetett skillnél.
Sorrend: experiment calibration → diminishing → potential → server XP rate →
személyes hard cap / engine maximum. Soft cap az award előtti személyes szintet
vizsgálja, a facility nem írja át a személyes szintet.

Határ: új population membership profilját a létrehozáskor rögzítjük. Régi,
profil nélküli membership explicit importot igényel, nincs automatikus átlag.
Az XP-receipt csak a Player-checkpoint tranzakciójával válik tartóssá.

Próba: eldobható SQLite és valódi Player; páros workload, négy skill, cap-
átlépés, allowMulti=false, nem érintett skill, profilhiány, lifecycle-drift,
checkpoint-write failure/retry/reopen. A fixture saját clock/source identityt
rögzít. Legfeljebb 60 s natív child, 90 s wrapper; nincs providerhívás/költség,
nincs live world vagy történeti backup módosítás. STOP: első assertionhiba,
child deadline vagy hiányzó packed precondition; célzott diagnosztika követi.

Ellenőrzési kör: character-attributes képletek és binding store, population
membership/entry/genesis közvetlen fogyasztók, WorldMods XP és natív Player
checkpoint határ, root/engine TS és changed-line format. Teljes regresszió
nem alapértelmezett: komponenssaját additív táblák és célzott XP-hook változik,
a közös checkpoint tranzakciós szemantikája megmarad.

Migráció: additív, saját táblák; a régi membership profilját csak explicit
validált import kötheti be. A régi XP és alapadatok nem számolódnak újra.
Rollback: runtime leállítása, új kód visszavonása; saját táblák megőrzése
auditnak, a korábbi engine változat figyelmen kívül hagyja őket. Régi checkpoint
visszaállítása csak a hozzá tartozó teljes világmentéssel, nem külön XP-ledgerrel.

## Megvalósult határ

- `character-attributes/binding-store.ts`: saját additív, update/delete tiltott
  binding tábla az AgentState DB-ben. Lifecycle/source/world-profile/clock
  azonosság, immutable attribútumok és teljes potential/cap policy verzióval,
  digesttel. A genesis/population membership és seedelt profil ugyanabban az
  AgentState-tranzakcióban születik. A v29 közös séma nem változott.
- Új membership: exact `default-npc-attributes@1.0.0`,
  `default-npc-allocation@1.0.0`, `default-skill-potential@1.0.0`,
  `attribute-hard-cap@1.0.0`; seed a natív source-result ID/digest.
  A betöltött katalógusokat új létrehozás validálja; meglévő binding nem íródik újra.
- Régi membership replay/lookup nem generál profilt. Az explicit import API
  `AgentStateStore.bindCharacterAttributes`; az operátori CLI:

  ```powershell
  bun character-attributes/bind-cli.ts --agents-db .local/agent-state/agents.sqlite --agent-id AGENT_ID --input creation.json
  ```

  A `creation.json` a `CharacterAttributeCreation` négy mezőjét tartalmazza:
  teljes validált `attributes`, `potentialPolicy`, `capPolicy`, továbbá explicit
  `creationEvidence`. Nem az LLM tölti fel, a CLI sem választ átlagértéket.
  Ismeretlen DB/karakter, lifecycle-eltérés vagy immutable konfliktus hiba.
  E körben élő karakter migrációját nem futtattuk.
- `populationAttributeContext` a meglévő engine-population authorityból olvas.
  Halott/resetelt tag, profilhiány, sérült binding és clock-eltérés nem kap XP-t.
  A döntési kontextus megkapja a profilt és az exact policy/binding referenciát.
- `Player.addXp`: négy célskill, `allowMulti=false` mellett is potential/cap
  enforcement. Az utóbbi továbbra is kihagyja a világ- és szerver-szorzót.
  Minden más skill és a nem population-tag régi avatar útja vanilla marad.
  XP-egység az engine tized-XP-je; minden lépés külön kerekít, a végső rate után
  egész szám és hard-cap clipping következik. A level-1/99 perem is ellenőrzött.
- Soft cap az award **előtti** szintet értékeli. Egy átlépő awardra még az
  előző szint szorzója vonatkozik; a következőre a slowdown. Hard capnél még
  egy nagy, globálisan szorzott jutalom sem lépi túl a szinthatár XP-jét.
  A már magasabb személyes szintet a facility nem csökkenti és nem emeli.
- Saját `native_attribute_xp_receipt` tábla a kanonikus Player-checkpoint DB-ben:
  request/world-mod/potential/final XP, actual before/after, native activity,
  clock/world/lifecycle, teljes binding/policy és checkpoint digest.
  Az actual Player-byte ellenőrzése és receipt insert a meglévő checkpoint
  tranzakcióján belül fut. Failure után marad a dirty Player + pending evidence;
  az utolsó tartós save/receipt együtt marad a régi állapoton. Retry idempotens.
  Külső tranzakció rollbackje nem nyugtázza előre a pending receipteket.
  Kilépéskor az offline pending save is megőrzi őket a sikeres commitig.
- Native gather/kitchen rollback a statokkal együtt állítja vissza a pending
  XP-evidence listáját; a sikertelen munka nem hagy később könyvelhető XP-proofot.

## Bizonyíték és ellenőrzés

[Géppel olvasható páros eredmény](SI_C01_PAIRED_RESULT.json): két valódi Player,
azonos négy 80 egységes award; low profilnál skillenként60, high profilnál100
actual XP, nyolc natív receipt a World checkpoint DB-ben. Actual save-load és
külön receipt/checkpoint digest igazolja; a fixture DB-k a próba végén törlődnek.
Az artifact a LF-normalizált forrásfájlok hashét és exact policy/binding digesteit
is őrzi. Kontrollált szélső profilok, nem realizmuskalibrált népességmérés.

- `20261024-123802-533-si-c01-final-gate`: **46 PASS /0 FAIL**, benne13 natív
  eset; root/engine TS és changed-line format PASS, **37,001 s**.
- `20261024-123223-155-si-c01-consumer-repair`:53 runtime PASS, benne a régi20
  packed food/SDK/business fogyasztó. A teljes kör még FAIL volt a később
  javított TS-tranzakciós visszatérési típus/import miatt,50,809 s.
- `20261024-123017-349-si-c01-component-boundaries`: a profil/budget/allocation/
  potential/cap/progression, framework és WorldMods/ExperimentXp/DiminishingXp
  meglévő esetei PASS; a kör a v24 fixture és egy flaky shift-idő miatt FAIL,
  19,231 s. A v21/v24 fixture most ténylegesen eltávolítja a későbbi táblákat;
  a shift két határa egyetlen rögzített `Date.now()` értékből készül. Assertions
  és termékoldali migráció/műszakvalidáció nem lett gyengítve.
- Korábbi szűk diagnosztikák megmaradtak `.local/verification/` alatt:
  `122415-427-si-c01-first-native`8,852 s, `122520-048-si-c01-native-repair`
  2,622 s, `122545-113-si-c01-native-bootstrap`2,421 s (tesztbootstrap/import
  és kanonikus save-elsőbbség miatti fixture-izoláció), majd
  `122613-601-si-c01-native-isolation` PASS2,194 s. A
  `123441-027-si-c01-final-runtime-types`46 runtime PASS / root TS PASS,
  de engine CJS/ESM import FAIL volt,78,225 s; a végső kapu ezt is javítva igazolja.

A körök átfednek; a PASS-számok és idők nem adandók össze. Teljes regresszió
nem futott: a saját XP/profil táblák, a konkrét award/checkpoint és annak
közvetlen rollback/logout fogyasztói módosultak, a közös MarketStore/checkpoint
API és tranzakcióalap változatlan. Ezeket célzott write-failure/retry/reopen és
packed tartalompróbák fedik. A már változatlan PASS képletkört nem ismételtük.
Nincs providerhívás, költség, live world indítás, profile rollout vagy publication.

**SI-C01 kész;22/45. Következő: SI-C02, új kérésre.** SI-M3/MVS,
többnapos életpálya és önfenntartás továbbra sincs ezzel igazolva.
