# ADR-0001: külön munkatér és beágyazott rs-sdk fork

## Állapot

Elfogadott induló döntés; a fork klónozása után felülvizsgálandó.

## Döntés

A `C:\Projects\OSRS` a teljes projekt munkatere. A saját `rs-sdk` fork külön,
önálló Git-repozitóriumként a `C:\Projects\OSRS\rs-sdk` könyvtárba kerül.

## Indoklás

- Az upstream repo már saját dokumentációval, agent-beállításokkal és több komponenssel rendelkezik.
- A projekt saját skillek és magas szintű tervek az upstream frissítésektől függetlenül kezelhetők.
- Az `upstream` változásai tisztábban olvaszthatók be.

## Következmény

A munkatér gyökere és az `rs-sdk/` két külön verziókezelési egység. Az `rs-sdk/`
a gyökér `.gitignore` fájljában szerepel; később igény szerint Git submodule-ra
váltható.

