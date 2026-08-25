# ADR-0002: online adminmódosítások az engine tickjén

## Állapot

Elfogadott.

## Döntés

Online játékos hiteles állapotát kizárólag az engine módosíthatja. A gateway az
adminfelület kérését típusos, rövid életű belső paranccsá alakítja, az engine pedig
a következő world tick elején ellenőrzi és hajtja végre.

Az első ilyen művelet, a teleport, csak verziókezelt allowlistben szereplő
célpontazonosítót fogad el. A gateway és az engine ugyanazt a konfigurációt olvassa;
nyers koordináta nem megy át a belső API-n. A belső végpontot futásonként generált,
a botkliensnek át nem adott token védi.

## Indoklás

- A futó játékos mentésfájljának átírását az engine később felülírhatná, vagy az
  állapot megsérülhetne.
- A kliens nem hiteles állapotforrás, ezért egy kliensoldali pozícióváltoztatás nem
  lehet adminművelet.
- A world tick határán a player, script, interaction és collision állapot együtt,
  determinisztikusan ellenőrizhető.
- Az allowlist és a kettős validálás megakadályozza, hogy módosított böngészőkérés
  falba, nem betöltött területre vagy tetszőleges koordinátára mozgassa a játékost.

## Következmény

Az új online adminmódosításoknak ugyanezt az utat kell követniük: helyi
jogosultságvédelem és audit a gatewayben, külön belső hitelesítés, rövid életű
parancs, majd engine-tickben végzett ismételt validálás és atomi módosítás. A
közvetlen save-írás és a böngészőből elérhető engine-módosító végpont nem elfogadott.
