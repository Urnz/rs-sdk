# Konfiguráció

Csak verziókezelhető minták és nem titkos alapértékek kerüljenek ide. A tényleges
jelszavak, API-kulcsok, tokenek és lokális botadatok nem commitolhatók.

- `world-mods.json`: a modok manifestje és szerkeszthető alapbeállításai.
- `properties.json`: a verziózott ingatlankatalógus; tulajdonosi állapot soha nem
  kerül ebbe a fájlba.
- `attribute-budget-policies.json`: a nem játékos karakterek seedelt, korlátozott
  induló adottság-pontkeretének verziózott és titokmentes eloszlása.
- `attribute-allocation-policies.json`: a pontkeretet generalista, specialista és
  nem optimalizált karakterprofilokra osztó seedelt policy.
- `human-attribute-creation-policies.json`: a játékos által kiosztható normál és
  az NPC-kkel azonos genetikai lottót használó hardcore karakteralkotási módok.
- `skill-potential-policies.json`: skillenkénti attribute-súlyok, valamint a
  tanulási szorzó és személyes potenciál korlátai; titkot nem tartalmaz.
- `skill-cap-policies.json`: klasszikus, attribute-függő kemény és puha, valamint
  facility-központú személyes skillplafon-policyk.
- `skill-introduction-gate-policies.json`: az új személyes skillekhez megkövetelt
  független hiánybizonyíték és kísérleti bizonyíték szabályai.
- `needs-policies.json`: a karakter szükségleteinek verziózott, bővíthető
  definíciói; elsőként a hunger és fatigue skálája és kritikus küszöbe.
- `needs-dynamics-policies.json`: a szükségletek SimulationClock-alapú online,
  offline, ébrenléti és alvási óránkénti változásai.
- `housing-tier-policies.json`: a lakhatási biztonság és komfort verziózott
  hierarchiája az utcától a megerősített ingatlanig.
- `housing-effect-policies.json`: a lakhatási szintek fatigue-regenerációs,
  privát storage- és lopásvédelmi hatásai.
- `housing-units.json`: felhasználó által szerkeszthető housing modul. Meglévő
  `propertyId`-khez rendel lakóegységet, ágyakat, kapacitást és bérleti feltételeket;
  az `enabled` mezővel kódmódosítás nélkül kapcsolható. Új épület előbb a
  `properties.json` katalógusba, majd ide vehető fel.
- `housing-furnishings.json`: az engedélyezett bútorfajták capabilityit és a
  meglévő Propertyk szobánkénti elhelyezési slotjait adja meg. Új ház vagy
  bútor kódmódosítás nélkül, érvényes Property-hivatkozással vehető fel.
- `land-construction.json`: alapból letiltott, verziózott előkészítő katalógus a
  későbbi megvásárolható földparcellákhoz és építési terv/stage definíciókhoz.
  Nem hoz létre épületet és nem módosítja a világot.
- `food-loops.json`: a nyersanyagforrást, Cooking átalakítást, kész ételt és
  hunger-csökkentést egyetlen verziózott, bizonyíték-alapú láncba köti.
- `item-lifecycle.json`: a példányszintű tárgyak maximális tartósságát,
  használatonkénti kopását és javíthatóságát definiálja.
- `item-state-policies.json`: konkrét item ID-nként választ a példányszintű,
  stack- és batch-kezelés között; ismeretlen tárgyhoz nincs implicit fallback.
- `batch-expiry-policies.json`: alapból csak `prepared` állapotú, szimulációs
  időre épülő szerződés a romlandó gyártási tételek eltarthatóságához és
  capabilityhez kötött tárolási minőségéhez; önmagában nem aktivál romlást.
- `loop-metric-policies.json`: a zárt food- és tool-loopok készletminimumait és
  hiányszámítását köti a verziózott chain-, illetve production-cycle azonosítókhoz.
- `economic-npc-migrations.json`: csak tervezési állapotú, verziózott migrációs
  katalógus a statikus gazdasági NPC-szolgáltatások Business-, Property-, agent-,
  inventory- és treasury-alapú kiváltásához; önmagában nem kapcsol át élő shopot.
