# SI-C07 – Lifecycle route/build pin és clock/world-policy megfigyelés

**Ugyanaznapi folytatás:** [C06 environment inventory és mod/director mutation history](SI_C07_POLICY_MUTATIONS.md)
készült. A két mintapont közti oda-vissza állítást külön journal őrzi meg;
teljes loaded dependency/input vagy külső writer enforcement továbbra nincs.

2026-10-27, a2. munkacsomag részeredménye. SI-C07 továbbra NO-GO,27/45;
[6 munkacsomag maradt](SI_C07_REMAINING_WORK.md). Az eredeti17 requirement,
8 integrity gate és minden küszöb változatlan. Előzmény:
[páros tick-watermark és World-census](SI_C07_LIFECYCLE_WATERMARKS.md).

## Rögzített útvonaljegyzék és tényleges policy

A `native-policy-manifest.ts` a7 meglévő lifecycle observation route-ot az
érintett natív entrypointokhoz rendeli. Explicit forrásfájllista, bytehossz és
SHA-256 tartozik hozzá. Külön lista rögzíti a lifecycle/clock/minimum/survival/
mod konfigurációkat és az opcionális local mod/director fájlok jelenlétét.
Hiányzó kötelező fájlból nincs teljes pin, opcionális hiány explicit null.
Nincs jelszó, API-kulcs, chat vagy konfiguráció-payload a journalban.

A natív observer importkor egyszer olvassa a declared code-files lenyomatát.
Ez importkori lemezazonosság; nem bizonyítja minden futó dependency vagy packed
script betöltött bytejait. A manifest ezt explicit részlegesnek jelöli.
Az opening pinhez eltérő importkori identity, megváltozott declared source-file
vagy policy-file külön drift megfigyelés lehet. Nincs utólagos boot-backfill.

A két meglévő World tickponton külön policy-observer is fut, akkor is, ha az
aktuális census kontextusa már nem érvényes. A sikeres aktuális mortality-pass
eredeti pozíciója és headje rögzíti, mikor történt a megfigyelés; külön snapshot
tartalmazza a tényleges aktuális clock state-et, cached age/mortality/binding,
survival-selection és aktív mod-policy digestjét. A mod-policy getter nem
frissít metrics-et, nem reloadol fájlt és nem nyit lazy store-t.

Az observer nem `observe`-olja, nem állítja át és nem javítja az órát. A state
profile/rate/revision/status/anchor értékei a meglévő readonly getterből jönnek.
Így egy ticken belüli pause/reconfigure is látható, ha az emiatt érvénytelen
census már nem ír új frame-et. A normál gameplay guard és clock setter maradt.

## Prospektív journal és kiértékelés

A saját `native_lifecycle_policy_*` schema1 selection/event/head/fault journal
explicit opening pint igényel a watermark-selection mellé. Az opening clock és
age/mortality/survival kötése a már kijelölt eredeti mortality authorityhoz
illeszkedik. A selection és audit immutable, session/tick/stage egyedi, a fault
counter tartós és nem resetelhető. Hiányzó authority explicit null/fault; teljes
DB-hiba vagy elmaradt hívás nem tanúsít változatlanságot. Limit100000 sor.

A readonly `sources.lifecyclePolicy` az applied original founder/lifecycle/
membership/world/clockhoz és a native mortality/census prefixekhez köti a
journalt. A vizsgált ablak genesis óta tart, a warmupot is tartalmazza.
Minden after-guard/end-tick pont, egymást követő tick és azonos session kell.
Hiányzó/null/foreign/future/stale context, hiányzó stage vagy rossz prefix gap;
a korábbi maximum simulation/wall-gap policy nem lett lazítva.

A kiértékelő külön észleli a clock profile/status eltérését, a native pass utáni
reconfigure-t, a revision/anchor szegmens változását és a hibás vetített időt.
A meglévő setterek monoton revíziója az oda-vissza profilváltást vagy
pause/resume-ot is megőrzi, még ha a záró profil újra az eredeti. Opening pin
paused baseline mellett is készíthető; a futás első frame-je adja a running
szegmens kezdő identityjét, a későbbi ablakban nem fogadunk el néma szegmensváltást.

A hiteles natív pozícióhoz kötött source/config/effective-policy/clock eltérés
scoped `unchanged-clock-and-world-policy` FAIL-t adhat. A külön
`policyIntegrityViolations` diagnosztika hibás vagy hiányzó minimum frame mellett
is megmarad. Más census-gap, policy fault vagy hiányzó boot manifest nem törli
el az önállóan igazolt clock-sértést. Idegen query scope nem vehet át sértést.

`completePinnedPolicyObservations` csak a declared forrásokkal kötött ablak
megfigyelési teljessége. A teljes dependency/packed/environment inventory,
intratick mod/director hot-reload history és a többi producer még hiányos.
`completeWorldPolicyEnforcement:false`, `completeLifecycleEnforcement:false`;
sem egy változatlan mintasorozat, sem a fájlok létezése nem teljes integrity PASS.
A16 forráscsalád/17 requirement/8 gate továbbra selectedSources=null és
qualifiesCoverage=false. SI-M3/MVS PASS nincs.

## Bevezetés, rollback és ellenőrzés

Nincs közös user_version, clock, health vagy AgentState séma-/migrációváltozás.
Régi checkpointban nincs implicit install vagy kitalált történet. Baseline
előtt explicit új source/build/schema pin kell. Rollback előtt stop és új pin
szükséges: régi bináris nem ír policy-historyt, ezért nem folytathatja a
tanúsított ablakot. Evidence-t nem törlünk és történeti backupot nem módosítunk.

A C06 explicit requiredTables mellett ellenőrzi a policy-journal teljes auditját
és dependency-prefixeit, az aktuális declared source/config pin egyezését és
azt is, hogy a rögzített fájlok ténylegesen szerepelnek-e az archívumban.
Izolált restore után a manifest visszaolvasható; rossz head vagy source drift
új baseline-t tilt. A mechanikai fixture nem kész SI-C07 gazdasági baseline.

Korai packed native próba: tényleges World observation, valódi revisioned clock
reconfigure, elveszett census context mellett megmaradó policy snapshot,
változatlan player-save és clock az observer előtt/után. Write-failure és null
policy authority tartós gap. Nem teljes World.cycle vagy live run.
Root SQLite próbák: stable/frozen readonly reread, külön mért profile/pause/
round-trip/effective/config/source/boot drift, null/foreign/prefix/session/gap,
scoped minimum FAIL és sérült census mellett megmaradó clock-sértés.
Saját schema/reopen/immutable audit/rollback/user_version42 és C06 restore is
érintett. Pontos scope/eredmény/idő: [átadás](SOCIETY_DEVELOPMENT_HANDOFF.md).

Full regresszió nem indokolt saját additive observer/journal és közvetlen
metrics/minimum/restore/preflight fogyasztók esetén. A shared clock gazdasági/
auth/persistence alap változatlan. Nincs live install/run/baseline/providerköltség.

Következő a teljes build/config/packed/environment producer inventory és a
mod/director változtatások tartós történetének illesztése az integrity adapterhez.
A teljes boundary/custody/access és admin/external source history is kell.
A2. csomag nyitott,6 maradt; a3. founder baseline és C08 nem indul.
