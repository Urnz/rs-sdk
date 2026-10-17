# 25.7 – Windows operációsrendszer-titoktár

A helyi Windows runtime a Windows Credential Manager általános hitelesítőadatai
között tárolja az LLM-provider kulcsát, a megjegyzett botjelszavakat és az új
kezelt világok login privát kulcsát, illetve worker/engine vezérlőtokenjét.
Tartós titok nem kerül az új `bot.env`, `runtime.json` vagy világkonfigurációba.
Az admin API csak beállítottságot és forrás/migrációs állapotot ad vissza;
nincs kulcslekérő vagy titokexportáló HTTP-művelet. A kulcsbevitel és csere
továbbra is írható, a mező betöltés után üres.

## Tárolás és futtatás

A natív adapter a `CredWriteW`, `CredReadW`, `CredDeleteW` API-kat használja,
`CRED_TYPE_GENERIC` és `CRED_PERSIST_LOCAL_MACHINE` beállítással. A tárolás
a futtató Windows-felhasználóhoz és géphez kötött. A cél neve a kanonikus
munkakönyvtár SHA-256 névteréből és egy kötött titoknévből áll; nincs kliens
által megadható vault-cél. Két világ azonos botneve külön jelszót kap.
Az új folyamat ugyanott, ugyanazzal az OS-fiókkal visszaolvashatja a titkot.

A PowerShell/natív segéd titkos adatot csak privát stdin/stdout csövön ad át
a szerverfolyamatnak. A titok nem parancssori argumentum, segédfájl vagy
naplószöveg. A segéd engedélylistás környezetből fut, hibája általános és
korlátozott. A státuszlekérés nem adja vissza a credential blob tartalmát.
Nem támogatott platformon vagy hibás vault esetén nincs fájlos/környezeti
visszaesés. Ehhez Windows és `pwsh` szükséges; más OS backendje külön munka.

A futó engine és bot az adott művelethez szükséges titkot a memóriában és
a saját folyamatkörnyezetében megkapja. Az engine login kulcsát csak az
engine worker kapja; provider/admin/worker/login titkokat a bot- és skill-
gyermekek nem örökölnek. Bun `.env` automatikus betöltésük le van tiltva.
A worker generációja és portjai a futási naplóban maradnak, a token a vaultban.

Ez OS-védelem a lemezen, nem folyamatok közötti OS-sandbox: ugyanazzal a
Windows-fiókkal futó, tetszőleges kód az adott fiók Credential Manageréhez is
hozzáférhet. A világonkénti névtér az alkalmazás kötése, nem külön OS-jogosultság.

## Korábbi titkok migrációja

Az érintett gateway/bot/worker folyamatokat előbb állítsd le. A kompatibilis
workspace gyökerére futtasd:

```powershell
bun scripts/migrate-os-secrets.ts
# Másik kompatibilis workspace esetén:
bun scripts/migrate-os-secrets.ts C:/path/to/instance/workspace
```

A migrátor a régi `.local/admin/secrets/openai-api-key.txt`, az adott botok
`bot.env` jelszavai, kezelt világnál a privát login kulcs és szomszédos futási
napló tokenje alapján importál. Ha `OPENAI_API_KEY` érkezik a CLI környezetében,
azt is importálhatja; a tartós OS-/shell-környezeti definíciót az üzemeltetőnek
külön el kell távolítania. Eltérő fájlos és környezeti értéket nem választ ki.
A futó szolgáltatás a régi fájlból vagy környezetből nem használ provider kulcsot.

Minden forrás módosítása előtt visszaolvassa és ellenőrzi az OS-bejegyzést.
Eltérő meglévő bejegyzést nem ír felül. Hibánál a még nem igazolt forrás
megmarad; az addig igazolt lépések megmaradnak, a futás ismételhető. A bot
konfigurációja és a runtime journal atomikus fájlcserével frissül. A migrátor
csak összesített darabszámot ír ki. Titokról plaintext biztonsági másolatot
nem készít. A workspace áthelyezése vagy más OS-fiók külön vault-importot igényel.

A 25.6-os vagy régebbi pinnelt világ forrását a vezérlő nem írja felül.
Ha nincs vault-kompatibilis forrása, migráció előtt zárt hibát ad, az adatokat
és régi titkokat megőrzi. A forrásverzió ellenőrzött migrációja a 25.8 feladata;
a régi világot nem állítjuk automatikusan új formátumúvá. A hagyományos helyi
emulátor upstreamből származó, nyilvános demonstrációs RSA-kulcsa kompatibilitási
fixture marad; ez nem új kezelt világ privát kulcsa és nem szolgáltatói titok.

## Hibák és visszaállítás

Az admin nem olvassa vissza a kulcsot a böngészőbe és nem helyettesít hiányzó
bejegyzést másik világ kulcsával. Hiányzó botjelszó új biztonságos bevitelt
igényel. A provider kulcs cseréje után a régi fájl eltávolul; törléskor a vault
bejegyzés és korábbi fájl is eltávolul, környezeti fallback nem aktiválódik.
Archivált világ vault-bejegyzése megmarad az adatmegőrzéssel együtt.

Régi binárisra rollback előtt állítsd le az érintett folyamatokat. Az OS-vault
bejegyzéseket őrizd meg; a régi plaintext formátumot nem állítjuk vissza
automatikusan és a titkot nem exportáljuk. Visszaállításhoz kompatibilis runtime
vagy a kulcs jogosult újbóli megadása szükséges. SQL-séma nem változik.

Ellenőrzések: [Phase 25 progress](../PHASE25_PROGRESS.md).
