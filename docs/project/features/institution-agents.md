# Institution agent alapok

## Szerep és subject

Az agent memóriája, céljai és személyisége továbbra is az `agentId` alatt él, de
a fizikai player többé nem az implicit jogosultságforrás. A perzisztens
`AgentControlProfile` mondja meg, hogy az agent milyen szerepben dönt és kit képvisel:

- `player` → pontosan egy `player` subject és ugyanaz az avatár;
- `institution` → `business` vagy `faction` subject, avatár nélkül;
- `service` → rendszer-szolgáltatás, avatár nélkül;
- `world-director` → a világ seedelt eseményvezérlője, avatár nélkül.

A nem-player identity közvetlenül létrehozható az adminpanelen botkatalógus-bejegyzés
nélkül. Az identity `playerUsername` mezője ilyenkor `null`; a tényleges kötést a
control profile szerep–subject párja adja. Player controller továbbra is csak egy
létező bothoz, exact avatar-kötéssel hozható létre.

## Fizikai biztonsági határ

Az `execute-player-skill` csak player szerepnél, player subjectnél és az exact
`avatarPlayerUsername` egyezésekor engedélyezett. Minden más szerep fail-closed
választ kap. Az intézmény csak `request-player-action` típusú domain kérést tehet;
ennek tartós player-megbízási queue-ja még következő szelet.

A kezdeti domain allowlist:

- business: budget/assets áttekintés, szerződés- és business-policy javaslat,
  player-munka kérése;
- faction: budget/assets áttekintés, szerződés- és faction-policy javaslat,
  player-munka kérése;
- service: budget és saját queue áttekintése;
- World Director: budget és validálandó eseménysablon javaslata.

Ezek típusos képességnevek, nem általános fájl-, shell-, hálózati vagy engine-eszközök.

## Döntési ritmus és keretek

Minden profil deklarálja:

- a döntési időközt;
- a napi döntésszámot;
- a napi LLM-költségkeretet micros egységben;
- a napi operatív GP-keretet.

A `recordDecision` egyetlen SQLite tranzakcióban ellenőrzi a profil revízióját,
a scheduled időpontot, a napi ledgert és mindkét költségkeretet. Csak ezután írja
be a megváltoztathatatlan döntési rekordot és lépteti a következő döntési időt.
Az event és admin trigger kihagyhatja a scheduled várakozást, a napi limiteket nem.

A control profile bekerül a korlátozott döntési contextbe, így a későbbi LLM látja,
hogy kit képvisel, van-e avatárja, milyen domain eszközei és keretei vannak. Az
adminpanel „Vezérlés és keretek” ablaka optimista revízióval és auditnaplóval ment.
