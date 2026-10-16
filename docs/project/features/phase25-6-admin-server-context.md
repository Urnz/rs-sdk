# 25.6 – kötelező szerverkontextus az adminnézetekben

A „Saját szervereim” kártyáról a hagyományos és a kezelt világ adminja is
megnyitható. A lap címe `/admin/index.html?serverId=<regisztrált ID>`.
A kiválasztott név és azonosító a fejlécben látható, gateway-leálláskor is.
A bot-, world/mod-, property-, gazdasági, társadalmi, agent- és AI-nézet
ugyanahhoz a lapkontextushoz kötődik.

## Kérés és útválasztás

Minden `/api/admin/*` domainkérés és `/api/control-plane/status` kérés
kötelező `X-Control-Server-ID` fejlécet visz. Nincs implicit local-default
API-visszaesés. A fejléc azonosítóformátuma a registry formátuma; hiányzó,
üres vagy többértékű fejléc 400 `SERVER_CONTEXT_REQUIRED`. Ha a kérés
`serverId` queryt is tartalmaz, annak egyetlen értéke pontosan egyezzen
a fejléccel, különben 409 `SERVER_CONTEXT_MISMATCH`.

A control plane minden kérésnél újra ellenőrzi a sessiont, CSRF/origin/
explicit mutation intent kaput és az adott erőforrás ownership rekordját.
A local-default tulajdonjog nem helyettesíti a kiválasztott világét, és egy
kezelt világ tulajdonosának nem kell local-default tulajdonosnak lennie.
Idegen és nem létező szerver egyaránt 404. A regisztrált, de lifecycle-hoz
nem kötött tetszőleges metadata-végpont nem válik proxycéllá.

A hagyományos backend csak a konfigurált endpointpár exact registry-kötésével
használható. Kezelt világnál a registry endpointpárjának a lifecycle hat
portjához kell illeszkednie. Proxyzás előtt a saját generáció/token alapján
azonosított gateway-worker készenlétét is ellenőrizzük. Leállított,
archivált vagy nem igazolható gatewayre domainkérés nem megy. Az engine
kiesése önmagában nem tiltja le az azonosított gateway olvasható adminját.

A kiválasztott gateway kapja az eredeti method/query/body-t, a validált
session cookie-t, CSRF/intent és szükség esetén kliens által megadott
admin-auth fejlécet. A control plane nem ad szolgáltatási titkot a kéréshez.
Az Origin a cél gateway eredetére íródik át, redirectet nem követünk.
A gateway saját erőforrás-ID-jával is összeveti a fejlécet, még a domain-
handler meghívása előtt. Másik gatewayre küldött context 409.

A sikeres válasz `X-Control-Server-ID` fejlécet kap, amit a felület ellenőriz.
Ha a backend eltérő azonosítót állít, a központi proxy visszatartja a választ.
Régi, pontosan kötött gateway-verzió hiányzó válaszfejlécét a központi proxy
saját, ellenőrzött útválasztási kontextusával egészíti ki. A header egyezés
nem önálló kriptográfiai bizonyíték: a managed worker azonosítása külön kapu.

## Lapok, állapot és hibák

A lap serverId-ja a dokumentum betöltésekor rögzül, nem közös storage-ban
kiválasztott „aktuális szerver”. Két lap külön világot kezelhet, azonos bot-,
property- vagy agent-ID sem válthat közöttük. Szerverváltás új dokumentumot
tölt be, amely nem örökli az előző lap listáit, kijelöléseit és folyamatban
lévő UI-válaszait. Ha valaki History API-val átírja az URL kontextusát,
a régi dokumentum további kérései újratöltésig elutasítódnak.

A régi admin token sessionStorage-kulcsa is szerverenként különül el;
a korábbi globális `rs-admin-token` értéket nem vesszük át más világra.
Az AI-konfiguráció és minden meglévő domainművelet a közös API-wrapperen
keresztül kapja a rögzített fejlécet, a társadalmi dashboard is ezt használja.

A status cache és a párhuzamos probe deduplikáció szerverenként külön van,
az ownership nincs cache-elve. Stopped managed világhoz is megnyitható a
saját admin shell: név/ID, offline kapcsolatjelzés és visszalépés működik,
domainmutáció nem indul másik szerveren helyette. A műveletet nem ismételjük
automatikusan. Proxy-timeout utáni módosító kérés eredménye továbbra is
ismeretlen lehet; állapot/audit ellenőrzés szükséges ismétlés előtt.

A központi `/admin/` továbbra is a saját szerverlista. Kontextus nélküli
`/admin/index.html` ide irányít. A közvetlen gateway `/admin/` belépése
a saját bound ID-ját tartalmazó URL-re irányít, nem a központi default világot
választja. A global account/login és lifecycle API továbbra is a független
control plane-hez tartozik; ezek nem domainnézetek.

## Migráció és rollback

Identity v1, registry v2 és a világok domainadatai változatlanok; új SQL-
migráció nincs. Kliens/automatizálás az admin API-t ezután explicit fejléc
nélkül nem hívhatja. A régi, ID nélküli domain-bookmark a szerverlistára vezet.
A gateway közvetlen belépési URL-je a saját context URL-re irányít.

Pinnelt régi világ forrását nem írjuk felül. A központi proxy a korábbi,
azonosított lifecycle-gatewayre is tud megfelelő világkontextussal irányítani;
az új közvetlen gateway-kapu a hozzá tartozó forrásverzióban érvényes.
A 25.5-ös instance-profil/migrációs szabályok ettől változatlanok.

Visszaállítás előtt a control plane-t állítsd le és készíts konzisztens
privát identity/registry backupot; világadatokat ez a változás nem migrál.
A vezérlő és a közvetlen gateway UI/API-verzióját együtt érdemes visszaállítani:
régi kliens fejléc nélkül az új gatewayen zárt hibát kap, új kliens pedig
nem fogad el azonosító nélküli domainválaszt közvetlenül régi gatewaytől.
Futó művelet ismeretlen eredményét rollback nem játssza újra.

Az OS-/szolgáltatói titoktár (25.7), általános felügyelet/backup (25.8)
és távoli TLS/RBAC (25.9) külön feladat. Az admin IA/UX teljes átszervezése
a 26. fázis része; e lépés a meglévő nézetek szerverhez kötését adja.

Ellenőrzések: [Phase 25 progress](../PHASE25_PROGRESS.md).
