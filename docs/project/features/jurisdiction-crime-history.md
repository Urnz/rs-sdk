# Időablakos helyi felelősségi történet

Az `inspectJurisdictionCrimeHistory` a teljes helyi, adott szereplőhöz és
joghatósághoz kötött `responsible` finding-listát olvassa az auditált
`CrimeEvidenceStore`-ból. Nem kézzel kiválasztott receipt-kohorszból becsül
történetet. A findinget a case és az eredeti Thieving outcome pontos
azonosságához köti; hiányos, sérült vagy más szereplőhöz tartozó forrásnál
hibával zár. A finding-listát és a ténylegesen felhasznált case/outcome
rekordokat az ellenőrzés végén újraolvassa, megfigyelt változásnál nem ad
részleges eredményt. Ez nem közös atomi snapshot: a visszaolvasás utáni,
illetve két olvasás között megváltozó majd visszaálló adat minden esetét
nem bizonyítja.

Két külön idődimenziót kezel:

- Az incidens ablaka `[incidentFrom, incidentUntil)`, az eredeti outcome
  `occurredAt` mezőjéből, nem a felfedezés vagy ítélet idejéből.
- A `recordedAsOf` inkluzív döntésrögzítési cutoff: később rögzített finding
  nem kerül az eredménybe. Ez logikai cutoff a jelenlegi auditált adatokon,
  nem korábbi teljes DB-snapshot visszaállítása.

A canonical ISO időpontoknál `incidentFrom < incidentUntil <= recordedAsOf`
kell. Az ítéleti idő nem előzheti meg az incidenst, a rögzítés az ítéletet.
Az ablakon kívüli vagy cutoff utáni adatból nem lesz új incidens a nézetben.

Ugyanazt az outcome receiptet több finding vagy case mellett is egyszer
számolja, de az összes releváns finding/case ID megmarad az ellenőrizhetőséghez.
Az `additionalResponsibleOutcomes` az elsőn túli distinct incidensek száma
**ebben az ablakban**, nem büntetőjogi visszaesés, rehabilitáció utáni új
bűncselekmény vagy népességi visszaesési arány. `not-proven`, puszta gyanú és
felderítetlen cselekmény nem kerül a felelősségi számlálóba.

A forrás teljessége csak a helyi felelősségi ledgerre vonatkozik. Más világok,
joghatóságok, rejtett incidensek, be nem jegyzett döntések és a teljes népességi
follow-up hiányában globális visszaesési arány és jövőbeli kockázat továbbra
sem elérhető. Ez nem reputáció, karma, wanted pontszám vagy szankció.

## Jogosultság és adatkezelés

Belső modul, nincs új HTTP/admin/LLM route. A hívónak külön jogosítania kell
a jogi történethez és rejtett outcome-identitásokhoz való hozzáférést; az
agent kontextusába nem kerül automatikusan. Csak az ablakba került incidensek
azonosítói kerülnek a kimenetbe, játékos-login vagy készletadat nem.

## Migráció és visszaállítás

Nincs perzisztens séma- vagy adatváltozás, visszamenőleges állapotírás sem.
A kód kikapcsolása nem módosítja a case-, evidence- vagy Thieving-naplót;
nincs adat-migráció vagy rollback-írás. A meglévő selected-cohort metrikák
változatlanok, a globális visszaesési dimenzió továbbra is hiányzóként szerepel.

## Ellenőrzés (2026-09-26)

- Új history-tesztek: 40 sikeres, 0 hibás; teljes crime-metrics csoport:
  48 sikeres, 0 hibás. Valódi tartós forrásokkal időablak, cutoff,
  joghatóság/actor szűrés, újranyitás és tampering; szűk source-double tesztekkel
  deduplikáció, hibás kapcsolatok és visszaolvasás közbeni forrásváltozás.
- Teljes Bun 1.3.14 csomag: 1401 sikeres, 0 hibás teszt, 257 fájl.
  A külső collision-oracle ellenőrzés az elérhetetlen demo endpoint miatt
  a suite saját jelzése szerint kihagyódott; hook-timeout nem jelentkezett.
- Gyökér és engine TypeScript, formázás és staged whitespace: hibamentes.
- Élő világadatot nem módosítottunk.
