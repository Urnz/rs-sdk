/** Local, read-only guidance. Opening help never submits a form or calls the backend. */
export const workflowGuides = {
    overview: {
        title: 'Az első ellenőrzés ezen a szerveren',
        before: 'Ellenőrizd a fejlécben a kiválasztott szerver nevét és a kapcsolat állapotát.',
        steps: ['A Karakterek nézetben keress egy online karaktert, vagy indíts egyet.',
            'A Célok és önálló működés alatt keresd meg a hozzá kapcsolt döntéshozót és a célját.',
            'Az AI és költségkeret alatt ellenőrizd a működési kapcsolókat és a keretet, mielőtt önálló munkát engedélyezel.'],
        expected: 'A karakter online, a döntéshozó a megfelelő karakterhez tartozik, és az indított munka a Műveletek listában követhető.',
        trouble: 'Ha a szerver nem válaszol, előbb a Saját szervereim oldalon ellenőrizd az állapotát. A nulla adat önmagában nem bizonyít hibát.',
        terms: { Karakter: 'A játékvilágban mozgó bot.', Agent: 'Tartós döntéshozó: céljai, emlékei és megtanult képességei vannak.' },
        links: [['#bots', 'Karakterek'], ['#agents', 'Célok és önálló működés'], ['#llm', 'AI és költségkeret']]
    },
    bots: {
        title: 'Karakter indítása és egy feladat kipróbálása',
        before: 'A helyi játékszerver legyen elérhető. Új karakterhez a helyi bot bejelentkezési adataira lesz szükség.',
        steps: ['Válaszd a + Karakter indítása gombot, ellenőrizd a nevet és hagyd jóvá az indítást.',
            'Várd meg az Online állapotot. A névre kattintva ellenőrizheted a karakter részleteit.',
            'A karakter sorában válassz egy ellenőrzött képességet, olvasd el a leírását és a paramétereit, majd kövesd a futást a Képességek és próbák alatt.'],
        expected: 'Az indítás és a feladat eredménye a Műveletek listában, a lezárt feladat jelentése a képességfutások között jelenik meg.',
        trouble: 'Ha a karakter nem válaszol, ellenőrizd az utolsó adat idejét és a szerver kapcsolatát. Ha már fut feladata, várd meg vagy állítsd le azt az új indítás előtt.',
        terms: { Online: 'A karakter friss játékállapotot küld.', 'Verified skill': 'Ellenőrzött, verziózott végrehajtható képesség; például egy meghatározott gyűjtési feladat.' },
        links: [['#skills', 'Futási jelentések'], ['servers.html', 'Saját szervereim']]
    },
    agents: {
        title: 'Céltól az önálló feladatig',
        before: 'Játékos szerepű agenthez ugyanahhoz a karakterhez tartozó, friss online állapot szükséges. Az intézményi döntéshozónak nincs saját mozgatható karaktere.',
        steps: ['Hozz létre vagy válassz agentet, és ellenőrizd a karakterkapcsolatát.',
            'Adj neki érthető célt. Végrehajtható munkához aktív azonnali feladat és megtanult, ellenőrzött képesség is kell.',
            'Ellenőrizd az AI keretét és az engedélyezett képességeket, majd az önálló működés kapcsolóját. A döntési naplóban keresd az indítást vagy a kihagyás okát.'],
        expected: 'A döntési napló megmondja, indult-e feladat, jóváhagyásra vár-e javaslat, vagy melyik előfeltétel hiányzik.',
        trouble: 'A hozzáférés megadása és a képesség megtanulása külön lépés. Üres képességlista esetén mindkettőt, valamint az adott verziót is ellenőrizd.',
        terms: { Grant: 'Hozzáférési jogosultság, például tagság, oktatói kapcsolat vagy licenc.', 'Azonnali feladat': 'A célhierarchia most végrehajtható lépése; mentése új döntést is kiválthat.' },
        links: [['#llm', 'AI beállítások'], ['#skills', 'Képességek és eredmények']]
    },
    map: {
        title: 'Egy karakter megkeresése a térképen',
        before: 'A térképhez friss játékállapot szükséges.',
        steps: ['Nyisd meg a térképet, és válassz karaktert a listából.', 'A térképet húzással mozgathatod, görgetéssel nagyíthatod. A kiválasztott karakterre fókuszálhatsz.'],
        expected: 'A karakter helye frissül; a térkép megnyitása nem lépteti be vagy mozgatja át a karaktert.',
        trouble: 'Hiányzó pozíciónál a Karakterek nézetben nézd meg, online-e a karakter és mikori az utolsó adata.',
        terms: { Szint: 'A térkép magassági rétege; azonos koordinátán több réteg is lehet.' }, links: [['#bots', 'Karakterállapotok']]
    },
    economy: {
        title: 'Pénz- és készletváltozás ellenőrzése',
        before: 'Válassz egy konkrét karaktert vagy megfigyelt időszakot; a grafikon és az eseménylista eltérő nézetet ad.',
        steps: ['Nézd meg az összesített pénzt és készletet, majd szűrd a gazdasági eseményeket karakterre vagy típusra.',
            'A bejövő és kimenő tárgyakat a pénzmozgással együtt vizsgáld. Bankmozgatásnál ugyanaz a vagyon kerülhet másik tárolóba.'],
        expected: 'Az eseményekből megállapítható, melyik tevékenységhez tartozik a megfigyelt változás.',
        trouble: 'Ha nem látszik esemény, előbb töröld a szűrőket és ellenőrizd az adatfrissítést; ne indíts új tranzakciót csak emiatt.',
        terms: { gp: 'Játékbeli pénzegység.', Nettó: 'A bejövő és kimenő mennyiségek különbsége.' }, links: [['#contracts', 'Szerződések'], ['#society', 'Társadalmi mutatók']]
    },
    businesses: {
        title: 'Vállalkozás és munkavégzés előkészítése',
        before: 'Létező tulajdonos agent kell. Az ingatlan megadása opcionális; egy azonosító beírása nem vásárol ingatlant.',
        steps: ['Az Új vállalkozás alatt adj stabil azonosítót, nevet és tulajdonost.',
            'A létrejött vállalkozás részleteiben ellenőrizd a szerepeket és az alkalmazottakat. A tulajdonos külön szerep, nem alkalmazott.',
            'Munkavégzés előtt ellenőrizd a jóváhagyott működési szabályt, a munkakör képességét és a fedezetet; a player agentnek a megbízást külön el kell fogadnia.'],
        expected: 'A vállalkozás megjelenik a listában. Létrehozása önmagában nem indít karaktert vagy munkafutást.',
        trouble: 'Hiányzó dolgozó vagy indítható munka esetén a foglalkoztatást, a jóváhagyott szabályt, a megtanult képességet és az online karaktert ellenőrizd. A Vállalkozási szerepkörök és feladatok kártya elmondja a támogatott szerepeket.',
        terms: { Business: 'Tartós vállalkozási nyilvántartás tulajdonossal és szerepekkel.', Policy: 'Jóváhagyott működési szabály; a javaslat még nem aktív szabály.' },
        links: [['#agents', 'Agentek és megbízások'], ['#world', 'Ingatlanok']]
    },
    contracts: {
        title: 'Ajánlattól az igazolt teljesítésig',
        before: 'Két külön agentet válassz. Tisztázd, ki milyen pénzt, tárgyat vagy szolgáltatást vállal.',
        steps: ['Töltsd ki az Új ajánlat két oldalát; a tárgysorokban az azonosító, darabszám és név sorrendjét tartsd meg.',
            'Ellenőrizd az ajánlatot és a címzett elfogadását. Az elfogadott szerződés még nem bizonyít teljesítést.',
            'Szolgáltatásnál a lezárt, megfelelő képességfutás bizonyítékát rögzítsd, majd ellenőrizd a szerződés teljesítési és elszámolási állapotát.'],
        expected: 'Az ajánlatból szerződés lesz; a teljesítési bizonyíték és az elszámolás külön ellenőrizhető.',
        trouble: 'Ha az elszámolás hibás vagy bizonytalan, a szerződés állapotát és a futásazonosítót olvasd vissza. Ne hozz létre második ajánlatot ugyanennek a rendezésére.',
        terms: { 'Futásazonosító / run ID': 'Egy konkrét feladatfutás hivatkozása.', Bizonyíték: 'A végrehajtásról rögzített, ellenőrizhető eredmény; a vállalás szövege nem helyettesíti.' },
        links: [['#skills', 'Lezárt képességfutások'], ['#agents', 'Résztvevő agentek']]
    },
    society: {
        title: 'Egy időszak társadalmi mutatóinak lekérése',
        before: 'Válassz kezdő- és végidőt, valamint pontos agentlistát. Az időpontok UTC-ben értendők.',
        steps: ['Az Óraadatok kitöltése gombbal kérd le a világ órájának adatait, majd állítsd be az időablakot és a riportkohorsz mezőben a vizsgált agentek azonosítóit.',
            'Kérd le a mutatókat, majd a Források, lefedettség és korlátok alatt ellenőrizd, milyen adatokra támaszkodik a jelentés.'],
        expected: 'Az adott időszak és agentcsoport eredménye látható; a lefedettségi hiányok külön jelzettek.',
        trouble: 'Üres vagy hiányos eredménynél ellenőrizd az időablakot, az agentazonosítókat és a források lefedettségét. Ha az óra nem olvasható, ne találj ki azonosítót vagy lenyomatot. A hiányzó adat nem azonos a nulla teljesítménnyel. A külön riportokba átveheted ezt az időablakot; utánpótláshoz, örökléshez és tudásátadáshoz előbb töltsd be az oldal tetején a választható adatokat.',
        terms: { Kohorsz: 'A vizsgálathoz kiválasztott agentcsoport.', UTC: 'Egységes időzóna; az ISO időpont végén a Z ezt jelöli.' }, links: [['#economy', 'Gazdasági események']]
    },
    skills: {
        title: 'Képességpróba és ellenőrzött publikálás',
        before: 'A draft fejlesztési változat. A kézi próba is valódi játékállapotot módosít; külön tesztkarakterrel dolgozz.',
        steps: ['A kézzel próbálható draftnál olvasd el a paramétereket és a korlátokat. A hiányzó képességhez kötött tesztpróbát a Hiányzó képességek listájából indíthatod.',
            'A Draft próbák és publikálás alatt ellenőrizd a kijelölt tesztkaraktert és a pontos verziót. Két egyező sikeres futás után kérj bizonyíték-ellenőrzést.',
            'Csak sikeres ellenőrzés után hagyd jóvá a publikálást. Ezután az agentnél külön ellenőrizd a tanulást és az automatikus használat engedélyét.'],
        expected: 'A próba futási jelentése és ellenőrzési eredménye visszakereshető; a publikálás külön jóváhagyott lépés.',
        trouble: 'Ha nincs publikálási lehetőség, nézd meg a sikertelen ellenőrzéseket és az elfogadott futások számát. A kézi draftfuttatás önmagában nem helyettesíti a tesztpróba bizonyítékait.',
        terms: { Draft: 'Ellenőrzésre váró fejlesztési változat.', Verifier: 'A tesztpróba bizonyítékait ellenőrző lépés.', Publikálás: 'Az ellenőrzött képesség közzététele a helyi katalógusban; nem automatikus használati engedély.' },
        links: [['#bots', 'Tesztkarakter ellenőrzése'], ['#agents', 'Tanulás és hozzáférés'], ['#llm', 'Automatikus használat engedélyei']]
    },
    experiments: {
        title: 'Egy közös kísérlet kipróbálása',
        before: 'Legalább két online, játékos szerepű agent kell, külön karakterekkel. A kiválasztott profil alkalmazott értékeinek egyezniük kell a világ aktív beállításaival.',
        steps: ['Hozz létre vagy válassz verziózott paraméterprofilt. Az alkalmazható profilrészeket a profil kártyáján külön alkalmazd; a profil mentése önmagában nem állítja át a világot.',
            'Adj nevet és seedet, válassz pontos profilverziót és legalább két résztvevőt, majd ellenőrizd és hagyd jóvá az indítást.',
            'A Műveletek listában kövesd a futást. A kísérlet Agentenkénti eredmények részében ellenőrizd a feladatokat; összehasonlításhoz előbb várd meg a hibamentes lezárást.'],
        expected: 'A futás azonosítóval megjelenik; előbb feladatkiosztás, majd futás és lezárt vagy részleges eredmény látható.',
        trouble: 'Ha nem választható egy résztvevő, ellenőrizd az online állapotát és az egyértelmű karakterkapcsolatát. Profilhibánál az aktív világbeállításokat, futási hibánál a célokat és az AI keretét nézd meg.',
        terms: { Seed: 'Rögzített kiinduló érték a reprodukálható választásokhoz; azonos seed önmagában nem jelent azonos kezdő világállapotot.', Profilverzió: 'Változtathatatlan paraméter-összeállítás. Módosításhoz új verzió kell.', Pillanatkép: 'Mérési adatfelvétel; nem visszaállítható szervermentés.' },
        links: [['#agents', 'Résztvevők és célok'], ['#world', 'Aktív világszabályok'], ['servers.html', 'Visszaállítható szervermentések']]
    },
    world: {
        title: 'Világszabály módosítása és visszaellenőrzése',
        before: 'A Szabályok és ingatlanok megnyitása gombbal nyisd meg a kezelőt. Nézd meg az aktuális állapotot és az aktiválási módot.',
        steps: ['Módosíts egy kiválasztott szabályt, és a jóváhagyási ablakban ellenőrizd a hatást és a helyreállítás módját.',
            'Mentés után ellenőrizd, hogy aktív lett-e a változás, vagy újraindítás/migráció szükséges. A konfiguráció mentése nem minden esetben jelent aktiválást.',
            'Visszaállításhoz válaszd ki a megfelelő konfigurációmentést. Teljes világmentést a Saját szervereim oldalon kezelhetsz.'],
        expected: 'A kért konfiguráció és az aktív állapot megkülönböztethető; a Műveletek lista jelzi a fennmaradó teendőt.',
        trouble: 'Állapotverzió-ütközésnél frissítsd az adatokat és hasonlítsd össze az új állapotot a tervezett módosítással. Aktiválási hibánál ne ismételd meg vakon a teljes mentést. Világkezdethez az alábbi kártyákon ellenőrzött tervfájlt választhatsz; visszaállítás előtt frissítsd a korábbi alkalmazásokat.',
        terms: { 'Hot reload': 'Az ezt támogató szabály újraindítás nélküli aktiválása.', Revízió: 'Állapotverzió; védi a frissebb változásokat a régi űrlap felülírásától.', Konfigurációmentés: 'A kért szabályértékek mentése; nem a teljes világ és játékosállapot másolata.' },
        links: [['servers.html', 'Teljes világmentés és újraindítás'], ['#experiments', 'Kísérleti paraméterprofilok']]
    },
    'world-events': {
        title: 'Esemény előnézetétől a játékbeli jelzésig',
        before: 'Az előnézethez seed és cikluskulcs kell. A játékbeli jelzéshez az automatikus kézbesítés és a World Director világjelzések szabály is szükséges.',
        steps: ['Először az Esemény előnézete gombot használd, és olvasd el a kiválasztott eseményt.',
            'Ha valóban kézbesíteni szeretnéd, ellenőrizd az automatikus ciklusok kapcsolóját és a Világszabályok alatt a World Director világjelzések módosítást.',
            'A Tartós ciklus sorba állítása már mentett munkát hoz létre. A ciklusnaplóban kövesd a kézbesítést; a feldolgozás a következő 30 másodperces ciklustól történik.'],
        expected: 'Az előnézet még nem küld játékbeli eseményt. A sorba állított ciklus és a tényleges kézbesítés külön állapottal követhető.',
        trouble: 'Ha nem jelenik meg jelzés, előbb a két engedélyező beállítást és a ciklusnaplót nézd meg. Ne hozz létre új ciklust pusztán a késleltetés miatt.',
        terms: { Cikluskulcs: 'Egy eseményciklus stabil megnevezése; például day:1.', Kézbesítés: 'A kiválasztott esemény továbbítása a játékvilágnak, az előnézeten túl.' },
        links: [['#world', 'Világjelzések beállítása']]
    },
    llm: {
        title: 'AI-beállítások és egy kézi próba',
        before: 'Ellenőrizd a szolgáltatót, a modellt, a kulcs állapotát és a költségkeretet. A kulcs értéke nem olvasható vissza.',
        steps: ['Olvasd át a működési kapcsolókat és a korlátokat; külön döntés az újratervezés és a képességek automatikus végrehajtása.',
            'Mentés után az agent kézi AI-próbájában először előnézetet kérj, és olvasd el az indoklást és a képességfeloldást.',
            'Csak a kívánt, ellenőrzött képességeket engedélyezd automatikusan. Céltervjavaslat esetén külön emberi jóváhagyás szükséges.'],
        expected: 'A mentett beállítás a következő AI-hívásra érvényes; a kézi előnézet önmagában nem módosítja az agent céljait.',
        trouble: 'Elmaradó futásnál a döntési naplóban nézd meg a keret-, jogosultság- vagy képességhiány okát. A kulcs üresen hagyása mentéskor megtartja a meglévő kulcsot.',
        terms: { 'Dry-run': 'Kézi AI-próba: a modellhívás a beállított keretet használja, de az előnézet még nem engedélyez játékbeli végrehajtást.', Allowlist: 'Az automatikusan használható képességek és korlátaik listája.', 'Mikro-USD': 'Egy USD egymilliomod része: 1 000 000 mikro-USD = 1 USD.' },
        links: [['#agents', 'Agent kiválasztása és döntési napló'], ['#skills', 'Képességek és verziók']]
    },
    servers: {
        title: 'Szerver létrehozása, mentése és helyreállítása',
        before: 'Ellenőrizd a szerverkártya nevét és a hozzáférésedet. Indítást/leállítást üzemeltető is kérhet; mentést, migrációt és archiválást tulajdonos kezel.',
        steps: ['Új helyi szervernél válassz nevet, forrásverziót és világsablont. A létrehozás után külön Indítás szükséges; karakter és AI nem indul automatikusan.',
            'Mentés készítése után várd meg a befejezést. A Mentések betöltése gombbal kérd le a listát, és dátum/verzió alapján válassz visszaállítandó mentést.',
            'Visszaállítás vagy Verzió frissítése előtt olvasd el a jóváhagyást. A világ leállhat, és a művelet után leállítva marad; ellenőrizd az eredményt, majd szükség esetén külön indítsd el.'],
        expected: 'A Műveletek listában befejezés és az érintett szerver látható. A szerverkártya mutatja az aktuális állapotot és a forrásverziót.',
        trouble: 'Ha nincs karbantartási gomb, ellenőrizd a tulajdonosi hozzáférést, a szerver állapotát és azt, hogy kezelt helyi szervert választottál-e. Bizonytalan eredménynél előbb állapotot olvass vissza.',
        terms: { Világsablon: 'Az új világ induló összeállítása.', Világmentés: 'Visszaállítható helyi szervermentés; különbözik a kísérleti mérési pillanatképtől.', Archiválás: 'Leállítás és archivált állapot; ezen a felületen nincs visszaaktiválás.' },
        links: [['account.html', 'Fiók és hozzáférések']]
    },
    account: {
        title: 'Új fiók és a megfelelő szerverhozzáférés',
        before: 'A saját fiók, a játékbeli karakter és az agent külön fogalom. Más fiók szerverhozzáférését a tulajdonos adhatja meg.',
        steps: ['Új fiókot a helyi alapértelmezett szerver tulajdonosa hozhat létre. A létrehozás önmagában nem ad szerverhozzáférést; más szerver tulajdonosaként a meglévő fiókok szerepkörét kezelheted.',
            'A kívánt szerver kártyáján nyisd meg a Hozzáférések kezelése hivatkozást, majd ott válaszd ki és mentsd a szükséges szerepkört.',
            'Kérd meg a felhasználót, hogy a saját fiókjával ellenőrizze a Saját szervereim listát. Jelszócsere vagy saját munkamenet visszavonása után új bejelentkezés kell.'],
        expected: 'A hozzáférés a kiválasztott szerverre szól. A néző megfigyelhet, az üzemeltető indíthat/leállíthat, a tulajdonos teljes kezelést végezhet.',
        trouble: 'Ha nincs szerepkörválasztó, a szerverkártyáról nyisd meg ezt az oldalt, és ellenőrizd a tulajdonosi hozzáférést. Az új fiók üres szerverlistája hozzáférés hiányát is jelentheti.',
        terms: { Munkamenet: 'Egy bejelentkezés; visszavonása az adott bejelentkezést lezárja.', Tulajdonjog: 'Teljes kezelési jog a megjelölt szerverhez; a helyi alapértelmezett szerver tulajdonosi listája külön is látható.' },
        links: [['servers.html', 'Szerver és hozzáférés kiválasztása']]
    },
    observations: {
        title: 'Mit ellenőrizhetsz megfigyelőként?',
        before: 'A fejlécben a kiválasztott szerver neve legyen látható.',
        steps: ['A Kapcsolat alatt ellenőrizd az admin kapcsolatát és a játékszervert.',
            'A szimulációs időt és a populációt együtt olvasd; a Frissítés új adatot kér. Részletes kezeléshez a szerver tulajdonosától kérhetsz hozzáférést.'],
        expected: 'A megfigyelési adatok vagy a hiányzó kapcsolat oka látható. Az oldal nem módosítja a játékvilágot.',
        trouble: 'Ha az egyik adatforrás nem érhető el, attól a másik még válaszolhat. Ellenőrizd a kiválasztott szervert és a kapcsolati jelzéseket.',
        terms: { 'Szimulációs idő': 'A helyi játékvilág saját ideje; eltérhet a számítógép naptári idejétől.' }, links: [['servers.html', 'Saját szervereim']]
    }
};

