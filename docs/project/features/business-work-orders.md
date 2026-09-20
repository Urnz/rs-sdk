# Business shifts and work orders

A `config/business-work-policies.json` egy Business pontos szerepét, verified
skilljét, Propertyjét, facility-capabilityjét, minimális és maximális műszakidejét,
valamint a `verified-completion` bérfeltételt kapcsolja össze.

A work order csak aktív, pontos role-definitionnel rendelkező munkaviszonyhoz
hozható létre. Pillanatképként megőrzi a dolgozót, szerepet, skillverziót, a
munkaviszony bérét, a műszakablakot és a szükséges helyhasználati jogosultságot.
A Business Property és facility entitlementjének a teljes műszak alatt érvényesnek
kell lennie.

A lifecycle:

1. `scheduled`: még nem végezhető és bér sem jár érte;
2. `running`: kizárólag a műszakablakon belül indítható;
3. `completed`: csak megbízható adapterrel hitelesített, pontos worker-, Business-,
   work-order- és skillbizonyíték után, valós és korlátos munkaidővel;
4. a bér ekkor `earned`, de még nem `paid`;
5. `paid` csak külön, hiteles intézményi treasury/player-reward settlement
   azonosító rögzítése után lehet.

Így az LLM vagy institution agent kiadhat magas szintű work ordert, de nem
állíthatja önmagában sem a fizikai munkát, sem a pénzmozgást teljesítettnek.

## Migráció és visszaállítás

A migráció additív: két új tábla (`business_facility_entitlement` és
`business_work_order`) jön létre. Meglévő munkaviszonyt, Propertyt, work queue-t
vagy treasury-adatot nem ír át, és nem készít automatikus műszakot.

Visszaállításkor a régi kód figyelmen kívül hagyhatja az új táblákat. Azokat audit-
és bérbizonyítékként meg kell őrizni. Running ordert visszaállítás előtt le kell
zárni vagy explicit megszakítani; completed/paid történetet törölni vagy kézzel
visszaminősíteni tilos.
