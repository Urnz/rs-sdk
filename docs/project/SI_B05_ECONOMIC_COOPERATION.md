# SI-B05 – Typed gazdasági együttműködés

2026-10-23: **kész**. Ág: `codex/si-b05-economic-cooperation`.
Következő: SI-B06; az nem indult el.

Határ: a meglévő supervisor/inbox/queue/decision ledgerben kezdeményezés,
elfogadás/elutasítás és munkaigény-ajánlat, strict szerveroldali granttal.
Partner a saját `agent.<id>` kapcsolatokból vagy címzett ajánlatból; a trust
személyes marad. Modell csak validált opció-ID-t választ. Elfogadáshoz külön
counterparty-döntés kell; nincs automatikus beleegyezés vagy employment.
Fedezet és teljesítés a meglévő contract/escrow/native receipt lifecycle-é.

Célzott ellenőrzés: új action/role/consent/revision/expiry/funds/risk, saját
receipt upgrade/reopen/rollback/future, provider uncertainty, application retry;
offer/settlement és érintett B03/B04/replan/terminal fogyasztók; érintett TS és
format. Saját additív tábla nem indokol teljes regressziót.

Vékony natív próba: eldobható fixture, kontrollált nulla költségű provider,
helyi packed engine. Saját kapcsolat → offer → külön acceptance → escrow →
reviewed skill → natív receipt → egyszeri settlement. Fali óra és a fixture
saját checkpoint/actor kötése; leaf 15 s, külső 30 s; nincs élő világ vagy
publication. Process ACK/sikeres journal önmagában nem natív szolgáltatás-proof.
Hiányzó/eltérő receipt stop, uncertainty megőrzése; limitet nem emelünk vakon.

## Implementált szerződés

`economic-cooperation-runtime.ts` az existing replan belépésben fut, saját
scheduler nélkül. Businessnél a B04 policyválasztás előtt, playernél a friss
avatar/context és a sürgős önellátás ellenőrzése után választhat együttműködést.
Ha nincs grant vagy nincs megengedett akció, az existing út folytatódik.
Az alapértelmezett `config/economic-cooperation.json` **üres grantlista**.
Élő actor engedélyezése vagy providerköltés nem része ennek a tasknak.

A strict v1 grant exact agent/role/subject és enrollment policy/version mellett
minimumTrust, GP/action, GP/day, item-unit és TTL limiteket tartalmaz. Legfeljebb
hat jóváhagyott reciprok templateből legfeljebb tizenkét konkrét opció épül.
Partner nincs grantben kiosztva: saját tartós kapcsolatok alapján kereshető.
`agent.<agentId>`, illetve egyértelműen feloldható meglévő agentId/playernév
actorKey használható; kétértelmű vagy ismeretlen kulcs nem partner.
A címzett ajánlat visszautasítható, elfogadáshoz megfelelő saját trust és
exact matching template is kell. Más actor kapcsolata, treasuryje, inventoryja
nem kerül a modell elé. Személyes trustot ez a folyamat nem ír globálisan.

Typed akciók: `propose-offer`, `propose-work`, `accept-offer`, `decline-offer`.
LLM mód `choose-economic-action`, tool `select_economic_action`, exact player
vagy institution role. A strict provider-séma kizárja a fizikai eszközt;
validator csak megadott optionId-t enged. Nem írhat új partnert, feltételt,
paramétert, célt vagy authorityt. Eseményszöveg külön untrusted adat.
A mock első opcióválasztása explicit fixture, nem valódi LLM-teljesítmény.

Mindkét actor saját döntést hoz. A proposal még nem contract vagy escrow;
elfogadás csak a címzettől, immutable ajánlatrevisionnel és határidővel mehet
az existing `acceptFundedEconomicOffer` útján. Az offer-origin mindkét party
identity/role/subject/avatar kötését rögzíti; más Businessre vagy új lifecycle-re
átkötött actor nem vállalhatja át csendben a pénzügyi kötelezettséget.
Egy munkaigény itt önkéntes work-offer, nem automatikus employment vagy
mások avatárját vezérlő player-request. Nincs új hitel/adó/forced-consent jogkör.

## Fedezet és valódi teljesítés

- Saját friss inventory vagy exact aktív Business treasury fedezete kell.
  A GP-t a már létező decision ledger napi/action kerete konzervatívan foglalja;
  a proposal nem von le tényleges vagyont. Acceptance a meglévő escrow/treasury
  lifecycle-on keresztül foglal. Coins nem kerülhet itemként a GP-limit mellé.
- Player↔player asset-trade a meglévő player-inventory escrow-n keresztül
  teljesül. Avatarless Business csak saját treasury GP-t ígérhet. Player-item
  intézménynek átadásához továbbra is a meglévő native commerce kell; a generikus
  player escrow jogosultsága nem bővült.
- A támogatott work/service feltétel gépi jelentése pontosan
  `service: "one-native-invocation"`, exact `skill: {id, version}` mellett.
  A kezdeti native proof adapter a gather/cook/consume lobster procedure-öké.
  Tetszőleges munkamennyiséget ígérő service-szöveg vagy más proof nélküli
  eljárás nem fogadható el. Egy gather nem jelent készételt vagy Businessbe
  szállított nyersanyagot: a vállalás egy natív meghívás eredménye.
- Elfogadott, még nem teljesített szolgáltatás B03 stratégiai opcióvá válik
  `contract-obligation` bindinggal, az existing verified Skill[]/grant/native
  preflight mellett. A reward idézett ellenérték; nem realizált bevétel.
  Az existing, explicit jóváhagyott current state objective továbbra is kell;
  az ajánlatelfogadás nem szintetizál új stratégiai cél-authorityt.
