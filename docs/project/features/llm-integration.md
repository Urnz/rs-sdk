# LLM-integráció – tervezési vázlat

## Első cél

Egy korlátozott lokális tesztügynök kapjon tömör játékállapotot, válasszon az
engedélyezett műveletek közül, majd a determinisztikus végrehajtó ellenőrzés után
hajtsa végre a lépést.

## Rétegek

1. **Megfigyelés:** releváns játékállapot strukturált összefoglalása.
2. **Tervező/model adapter:** providerfüggetlen kérés és válasz.
3. **Policy/validator:** jogosultság, séma, költség-, idő- és lépéshatár.
4. **Végrehajtó:** szűk rs-sdk eszközök; közvetlen fájl- vagy engine-hozzáférés nélkül.
5. **Audit:** futásazonosító, modell, eszközkérés, eredmény, idő és hibakód.

## Biztonsági alapok

- A játékchat és minden külső szöveg nem megbízható adat.
- Titok nem kerülhet promptba vagy naplóba.
- A modell nem kap tetszőleges kódfuttatást az első verzióban.
- Minden futásnak van maximális lépésszáma, ideje és költségkerete.
- Vészleállítás után újabb modell- vagy eszközhívás nem indulhat.
- A tesztek alapértelmezetten determinisztikus mock modellt használnak.

