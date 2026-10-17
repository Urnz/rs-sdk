# 26. fázis – megvalósítás és ellenőrzés

## 26.1 – Felhasználói feladatok szerinti adminfelület (2026-10-17)

Elkészült a meglévő admin információs architektúrájának átszervezése.
Négy csoportban 13 nézet, új Áttekintés első lépésekkel és közvetlen
munkafolyamat-belépésekkel. Önálló nézetet kapott a vállalkozás/foglalkoztatás,
az ajánlat/szerződés, a világszabály/ingatlan és a világesemény. A képességhiányok
és próbák a Képességekhez, a döntési események a Célok és önálló működéshez
kerültek. A globális fejléc szerver- és fiókváltásra szolgál, a műveleti gombok
a megfelelő nézetekben vannak.

Mindegyik nézet rövid cél-/előfeltétel-magyarázatot kapott. A HTML-beli
nézetlista közös forrása az oldalsó navigációnak, a mobilválasztónak és a
kezdőlap kártyáinak. A helyi hash-alapú navigáció támogatja a közvetlen linket,
újratöltést és Vissza/Előre működést, és nem írja át a dokumentum szerverét.
Szabványos hivatkozások, `aria-current`, címre helyezett fókusz és tartalomra
ugró billentyűzetes link segíti a használatot.

[Használat, menürend és határok](features/phase26-1-admin-workflows.md).

### Kiválasztott ellenőrzési kör

Érintett modul: `server/gateway/admin/public`, fogyasztója a gateway és az
önálló control plane. Megváltozott határok: HTML/JS nézetkapcsolat,
áthelyezett űrlapok és eseménykezelők, nézethez kötött adatfrissítés, mobil- és
billentyűzetes navigáció. Az admin és control-plane tesztcsomag, az új valódi
Chrome-próba, root TypeScript és módosított sorok formázása volt indokolt.

Az engine és webclient kódja, API-szerződés, hitelesítés/jogosultság,
adatmodell, runtime-függőség és tesztfelderítés nem változott. Emiatt engine/
webclient typecheck és teljes `verify:full` nem volt szükséges. Az új teszt
a meglévő admin tesztkönyvtárban van, amelyet a root typecheck is lefed.

### Eredmények és exact bizonyítékok

- **Érintett modulok: 424/424 PASS, 0 skip, 90 fájl, 87,96 s.** Parancs:
  `bun test server/gateway/admin server/control-plane/test`.
  A közös wrapper ezután root typechecket indított, amely két új tesztbeli
  DOM-iterálást elutasított (`TS2488`); ezért a teljes parancslánc exitje 2
  maradt, a formázási lépés itt nem indult el. Ez nem zöld teljes kapu.
  Wrapperidő **103,671 s**; napló:
  `.local/verification/20261017-162139-212-phase26-1-affected.log` és azonos
  nevű `.result.json`.
- **Javítás utáni végső kör: PASS, exit 0, 18,575 s.** A tesztben
  `Array.from` váltotta a NodeList spreadet a repository DOM-libjével való
  kompatibilitáshoz. Parancs:
  `bun test server/gateway/admin/navigation-browser.test.ts && bun run typecheck && bun run format:check`.
  Az új Chrome-eset **1/1 PASS**, root TypeScript és formázás **PASS**.
  Napló: `.local/verification/20261017-162346-739-phase26-1-final.log` és
  azonos nevű `.result.json`. A 424 sikeres modultesztet nem ismételtük:
  a végső javítás kizárólag az új teszt DOM-iterálását érintette.
- **Szerkezeti ellenőrzés PASS:** a korábbi HTML mind a 213 elem-ID-ja
  megmaradt, a jelenlegi 219 ID mind egyedi.
- **Dokumentáció:** mind a 39 helyi hivatkozás feloldható. A dokumentáció
  utóellenőrzésénél a sandboxos Bun-indítás `CouldntReadCurrentDirectory`
  hibát adott (0,684 s, `20261017-162458-789-phase26-1-docs.log`). A formázó
  ugyanazon PowerShell-scriptjének közvetlen futtatása PASS, exit 0,
  **1,042 s**, `20261017-162505-756-phase26-1-docs.log`.
- **Vizuális ellenőrzés:** az új kezdőlap 1440 px és 390 px szélességen
  képen átnézve. A böngészős teszt mind a 13 nézetben ellenőrzi, hogy nincs
  vízszintes dokumentumtúlcsordulás. Képek:
  `.local/verification/phase26-1-desktop.png`, `phase26-1-mobile.png`.

A Chrome-eset tényleges login és control-plane HTTP mellett, szintetikus,
memóriabeli fiók/regiszter és izolált gateway-válaszok használatával fut.
Elfogadott láncok: szerverlista → Áttekintés → területi nézet → megfelelő
űrlap; karakterindítás/pillanatkép/világkezelés ablakának megnyitása;
billentyűzetes nézetváltás és tartalomra ugrás; mobilválasztó és kártyalink;
Vissza/Előre, közvetlen link és reload; backendhiba melletti navigáció;
ismeretlen hash visszavezetése. A teszt végig ellenőrzi a szerverfejlécet és
azt, hogy navigációból nem keletkezik módosító backendkérés.

Az első sandboxos Chrome-indítás `Code 34` hibával leállt (1,089 s,
`20261017-161909-325-phase26-1-navigation.log`); ezt nem számítottuk PASS-nak.
A sandboxon kívüli első próba egy tesztfixture-hibát jelzett: a csak hashben
eltérő URL nem töltötte újra a dokumentumot az offline ellenőrzéshez.
Explicit reload után a külön navigációs kör PASS lett (3,051 s,
`20261017-162048-353-phase26-1-navigation.log`). A végső, billentyűzetes
esettel bővített változatot a fenti érintett és végső kör igazolja.

### Elfogadási határ

A 26.1 lezárható. Ez célzott modul-/UI-elfogadás, nem teljes regressziós PASS,
nem minden backendművelet paritási igazolása és nem élő társadalmi futás.
A 26.2 capability-mátrix, a további műveleti visszajelzések, részletes
kontextusos súgók és a végső teljes UX/hozzáférhetőségi audit nyitva maradnak.
Következő feladat: **26.2**.
