# Rövid fejlesztési átadás

Frissítve: 2026-10-24. Belépő, nem futási napló.
A checkboxok forrása: [feladatlista](TASKS_SOCIETY_INTEGRATION.md).

## Aktuális állapot és következő lépés

- **SI-A technikailag lezárva; SI-B01–SI-B06 és SI-C01–C02 kész. SI-M2 v2 PASS.
  Következő: SI-C03, összesen23/45 kész. Új kérés nélkül ne kezdd el.**
  Következő konkrét határ: egy native input/idő/facility/worker-skillhez kötött
  repair vagy replacement, majd ugyanazzal az igazolt instance-szal új munka.
- [SI-C02 működés, korlátok, migráció és teljes ellenőrzési index](SI_C02_NATIVE_MINING_TOOL.md),
  [100 natív munka és source/packed hashek](SI_C02_NATIVE_RESULT.json).
  Ág: `codex/si-c02-native-mining-tool`, kiinduló commit `9e1433607`.
- ItemLifecycleStore borrowed DB mód: ugyanaz a lifecycle motor a kanonikus
  Player-checkpoint DB-ben. Saját schema marker3, shared user_version és
  connection PRAGMA/close ownership változatlan. A string-path constructor
  továbbra is a standalone DB-é; a canonical checkpointot csak borrowed módban
  szabad megnyitni. Régi authority live átköltöztetése nem történt.
- Explicit backend `bindNativeMiningTool`: már létező, owner/provenance-kötött
  instance + egyetlen unnoted1265 fizikai tool. Nincs automatikus stack→új
  durability vagy LLM által feltöltött receipt. Player-load pontos checkpointból
  hidratál; witnessed native inventory/equipment/bank/offer move és BOTH_MOVEINV
  ugyanazt az ID-t/kopást/provenance-t viszi. Ismeretlen/dupla/note/lost tool
  quarantined és explicit reconciliation; nincs automatikus friss instance.
- Packed Mining → actual copper/tin INV_ADD → existing cycle.use → Player save
  és immutable native event egy SQLite commit. Failed roll/gem/animation nem
  cycle-use. Broken/replaced, foreign lifecycle/clock, policy drift, másik
  pickaxe és nem támogatott Mining source nem kerülheti meg a guardot.
  Suspended munka exact tool/revisionhoz kötött; replay breakage után sem ad
  új outputot/XP-t/use-t. Nincs elvesző cross-DB pending-wear ablak.
- Native trade a tényleges TradeEvidenceStore után, azonos checkpointtal
  változtat ownert. Külön trade-ledger hiba/sourcegap továbbra sem distributed
  ACID: sikertelen local commit nem igazol native transfer-proofot; custody
  quarantine, nem reset. Halott actor nem dolgozik/ad át, az instance auditja
  és régi custodyja megmarad; nincs automatikus örökös vagy új item.
- Readonly tool context a canonical source-ból, actor/lifecycle/clock/world/
  policy ellenőrzéssel. Durability/service-capacity nem reachability:
  az engine külön ellenőrzi, hogy a tool tényleg inventory/equipmentben van.
- Normál100 durability /1 wear:100 packed Mining-output,100 külön action-ID,
 100 bankolt actual rézérc, broken0 és következő copper/iron munka tiltva.
  Ez mechanikai kapu, nem SI-M3/MVS vagy önfenntartás; repair/replacement SI-C03.
- Fájlok: `item-lifecycle/store.ts`/`native-tool.ts`, engine `NativeMiningTool.ts`,
  `ScriptRunner.ts`/`ScriptState.ts`/`InvOps.ts`, Player/PlayerLoading/World
  checkpoint adapter; admin `agent-state.ts` readonly context. Új gate:
  gateway `native-mining-tool.test.ts`,13 natív eset.
- [SI-C01 exact attribute/XP és migráció](SI_C01_NATIVE_ATTRIBUTE_XP.md) megmaradt:
  population creation immutable profile; régi hiány explicit import; négy
  skill XP calibration→diminishing→potential→rate→cap, actual checkpoint receipt.
  AgentState továbbra is v29. Nincs live profile/tool import vagy worldindítás.
