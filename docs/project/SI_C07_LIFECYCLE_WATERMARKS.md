# SI-C07 – Lifecycle tick-watermark és tényleges World-census

**Ugyanaznapi folytatás:** a [lifecycle route/build pin és policy observer](SI_C07_LIFECYCLE_POLICY.md)
külön köti az importkori declared forrásokat az aktuális cached policy/clock
state-hez. Igazolt drift scoped FAIL lehet, teljes world-policy enforcement még nincs.

2026-10-27, a2. munkacsomag részeredménye. SI-C07 továbbra NO-GO,27/45;
[6 munkacsomag maradt](SI_C07_REMAINING_WORK.md). Az eredeti17 követelmény,
8 integrity gate és valamennyi küszöb változatlan. Előzmény:
[mortality-pass](SI_C07_MORTALITY_COVERAGE.md), [attempt journal](SI_C07_LIFECYCLE_ATTEMPTS.md).

## Két megfigyelési pont, valódi World-slotok

A World a meglévő terminal guard/eviction után, majd a tick végén, a tickcounter
léptetése előtt hívja a read-only observert. A census a tényleges indexed
`World.players` gyűjteményből olvas. Ezért a feldolgozási playerLoopból kimaradt,
de még bent maradó selected avatar is látszik. A kiválasztott roster minden
tagja kap authority sort; az offline alapító üres avatarlistával jelenik meg.
Dupla username külön slotokban megmarad, nem deduplikáljuk el a bizonyítékot.

Mindkét sample tartalmazza a native clockot, a mortality-pass prefixét, az
attempt-journal head/fault értékét, a lifecycle sessiont és a tényleges
HP/finite/terminal állapotokat. A tick két pontja különbözik: a tick végére
bekövetkező jogos lethal damage önmagában nem hibás eviction bizonyítéka;
az utána következő guardnak kell eltávolítania az avatart. A census nem
változtat HP-t, flaget, slotot, mortality/admission vagy interpreter döntést.

## Saját prospektív séma és visszaolvasás

A `native_lifecycle_watermark_*` saját1-es selection/event/head/fault sémája
explicit baseline előtti initet igényel. A selection a korábbi immutable
lifecycle-selectionhöz, a két rögzített stage-hez, a World-slot census producerhez
és az opening attempt head/fault cursorhoz kötött. Nincs implicit install,
user_version-emelés, korábbi history átalakítása vagy kitalált backfill.

Az események láncoltak és immutable-ek; session/tick/stage egyedi. Az observer
írási hibáját tartós, vissza nem állítható fault counter jelzi, ha a DB írható.
Teljes DB-hiba, rollback vagy elmaradt hívás nem válik nulla-kísérlet igazolássá.
Tartalomlimit100000 sor; nincs csonkolt siker. IP, jelszó, chat, packet-payload
és exception-payload továbbra nincs a naplóban.

A readonly `sources.lifecycleWatermarks` ellenőrzi az eredeti applied founder/
lifecycle/membership/world/clock kötést, a native health/death/binding prefixeket,
a mortality-pass forrást és az attempt-cursorokat. Genesis óta a teljes warmup
és evaluation ablak számít. Csak váltakozó after-guard/end-tick párok, egymást
követő tickek, azonos session, monoton clock és ismert actor-context mellett
lehet teljes megfigyelési ablak. A maximum simulation/wall gap a korábbi
mortality-selection policyjához kötött, nem új lazított határ.

Hiányzó nyitó/záró pont, tick vagy stage; restart; idegen/stale/null authority;
rossz audit-prefix; observer fault; lezáratlan/ismeretlen attempt és closing
seal utáni attempt-tail gap marad. Az üres avatarlista csak a megfigyelt World-
slotok állapota, nem az összes lehetséges belépési út teljességi bizonyítéka.

## Részleges tanúsítvány és önálló FAIL

A `completePostGuardCensusCoverage` és `completeRecordedAttemptWindow` csak az
adott eredeti forrásokkal kötött megfigyelési ablakról szól. Nem jelent teljes
lifecycle enforcementet, folyamatos intratick HP-megfigyelést, survival/living
founder alsó boundot vagy eredeti minimum integrity PASS-t.
`completeLifecycleEnforcement:false` és SI-C07 NO-GO marad.

A hiteles after-guard pontban bent maradt natív halott/terminal/zero-HP avatar,
hiányzó finite flag vagy dupla original avatar pozitív scoped sértés lehet.
Ez a `finite-lifecycle-no-respawn` gate FAIL-je és külön diagnosztika. Más tick/
forrás hiánya, observer fault vagy sérült attempt-journal nem törli el a külön
igazolt census-sértést. Fordítva: sérült censusból nincs új bizonyíték; a külön
hiteles attempt/native founder-death FAIL ettől továbbra megmarad. Idegen query
scope nem vehet át sértést. A16 forráscsalád/17 requirement/8 gate jegyzéke
továbbra selectedSources=null és qualifiesCoverage=false.

## Bevezetés, rollback és ellenőrzés

A C06 explicit requiredTables mellett az új saját journal selection/audit/head/
fault forrást is validálja és izoláltan restore-olja. Baseline előtt új build/
source/schema pin szükséges. Legacy checkpointban nincs automatikus default.
Rollback előtt stop és új pin kell: régi bináris nem írja a két tickpontot,
így vele nem folytatható tanúsított ablak. Evidence-t nem törlünk.

Korai natív próba a valódi World-slotgyűjteményt és a tényleges save-parsert
használja; terminal orphan avatar, két stage, köztes parse heademelkedés és
observer write/null-context hiba mellett változatlan player-save. Ez nem teljes
World.cycle vagy hosszú live run. A SQLite adapterpróbák valódi original
AgentState/clock/health authorityból dolgoznak, kontrollált census eseményekkel:
teljes offline ablak, frozen readonly reread, source/stage/session/identity/
pending/fault negatív ágak, pozitív sértés és scoped minimum FAIL. Saját séma,
shared user_version42, rollback és immutable history is ellenőrzött.
Pontos scope/eredmény/idő: [átadás](SOCIETY_DEVELOPMENT_HANDOFF.md).

Full regresszió nem indokolt saját additive observer/journal és közvetlen
metrics/minimum/restore fogyasztók módosításakor. Shared clock/economic/
persistence/global auth alap nem változott. Nincs live install/start, provider,
új baseline, hosszú run vagy történeti backup-olvasás.

Következő a lifecycle route/build manifest explicit pinje és a clock/world-policy
continuity adapter. Az eredeti8 integrity teljes bizonyítása és a teljes
boundary/custody/access és administrative/external producer source-universe
még kell. A2. csomag nyitott,6 maradt; a3. founder baseline és C08 nem indul.
