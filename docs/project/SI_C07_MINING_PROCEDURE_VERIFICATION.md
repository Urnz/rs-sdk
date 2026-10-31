# SI-C07 – Az óneljárás natív próbája és forrásellenőrzése

2026-10-30. A rögzített **3. közös founder-baseline csomag** része.
[A baseline feltételei](SI_C07_FOUNDER_BASELINE.md) és a hét munkacsomag
változatlan; a 2. csomag lezárása továbbra11/11. Ez nem új lezárási pont.

## Elkészült

A `procedure.mining.gather-tin@0.1.0` draft kipróbálhatóságának körkörös
feltétele megszűnt: a normál Mining korábban kizárólag megtanult verified
eljárást fogadott el, ezért a draft nem szerezhetett valódi natív bizonyítékot.
Most kizárólag az adott exact draft kétműveletes, paraméter nélküli alakjához
adható acknowledged trial: walk3285,3365/tolerance5, majd exact tin gather,
60s műveleti és legfeljebb120s eljárási limit. A korábbi15s keret élő
Mining1/bronze tick-ritmus alapján módosult; [mérés és indok](SI_C07_FOUNDER_TRIAL_STAGE.md).
Nincs bank/trade/GP jogosultság.
Az admin meglévő külön trial-run megerősítése és az executor markerje kell;
a draft státusz vagy a megtanult tudás önmagában nem engedély.

A natív belépés újraolvassa a pontos checksumot, runtime grantot, aktuális
run/step admissiont, heartbeatot, aktív population/lifecycle/control kötést.
A tiltott tudás, lezárás, cancellation és lejárat ugyanúgy kizáró ok.
A draft-trial authority digest az adott runId-hoz is kötött. A verified
eljárások korábbi authority digestje változatlan.

A verifier két külön natív dispatch/output hatást és megbízható backend
forrásellenőrzést követel meg a typed copper/tin Mininghez. Az ACK, XP,
inventory-delta vagy feltöltött success-esemény nem helyettesíti ezt.
A repeat és a külön paraméterezett child-call felismerése is bekötött.
A readonly reader ugyanazon kijelölt világ/checkpoint mellett összeköti:

- az exact eljárás/run/paraméter checksumot és executor admission/seal fájlt;
- a tartós invocationt és egyszer használható natív target dispatchot;
- a fulfilled intentet és annak friss natív output nyugtáját;
- a külön lifecycle auditból újraellenőrzött szerszámhasználatot.

Az admin verify és a CLI verify is ezt hívja. Publikálás előtt újból megnyílnak
a források; az eljárásból újraszámított Mining-követelmény miatt régi, a natív
gate nélküli report sem használható. Az emberi approval/digest kapu megmaradt.

## Natív bizonyíték és határa

A packed-engine teszt két független, aktív populationhöz kötött runban
**Mining1**, bronze pickaxe100→99, egy valódi tin ore, natív HTTP/tick ingress,
dispatch, intent és lifecycle audit mellett végigmegy a SkillExecutor és
RsSdkSkillRuntime útján. A két hatásból a report-only verifier PASS-t ad.
Sem skill-store mentés, sem1.0.0 publikálás nem történik.

A mozgás és a loc elhelyezése kontrollált fixture. A determinisztikus1-es
RNG-mag a valódi packed Mining dobását vezérli, nem emeli a skill szintjét.
Ez mechanikai/source-join bizonyíték, **nem** létező világon végigjárt út,
jóváhagyható élő skill-trial report, autonóm teljesítmény vagy C07 baseline.

Hiányzó executor seal, hamis receipt digest, idegen username/world és egy
külön másolaton átírt/rehashed native effect elutasított. Az eredeti natív
event UPDATE-jét az immutability trigger tiltja; ezt az állítást megtartottuk.
A kanonikus DB byte-hash readonly újraellenőrzés után azonos.

