# Személyes játékos és a botok megfigyelése

Igen, ugyanabban a helyi világban személyesen is lehet játszani, amelyben a botok
futnak. Ehhez külön játékosfiókot használj, hogy a bot és a játékos egyszerre
lehessen bejelentkezve.

## Első bejelentkezés

1. Indítsd el az engine-t `WEBSITE_REGISTRATION=false` beállítással a
   [local-development.md](local-development.md) szerint.
2. Nyisd meg a `http://localhost:8888/vanilla/` címet egy normál Chrome, Edge vagy
   Firefox böngészőben.
3. Kattints az **Existing User** gombra.
4. Adj meg egy még nem használt, 1–12 karakteres felhasználónevet és egy
   1–20 karakteres jelszót, majd kattints a **Login** gombra.
5. A helyi szerver az első bejelentkezéskor automatikusan létrehozza a fiókot.
   Később ugyanezzel a név–jelszó párossal lépj be.

A kliens **New User** gombja egy eredeti, 2004-es szöveget mutat, amely a régi
RuneScape weboldal regisztrációjára hivatkozik. Ebben a helyi projektben nincs
ilyen külön regisztrációs oldal, ezért ezt a gombot figyelmen kívül kell hagyni.

## Hogyan találod meg a botot?

- Az új játékos a tutorialon kezd. Beszélj a **RuneScape Guide** NPC-vel; felajánlja
  a tutorial átugrását. Az igen választás után Lumbridge-be kerülsz.
- A jelenlegi tesztbot szintén Lumbridge környékén fut. Ha a botfolyamat aktív és
  ugyanazon a világon vagytok, normál játékosként látod mozogni és dolgozni.
- A futó botok technikai állapota a `http://localhost:8888/status` címen is
  ellenőrizhető.

## Fontos

- Ne használd a bot fiókját személyes játékra, mert egy fiók nem lehet egyszerre
  a headless botban és a böngészőben bejelentkezve.
- A jelszót ne írd dokumentációba és ne commitold Gitbe.
- A gyökér `/` oldalon lévő bot-login mezők a jelszót URL-paraméterbe is tehetik;
  személyes játékhoz ezért a `/vanilla/` kliens ajánlott.