export const fieldHints = [
    ['#multi-agent-experiment-form [name="parameterProfile"]', 'A profil neve és verziója együtt azonosítja a bemenetet. Mentés után a profil kártyáján külön alkalmazhatók a világbeállítások.'],
    ['#multi-agent-experiment-form [name="seed"]', 'Összehasonlításhoz ugyanazt a seedet használd, és a résztvevőket, a kezdőállapotot és a világbeállításokat is egyeztesd.'],
    ['#experiment-parameter-profile-form [name="version"]', 'Például 1.0.0. Meglévő profil tartalma nem írható át: módosításhoz készíts új verziót.'],
    ['#experiment-parameter-profile-form [name="parameters"]', 'A JSON a mezőben látható négy listát várja: respawns, xpRewards, marketPrices, finishedProducts. Tartsd meg a szerkezetet; a célpont- és tárgyazonosítókhoz ellenőrzött adatot használj.'],
    ['#economic-offer-form [name="creatorItems"]', 'Soronként: tárgyazonosító,darabszám,név. Példa: 436,100,Copper ore. Csak pénzt vállaló oldalon a tárgylista üresen maradhat.'],
    ['#economic-offer-form [name="counterpartyItems"]', 'Ugyanaz a sorrend: tárgyazonosító,darabszám,név; minden tétel külön sorba kerüljön.'],
    ['#business-form [name="businessId"]', 'Tartós hivatkozási név, például varrock-forge. Válassz egyértelmű azonosítót, és később is ezt használd a vállalkozás hivatkozásakor.'],
    ['#business-form [name="propertyId"]', 'Opcionális hivatkozás a Világszabályok és ingatlanok katalógusából. Beírása nem vásárol ingatlant és nem ad használati jogot.'],
    ['#society-scope [name="from"]', 'UTC ISO időpont, például 2030-01-01T00:00:00.000Z. A kezdet legyen korábbi a végidőnél.'],
    ['#society-scope [name="actors"]', 'Az agentek stabil azonosítóit add meg, például ada, bea; nem a karakterek megjelenített neveit.'],
    ['#society-scope [name="clockId"]', 'A világ szimulációs órájának azonosítója. Az Óraadatok kitöltése gombbal kérd le; nem kell megjegyezned vagy kitalálnod.'],
    ['#society-scope [name="clockProfileDigest"]', 'Az óra beállításainak ellenőrző lenyomata. Az Óraadatok kitöltése együtt tölti az óraazonosítóval; csak ugyanahhoz az órához tartozó értéket használj.'],
    ['#world-director-config-form [name="epoch"]', 'Az ütemezés UTC kezdőpontja ISO formában, például 2030-01-01T00:00:00.000Z. Nem a következő esemény kézi indítógombja.'],
    ['#world-director-preview-form [name="cycleKey"]', 'Például day:1. Azonos seed és cikluskulcs ugyanazzal a jóváhagyott sablonkészlettel azonos eseményverziót választ.'],
    ['#llm-settings-form [name="maxCostMicros"]', 'Mikro-USD: 1 000 000 = 1 USD, 10 000 = 0,01 USD. A futási és a napi keretet külön ellenőrizd.'],
    ['#llm-settings-form [name="maxDurationMs"]', 'Milliszekundum: 1 000 = 1 másodperc, 60 000 = 1 perc. Ez az AI-futás időkorlátja.'],
    ['#agent-goal-form [name="horizon"]', 'Az életcél hosszabb irány, az azonnali feladat a most végrehajtható lépés. Az azonnali cél mentése új döntést is kiválthat.'],
    ['#skill-form [name="skill"]', 'A képesség azonosítója és verziója együtt számít. Előbb olvasd el a leírást és a megjelenő paramétereket; az indítás valódi feladatot futtat.'],
    ['#server-create-form [name="version"]', 'A helyben elérhető forrásverziók közül válassz. A meglévő szerver verzióváltását a saját kártyáján találod.'],
    ['#password-form [name="password"]', 'Legalább 12 karakter. Mentés után minden jelenlegi munkameneted lezárul, ezen az eszközön is.']
];