- A terminal és explicit evidence-port új, cooperation-originű contractnál
  külön ellenőrzi a kanonikus natív forrást. Exact run/parameters/skill/action,
  world/lifecycle/clock és eredményreceipt kell; időben acceptance után és a
  terminal előtt. Sikeres journal, ACK vagy korábban végzett más munka nem proof.
  Legacy kézi contractok evidence-szemantikája nem módosult.
- A valódi receipt után a meglévő settlement fizet; replay ugyanazt a
  settlement/escrow ID-t használja. Rejection/expiry nem teljesítés. Default
  kizárólag a meglévő resolution/escrow-reconciliation útján oldhat fel holdot.

## Perzisztencia és hibák

AgentState v28→v29: saját additív `agent_economic_action` tábla/index.
Prepared request és decision ledger egy tranzakció. Profile revision, grant,
actor binding, trigger, megadott opciók, model choice és application eredmény
összekötve; 60 s vagy hosszabb profile cooldown. Inference CAS claim egyszeri.
Bizonytalan terminal `inferring` marad és új esemény sem küldi el újra.

A contract DB a legelső új offernél saját v1 `economic_cooperation_schema` és
`economic_cooperation_origin` táblát kap. Offer és immutable origin egy
tranzakció; origin update/delete tiltott, stabil action/offer/contract ID-val.
Saját migráció/conflict/rollback nem változtatja meg a többi contract migrátort.
A meglévő `create` ID-paramétere explicit string-annotációt kapott, futási
viselkedése nem változott; az új idempotens port külön metódus.

`applying` outboxot új supervisor-ébresztés az eredeti ID-val folytatja; nem
gyárt új offert vagy foglalást. Fedezet-/port-hibánál a függő vállalás látható,
az existing backoff/quarantine kezelheti. Inference után grant, lease/owner,
stop, actor binding, partner, terms/revision/expiry, own trust és cover újra
ellenőrzött. Urgent self-care továbbra is megelőzi az új együttműködést.

Rollback: gateway/engine íróstop, előbb függő escrow/settlement reconciliation,
majd az upgrade előtti kód és együtt mentett agents/contracts/treasury/native
DB-k visszaállítása. `user_version` visszaírása, origin/decision törlése vagy
egyoldalú inventory-restore nem rollback. A vizsgálat csak eldobható fixture-öket
migrált, történeti vagy élő világ DB-jét nem nyitotta meg.

A vékony treasury-path helper változatlan függvényt emel ki, az eredeti export
megmarad. Emiatt az engine a natív próbához nem húzza be a teljes admin/catalog
függőségi fát. A már érintett skill-history és telemetry importok explicit `.js`
útvonalat kaptak a NodeNext fogyasztóhoz; közös buildkonfiguráció nem változott.

## Ellenőrzési index és korlát

- `20261023-210746-144-si-b05-first-action-boundary`: 0 PASS / 16 fixture FAIL,
  4,191 s. A régi actorKey nem enged `:` jelet; az új komponens a meglévő
  karakterkészletű `agent.` formátumot használja, közös validator nem lazult.
- `20261023-210813-488-si-b05-action-types`: 16 PASS, majd root TS FAIL,
  62,565 s. A UUID defaultból szűken inferált create-ID string-annotáció javítva.
- `20261023-211235-889-si-b05-native-first`: egy új natív fixture FAIL,
  16,890 s; hiányzó treasury-helper import. Wrapper a child hibát is idézi,
  ezért a summary két FAIL sora nem két külön natív eset.
- `20261023-211330-862-si-b05-native-consent`: az új natív eset és root TS
  PASS, engine TS FAIL, 118,028 s. Új fixture kompenzációs remove-API javítva;
  treasury-path import leválasztva, érintett legacy importok NodeNext-kompatibilisek.
- `20261023-211954-118-si-b05-consumers-native-types`: 20 PASS / 1 gateway
  fixture FAIL, 9,632 s. Hiányzó `inGame`/combat állapot pótolva. A változatlanul
  sikeres saját esetek nem futottak mind újra.
- `20261023-212201-424-si-b05-final-consumers`: **125 PASS**, root/engine TS
  és format PASS, 159,810 s. Három javított/szigorított saját eset, 121 közvetlen
  fogyasztó 13 fájlban, egy új SDK/packed native SI-B05 eset (19 korábbi native
  case nem ismétlődött). A korábbi sikeres saját esetek megmaradtak bizonyítéknak;
  a körök átfednek, számaik nem adhatók össze egy full-regresszióként.
- `20261023-212655-312-si-b05-origin-audit`: **PASS**, 0,689 s. Eldobható
  legacy contract DB→saját v1, reopen/exact replay, identity collision,
  immutable origin update/delete, offer+origin atomikus rollback, future séma.
- `20261023-212951-881-si-b05-docs-final`: **PASS**, 2,602 s; roadmap 20 kész /
  következő SI-B06, helyi Markdown-linkek, 18 literal + 2 factory native case
  és wrapper-leltár, staged fájlkör és formázás.

Teljes regresszió nem indokolt: saját additív receipt/origin, új role/action
validator és közvetlen contract/replan/terminal adapterek változtak. A közös
escrow, treasury commit, SimulationClock és natív pénzügyi tranzakciók alapja
változatlan; az érintett meglévő contract/settlement fogyasztók célzottan PASS.
Dokumentációzárás és push miatt a sikeres runtime/TS kör nem ismétlődik.

A mechanikai bizonyíték kontrollált provider és eldobható saját világforrás.
Nem élő autonóm gazdasági trajectory, nem SI-M1/SI-M2 vagy SI-B06 verdict.
Nincs providerköltés, új publication, élő world-indítás vagy teljes regresszió.
