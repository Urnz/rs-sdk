# SI-C02 – Natív bronzcsákány-használat

2026-10-24, **kész / mechanikai PASS**. Ág: `codex/si-c02-native-mining-tool`;
kiinduló commit `9e1433607`.

Hipotézis: a meglévő `bronze-pickaxe-mining` cycle egy igazolt instance-hoz
kötött, tényleges copper/tin `get_ore_normal → INV_ADD` output után egyszer
könyvel kopást. Animation/failed roll nem use-proof. Broken tool nem indulhat
új munkára; transfer és reopen ugyanazt a durabilityt és provenance-t tartja.

Határ: explicit instance-opening egyetlen natív bronze1265 tárgyra; sidecar
custody a Player-checkpoint DB-ben. Native slotmozgatás és valódi trade követi
az instance-t. Ismeretlen/ambiguus mozgatás quarantine/reconciliation, nem új
instance vagy automatikus teljes durability. ItemLifecycleStore ugyanaz a motor,
borrowed DB módban a natív output/wear/checkpoint közös SQLite-tranzakciójával.
Így nincs külön commitolt output utáni elveszíthető pending-wear ablak.

Próba: saját disposable fixture-clock/world/lifecycle, packed Mining script,
actual Player/inventory/checkpoint és változatlan100 durability/1 wear policy.
Egy csákány100 sikeres munkája → broken →101. tiltva; explicit trade, reopen,
source/clock/ownership drift, output-write rollback és halott actor tiltása.
Native child limit60 s, wrapper90 s; nincs provider/költség, live enrollment,
worldindítás vagy történeti backup módosítás. Első assertionhiba/deadline esetén
STOP és szűk diagnosztika. Nem gazdasági/MVS vagy többnapos trajectory-minősítés.

Ellenőrzés: ItemLifecycleStore/cycle saját upgrade/borrow/reopen/rollback,
natív Mining + inventory/trade fogyasztók, SI-C01 XP checkpoint regressziós határ,
root/engine TS, changed-line format. Full nem automatikus: a közös save formátuma
és a MarketStore tranzakcióalapja változatlan; saját additív komponenshatár készül.

Migráció: nincs automatikus instance-generálás régi stackből. Explicit opening
existing lifecycle instance + natív tárgy/owner/source bizonyíték alapján.
A borrowed séma saját versiontáblát használ, nem a közös DB user_version-jét.
Régi standalone lifecycle DB marad olvasható/írható a régi constructorral;
live authority átköltöztetése külön offline, auditált művelet, itt nem fut.
Rollback: runtime leállítása és kód-visszavonás; a saját táblák auditnak maradnak.
Az instance és a hozzá tartozó Player checkpoint csak együtt állítható vissza.

## Megvalósult működés

- Az `ItemLifecycleStore` új borrowed-DB módja a meglévő lifecycle motort
  futtatja a kanonikus Player-checkpoint adatbázisában. Saját
  `item_lifecycle_schema` verzió3; a közös `user_version`, connection PRAGMA-k
  és close ownership változatlan. A régi string-path constructor migrációja,
  repair/replacement és auditja megmaradt. Tulajdonátadás auditált művelet,
  durability, quality és provenance változtatása nélkül, broken állapotban is.
- `NativeToolStore`: instance-ID/actor/avatar/world/lifecycle/clock/policy és
  native inventory/slot kötés; append-only native eventek. Az opening meglévő,
  azonos actorú lifecycle instance-t és egyetlen unnoted1265 fizikai tárgyat
  igényel. `bindNativeMiningTool` backend-only API, nem LLM-feltöltés vagy
  automatikus inventory-scanből keletkező új csákány. Árva/dupla instance hiba.
- Player-load a pontos kanonikus checkpointból hidratálja a fizikai token
  referenciáját. A natív `INV_MOVEFROMSLOT`, `INV_MOVETOSLOT`, `INV_MOVEITEM`
  megőrzi azt a saját inventory/equipment/bank/tradeoffer között. Ismeretlen
  replacement/loss, duplicate, note vagy más nem tanúsított változás a következő
  checkpointban **quarantined**; se új ID, se100 durability nem keletkezik.
  Ez egy szándékosan szűk exact-instance bridge, nem minden stackitem újraformázása.
- A `ScriptRunner` a Mining-belépő előtt ellenőrzi az owner/lifecycle/clock,
  audit, fizikai token, elérhető inventory/equipment, exact policy és usable
  állapotot. A támogatott termelés a normál copper/tin forrás. Más Mining-
  belépő (fast/essence/gem/macro) nem kerülheti meg a kötött csákány kapuját;
  nem támogatott cycle vagy másik választható pickaxe explicit hiba.
  A populationon kívüli, nem kötött régi avatar vanilla marad.
- A packed `get_ore_normal → INV_ADD` csak1 tényleges436/438 érc után könyvel
  egy use-t a meglévő `bronze-pickaxe-mining` service-szel. Failed roll, gem
  side-roll és animation nem ennek a cycle-nak a termelése. Egy UUID a pontos
  instance/revision/source/clock és actual checkpoint digesthez kötődik.
  Suspended munka közben lecserélt/revíziót váltott tool nem terhelhető utólag.
