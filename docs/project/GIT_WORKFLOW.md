# Egyszerű Git-munkafolyamat

A branch-kezelést alapértelmezetten a Codex végzi.

## Ágak

- `main`: csak ellenőrzött, stabil állapot.
- `codex/baseline-local-setup`: az első helyi baseline és Windows-javítások.
- `codex/<rövid-feladatnév>`: minden későbbi önálló feature vagy javítás.

## Szabály

1. Új munkát nem közvetlenül a `main` ágon kezdünk.
2. A Codex létrehozza a feladathoz tartozó ágat.
3. Kis, értelmes commitok készülnek; a dátum önmagában nem commitüzenet.
4. Teszt után az ág egyesíthető a `main` ágba.
5. Az eredeti MaxBittker repo mindig `upstream` néven marad.
6. A saját GitHub-fork lesz az `origin` remote.

Javasolt commitüzenetek például:

- `chore: document local Windows baseline`
- `fix: use the Windows home directory for lite cache`
- `feat: add diminishing XP counters`
- `test: cover property purchase races`

