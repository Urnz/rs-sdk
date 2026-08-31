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
ennek tartós player-megbízási queue-ja nem ad át közvetlen avatarvezérlést.

## Player-megbízási queue

Business- vagy faction-subjecthez kötött institution agent küldhet megbízást egy
exact avatarhoz kötött player agentnek. A kérés csak akkor jön létre, ha a címzett
már ismeri a kért exact skillverziót, a paramétereket a verified skill sémája
elfogadja, és a díj nem nagyobb a megbízó napi operatív kereténél.

Az állapotgép és a módosító fél is korlátozott:

- `pending → accepted/rejected`: kizárólag a címzett player agent;
- `pending → cancelled`: kizárólag a megbízó institution;
- `accepted → approved`: kizárólag a címzett player exact avatarjához kiadott,
  rövid életű egyszer használható approvalval;
- `approved → running`: kizárólag ugyanazzal az approvalval és egy előre kiosztott,
  egyedi skill-run ID-val;
- `running → completed/failed`: automatikusan az exact skill-run journalból;
- `accepted → cancelled`: kizárólag a címzett player agent;
- lezárt rekord nem nyitható újra, és minden írás optimista revíziót használ.

Az aktív megbízások bekerülnek mindkét agent korlátozott döntési contextjébe. Az
adminpanelen az elfogadás még nem indít fizikai műveletet. Az ezt követő külön
„Engedélyezés és indítás” művelet ellenőrzi, hogy a bot online, szabad és az exact
avatarhoz kötött-e, továbbá hogy az agent ismeri-e az eltárolt exact skillverziót és
a paraméterek változatlanul érvényesek-e. Ezután öt perces approvalt ad, és már az
indítás előtt a futáshoz köti a megbízást. Az approval az `approved → running`
átmenettel elfogy; lejárva vagy új run ID-val nem használható fel.

A supervisor ugyanazt a run ID-t adja át a skill executorának és a journalnak. A
futás végén minden nem `completed` eredmény elrontja a megbízást; ha az executor a
journal létrehozása előtt omlik össze, a folyamat kilépési állapota a biztonságos
fallback. A sikeres, díj nélküli munka közvetlenül lezárul, a fizetett munka előbb
`settling` állapotba kerül egy tartós settlement ID-val.

A gateway ezen az ID-n kér engine-tickes kifizetést az exact avatar valódi coin
inventoryjába. Az engine külön SQLite-journalban foglalja és véglegesíti a creditet,
majd azonnali player autosave-ot kér. A már committed ID ismétlése ugyanazt a receiptet
adja, nem újabb pénzt; részleges inventory-módosítást visszafordít és rejectedként
naplóz. Offline player vagy átmeneti engine-hiba előtt nem történik coinmozgás, a
megbízás `settling` marad, és az adminpanelen újrapróbálható. Egy összeomlás miatt
`pending` engine-rekord szándékosan fail-closed, kézi egyeztetést igényel.

A díj forrása ebben az első változatban a létrehozáskor ellenőrzött és naponta
összesítve lefoglalt intézményi operatív keret. Ez már valódi player-coin kifizetés,
de még nem Business- vagy Governance-treasury terhelés: azt a domain wallet-portok
elkészültekor kell a settlement forrásoldalára kötni.

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
