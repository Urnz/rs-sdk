# 26.7 – Használhatósági és képességparitási audit

2026-10-18. A helyi/private LostCity adminfelület lezáró auditja.
A 31 nyilvántartott felületi hiányhoz kezelési űrlap vagy olvasható riport
készült. A meglévő 13 kezelési terület és a nézői felület megmaradt.

## Hol találhatók az új műveletek?

- **Célok és önálló működés:** teljes döntéshozói idővonal, önálló működés
  vezérlőállapota. Az oldal tetején a **Választható résztvevők, hagyatékok
  és szabályok** kártyával tölthetők a döntéshozó-választók.
- **Karakterek:** az adminműveletek legutóbbi 100 naplóbejegyzése,
  végrehajtóval, indokkal és kimenetellel.
- **Kísérletek:** környezetellenőrzés, korábbi pillanatképek, a meglévő
  kísérletűrlap indítás nélküli elővizsgálata, XP-ismétlési alapállapot
  olvasása/nullázása/visszaállítása és natív XP-bizonyíték olvasása/lezárása.
- **Pénz és készletek:** függőségi és kiesési kockázati riport pontos
  szimulációs időablakkal és órakötéssel.
- **Vállalkozások és munka:** támogatott szerepkörök és feladatok leírása.
- **Társadalmi mutatók:** mérési szerződés, külön értékelési és
  önfenntartási riport; hosszú kísérlet és összehasonlítás; archívum,
  engedélyezett tudásátadás, öröklés és népesség-utánpótlás.
- **Világszabályok és ingatlanok:** előkészített világterv ellenőrzése és
  alkalmazása, profilok és korábbi alkalmazások, tárolt mentőanyagból
  visszaállítás, külső kereskedelem megfigyelése/riportja és tisztasági riport.
- **Szervermegfigyelés:** a néző és üzemeltető számára engedélyezett két
  gazdasági és két társadalmi olvasási művelet is elérhető. A tulajdonosi
  önfenntartási riport és a módosító műveletek nem kerültek erre az oldalra.

A kártyák alapból összecsukottak. Mindegyik megmondja, mire való, milyen
adat szükséges, és mit jelent az eredmény. Az űrlapok feliratozott mezőket,
kapcsolt magyarázatokat, név szerinti választókat és helyben megmaradó
állapotjelzést használnak. A riportok feliratozott adatok; a lenyomatok
és forráshivatkozások külön részletekbe kerülnek. A hosszú listák 25 elemes
lépésekben nyithatók tovább, a riportterület billentyűzettel görgethető.
A résztvevő-, vállalkozás- és futásazonosítók eredeti szövege megmarad;
a fordítás az ismert állapotokra és kategóriákra korlátozott. A nem
megbízható szöveg HTML-ként nem hajtódik végre.

A külön gazdasági és társadalmi riportok **Óraadatok kitöltése** gombja
beolvassa az óra azonosítóját és profillenyomatát. Üres időablaknál az
utolsó 24 szimulációs órát ajánlja fel; a már megadott időablakot megtartja.
A tulajdonosi oldalon a közös társadalmi riport időablaka és résztvevői
köre is átvehető. Olvashatatlan óránál a mezőkbe nem kerül kitalált érték.

## Előnézettől a végrehajtásig

1. A résztvevőket és szabályokat az oldal tetején töltsd be. A kezelési
   kártyák hivatkozása odavisz, nézetváltás vagy módosítás nélkül.
2. Add meg a célművelet adatait, majd kérj előnézetet. A számmezők számmá,
   a résztvevőlisták külön azonosítókká alakulnak.
3. Olvasd el a tervet és az akadályokat. Akadály, hiányzó adat vagy hibás
   válasz esetén a végrehajtógomb nem használható.
4. A külön végrehajtógomb a műveletspecifikus jóváhagyást nyitja meg.
   A címzett, vagyon/tudás, állapotverzió és előnézeti lenyomat a pontos
   előnézethez kötött. A **Mégse** nem küld végrehajtási kérést.
5. A kártyán és a **Műveletek** listában ellenőrizd a választ. Hiba vagy
   megszakítás után új előnézet kell; nincs automatikus módosító újrapróbálás.

A kliens őrzi az előnézeti lenyomatot, revíziót és az egyszeri művelet
azonosítóját. Nem kell ezeket bemásolni. Mezőváltozás vagy a választható
adatok frissítése érvényteleníti az előnézetet. A backend változatlanul
újra ellenőrzi a bizonyítékokat, jogosultságot és revíziót.

