# 26.6 – Kritikus kezelési folyamatok böngészős és API/UI szerződése

2026-10-17. Új, valódi API-kezelőkig futó Chrome-próbák és a meglévő
kritikus tesztek közös ellenőrzése. Nem általános képernyő- vagy
gombszámlálás: a böngészőben megadott adatoknak a backend által elfogadott,
elmentett és visszaolvasott eredménnyel kell egyezniük.

## Új, végigjárt folyamatok

A [böngészős szerződéscsomag](../../../server/gateway/admin/admin-workflow-contract-browser.test.ts)
hat tesztesete ugyanazt a control-plane belépést, HTML/JS-t, jóváhagyást,
gateway API-kezelőt, validátort és tárolási műveletet használja, mint az
alkalmazás. A tesztadatok kizárólag ideiglenes könyvtárban élnek.

- **Kísérleti paraméterprofil:** késleltetett betöltés, üres lista,
  érvénytelen JSON írás nélkül, valódi 201-es létrehozás, strukturált
  paraméterek és lenyomat, változtathatatlan verzió elutasítása,
  űrlapérték megőrzése és újratöltés utáni visszaolvasás.
- **Világszabály mentése:** a kiválasztott szabály valódi beállításai
  szerepelnek a jóváhagyásban; a kért revízió és számérték eljut az API-hoz.
  Mentés utáni aktiválási hiba részleges eredményként, konkrét okkal jelenik
  meg. Közben megváltozott revízió esetén a régi űrlap nem írja felül az
  újabb konfigurációt; a felhasználó beírt értéke megmarad.
- **AI-beállítások:** jóváhagyás megszakításakor nincs mentés. A számmezők
  számmá alakulnak, a pontos modell és költséglimit elmentődik, a kulcs
  értéke sem a jóváhagyásban, sem a válaszban nem jelenik meg. Backend által
  elutasított modell után a korábbi konfiguráció sértetlenül visszaolvasható.
- **Világesemény:** az előnézet nem hoz létre ciklust vagy kézbesítési
  rekordot. A sorba állítás ugyanahhoz a kiválasztási lenyomathoz kötött;
  ismétléskor nem készül másolat. A kézbesítési hiba látszik, és a tároló
  sikeres újrafeldolgozása után a kézbesített állapot is megjelenik.
- **Képességpublikálás:** hibás ellenőrzésű próbához nincs publikálógomb.
  A jóváhagyás a pontos draftot, célverziót, tesztkaraktert és bizonyítékokat
  mutatja. Megszakításkor nincs publikálás. A közben megváltozott
  ellenőrzési jelentés régi lenyomatát a valódi API elutasítja; új
  áttekintés után a verified verzió ténylegesen a tesztkönyvtárba kerül,
  a próba publikált állapotú lesz, és a gomb eltűnik.
- **Ajánlat és vállalkozás:** a valódi agentlista tölti a választókat.
  Hibás tárgysor helyben megáll; helyes adatnál a GP, tárgyazonosító,
  darabszám és képességverzió szerkezete eljut a backendhez. A címzett
  jóváhagyott elutasítása a megfelelő szereplővel és revízióval történik.
  A lezárt ajánlat és az új vállalkozás újratöltés után is látható.
  Ajánlatból ebben a próbában nem lesz szerződés vagy tényleges kifizetés.

## Korábbi kritikus regressziók

A hat új esetet a korábbi tesztek egészítik ki:

- [Szerver/fiók Chrome-folyamatok](../../../server/control-plane/test/browser.test.ts):
  létrehozás, indítás/leállítás, hiba, archiválás, mentés-visszaállítás,
  migráció, hiányzó szolgáltatások, két független szerverkontextus,
  fióklétrehozás és hozzáférés.
- [Böngészős jogosultságok](../../../server/control-plane/test/security-browser.test.ts):
  szerepkörök, megfigyelés és munkamenet-visszavonás.
- [Műveleti jóváhagyás](../../../server/gateway/admin/operation-review-browser.test.ts):
  valódi felületi karakterindítás, titokmaszkolás, megszakítás, dupla kattintás,
  megváltozott szerverkontextus és hibás műveleti útmutató.
