# SI-C07/2 P2-04 – Óra és világpolicy natív kapu

2026-10-28. **P2-04 kész komponensszinten: 3/11 pont kész, 8 nyitott;
3/8 pozitív natív integrity kapuút.** [Lezárási lista](SI_C07_PACKAGE2_CLOSURE.md).
Ez nem hosszú C07 gazdasági run vagy SI-M3/MVS PASS; 27/45, preflight NO-GO.

## Bizonyítási határ

A `society-metrics/world-policy.ts` az eredeti
`unchanged-clock-and-world-policy` kaput értékeli. A már meglévő natív
policy/census/clock és mutation prefixek mellett explicit
`WorldPolicyRuntimeContract` és valódi engine/gateway indulási rekord kell.
A szerződés rögzíti a C06 archive source/config/packed byte-hash leltárát,
Bun/platform és a kizárólag whitelistelt nyilvános runtime inputok digestjét.
Ide tartoznak például a NODE_XPRATE, NODE_MEMBERS és BUILD_* policy bemenetek;
API-kulcs, teljes környezet vagy .env tartalom nem kerül be a rekordba.

**Futási előfeltétel:** a kijelölt forrás-, config- és packed bemenetek a
kontrollált kísérletben immutable állapotúak. Az alkalmazáson belüli módosítási
utak naplózottak; tetszőleges külső fájlírás nem támogatott run-művelet.
Ez a meglévő source-immutable kísérleti feltétel kódhoz kötött szerződése,
nem ellenséges OS/host vagy minden ténylegesen betöltött dependency attestációja.
A meglévő `completeRuntimeDependencyUniverse:false` és az alacsonyabb szintű
részleges observer-állítások változatlanok.

Az engine és gateway tényleges startup belépője rögzíti az indulási rekordot,
ha a szerződés előzetesen települt. A kiválasztott fájlok hash-ellenőrzése
induláskor egyszer történik, nem minden tickben. Közös processz-session köti
az engine indulását a natív mintákhoz és a mutationöket a megfelelő engine/
gateway processzhez; a két szerep azonos sessionnel nem igazolható. A rekordok
head-prefixe az eredeti natív mutationCursor része. Újraindulás vagy hiányzó,
idegen, hibás/stale szerep/input/frame/cursor nem kap pozitív kaput.

## Írók, reload és értékelés

A szigorú producerregiszter hat módosítási utat fed le: mod configure/restore/
hot-reload, director configure/event-accept és **World.reload packed reload**.
Utóbbi a korábban betöltött packed identityhez hasonlít, így két azonos
lemezolvasás nem rejti el az új tartalom betöltését vagy az oda-vissza váltást.
A normál signal/no-op nem policy-sértés. Sikertelen/hiányos reload unknown;
a tényleges callback ugyanannyiszor fut, és az eredeti kivételt megőrzi.
Pause/resume/reconfigure a meglévő monoton clock-revision és anchor történetből
ellenőrzött. A teljes warmup+evaluation natív ablak minden pontja szükséges.

A kapu PASS/FAIL/inconclusive eredménye a native-outcomes → minimum-assessment
útba bekötött, a `clock-world-policy` sourceCoverage család tényleges
lefedettségi adaptert kapott. Teljesen megfigyelt szabálysértés mellett a
coverage lehet complete, de az integrity FAIL. A hiányos másik forrás nem törli
az igazolt korábbi sértést. A closing cursor utáni esemény nem kerül vissza az
ablakba. A globális `qualifiesMinimum:false` továbbra megmarad.

## Saját séma, kompatibilitás és rollback

Nincs új journal fájl vagy közös migráció. A meglévő policy-mutations.sqlite
opcionális, saját schema1 táblái: `world_policy_runtime_schema`, `_contract`,
`_event`, `_head`. Append-only eseménylánc és immutable contract; user_version
változatlan. Legacy ötproduceres pin és régi cursor olvasható, runtime-kapuja
unavailable/unknown; nincs automatikus telepítés vagy történeti backfill.
Az új hatproduceres kör explicit contract-digesthez és friss selectionhöz kötött.

Előkészítés offline, új baseline előtt: teljes C06 környezetleltár és a launcher
ismert inputjaival `createWorldPolicyRuntimeContract`; ezután a digest a
PolicyMutationSelectionben és explicit `WorldPolicyRuntimeStore` init. Mindkét
processznek a szerződés telepítése után kell indulnia, a run nyitópontja előtt.
A konkrét C07 baseline/indítás/source-selection a 3./5. csomag feladata.
C06 prepare/capture/restore és a benchmark olvasó az új opcionális forrást is
ellenőrzi. Legacy pinből nem lesz észrevétlenül szigorú pin.

Rollback előtt stop és bizonyítékarchiválás; régi binárissal szigorú run nem
folytatható. A pre-contract baseline külön workspace-be állítható vissza;
az új immutable selectiont/eseményeket nem írjuk át és nem töröljük.
Nincs live telepítés, szerverindítás vagy providerhívás ebben a fejlesztésben.

## Ellenőrzés

Valódi SQLite/native readerekből, az eredeti 1+7 frame-en át a pozitív kapu és
sourceCoverage is PASS-képes; a 193 natív tickpontos fixture gazdaságot nem futtat.
Hibás input/session/role/cursor/frame/restart, packed round-trip, failed reload,
readonly újraolvasás, immutable schema/rollback és C06 offline restore próbázott.
A fixture első időtúllépését fázismérés után egy izolált építési tranzakció oldotta
meg: build 28,256→7,446 s, teljes próba 30,843→10,064 s, 15 s limit változatlan.
A production append és külön rollback-próbák tranzakcióhatárai változatlanok.
Részletes ellenőrzési eredmények az [átadásban](SOCIETY_DEVELOPMENT_HANDOFF.md)
és a [progressben](SOCIETY_INTEGRATION_PROGRESS.md).
