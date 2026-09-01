# Gazdasági ajánlatok és egyszerű szerződések

## Cél és határ

A Phase 12 szerződésledger két létező persistent agent közötti megállapodásokat
tartósít. A támogatott kezdeti típusok:

- `trade`: tárgy, GP vagy szolgáltatás kölcsönös cseréje;
- `work`: díj ellenében vállalt termelés vagy más munka;
- `service`: nem feltétlenül tárgytermeléssel járó szolgáltatás.

Mindkét fél kötelezettsége külön tartalmazhat GP-t, legfeljebb húsz egyedi
item ID-t mennyiséggel és egy rövid szolgáltatásleírást. Mindkét oldalon legalább
egy kötelezettség kötelező, ezért az MVP nem hoz létre üres vagy egyoldalú
„szerződést”.

## Életciklus és integritás

Az ajánlat `open`, majd `accepted`, `declined`, `withdrawn` vagy automatikusan
`expired` lehet. Csak a pontos címzett fogadhatja vagy utasíthatja el, és csak az
ajánlattevő vonhatja vissza. Minden módosítás optimista revíziót kér.

Elfogadás egyetlen SQLite tranzakcióban:

1. ellenőrzi a címzettet, revíziót, nyitott állapotot és lejáratot;
2. lezárja az ajánlatot;
3. változatlan feltételekkel létrehozza az `active` szerződést.

A normalizált feltételek digestje az ajánlatban és a szerződésben azonos. Az
ismételt pontos elfogadás idempotensen ugyanazt a szerződést adja vissza.

## Adminfelület és biztonság

Az adminpanel `Kísérletek` füle új ajánlatot tud létrehozni, listázza a lejárt és
lezárt ajánlatokat, valamint az aktív szerződéseket. A gazdasági lista olvasása is
admin-hitelesítést igényel. Minden létrehozás és státuszváltás bekerül az admin
auditnaplóba.

Az `active` ebben a szeletben csak azt jelenti, hogy a felek elfogadták a
feltételeket. Nem történt automatikus pénz- vagy tárgymozgás, és a rendszer még
nem állít teljesítést. Ehhez a következő körben hiteles skill-run/gazdasági
esemény-egyeztetés és idempotens settlement szükséges.
