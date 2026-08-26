# Helyi baseline – 2026-08-26

## Verziók

- Upstream: `MaxBittker/rs-sdk`
- Kiinduló commit: `9cd3d7019ad3a8654ee31d22af3272d91fe1881e`
- Fejlesztői ág: `codex/bot-admin-dashboard`
- Git: `2.52.0.windows.1`
- Bun: `1.3.14` (`0d9b296af`)
- Node.js: `22.16.0` (a projekt futtatása Bun alatt történik)

## Ellenőrzött állapot

- Gyökér-, webclient- és engine-függőségek telepítve a lockfile-ok alapján.
- Webclient standard, bot és item-viewer build sikeres.
- Gateway: `localhost:7780`.
- Engine/webclient: `localhost:8888`.
- Game/login/logger/friend szolgáltatások elindultak EASY_STARTUP módban.
- Mind a hat SQLite-migráció sikeresen lefutott.
- Egyparancsos stack-kezelés, komponensenkénti naplók és egészségellenőrzések
  elérhetők a `scripts/` könyvtárban.
- Teljes ellenőrzés: 298 teszt sikeres, 0 sikertelen.

## Botadmin baseline

- Helyi adminfelület: `http://localhost:7780/admin/`.
- A katalógus 34 helyi játékosmentést egyesít az élő gateway- és
  agent-skill-állapottal.
- Ellenőrzött életciklus: egy offline bot adminfelületről spawnolva aktívvá vált,
  majd despawn után tisztán lecsatlakozott.
- Az offline save-olvasó CRC-ellenőrzéssel, írás nélkül szolgáltat skill, XP,
  pozíció, inventory, equipment, bank és pénz adatokat.
- A módosító műveletek helyi jogosultságvédelemmel, kötelező indoklással és
  `.local/admin/audit.jsonl` auditnaplóval futnak.
- A bot eltávolítása csak offline állapotban, pontos névmegerősítéssel lehetséges,
  és első körben visszaállítható karanténba mozgatást jelent.
- Az adminfelület csak a verziózott, `verified + shared` agent skilleket kínálja
  fel, a paraméterűrlapot a skill sémájából építi, és szerveroldalon is validálja.
- Online, helyi hitelesítő adatokkal rendelkező bothoz egy agent skill indítható;
  a futás külön naplót, aktív futásjelzőt és indítási/leállítási auditot kap.
- Online, éppen nem harcoló és agent skillt nem futtató bot az adminpanel öt
  jóváhagyott célpontjára teleportálható. A gateway és az engine ugyanazt a
  verziókezelt célpontlistát használja.
- A teleport nem a mentést vagy a klienst írja: egyszer használatos belső tokennel
  védett engine-parancs, amely a következő world tickben ismét ellenőrzi a játékost,
  a világot és a célmező collision állapotát.
- A teljesen offline bot mentése az adminpanelen szint/XP, pénz, inventory és bank
  szerint szerkeszthető. Az engine az eredeti `PlayerLoading`/`Player.save()` codecet
  használja, majd CRC-visszaolvasással ellenőrzi az eredményt.
- Minden edit és restore előtt változtathatatlan helyi backup készül a
  `.local/admin/save-backups/<bot>/` könyvtárban. Elavult editor, párhuzamos írás,
  online/bejelentkező/kijelentkező játékos és jogosulatlan belső kérés elutasítódik.
- Az admin-despawn engine-ticken indít kanonikus logoutot; az élő próbán 229 ms
  alatt lett a mentés engine-oldalon is szerkeszthető.
- Oda-vissza próba: 25 gp / Fishing 1 / üres extra készlet → 35 gp / Fishing 2
  (800 XP) / 1 copper ore / 2 raw lobster → eredeti állapot. A tesztbot végül
  ismét online, 25 gp-vel fut.
- Az adminpanel a legutóbbi 30 befejezett agent-skill futást időrendben mutatja:
  állapot, bot, skillverzió, időtartam, műveletszám, eredmény és lenyitható
  eseménylista. Az új naplók a bot nevét is tárolják; a régi naplók változatlanul
  olvashatók, ezeknél a bot neve „Korábbi futás”.