- Nincs providerhívás/költség, enrollment vagy publication. Korábbi admincím
  `http://127.0.0.1:7781/admin/`; API-kulcs a Helyi szerver/local-default aktív
  repo Windows titoktárában. Új runtime-indítás előtt állapotellenőrzés kell.
- B06 korábbi engedély csak0,05 USD-s próbára szólt;11 kérés /4235 microUSD
  =0,004235 USD, uncertain0. Normál per-call0, auto-replanning/autonomousExecution
  off; B04/B05 default grant üres. Nincs általános költési engedély.
  [B06 külön FAIL és v2 PASS](SI_B06_STRATEGIC_ACCEPTANCE.md).

## Legfrissebb ellenőrzés

- **Teljes regresszió nem futott.** Saját additive lifecycle/identity/event
  táblák és konkrét Mining/inventory/trade/checkpoint adapter. A shared save
  formátum és MarketStore transaction API változatlan, közvetlen fogyasztók
  célzottan lefedve. Taskzárás/push nem indít új runtime tesztet.
- `20261024-130836-796-si-c02-native-custody-fixed`:31 PASS, benne20 lifecycle/
  cycle/repair/borrow és10 natív +wrapper,2,907 s.
- `20261024-131219-378-si-c02-consumer-gate`:46 PASS /0 FAIL; benne13 Mining,
 11 lineage és13 SI-C01 XP natív eset, admin-context; root/engine TS/format PASS,
 107,489 s.
- `20261024-131518-824-si-c02-final-mining-gate`: további Mining-belépő guard
  javítása után13 natív +wrapper PASS, engine TS/format PASS,38,409 s.
  Változatlan root/lineage/XP körök nem ismétlődtek.
- `20261024-132454-140-si-c02-final-instance-id`:128 karakteres valid instance-ID
  native trade esetével is13 natív +wrapper PASS, engine TS/format PASS,48,883 s.
  Ez a végső source-bound natív eredmény; a root fogyasztókat ez nem módosította.
- Első entry-pointer és hibás BANK-fixture FAIL-ok megmaradtak, későbbi szűk
  PASS-szal javítva. SQLite auto-review patch elutasítás után az eredeti owned
  constructor szerződését megőrző változat készült; nincs fennmaradó blokkolás.
  Pontos log/result index a C02 dokumentumban, `.local/verification/` alatt.
  A körök átfednek; PASS-számok/idők nem összeadandók.

## Megőrzendő döntések és mentések

- SI-A15 v2 technikai elfogadás kész; eredeti D1/SI-M1 önfenntartási PASS nincs,
  teljes gazdasági minősítés `inconclusive`. SI-M2 korlátos stratégiai kapu most PASS, nem önfenntartási minősítés.
  Kontrollált mechanikai és autonóm trajectory bizonyíték nem azonos.
- Éhség/önálló ételkeresés egy nap után, éhhalál hét nap teljes hiány után;
  normál adag egy napot pótol. Live nap/óra, teszt nap/öt perc. SI-C09 nyitott
  realizmuskalibráció; a világot nem igazítottuk a karakterek túléléséhez.
- Csak helyi/private emulator. Korábbi publication-engedély csak a konkrét
  food/travel verziókra szólt, nem új publikálásra. Az SI-B06 jelenlegi, szűk providerkerete fent külön szerepel.
- [SI-A15 technikai eredmény](SI_A15_TECHNICAL_RESULT.md),
  [archívum/restore](SI_A15_RESULT_ARCHIVE.md).
  World: `backups/si-a15-technical-20261022-1648/workspace`;
  result: `backups/si-a15-technical-result-20261022-1715/workspace`;
  restore: `backups/si-a15-technical-restored-20261022-1726/workspace`.
  A korábbi záráskor a runtime-ok leálltak. Új indítás előtt aktuális
  állapotellenőrzés kell; immutable result payload DB-it ne nyisd meg.

```powershell
pwsh -NoProfile -File scripts/get-society-work-brief.ps1
```

A folytonosságot ezek a fájlok és a repo-local society skill adják, nem a chatmemória.
