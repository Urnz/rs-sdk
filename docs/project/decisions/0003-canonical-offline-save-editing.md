# 0003 – Kanonikus offline mentésszerkesztés

- Dátum: 2026-08-26
- Állapot: elfogadva

## Döntés

Offline játékos mentését kizárólag az engine saját `PlayerLoading.load()` és
`Player.save()` kódján keresztül módosítjuk. A gateway nem ismeri és nem írja a
bináris formátum byte-pozícióit. Online, login alatt álló vagy még logout-mentést
végző játékos fájlja nem módosítható.

Az engedélyezett mezők első körben a skillek XP-je, a teljes coinmennyiség, az
inventory és a bank. Az itemazonosítókat, mennyiségeket, kapacitást, members
korlátozást és XP-határokat az engine is ellenőrzi.

Minden írás előtt változtathatatlan backup és metaadat készül a Gitből kizárt
`.local/admin/save-backups/<bot>/` alatt. Az új mentés ideiglenes fájlon át kerül
a helyére, előtte és utána kanonikus CRC-ellenőrzéssel. Restore előtt az aktuális
állapot ugyanígy új backupot kap.

## Következmények

- A mentésverzió vagy a kanonikus codec változása nem igényel párhuzamos admin
  serializer karbantartását.
- Az adminfelület rövid időre visszautasíthat egy szerkesztést, ha a játékos
  éppen ki- vagy bejelentkezik; ez biztonsági tulajdonság.
- A gateway–engine csatorna futásonkénti titkos tokenje, kötelező indoklás és
  auditnapló minden szerkesztésre és visszaállításra érvényes.
- A despawn engine-ticken normál logoutot kér, hogy a fájl rövid időn belül
  szerkeszthető legyen a hosszú kapcsolat-timeout megvárása nélkül.
