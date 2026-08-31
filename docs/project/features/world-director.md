# World Director

## Cél és biztonsági határ

A World Director nem szabadon cselekvő „világisten” LLM. Feladata, hogy egy
kísérleti seedből és cikluskulcsból reprodukálható módon kiválasszon egy előre
jóváhagyott, verziózott eseménysablont. A kezdeti implementáció csak döntést és
digestet készít; nem módosítja a játékvilágot.

## Sablonmodell

Egy sablon az alábbi korlátozott mezőket tartalmazza:

- stabil `templateId` és egzakt `version`;
- allowlistelt `kind`;
- rövid cím és összefoglaló;
- legfeljebb 12 régió és 12 tag;
- 1–100 közötti egész választási súly;
- szerveroldali `status` és `source`.

Az LLM csak az első hat csoportot javasolhatja. A szerver minden extra mezőt
elutasít, majd a szabályos javaslatra is kizárólag `draft` és `llm-proposal`
minősítést tesz. Végrehajtási payload szándékosan nincs a sémában.

## Determinisztikus választás

Az approved sablonok `templateId`, majd `version` szerint rendeződnek. A választó
a seed, a cikluskulcs és minden eligible sablon teljes tartalmának SHA-256
lenyomatából képez súlyozott ticketet. Így:

- azonos bemenet byte-for-byte azonos döntést ad;
- a forráslista sorrendje nem számít;
- egy sablon tartalmi vagy verzióváltozása megváltoztatja a digestet;
- draft és retired sablon soha nem választható.

## Admin-előnézet

Az AI beállítások lap World Director szekciója felsorolja a beépített approved
sablonokat. A seed és cikluskulcs megadásával auditált előnézet kérhető. Az
eredmény sablonverziót, ticketet és digestet mutat, de `simulation: true`, ezért
nem publikál eseményt az engine vagy a modok felé.

## Következő integrációs réteg

A valódi futtatáshoz még tartós ciklusnapló, ütemező, approval lifecycle és szűk
event-output port kell. Csak trusted adapter fordíthat majd egy approved sablont
konkrét, típusos mod-eseménnyé; az LLM közvetlen engine- vagy world-write jogot
akkor sem kap.