- Az adminból megnyitható élő világtérkép a szerver eredeti MapView rendererét
  ágyazza be. A 0,75 másodpercenként frissülő pozícióréteg mellett külön online
  botlista, koordináta-alapú fókusz, kijelölt bot kiemelése és Spectate-átjárás
  érhető el. A fókuszüzenetet a MapView csak azonos protokollú és hostnevű helyi
  admineredettől fogadja el, a koordinátát pedig a renderelt tér saját
  underground/overworld transzformációjával számolja.

## Smoke teszt

- Tesztbot: `32WTGxrvt`.
- Headless lite clienttel belépett a helyi világba.
- A tutorial átugrása sikerült.
- Fát talált és kivágta.
- Megfigyelt eredmény: `Woodcutting +625 XP`.
- Külön manuális játékosfiókkal a bot ugyanabban a világban látható volt.

## Mentés–visszaállítási próba

- Próba mentés: `backups/phase4-drill-20260819` (helyi, Git által figyelmen kívül hagyva).
- Mentett állományok: SQLite adatbázis és WAL/SHM, valamint két játékosmentés;
  összesen 5 fájl.
- A visszaállítás előtt automatikus védőmentés készült.
- A visszaállítás utáni SHA-256 ellenőrzés sikeres volt.
- Újraindítás után az engine, webclient és gateway egészséges, a tesztbot aktív
  és játékban van.

## Agent-skill baseline

- Önálló `agent-skills/` modul: validálás, registry, per-agent tudáskönyv,
  shared/private fájltár, korlátos végrehajtó, rs-sdk adapter és auditjournal.
- Megosztási kísérleti módok: `shared-library` és `isolated-discovery`.
- Agent által benyújtott skill csak saját provenance-szal és `draft` állapotban
  menthető; más agent automatikusan csak `verified + shared` skillt fedez fel.
- Első verified skill: `mining.varrock-east.copper-to-bank@1.0.0`.
- Három sikeres élő ciklusban a bot 8-8 rézércet bányászott és bankolt; a teljes
  bank–bánya–bank útvonal is megismételhetően működött.
- Első tartós verified audit: run `088fce52-901d-437f-8e66-196ccdfce079`, helyileg
  `.local/agent-skills/runs/088fce52-901d-437f-8e66-196ccdfce079.json`.
- Verified fishing + banking skill: `fishing.karamja.lobster-to-draynor-bank@1.0.0`.
- A teljes Port Sarim → Karamja → fishing → vám → Port Sarim → Draynor bank
  élő útvonal sikeres volt: run `e0415a5f-bb64-4607-8c8c-f67f0973c170`, 16
  skill-művelet, 18 fishing-spot újracélzás, majd `Raw lobster x1` bankolás.
- A mozgó erőforrások kezelése inventory- vagy XP-változásig újracéloz; a komp
  párbeszédei kizárólag előre engedélyezett érdemi válaszokat fogadnak el.
- A második teljes fishing audit is sikeres volt: run
  `1f149254-9397-4437-ab9c-c5fd9db891e0`, 45 fishing-spot újracélzással.
- További verified skillek: `production.varrock.bronze-daggers@1.0.0`,
  `shopping.lumbridge.buy-hammers@1.0.0` és `trade.lumbridge.give-item@1.0.0`.
- A production, shopping és trade skillek két-két független élő auditban sikerültek;
  a trade fogadó inventoryját a futtató külön ellenőrizte.

## Windows-megjegyzések

- A generált `sdk/API.md` LF sorvéget igényel, mert a teszt byte-pontosan hasonlít.
- A lite cache útvonalához `homedir()` használata szükséges, mert Windows alatt a
  `HOME` környezeti változó hiányozhat.
- A Bun telepítés utáni már futó alkalmazások nem feltétlenül látják az új PATH
  értéket; új terminálban a `bun --version` paranccsal ellenőrizhető.