- Érc, wear, audit, native receipt és Player-checkpoint **egy SQLite commit**.
  Write-failure mindet visszagörgeti; replay, még a breakage után is, nem ad
  új itemet/XP-t/use-t. Így nincs elvesző cross-DB pending wear, és nincs új
  durability-motor vagy második készletauthority. Checkpoint másik DB-ből
  nem igazolhatja a toolt. A meglévő XP-checkpoint határ változatlanul tesztelt.
- A valódi két `BOTH_MOVEINV` után a tényleges `TradeEvidenceStore` eseménye
  igazolja az exact instance átadását. Mindkét Player és a lifecycle owner
  közös checkpoint-tranzakcióban változik. Az eredeti provenance digest és a
  tartósság megmarad; source/revision/clock-eltérés és event-ID konfliktus hiba.
  A belső művelet-ID fix hosszú digest, így a megengedett128 karakteres
  instance-ID átadása is működik, nem hagy utólagos ID-length sourcegapet.
  A külön trade ledger továbbra sem distributed ACID: ledger utáni checkpoint-
  hiba sourcegapet hagyhat. Ilyenkor nincs native transfer-proof/ownership reset;
  a régi custody quarantine és explicit reconciliation, nem kitalált új tool.
- Halott/resetelt actor nem dolgozhat/adhatja át a toolt. Eltűnt fizikai tárgy
  mellett is megmarad a lifecycle/custody és az audit; nincs automatikus örökös
  vagy új instance. A repair/replacement és az újrahasználat SI-C03 munkája.
- Readonly tool context a kanonikus forrásból: aktuális instance, durability,
  usable/broken/quarantined státusz és lifecycle service-capacity; exact
  actor/lifecycle/clock/world és policy ellenőrzéssel. Hiányzó/stale forrás
  unavailable, nem feltételezett új/használható csákány. Reachability és a
  tényleges kézben/inventoryban levés külön engine-előfeltétel marad.

## Natív próba és ellenőrzési index

[Géppel olvasható eredmény](SI_C02_NATIVE_RESULT.json): **100 packed Mining
output,100 külön natív action-ID,100 tényleges bankolt rézérc; durability100→0,
status broken; következő copper- és iron-Mining tiltva.** Actual Player-load,
checkpoint digest és helyes lifecycle-audit. Változatlan100/1 policy; nem rövidre
vágott tesztcsákány. A forrásmanifest15 LF-normalizált fájl és48 packed asset
hashét tartalmazza. A fixture DB-k a próba végén törlődnek.

- `20261024-130836-796-si-c02-native-custody-fixed`: **31 PASS**,20 lifecycle/
  cycle/repair/borrow és10 natív eset + wrapper,2,907 s.
- `20261024-131219-378-si-c02-consumer-gate`: **46 PASS /0 FAIL**, benne13
  Mining,11 lineage,13 SI-C01 XP natív eset és közvetlen admin-context fogyasztó;
  root/engine TS és format PASS,107,489 s.
- `20261024-131518-824-si-c02-final-mining-gate`: a további Mining-belépő guard
  pontosítása után **13 natív eset + wrapper PASS**, engine TS/format PASS,
  **38,409 s**. A változatlan root/lineage/XP köröket nem ismételtük.
- `20261024-132454-140-si-c02-final-instance-id`: a teljes128 karakteres
  instance-ID native trade esetével is **13 natív +wrapper PASS**,
  engine TS/format PASS, **48,883 s**. Ez a végső source-hoz kötött natív eredmény;
  a root/lineage/XP körök bemenetei ettől nem változtak.
- Diagnosztikák megőrizve: `20261024-130157-490-si-c02-lifecycle-boundary`
  20 PASS/1,054 s; `130316-237-si-c02-first-native` FAIL/1,904 s (guard a még
  nem létező opcode-operand helyett közvetlen primary Player-pointert igényel),
  majd `130359-743-si-c02-native-entry-fix` PASS/1,905 s. A
  `130629-857-si-c02-native-custody` FAIL/2,458 s két hibás `InvType.BANK`
  fixture-referenciával; tényleges `getId('bank')` feloldásra javítva.
  Assertions/policy/határidő nem lett gyengítve.

Az auto-review egy közös SQLite constraint patch-et elutasított; a végső,
eredeti constructorral összevetett megoldás csak a saját, újonnan nyitott
kapcsolaton végzi a régi PRAGMA-beállítást. A borrowed kapcsolat beállítását
nem módosítja. Nincs fennmaradó engedélykérés vagy blokkolt módosítás.

A körök átfednek, PASS-szám/idő nem összeadandó. **Teljes regresszió nem futott**:
a komponens saját additive séma és guard változott, a közös save-format,
MarketStore/transaction API és non-enrolled utak változatlanok. Célzott upgrade,
borrow/reopen, rollback, trade, XP és context fogyasztók fedik az új határt.
API-költség0; nincs live world indítás, tool-enrollment vagy skillpublication.
Ez mechanikai kapu, nem autonóm procurement/repair vagy MVS/önfenntartási PASS.

**SI-C02 kész;23/45, következő SI-C03, új kérésre.**
