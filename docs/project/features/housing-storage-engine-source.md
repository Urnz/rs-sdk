# Housing storage engine-forrás

Az `assessEngineHousingStorageSource` auditlánc-ellenőrzés után is zárva tartja
a vanilla `container-theft` események Housing-bekötését. A szerveres láda- és
standesemény a loc célpontot és a tényleges item-/XP-változást rögzíti, de nem
tartalmaz HousingUnitot, auditált bútor-elhelyezésazonosítót/revíziót vagy
lakhatási tároló open/withdraw műveletet. Azonos koordináta vagy Property
belépési metadata nem helyettesítheti ezeket.

Ez a vetület nem hoz létre lopási vagy jogi bizonyítékot. Az éles bekötéshez
külön szerveres storage-művelet és a tárolóhoz kötött, eseménykori placement
snapshot szükséges, majd exact ellenőrzött Thieving/Housing átvezetés.
Nincs új perzisztens séma; visszaállításkor a csak olvasható kapu eltávolítható.