- [Műveletkövetés](../../../server/gateway/admin/operation-progress-browser.test.ts):
  a néma kísérletindítás regressziója; beküldés, futás, részleges eredmény,
  hiba, elveszett státuszlekérdezés, helyreállás, időtúllépés és dupla küldés.
- [Navigáció és helyi segítség](../../../server/gateway/admin/navigation-browser.test.ts):
  13 nézet, tényleges célpontok, mezőleírás, mobil, billentyűzet,
  megfigyelői szerepkör és kiesett játékbackend melletti használat.
- [Natív társadalmi riport](../../../server/gateway/admin/society-dashboard.test.ts):
  szűrés, lapozás, eredeti bizonylat, forrásváltozás, késői válaszok
  kizárása és nem megbízható szöveg biztonságos megjelenítése.
- [Capability-szerződés](../../../server/gateway/admin/capability-matrix.test.ts):
  backend-/frontend-képességkötések, módszerkapuk, valódi szerepkörök,
  létező belépési pontok és a jóváhagyási policy teljessége.

Az üres és betöltési állapotot külön, késleltetett profilválasz ellenőrzi;
a siker a backend visszaolvasott eredménye; a részleges állapot a mentés és
az aktiválás eltérő kimenetele; a hibákat valódi validálási, verzió- és
jóváhagyási kapuk, valamint a szimulált infrastruktúrahibák adják.

## Megtalált és javított felületi hiba

A világszabály Mentés gombja korábban egy nem definiált `mod` változóból
próbálta felépíteni a jóváhagyás beállításlistáját. Emiatt a beküldés előtt
`mod is not defined` hibával megállt. A kezelő most a kiválasztott
azonosítóhoz tartozó szabályt oldja fel az aktuális listából; hiányzó
szabálynál frissítést kér. A regresszió a helyes név/érték megjelenítését,
a valódi PUT-ot és az utána megmaradó teendőt is ellenőrzi.

A közös navigációs böngészőteszt az új nézethez tartozó súgó létrejöttét
megvárja, majd frissen feloldott locatorral kattint. Így a hashváltás közbeni
újrarenderelés nem hagy levált DOM-elemet a teszt kattintásánál. Nincs
mesterséges várakozási idő, kikapcsolt assertion vagy ehhez módosított
termékviselkedés.

## Tesztkörnyezet és határok

A teszt minden esethez külön Bun gyermekfolyamatot indít. Az útvonalak
tesztadaptere és a memóriabeli titoktár csak ott él; a többi teszt
modulregiszterét nem módosítja. A konfigurációk ismert statikus másolatai,
a SQLite-adatbázisok, a publikált tesztképesség és az auditnapló a
`rs-admin-contract-*` ideiglenes gyökér alá kerülnek. A statikus felületi
források a checkoutból csak olvasva töltődnek.

A hiányzó játékszolgáltatásokhoz üres adatforrások és üres botfelügyeleti
adapter tartoznak. A világszabály-próba saját, loopback engine-végpontot
használ. Nincs valódi botindítás, modellhívás, OS-titoktár-írás vagy
játékbeli gazdasági kifizetés. A publikálás szintetikus, előkészített
ellenőrzési jelentéssel működik; az élő bizonyíték előállítását a meglévő
verifier/domain tesztek ellenőrzik. A kézbesítési állapotot a valódi tároló
lease API-ja lépteti, nem valódi engine-worker.

Lezáráskor a böngésző és a gyermekfolyamat leáll; rekurzív törlés előtt a
teszt ellenőrzi a temp gyökér és a dedikált előtag egyezését. Azonos URL
újranyitásakor a tesztsegéd valódi újratöltést kér, így régi DOM nem lehet
hamis visszaolvasási bizonyíték.

A teljes backend/UI paritás 31 ismert hiánya és a végső használhatósági
audit a 26.7 feladat része marad. A célzott tesztcsomag nem állítja, hogy
minden backend-művelethez már készült külön böngészős eset.

[Roadmap](../TASKS.md), [ellenőrzési napló](../PHASE26_PROGRESS.md).