- `shop-genesis-bootstraps.json`: genesis-only, adatvezérelt shop-nyitókészlet és
  Business-nyitótőke; csak egyszer használható world-genesis allokációkat fordít,
  futás közbeni restock vagy közvetlen tárgy-/pénzjuttatás nincs benne.
- `actor-identity-boundary.json`: az ambient világentitások tartós actorrá
  emelésének fail-closed policyja; vizuális NPC/állat/mob típus önmagában nem
  jogosít agent-identitásra, csak domainadapterrel igazolt perzisztens állapot.
- `business-role-definitions.json`: stabil Business-szerepek, pontosan verziózott
  verified skill-korlátok, domainenkénti készlet-/storage-/treasury-/ár-/szerződés-
  jogosultságok és felvételi/delegálási policy. Draft skillre hivatkozva a gateway
  fail-closed módon nem indul el.
- `business-stock-policies.json`: Business- és item-specifikus véges készletminimum,
  cél- és maximumkészlet, beszerzési árplafon, eladási ár/reserve és settlement-
  korlát. Fizikai teljesítéshez csak pontos, review-zott verified skill engedhető.
- `business-work-policies.json`: szerephez és verified skillhez kötött műszak- és
  work-order korlátok, szükséges Property/facility entitlement és kizárólag
  hiteles teljesítés után kiérdemelhető bér feltétele.
- `production-workflows.json`: pontosan verziózott, adatvezérelt receptek és
  függőségi gráfok item-inputtal/-outputtal, idővel, személyes skill-, facility-,
  tool-, tudás- és entitlement-követelménnyel; önmagában nem mozgat készletet.
- `facility-capabilities.json`: Propertyhez és opcionálisan exact Businesshez
  kötött termelési, tárolási és más facility-képességek, kapacitással és az
  elfogadható employment/lease/contract/explicit hozzáférési jogcímekkel.
- `production-capital.json`: item-lifecyclehoz és telepítési facility-
  capabilityhez kötött termelőtőke; mechanikai throughput-, minőség-, hibaarány-,
  kapacitás- és capability-hatást, batchenkénti kopást és javítási policyt ad.
- `logistics.json`: Property/storage végpontok közötti verziózott útvonalak és
  gyalogos vagy járműves szállítási módok kapacitással, sebességgel, költséggel
  és a járműhöz szükséges facility-capabilityvel.
- `production-tool-cycles.json`: a termelőeszköz-életciklusok engedélyezett skilljét
  és kimeneti itemjeit köti verziózott konfigurációhoz.
- `item-repair-policies.json`: tárgytípusonként rögzíti a javításhoz elfogyasztandó
  anyagot, minimális időt, személyes kompetenciát és facility-capabilityt.
- `llm-runtime.json`: titokmentes provider-, modell- és biztonsági limitminta;
  alapértelmezetten kikapcsolt mock providerrel. API-kulcs soha nem kerül ide.
- `llm-runtime.openai.example.json`: másolható Responses API minta. A tényleges
  kulcsot `OPENAI_API_KEY` környezeti változóként kell átadni a gatewaynek.

Az adminpanel „AI beállítások” füle szerverenkénti helyi override-ot ír a
`.local/admin/llm-runtime.json` fájlba. Ez elsőbbséget élvez a verziózott
alapbeállítással szemben. Az adminpanelen megadott OpenAI-kulcs ettől elkülönítve,
a `.local/admin/secrets/openai-api-key.txt` fájlban marad, és az API csak azt
jelzi vissza, hogy van-e beállított kulcs; magát a titkot soha nem adja vissza.

Az opcionális `skillBuilder` blokk alapból ki van kapcsolva. Engedélyezve csak az
OpenAI providerrel működik: a gateway konfigurált időközönként legfeljebb egy
deduplikált gapet dolgoz fel, kizárólag deklaratív draftot ment, és per-gap valamint
napi költséglimitet is betart.

