# Observer-specifikus kapcsolatnézet (22. fázis)

Az `agent-state/underworld-knowledge.ts` kizárólag az adott agent tartós
kapcsolataiból, saját episodic bizonyítékaiból és ezekhez kötött, időben aktív
semantic memóriájából készít olvasható kontaktlistát. Nem olvas globális
orgazda-nyilvántartást. Csak az adott kapcsolatban hivatkozott, az agenthez
tartozó, megbízhatónak tárolt, időben érvényes és a szereplőt a strukturált
`actors` mezőben pontosan megnevező epizód számít közvetlen bizonyítéknak.

A nézet az epizód- és tudásazonosítókat, a kapcsolat revisionjét és az agent
szubjektív bizalom/ismerősség pontszámát adja vissza. Sem a kapcsolat címkéje,
sem a jegyzete, sem az episodic összefoglaló, sem egy semantic predicate nem
minősíti a szereplőt orgazdává. A nézet minden esetben
`underworld-claim-not-attested` blockerrel tér vissza. Ezért nem használható
feketepiaci trade célpont-keresőként vagy végrehajtási jogosultságként.

A hiányzó következő lépés külön, típusos és forrásellenőrzött underworld-claim
ingestion: az adott agent által ténylegesen megismert partnerre kell attestált,
visszavonható bizonyítékot adnia. A mai `trusted` memória önmagában nem elég,
mert kézi felvitellel is létrehozható. Nincs új perzisztens séma vagy gazdasági
írás; rollback esetén a vetület eltávolítható, az agent memória változatlan.