XP-visszaállításkor a korábbi nullázás bizonylatának `commandId`
azonosítója szükséges; ez az előző műveletre hivatkozik. A nullázás az
ismétlési állapotra vonatkozik, nem a karakter összes megszerzett XP-jére.
Világkezdethez előkészített `WorldGenesisResult` JSON-fájl választható,
legfeljebb 2 MB méretben; ez nem szervermentés és nem puszta konfiguráció.
A szerver validálja a teljes tervet, az alkalmazás az előnézet lenyomatát
küldi vissza. Visszaállításnál a futáslista szolgáltatja a revíziót és
a világterv lenyomatát; elavult kliens nem írhat át frissebb állapotot.

## A hiányzó előfeltétel látható marad

A telepített alap öröklési és tudásátadási szabályzat lehet üres. Ebből
nem készül kitalált szabály: a választó üres és konkrét magyarázat jelenik
meg. Nincs automatikus vagyonszerzés vagy teljes emlékmásolás. Egyes
műveletekhez élő helyi engine, korábbi kísérlet, archivált életciklus,
világkezdet vagy külön konfigurált adapter kell. Hiányuk teendőt jelent,
nem felületi képességparitási kivételt és nem sikeres végrehajtást.

A csak olvasó `GET /api/admin/workflow-options` a kiválasztott szerver
engedélyezett szabályait és meglévő hagyatékait adja vissza. A hagyatéki
nyilvántartást csak olvasva nyitja, hiánya esetén nem hoz létre adatbázist.
Egy hibás szabályzat nem tünteti el a többi adatot; külön figyelmeztetést ad.
A jogosultsági rendszer változatlan, az új végpont tulajdonosi hozzáférésű.

## Auditbizonyíték és határok

A [böngészős audit](../../../server/gateway/admin/usability-audit-browser.test.ts)
hét esete ellenőrzi a 20 korábban hiányzó olvasási és 11 módosító
műveletcsoport felületi szerződését. Valódi belépés, szerverkontextus,
jóváhagyás és böngészős HTML/JS fut. A választók, üres szabályzatok,
adminnapló és idővonal saját temp gyökérben valódi handlert is használnak.
A többi új folyamat pontos kérésalakját előkészített HTTP-válaszokkal
vizsgáljuk; ez nem állítja, hogy élő gazdasági vagy népességi módosítás
történt a játékvilágban. A domain-kapuk meglévő integrációs tesztjei és
a [26.6 valódi API/UI próbái](phase26-6-workflow-contracts.md) megmaradtak.

Az auditban mind a 13 nézet 320, 390, 768 és 1440 pixel szélességen
vízszintes oldalkilógás nélkül működik. A Chrome akadálymentességi fájában
az ellenőrzött, látható gomboknak, hivatkozásoknak és beviteli vezérlőknek
van neve. A kártyanyitás és mezőelérés billentyűzettel működik; az új
űrlapok ellenőrzött aktív szövegeinek kontrasztja legalább 4,5:1.
A szerver-, fiók- és műveletjegyzék oldal külön mobil/asztali ellenőrzést
kapott, a nézői/üzemeltetői riportok valódi szerepkörkapuval futnak.
A mobil és asztali űrlap képernyőképét vizuálisan is ellenőriztük.
Ez célzott hozzáférhetőségi audit, nem teljes WCAG-tanúsítás vagy
képernyőolvasós felhasználói kutatás.

A [verziózott mátrix](../../../server/gateway/admin/public/capability-matrix.v1.json)
**1.3.0**, 156 bejegyzés, 171 konkrét HTTP-művelet: **155 felületi
kapcsolat, 0 ismert felületi hiány, 1 automatikus infrastruktúraművelet**.
A 91 módosító bejegyzés közül 72 külön jóváhagyású, 19 indokoltan közvetlen;
az előnézet/végrehajtás útvonalváltozatok külön policyt kapnak.
140 backend-deklaráció, 153 módszerkapu és 181 frontend-hívásalak
forráskötését és árvaságmentességét ellenőrzi a szerződéscsomag.

Nincs adatmodell-, migráció-, gazdasági alap-, auth- vagy runtimefüggőség-
változás. Visszaállítás a felületi fájlok és az olvasó végpont korábbi
verziójára történhet; a végrehajtott domain-műveletek saját helyreállítási
szabályait ez nem helyettesíti. A statikus felületi módosítások újratöltéssel
láthatók; az új `/api/admin/workflow-options` végponthoz az admin/gateway
folyamat újraindítása szükséges. Helyi játékfolyamatot nem indítottunk újra.

[Roadmap](../TASKS.md), [parancsok, eredmények és mért idők](../PHASE26_PROGRESS.md).
