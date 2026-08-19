# Helyi fejlesztés

Ez a dokumentum az upstream fork klónozása után tölthető ki ténylegesen ellenőrzött
verziókkal és parancsokkal.

## Upstream által leírt alapfolyamat

1. Gyökérfüggőségek telepítése: `bun install --frozen-lockfile`.
2. Webclient függőségek telepítése a `server/webclient` könyvtárban.
3. Game engine indítása a `server/engine` könyvtárból: `bun run start`.
4. Webclient indítása a `server/webclient` könyvtárból: `bun run watch`.
5. Gateway indítása a `server/gateway` könyvtárból: `bun run gateway`.
6. Lokális botnál a `SERVER` változó maradjon üres.
7. Az ellenőrzések futtatása: `bun run check`.

## Első futáskor rögzítendő

- Git, Bun és Node verziója.
- Upstream commit azonosító.
- Használt portok és esetleges ütközések.
- Minden szükséges `.env` fájl helye, titkos értékek nélkül.
- Indulási sorrend, egészségjelzések és tiszta leállítás.
- Smoke teszt pontos lépései és eredménye.

