# SI-C07/2 P2-08 – Belső eredet és tényleges végfelhasználás

2026-10-29. A `verified-internal-lineage-and-final-use` pozitív natív adaptere
elkészült. **7/11 lezárási pont kész, 4 nyitott; 7/8 pozitív natív kapuút.**
SI-C07 továbbra nyitott, 27/45, preflight NO-GO; SI-M3/MVS nem PASS.
Következő P2-09: a living/survival szabályok pozitív alsó korlátjai.

## Mit igazol a kapu?

A meglévő natív food-production/lineage/delivery, trade, tool lifecycle/work,
material-lot és escrow naplókat köti az eredeti applied genesishez, teljes
founder cohorthoz, world/clock/profile és warmup/evaluation ablakhoz.
A P2-04 reviewed immutable-input és P2-07 external-value join marad a
producer-határ alapja. A kapu nem ellenőriz ellenséges hostot vagy minden
függőséget, és nem fogad HTTP-n vagy modellkimenetben feltöltött proofot.

`production-workflow/lineage-coverage.ts` a meglévő policy tickpont opcionális
cursorában hat meglévő stream prefixét, a canonical/projection táblák állapotát
és az admission/job darabszámokat rögzíti. A meglévő producer kódok és az
étel/tool konfigurációk is a rögzített bemenetekhez tartoznak. Nincs új
journal, tábla, séma/user_version vagy gazdasági/clock írási szemantikaváltás.

`society-metrics/lineage-evidence.ts` a meglévő domain-validátorokat használja:

- Valódi gather/cook receipt, canonical consumption és delivery, auditált
  food trade és mennyiségi megmaradás. Kimaradt production/trade/consumption,
  pending admission, hibás delivery vagy ismeretlen/kevert eredet nem complete.
  Business konyhai receipt esetén a meglévő exact escrow/kitchen join is kell.
- Az induló bootstrap-készlet külön eredet, nem belső termelés. Openinghez a
  tényleges eredeti integrity proof kell; mennyiségegyezésből nem készül eredet.
- A food-ancestry a meglévő mennyiségi, keveredést konzervatívan kezelő lánc;
  nem állít azonosított fizikai ételpéldányt vagy új clean-title minősítést.
- A tool/material ág ugyanazt az auditált Mining→ore→smelt→bar→repair→reuse
  láncot, single-spend lotot és committed escrowt használja, mint a már kész
  maintenance-reader. Ismeretlen input/hold, hiányzó lot és replacement unknown.
  Másolt/bankolt/reloadolt, már korábban unproven anyag nem kap új eredetcreditet.

`society-metrics/internal-lineage.ts` a teljes natív tickablakhoz és aktuális
prefixhez köti ezeket. A már ellenőrzött external parent újrahasználata exact
checkpoint snapshot digesthez kötött; közben változó checkpoint unknown.
Nem üres történeti csatornából nem készít friss nyitást;
bootstrap food-opening és explicit induló tool megőrizhető. Törölt prefix,
visszaeső admission-szám, hiányzó cursor és zárás utáni tail unknown.
Külön hiteles food/actor sértést egy hibás material-forrás sem tüntethet el;
FAIL csak az adott eseményt tartalmazó, saját scope-ú natív prefixből származhat.

Pozitív kapuhoz tényleges, evaluation alatti, termelőtől eltérő fogyasztóhoz
jutó belső étellánc kell. Az üres tool-stream igazolhat teljes megfigyelést,
de nem ad karbantartási ciklust. A napi final-use darabszám, belső relief-share,
maintenance minimum és a teljes társadalmi minimum külön számszerű szabály.
Egyetlen érvényes lánc nem teljesíti automatikusan ezeket.

## Fogyasztók és bevezetés

A native-outcomes és minimum-assessment pozitív/scoped negatív kapueredményt
exportál. A sourceCoverage három családja – native-food-lineage,
tool-lifecycle-work, tool-material-custody – azonos eredeti binding mellett
teljes lehet. Az összes család együtt még nem PASS; P2-03/P2-09–P2-11 nyitott.
Globális `qualifiesMinimum:false`, 17 szabály/8 kapu és minden küszöb változatlan.

C06 a cursorhoz tartozó összes checkpoint táblát explicit inventoryban kéri,
ellenőrzi a prefixet és a darabszámokat. Restore után a cursor byteazonos
logikai állapotot ad. Régi, cursor nélküli forrásból nincs backfill vagy
automatikus schema-init. Új reviewed pin és prospektív selection szükséges;
rollback előtt stop és összetartozó korábbi bináris/selection. Evidence nem törlődik.

## Ellenőrzési határ

A 193 tickpontos 1+7 fixture valódi SQLite production/trade/consume naplóval
éri el a pozitív gate/sourceCoverage ágat és frozen readonly újraolvasást.
Külön engine-próbák valódi packed A-gathers/B-cooks/C-eats lánccal, illetve
100 Mining output→törés→smelt→repair→reuse eredettel ellenőrzik ugyanazt az
evidence-readert. Ez mechanikai képesség, nem hosszú gazdasági run vagy ratio-próba.

Pontos check-ID-k, idők és korai hibák az [átadásban](SOCIETY_DEVELOPMENT_HANDOFF.md)
és a [progressben](SOCIETY_INTEGRATION_PROGRESS.md): **115 célzott eset,
root/engine típusellenőrzés PASS**. Csak az érintett tesztek és
root/engine TS szükséges; full regresszió nem indokolt. Nincs live
install/start/provider, új baseline vagy történeti backup-payload olvasás.
