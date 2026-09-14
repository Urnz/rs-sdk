# Bankok és hitelek – távlati vázlat

A gazdasági bank nem azonos a RuneScape tárgytároló bankjával.

Tervezett fogalmak:

- pénzbetét és kamat;
- hitel, futamidő és törlesztési ütemezés;
- fedezet, késedelem, nemteljesítés és lefoglalás;
- tartalékok és likviditás;
- változtathatatlan/auditálható főkönyv;
- vállalkozás- és ingatlanfinanszírozás.

Az MVP szereplőköre explicit institution-only: a betétes és hitelfelvevő
`business` vagy `faction`, a bank pedig business treasury. Első végrehajtható use
case: egy műhellyel rendelkező vállalkozás forgótőkehitelt vesz fel, a műhelyt
fedezetként leköti, termel, majd törleszt; nemteljesítéskor a bank a Property
domain receiptje alapján megszerzi a fedezetet. Player-betét és a részben
player-pénzből finanszírozott közvetlen műhelyvásárlás külön engine escrow/reward
integrációt igényel, ezért nem része ennek az MVP-nek.

## Institution settlement kapu

A Phase 13 első szelete nem hoz létre még betéti vagy hitelszerződést. A már
meglévő, atomi institution→institution treasury-átvezetést köti hiteles domain-
eseményhez a `server/gateway/admin/institution-settlement-orchestrator.ts` rétegben.

A banki és a későbbi adózási domain külön esemény-allowlistet kap. A caller nem
adhat át kézi `verified: true` jelzőt: egy szűk `InstitutionSettlementEvidenceVerifier`
portnak kell az exact event ID-t, SHA-256 digestet és hitelesítési időt
visszaadnia. Az orchestrátor csak ezután ír `settling` rekordot, ellenőrzi az
exact payer/payee/összeg/foglalás kötést, majd meghívja a treasury primitívet.
Siker után a rekord `committed`. A treasury transfer és az orchestrátor rekordja
egyaránt idempotens, ezért a treasury commit utáni folyamatmegszakítás ugyanazzal
a settlement ID-val biztonságosan újrapróbálható. Eltérő request, megváltozott
evidence, cross-domain eseménytípus vagy nem illeszkedő foglalás fail-closed.

Az allowlist most a banki betét-, kivét-, kamat-, hitel-, törlesztés- és
fedezet-realizációs eseményeket, valamint a 15. fázis számára az adókötelezettség,
adó-visszatérítés és támogatás eseményeit foglalja le. Ez csak végrehajtási port:
önmagában egyik eseményt sem állítja elő, és nem fogad HTTP bodyt vagy LLM-kimenetet
hiteles bizonyítékként.

A tényleges banking caller a `BankingSettlementService`: előbb a tartós
`banking_verified_event` store-ban ellenőrizteti és változtathatatlanul rögzíti a
domaineseményt, majd kizárólag ezt a store-t adja verifierként az orchestrátornak.
HTTP/LLM input nem adhat közvetlen verifier implementációt. Megváltozott forrás-
digest exact replay esetén is fail-closed.

Az event-store additív migrációja a `banking_verified_event` tábla létrehozása.
Rollbackkor a settlement callert előbb le kell állítani; a verified eventeket
auditadatként meg kell őrizni, és a tábla csak mentés után távolítható el.

### Migráció és visszaállítás

Az első megnyitás additív, idempotens `CREATE TABLE IF NOT EXISTS` migrációval
hozza létre az `institution_domain_settlement` táblát a meglévő economy SQLite
adatbázisban. A treasury táblák sémája és korábbi rekordjai nem változnak.

Rollback előtt le kell állítani a banki/adózási settlement callereket és menteni
az economy adatbázist. A kódréteg visszaállítható az előző verzióra; a plusz táblát
auditmegőrzés miatt alapértelmezetten érintetlenül kell hagyni. Ha teljes séma-
rollback szükséges, kizárólag mentés után törölhető az
`institution_domain_settlement` tábla. Már commitolt treasury-átvezetést a
sémarollback nem fordít vissza; azt külön, új és auditált kompenzáló tranzakcióval
lehet rendezni.

Az institution settlement saját `institution_settlement_schema` v1 jelzőt használ,
mert ugyanazt az SQLite fájlt más gazdasági store-ok is megoszthatják. A banking és
taxation settlement sorok nullable, monoton közös-szimulációs bélyeget kapnak az
immutable settlement payload digestjéből. A `settling → committed` átmenet nem
oszt új sorrendet; retry és crash-recovery ugyanazt a bélyeget tartja meg. Legacy
sorok `(createdAt,settlementId)` sorrendben tölthetők vissza az eredeti idő és a
treasury-transzfer módosítása nélkül. Rollbackkor az új oszlopok helyben maradhatnak;
a már commitolt treasury-mozgást továbbra is csak forward reconciliation vagy új,
auditált kompenzáló settlement rendezheti.

## Betéti főkönyv és tartalék

A `banking-ledger.ts` tartós bankdefiníciót és institution-betéti számlát ad.
A bank business treasuryhez kötött; a reserve ratio és az éves betéti kamat
bázispontban tárolódik. A tartalékpozíció a hiteles treasury cash és az összes
betéti kötelezettség alapján ad required/excess értéket és compliance jelzőt.

