# 26.4 – Látható műveleti állapotok

2026-10-17. A helyi admin, a Saját szervereim és a fiókkezelés közös
műveletkövetőt használ. A végrehajtás és a jogosultságok backend-szabályai
nem változtak.

## Használat

A **Műveletek** lista a kezelési tartalom elején jelenik meg az első
módosításkor. Nézetváltáskor megmarad, összecsukható, és a lezárt bejegyzések
egyenként elrejthetők. A párbeszédablakból indított művelet ott helyben is
mutat visszajelzést. A színek mellett minden állapot szöveges nevet kap;
az állapotváltozásokat képernyőolvasó is felolvashatja.

- **Jóváhagyásra vár:** még nem küldtünk módosító kérést. A Mégse és az
  Escape ezt **Nem indult el** állapottal zárja.
- **Beküldés folyamatban:** a kérés elindult, a szerver válaszára várunk.
- **Folyamatban:** az indítás visszaigazolt, a háttérmunka még tart.
- **Befejeződött:** befejezett műveleti válasz vagy lezárt futási jelentés
  igazolja az eredményt.
- **Teendő maradt:** például részleges kísérleti eredmény, sikertelen
  aktiválás/elszámolás vagy elmentett, de újraindítást igénylő beállítás.
- **Sikertelen:** a szerver konkrét hibát adott vagy a futás hibával zárult.
- **Ellenőrzés szükséges:** a kérés kimenetele vagy a legfrissebb állapot
  nem igazolható. Ez nem bizonyítja, hogy nem történt módosítás.

Minden bejegyzés tartalmaz időpontot, érintett kört, eredményt vagy teendőt;
a követhető háttérmunkák futásazonosítót is. Az **Állapot ellenőrzése** gomb
csak olvas, és nem indít második végrehajtást. A kapcsolódó kezelési nézethez
az **Eredmény és részletek** hivatkozás vezet.

## Kísérletek: a néma indítás megszüntetése

A jóváhagyás után azonnal látható a beküldés. Elfogadott indításkor a válasz
futása rögtön bekerül a kísérleti listába; nem kell megvárni egy második
listalekérdezést. A lista későbbi frissítési hibája nem írja át sikertelennek
a már elfogadott indítást.

A követő a konkrét kísérletazonosítót olvassa vissza. Megkülönbözteti a
feladatok kiosztását, a résztvevők feladatfutását, a befejezést, a részleges
eredményt és a futtatóhibát. Hibánál az ismert ok és a következő ellenőrzés
is megjelenik: agentenkénti eredmények, online karakterek, célok és AI-keret.
Újratöltéskor a szerverről betöltött, még futó kísérletek követése ismét
felépül, módosító kérés nélkül.

## Követés és biztonságos újrapróbálás

A szerver-életciklus és karbantartás tartós műveletazonosító alapján követett.
A képességfuttatás és a futásazonosítót adó autonóm döntés a konkrét skill-run
lezárt jelentésére vár. A karakter indítása/leállítása/újraindítása és a
feladat leállítása a karakterállapot visszaolvasásával követett.

A státuszlekérdezés két másodpercenként történik, legfeljebb három percig.
Utána a bejegyzés megmarad és kézi állapotellenőrzést kér; a szerveren futó
munka nem áll le. Átmeneti olvasási hiba után ugyanígy folytatható a követés.
A HTTP-kérés 30 másodperces időkorlátja és a műveleti útmutató 10 másodperces
betöltési korlátja diagnosztizálható visszajelzést ad.

Módosító kérés nem ismétlődik automatikusan. Az azonos, még futó vagy
bizonytalan kimenetelű beküldést a közös követő visszautasítja; a kísérleti
űrlap külön is védi a dupla indítást. A kérésazonosság SHA-256 lenyomattal
jelzett: jelszó, kulcs, CSRF-token és teljes kérésbody nem kerül a műveleti
bejegyzésbe vagy böngészős tárolóba. A megjelenített szöveg nem HTML-ként
értelmezett.

## Határok és szerződés

A lista a dokumentum élettartamára szól; nem új tartós napló. Legfeljebb
20 korábbi lezárt bejegyzést tart meg; függő bejegyzést emiatt nem távolít el.
A kísérletek futó rekordjai újratölthetők; a többi művelet eredeti kezelési
nézetében a szerveren tárolt állapot ellenőrizhető. A böngésző bezárása nem
állítja le a háttérmunkát.

Az önmagában HTTP 202-t adó, követhető futás-/műveletazonosító nélküli válasz
nem jelenik meg kész háttérmunkaként: külön ellenőrzési teendőt mutat.
A skill-run keresés a legfrissebb jelentéseket kéri, a backend legfeljebb
500-at ad vissza; hiányzó jelentésből nem következtet sikerre vagy hibára,
a követés végül kézi ellenőrzést kér.
Bejelentkezés és kijelentkezés nem függ a hitelesítés után betölthető
műveleti útmutatótól.

A capability-mátrix **1.2.0**: a két új állapotolvasó UI-kötés miatt
123 elérhető, 31 explicit hiányzó és 1 infrastrukturális bejegyzés,
összesen továbbra is 155 bejegyzés / 170 HTTP-művelet. Az új `reader`
hívások az önálló forrásauditba is bekerültek. A még hiányzó képességek
a 26.7 paritási auditban maradnak nyitva.

[Roadmap](../TASKS.md), [ellenőrzési napló](../PHASE26_PROGRESS.md),
[előző: jóváhagyási magyarázatok](phase26-3-operation-reviews.md).
