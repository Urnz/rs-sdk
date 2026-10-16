# Auditált orgazdai settlement-kérés visszaolvasása

A `FencingSettlementCoordinator.getRecordedRequest(settlementId)` a már
eltárolt teljes kérés leválasztott, mélyen fagyasztott másolatát adja vissza,
vagy hiányzó azonosítónál `null` értéket. Az auditellenőrzés és az olvasás egy
SQLite olvasási tranzakcióban történik. A kanonikus requesthash, az auditban
szereplő request-digest és a sor settlement/candidate/opportunity/trade-receipt
azonosítói egyezni kell. Sérült JSON vagy eltérő metadata esetén hibával zár.

A kérés tartalmazza a pontos asset-, seller-, buyer-, item-, quantity-, GP-,
revision- és forrásdigest-kötéseket; ezeket a mai metadata-only `get()` nem
adta vissza. `settling` és `committed` állapotban is történeti kérés, nem
gazdasági teljesítésigazolás. Az olvasás nem hívja újra az aktuális döntési
policyt, trade-verifiert vagy a készlet/pénz/provenance portokat. Későbbi
szereplő- vagy policyváltozás nem írja át a történeti kérést.

## Bevétel és jogosultság

Az API nem bizonyítja, hogy az eladó megkapta a GP-t. A saga `committed`
jelzése, az eltárolt `coinsPaid` állítás és egy Business treasury-debit még
nem független, tartós engine fizetési receipt. Hiteles payment-forrás hiányában
nem számolunk belőle gross proceeds-t, nettó profitot vagy sértetti kárt.

A későbbi exact kötés: Thieving receipt/digest → stolen provenance event →
azonos asset custody trade-eseménye → a rögzített request pontos trade-kötése
→ külön hiteles fizetési bizonylat. Egyik lépést sem helyettesíti szabad szöveg
vagy egy általános „committed” flag.

Belső olvasó, nincs új admin/HTTP/LLM route, és nincs automatikus orgazda-
lookup. A kimenet szereplő- és tranzakcióadatokat tartalmaz; hozzáférését a
hívónak külön jogosítania kell, publikus naplóba/Gitbe nem írható.

## Migráció és visszaállítás

Nem változik a perzisztens séma, a meglévő request JSON kerül visszaolvasásra.
Nincs visszamenőleges hitelesítés vagy audit-újraszámítás. A szigorúbb ellenőrzés
korábban rejtett integritáseltérést jelezhet; ezt forrásadatból kell egyeztetni,
nem auditot regenerálni. Kód-visszaállítás adatírás nélkül lehetséges, de a
metadata/audit request-digest eltéréseinek felismerése akkor ismét gyengülne.

## Ellenőrzés (2026-09-26)

- Célzott settlement tesztek: 16 sikeres / 0 hibás, 58 assertion.
  Lefedett a restart, történeti policy, mély immutability, hibás JSON,
  metadata- és auditeltérés, valamint az újrahash-elt request auditkötése.
- Teljes `bun test`, Bun 1.3.14 közvetlen Windows executable:
  1413 sikeres / 0 hibás, 6660 assertion, 257 fájl, 86,95 másodperc.
- Root, engine és webclient TypeScript ellenőrzés: exit 0.