2026-10-31: a [külön F-világ tényleges SDK/Lite útja](SI_C07_FOUNDER_TRIAL_STAGE.md)
is sikeres. Két új, nem seedelt Mining1 run13,254s és11,130s alatt, ugyanazon
owned instance100→99→98, két külön source-bound dispatch/fulfilled output;
normál tartós review és readonly recheck PASS. Az exact60s draft publikálási
javaslata a [közös előnézetben](SI_C07_FOUNDER_TRIAL_RESULT.json). Nem C07 warmup-credit.
Az exact1.0.0 az explicit emberi jóváhagyás és ismételt readonly ellenőrzés után
[publikált](SI_C07_FOUNDER_PUBLICATION_RESULT.json), a közös katalógusba is bekerült.

## Célzott ellenőrzés

- `20261030-153252-048-si-c07-p3-mining-unit-fixed`:19 PASS3,488s.
- `20261030-153549-860-si-c07-p3-tin-thin`:1 natív eset +1 wrapper PASS5,236s.
- `20261030-153829-592-si-c07-p3-mining-native-final`:a korábbi11 natív
  admission/cancel/replay/coverage eset és wrapper PASS12,791s; a teljes
  parancs FAIL17,151s az új negatív tesztben tiltott UPDATE miatt.
- `20261030-154058-296-si-c07-p3-tin-audit-final`:javított negatív teszt,
  1 natív eset +1 wrapper PASS5,807s. Run1/source874ms; run2/source2115ms;
  negatív és readonly ellenőrzésekkel2975ms kumulált belső idő.
- `20261030-154130-497-si-c07-p3-mining-consumers`:89 PASS4,634s;
  Mining admission/gather/request, verifier/framework, food/tool/travel,
  trials és publication approval közvetlen fogyasztók. A FileSkillStore
  Windows-hardlink műveleteihez natív jogosultság kellett.

Korai hibák megőrzöttek: `153149-889` és `153224-868` unit fixture/type-shape;
`153355-250` natív5s timeout, mert a régi4096 RNG-mag99-es szinten sikeres,
1-es szinten ismételten sikertelen dobás. Ennek késői async folytatása a
következő esetet is zavarta. A diagnosztika egyetlen natív esetre szűkült,
explicit15s összetett tesztkerettel; a termék15s gather limitje változatlan.
`153626-911` Bun child launch FAIL; Node tsc-re váltottunk.
`153640-906` TS FAIL58,008s, két típushiba javítva; végső eredmény az átadásban.

- `154144-274`:root TS PASS; a kombinált parancs FAIL99,274s az engine
  NodeNext JSON import attribute hiányán. Javítás után csak az engine ismétlődött:
  `154346-541-si-c07-p3-engine-types` PASS50,717s.
- `154542-304-si-c07-p3-artifacts-and-admin`:209 aktuális source SHA,
  packed SHA/eredeti policy/NO-GO artifact PASS és további14 admin/preflight
  teszt PASS. A parancs összesen FAIL6,023s az átadás végi üres sor miatt;
  dokumentum javítva, runtime nem ismétlődik emiatt.
- `154639-824-si-c07-p3-final-artifacts-format`:végső artifact/link/format
  PASS1,368s. A dokumentáció eredménybejegyzése nem új runtime-kockázat.

Teljes regresszió nem indokolt: szűk Mining draft-trial/verifier komponens,
közvetlen skill/admin fogyasztók és packed native határ. Nincs változó shared
persistence, clock vagy economic transaction alap. Root és engine TS szükséges.

## Következő konkrét munka

A három eljárás normál, tartós source-bound trial/review csomagja továbbra
kell: tin, smelt-bronze, repair-bronze-pickaxe. Egyik sem lett1.0.0 verified.
Utána a közös friss stage alkalmazó/ellenőrző útja következik a már rögzített
genesis,4 slot, worker-grant, tool opening és mind4 founder housing/sleep
feltételeivel. A3. csomag nyitott, összesen öt nagy csomag maradt.
