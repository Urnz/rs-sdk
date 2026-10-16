# Bűnügyi gazdasági forráslefedettség

Az `inspectCrimeEconomicCoverage` csak a hívó által kiválasztott, auditált
Thieving receipteket kapcsolja pontosan egyező provenance-lopáseseményekhez.
Megmutatja, mely tényleges tárgymozgásokhoz van ilyen esemény, és melyekhez
nincs a kiválasztott halmazban. Nem állítja, hogy a kihagyott események nem
léteznek; nem nyilvános játékos- vagy NPC-tudásvégpont.

Bevételt nem számol: az economy eventből hiányzik a lopási receipt/asset
okozati kapcsolata és a megfelelő olvasási auditkapu. Sértetti kárt sem
számol: a v2-ben auditált restitution claim összege igény, nem önmagában
hiteles sértetti veszteség vagy értékbecslés. A migrált v1 igény történeti
összege továbbra sem hitelesített. A két dimenzió ezért explicit hiányzik.

Csak olvasási vetület, nincs új séma vagy pénzmozgás. Visszaállításkor a
vetület eltávolítható; az alapforrások és a provenance-v2 migráció önálló
visszaállítási tervét ez nem módosítja.