Betét, kivét és kamat kizárólag az előző fejezet orchestrátorának `committed`
banking receiptjéből könyvelhető. A feleknek exact módon illeszkedniük kell a bank
treasuryjéhez és a számlatulajdonoshoz. Minden tranzakció egyenlő összegű debit és
credit számlapárt ír; a journal settlement/event azonosítói egyediek, az exact
replay idempotens, az eltérő replay és az overdraft elutasított.

Az additív, külön `banking_ledger_schema` v1 migráció az `economic_bank`, `bank_deposit_account` és `bank_journal`
táblákat `CREATE TABLE IF NOT EXISTS` módon hozza létre, majd nullable közös-szimulációs
bélyeget és óránként egyedi eseménysorrendet ad a journalhoz. A meglévő sorok
`(createdAt,transactionId)` sorrendben, a változatlan tranzakciódigestből kapnak bélyeget;
a régi `createdAt` és az auditlánc hash-e nem változik. Az exact settlement replay ugyanazt
a bélyeget adja vissza. Rollbackkor a callereket
előbb le kell állítani és az adatbázist menteni. A nullable oszlopok alkalmazás-visszaállításkor
helyben maradhatnak; destruktív eltávolításuk nem támogatott. A journal auditcélból megőrzendő;
teljes séma-visszaállításkor függőségi sorrendben journal → account → bank törölhető.
Commitolt pénzmozgást csak új, auditált kompenzáló settlement rendezhet.

## Hitelek

A `banking-loans.ts` institution-hitelfelvevőhöz kötött, napokban meghatározott
futamidejű és bázispontos kamatú szerződést tartósít. Életciklusa
`approved → active/overdue → repaid`. Folyósítás és törlesztés csak exact,
committed `loan-disbursed`, illetve `repayment-cleared` banki settlementből
történhet.

A kamat egész napokra, egyszerű éves kamattal, az utolsó elszámolt időponttól
determinálódik. A törlesztés előbb a felhalmozott kamatot, majd a tőkét csökkenti;
túlfizetés és idegen fél receiptje fail-closed. Az exact settlement replay nem
terhel kétszer, a megváltoztatott replay elutasított.

Az additív migráció a `bank_loan` és `bank_loan_payment` táblát hozza létre.
Az immutable folyósítási receipt külön `bank_loan_disbursement` táblába kerül.
Rollback előtt mentés és a loan callerek leállítása kötelező; a payment ledger
auditadatként megőrzendő. Teljes séma-rollback csak payment → loan sorrendben
végezhető, és nem fordít vissza treasury-mozgást.

## Fedezet és nemteljesítés

Overdue hitel explicit, optimista revíziós lépéssel kerülhet `defaulted`
állapotba. Az ingatlanfedezet csak a Property domain exact tulajdonos- és
verzióreceiptje után köthető le. A bank nem ír közvetlenül Property-adatot:
`pledged → seizing → seized` intentet tartósít, és szűk adaptertől várja az exact
lefoglalási receiptet. A stabil seizure ID miatt a folyamatmegszakítás utáni retry
nem foglalja le kétszer ugyanazt a műhelyt.

Az additív migráció a `bank_loan_collateral` táblát hozza létre. Rollbackkor a
callert le kell állítani és mentést készíteni; a már végrehajtott tulajdonváltás
csak új Property-domain kompenzáló tranzakcióval fordítható vissza.

A Property engine additív `property_transfer` receipt-ledgert kap. A gateway
`EnginePropertyCollateralAdapter` csak tokennel védett belső engine-végpontot
hív; a stabil transfer ID exact replaye idempotens, eltérő replaye elutasított.

## Atomi postingok és auditlánc

A betéti egyenleg, a journal, a külön debit/credit postingpár és az auditlánc új
eleme egyetlen immediate SQLite tranzakcióban készül. A postingok összege és
tranzakcióazonosítója azonos; féloldalas könyvelés nem maradhat tartósan.

Az auditlánc minden elemének SHA-256 hash-e az előző hashből, a kanonikus journal-
bejegyzésből és a két postingból képződik. A `verifyAuditChain()` a teljes sorrendet
és tartalmat újraszámolja, így a journal vagy posting utólagos módosítása
észlelhető. Exact settlement replay nem készít új postingot vagy láncszemet.

Az additív migráció a `bank_posting` és `bank_audit_chain` táblát hozza létre.
Rollback előtt kötelező menteni és leállítani a könyvelési callereket. Az auditlánc
nem törlendő normál rollback során; teljes séma-visszaállításkor audit → posting →
journal sorrend szükséges, commitolt gazdasági eseményt pedig csak kompenzáló
tranzakció rendezhet.

## Csőd, bankroham és fertőzés

A `banking-risk-simulation.ts` tiszta, inert stresszteszt: nem nyit adatbázist és
nem kap treasury-, settlement- vagy Property-write adaptert. A bankroham a cash
és a korlátozott kivételi igény különbségét, a fertőzés a defaultolt adósok felől
a hitelezők veszteségét terjeszti legfeljebb a konfigurált mélységig.

Az intézmények, kitettségi élek, egyedi kitettség, bankonkénti kivétel, defaultok,
fertőzési mélység és loss-given-default külön plafont kapnak. Határátlépés
fail-closed; a defaultplafon vagy mélység elérése `truncated` eredményt ad. Azonos
kanonikus input azonos SHA-256 eredménydigestet képez. Mivel nincs perzisztens
séma, ehhez a szelethez adatbázis-migráció vagy rollback nem tartozik.

