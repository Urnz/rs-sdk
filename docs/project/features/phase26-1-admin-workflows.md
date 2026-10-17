# 26.1 – Feladatok szerint szervezett adminfelület

2026-10-17. Hatókör: a meglévő helyi/private adminfelület információs
architektúrája és a hozzá kapcsolódó navigáció. A 26. fázis többi pontja
külön feladat marad.

## Használat

Bejelentkezés után a **Saját szervereim** oldalon válassz szervert. Itt
kezelheted a szerver indítását, leállítását, verzióját és teljes mentéseit.
A szerver megnyitása az új **Áttekintés** nézetre visz, ahol rövid első
lépések és a kezelési területekre mutató kártyák segítik az eligazodást.
A fejlécben végig látható a kiválasztott szerver neve és azonosítója.

A tulajdonosi kezelőfelület négy csoportja:

- **Napi felügyelet:** Áttekintés, Karakterek, Célok és önálló működés,
  Élő térkép. A karakter a játékbeli bot; az agent a hozzá kapcsolható,
  tartós célokat és emlékeket kezelő döntéshozó. A döntési napló is ide került.
- **Gazdaság és társadalom:** Pénz és készletek, Vállalkozások és munka,
  Ajánlatok és szerződések, Társadalmi mutatók. A vállalkozás és a szerződés
  saját nézetből kezelhető, többé nem a Kísérletek alatt kell keresni.
- **Kipróbálás és fejlesztés:** Képességek és próbák, Kísérletek. A képességhiányok,
  fejlesztési próbák és publikálás a képességek mellé kerültek. A kísérleti
  pillanatkép gombja a Kísérletek nézetben van; ez adatfelvétel, nem teljes
  szervermentés.
- **Világ és beállítások:** Világszabályok és ingatlanok, Világesemények,
  AI és költségkeret. A korábbi World Admin innen nyitható meg. Az események
  előnézete, ütemezése és kézbesítési naplója külön nézetet kapott az
  AI-szolgáltató beállításaitól.

Asztali nézetben csoportosított oldalsó navigáció, legfeljebb 900 px szélességnél
feliratozott, natív választó működik. Mindkettő ugyanabból a HTML-ben rögzített
nézetlistából épül; a kezdőoldal kártyái is ezt a listát használják.
Minden nézet címet és rövid cél-/előfeltétel-magyarázatot kapott.

## Navigáció és működési határok

A meglévő `serverId` paraméter mellé helyi nézetazonosító kerül, például
`/admin/index.html?serverId=local-default#businesses`. A Vissza/Előre gomb,
újratöltés és közvetlen hivatkozás megtartja a nézetet. Ismeretlen hash az
Áttekintésre vezet. A nézetváltás nem változtat szervert és nem hajt végre
gazdasági vagy játékbeli módosítást. A meglévő szerverkontextus- és jogosultsági
ellenőrzések továbbra is érvényesek.

A navigáció szabványos hivatkozásokat és az aktuális helyet jelző
`aria-current` attribútumot használ. Nézetváltás után a cím kap fókuszt.
Az „Ugrás a tartalomra” billentyűzetes hivatkozás a kiválasztott nézetet
megtartva lép a címre. A tartalom és a magyarázatok sikertelen backend-betöltés
esetén is elérhetők.

A meglévő műveleti űrlapokat és eseménykezelőket áthelyeztük; a karakterindítás,
pillanatkép és világkezelés a saját területükön található. A vállalkozások és
szerződések megnyitásakor az agentválasztók alapadatai is frissülnek.
A beállított világesemények frissítése az új eseménynézethez kötődik.

A fiók/jogosultságkezelés és a szerverlista a fejlécből érhető el. Az operator
és viewer továbbra is a meglévő, korlátozott megfigyelési nézetet kapja; ezen
rövid magyarázat jelzi a hozzáférés határát. Jogosultságot ez a változás nem bővít.

Nincs adatmodell-, mentésformátum- vagy migrációváltozás. A visszaállítás a
felületi fájlok előző verziójának visszaállításával történhet. A statikus
fájlokat a működő admin közvetlenül a repositoryból szolgálja ki, ezért a
frissítés megjelenítéséhez az adminoldal újratöltése szükséges.

## Ellenőrzés és korlátok

A `server/gateway/admin/navigation-browser.test.ts` valódi Chrome és
control-plane HTTP alatt, szintetikus, izolált fiókkal ellenőrzi a teljes
tulajdonosi navigációt, a ténylegesen áthelyezett tartalmakat és a műveleti
ablakok megnyitását. Lefedi a mobilválasztót, billentyűzetet, közvetlen linket,
újratöltést, Vissza/Előre működést, ismeretlen nézetet, backendhibát és a
szerverkontextus megőrzését. A nézetváltások nem küldenek módosító API-kérést.

A képernyőképek helyben: `.local/verification/phase26-1-desktop.png` és
`phase26-1-mobile.png`. A teljes érintett kör és mért ideje a
[26. fázis naplójában](../PHASE26_PROGRESS.md) szerepel.

Ez az információs architektúra elfogadása, nem backend-képességparitási audit
vagy a teljes társadalomszimuláció élő elfogadása. A verziózott capability-mátrix,
a műveleti visszajelzések egységesítése, a részletes kontextusos útmutatók és a
végső hozzáférhetőségi audit a 26.2–26.7 feladata marad.
