# Explicit kohorszhoz kötött jogi lefedettség

Az `inspectCrimeLegalCoverage` csak a hívó által kiválasztott Thieving
receipt-azonosítókat olvassa. A Thieving, case és evidence/finding naplók teljes
auditláncát ellenőrzi, a receiptet a konkrét agenthez köti, majd csak az adott
ügyben **ugyanarra az agentre** vonatkozó jogi findingokat vetíti ki.

A discoveryből létrejött ügy nem bizonyít felelősséget. A `not-proven` nem
felelősségi megállapítás, a finding hiánya pedig nem felmentés. Más gyanúsított
findingja nem válik a kiválasztott agent eredményévé. A különböző
joghatóságok findingjai elkülönülnek, és a nézet nem választ közöttük globális
„végső ítéletet”.

Ez belső, csak olvasható nézet: a rejtett receipt-kohorszhoz való hozzáférést a
hívónak kell engedélyeznie. Nem populációs statisztika és nem visszaesési
ráta, mert sem a teljes, elbírált történetet, sem az utánkövetési időablakot
nem igazolja. Nincs új perzisztens séma vagy vagyon-/szankcióművelet; a
visszaállítás a vetület eltávolítása, adatvesztés nélkül.
