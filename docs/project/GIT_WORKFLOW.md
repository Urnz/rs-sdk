# Git- és upstream-munkafolyamat

A branch-kezelést alapértelmezetten a Codex végzi.

## Ágak

- `main`: csak ellenőrzött, stabil állapot;
- `codex/<rövid-feladatnév>`: önálló feature vagy javítás;
- `codex/upstream-sync-YYYY-MM-DD`: kizárólag upstream-frissítés és konfliktusok.

Az eredeti `MaxBittker/rs-sdk` mindig `upstream`, a saját `Urnz/rs-sdk` fork pedig
`origin` remote néven szerepel.

## Normál fejlesztés

1. A Codex friss `main` ágból létrehozza a feladat branchét.
2. Kis, értelmes commitok készülnek; a dátum önmagában nem commitüzenet.
3. Lefut a feladathoz tartozó célzott teszt és a `bun run check`.
4. A branch felkerül az `origin` tárolóba, majd draft PR készül.
5. Csak sikeres ellenőrzés után kerül a változás a `main` ágba.

## Upstream frissítése

```powershell
git switch main
git pull --ff-only origin main
git fetch upstream
git switch -c codex/upstream-sync-YYYY-MM-DD
git merge --no-ff upstream/main
```

Ütközés esetén fájlonként kell dönteni:

1. A projekt saját `docs/project`, `scripts`, `agent-*` és `mods` tartalma maradjon meg.
2. Az upstream engine/SDK változását először értsük meg; ne használjunk automatikus
   „ours/theirs mindenhova” feloldást.
3. A Windows-javításokat csak akkor tartsuk meg, ha az upstream még nem oldotta meg őket.
4. Generált fájlt a generátorral készítsünk újra, ne kézzel egyesítsünk.
5. Függőségváltozás után minden érintett könyvtárban `bun install --frozen-lockfile`,
   majd `bun run check` és a teljes helyi smoke teszt következik.
6. Az upstream-sync is PR-on keresztül kerülhet a `main` ágba.

Konfliktus vagy sikertelen teszt esetén a sync branch megmarad diagnosztikára; a
stabil `main` ágat nem írjuk felül és nem használunk `git reset --hard` műveletet.