function node(tag, value) { const element = document.createElement(tag); element.textContent = value; return element; }
function hrefFor(target) {
    const url = new URL(target, location.href), server = new URL(location.href).searchParams.get('serverId');
    if (server) url.searchParams.set('serverId', server);
    return url.pathname + url.search + url.hash;
}
export function renderGuide(root, key) {
    if (!Object.hasOwn(workflowGuides, key)) key = 'overview';
    const guide = workflowGuides[key];
    if (root.dataset.guide === key) return;
    const open = root.querySelector('details')?.open || false;
    const details = document.createElement('details'); details.className = 'workflow-help'; details.open = open;
    details.append(node('summary', `Rövid útmutató · ${guide.title}`));
    const body = document.createElement('div'); body.className = 'workflow-help-body';
    body.append(node('h3', 'Mielőtt elkezded'), node('p', guide.before), node('h3', 'Próbáld ki lépésről lépésre'));
    const steps = document.createElement('ol'); for (const step of guide.steps) steps.append(node('li', step));
    body.append(steps, node('h3', 'Ezt ellenőrizd az eredményben'), node('p', guide.expected), node('h3', 'Ha elakadnál'), node('p', guide.trouble));
    const terms = node('dl', ''); terms.className = 'workflow-terms';
    for (const [term, explanation] of Object.entries(guide.terms)) terms.append(node('dt', term), node('dd', explanation));
    body.append(node('h3', 'Fogalmak ezen a képernyőn'), terms);
    const links = node('nav', ''); links.setAttribute('aria-label', 'Az útmutató kapcsolódó nézetei');
    for (const [href, title] of guide.links) { const link = node('a', title); link.href = hrefFor(href); links.append(link); }
    body.append(links); details.append(body); root.replaceChildren(details); root.dataset.guide = key;
}
export function mountWorkflowHelp() {
    for (const root of document.querySelectorAll('[data-workflow-guide]')) {
        const show = () => renderGuide(root, root.dataset.workflowGuide === 'context' ? location.hash.slice(1) || 'overview' : root.dataset.workflowGuide);
        show(); if (root.dataset.workflowGuide === 'context') window.addEventListener('hashchange', show);
    }
    for (const [index, [selector, content]] of fieldHints.entries()) {
        const field = document.querySelector(selector);
        if (!field || document.getElementById(`workflow-hint-${index}`)) continue;
        const hint = node('small', content); hint.id = `workflow-hint-${index}`; hint.className = 'workflow-field-hint';
        const describedBy = new Set((field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)); describedBy.add(hint.id);
        field.setAttribute('aria-describedby', [...describedBy].join(' '));
        const label = field.closest('label');
        if (label) {
            // Keep explanatory text out of the control's accessible name.
            const wrapper = node('div', ''); wrapper.className = 'workflow-field';
            if (label.classList.contains('society-wide')) wrapper.classList.add('society-wide');
            label.replaceWith(wrapper); wrapper.append(label, hint);
        } else field.insertAdjacentElement('afterend', hint);
    }
}
if (typeof document !== 'undefined') mountWorkflowHelp();
