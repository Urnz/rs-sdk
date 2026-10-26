# SI-C07 – Igazolt online alvás a natív megfigyelésben

2026-10-26, a2. munkacsomag része. SI-C07 nyitott,27/45, preflight NO-GO;
SI-M3/MVS nem PASS.17/17 részleges adapter,8 még hiányos integrity gate;
[6 rögzített munkacsomag maradt](SI_C07_REMAINING_WORK.md).

## Megfigyelt állapot és megfigyelési rés

A `Player.populationSleeping` fail-closed jelző: a housing runtime forráshiba
után is igazra állíthatja a mozgás/akció tiltásához. Ezért önmagában nem
alvásbizonyíték és nem elegendő teljes observer-coverage-hez.

Az új `observed-sleeping` frame-állapot csak online, nem terminal avatarhoz
adható, pontos roster/identity/lifecycle/world/clock és aktuális engine tick
mellett. Az új readonly `NativeHousingExecutor.observeSleeper` ellenőrzi:

- a player-time aktuális sleeping állapotát és annak housing witness-kötését;
- a hash-láncos native sleep witness-t és a kifizetett, aktív tenancy-entitlementet;
- a jelenlegi Property authorityt, prepaid forrást és bérleti lejáratot;
- a witness/tenant identityt, az adott fizikai ágyat, szintet és pozitív HP-t.

A rövid natív observation az adott frame idejét, a witness és binding digestet,
identityt és az érvényesség végét rögzíti. Nem állít folytonos lakhatási
jogosultságot vagy teljes mortality-enforcementet. Az eddigi sleep-validator
gameplay útja változatlan; az observer nem ébreszt, mozgat, terhel GP-t vagy
módosítja a bérletet. A meglévő identity/clock authority újraolvasása megmarad.

Az offline/logging-out játékos továbbra offline gap, akkor is, ha van régi
durable sleep witness. Terminal vagy pusztán jelzővel korlátozott avatar
restricted marad. Hiányzó/idegen/stale identity identity-gap; hibás housing
forrás source-gap. Generic restricted rekordból nem következtetünk utólag alvásra.

## Offline kiértékelés és igényidő

A frame-séma csak a megfelelő státusz mellett fogad el sleep observationt.
Az owner, lejárat és frame-idő alakja/kötése ellenőrzött; a metrics-reader a
valódi checkpoint sleep auditból és natív committed rent receiptből újraolvassa
a hivatkozott bizonyítékot. Kitalált JSON/digest vagy hiányzó natív forrás
nem ad observer-coverage-et. A natív ellenőrzés pillanatkori aktuális tenancy/
Property jogosultságra támaszkodik; a teljes történeti source-pin külön gate.

Az igazolt alvó frame megfigyeltnek számít, de a pending native demandId
nem hagyható ki belőle. Az executor request életideje továbbra teljes egészében
a conservative upper része, az alvási időt nem vonjuk le. Az intent availability
alvás alatt is unknown maradhat; ebből nem lesz használható tool vagy nulla
unusable-time állítás. A pozitív és zero-opportunity szabály, az azonos actor
request-uniója, valamint a meglévő lower FAIL változatlan.

## Bevezetés, rollback és ellenőrzés

A sleep-audit readonly olvasója a tiszta `housing/native-sleep.ts` modulba
került; az engine korábbi exportja kompatibilis re-export. Az eredeti táblák,
hash-szabályok, közös user_version és gazdasági tranzakciók változatlanok.
100000 sleep-row fölött nincs csonkolt siker. Új adatbázisséma, migráció vagy
történeti backfill nincs: az új JSON frame-változat csak új megfigyelésben jelenik meg.

Régi frame-ek korlátozott státusza továbbra gap. Régi reader az új státuszt
elutasíthatja, ezért rollback nem igazolhat változatlan strict baseline-
folytatást. A schema/source/build pin frissítése explicit új baseline előtt
szükséges; megőrzött evidence-t nem írunk át.

A tényleges native rent/escrow/prepaid és fizikai sleep→tick-hook→readonly
coverage út négy actorral próbázott. Alvás közbeni pozitív executor és pending
native kérés megmarad, a teljes idő-upper nem csökken. Expiry, korai tenancy-
lezárás, eltűnt identity, rossz pozíció, terminal/sleep-flag/stale-clock,
plauzibilis proof valódi forrás nélkül és legacy restricted negatív próbák.
Korábbi24 housing-integrációs eset is lefutott a readonly reader kiemelése után.
Root és engine TS érintett; full regresszió nem indokolt a komponenshez kötött
observer-adat bővítéséhez. Pontos scope/ID/idő: [átadás](SOCIETY_DEVELOPMENT_HANDOFF.md).

Következő kódhatár a natív use/wear→repair-or-replacement→usable-service ciklus
és belső maintenance-input/successor provenance. Teljes source coverage,
mortality/enforcement,8 integrity adapter, konkrét baseline/ratio/source pin
továbbra kell. Nincs live világ/run, providerköltség vagy történeti backup-read;
SI-C08 nem indul, a2. csomag és SI-C07 nincs kész.
