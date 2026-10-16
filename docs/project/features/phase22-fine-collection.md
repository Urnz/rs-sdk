# Phase 22.3 – restart-safe fine collection

## Határ és authority

A beszedés kizárólag már auditált `FineCollectionIntentStore` rekordból
tervezhető. A settlement journal önmagában nem hozhat létre bírságot: a
`planFineCollection` újraellenőrzi az intent auditláncát, és egy nem exportált
authority tokennel fagyasztja be a döntés-, player-, összeg- és treasury-
azonosságot. Az LLM, a treasury credit és az escrow nem hoz jogi döntést.

## Tartós lifecycle

1. `planned`: determinisztikus escrow- és settlement-ID készül az auditált
   collection ID-ból.
2. `held`: az engine ugyanabban a SQLite tranzakcióban veszi ki a player coinját,
   írja az escrow auditot és a teljes player checkpointot.
3. `credited`: a faction treasury egyszer, saját auditált tranzakciójában kap
   jóváírást. A verifier csak az exact, auditált `held` tervet fogadja el.
4. `settled`: az engine ugyanazzal az escrow ID-val terminálisan `consume`-olja
   a foglalást és checkpointot ír.

Minden fázis hash-láncolt journal-esemény. A hold, credit vagy consume után,
de a következő journal-write előtt bekövetkező leálláskor ugyanaz a parancs
ismétlődik. Az engine escrow és a treasury settlement exact-idempotens, ezért
nincs második debit vagy credit. A gateway startup/periodikus recovery csak
már engedélyezett, nem terminális terveket folytat; új bírságot nem dönt el.
Elégtelen coin a `planned` fázisban hagyja a tervet, treasury-mozgás nélkül.
Sérült journal, escrow- vagy treasury-audit fail-closed.

## Checkpoint authority

A checkpoint útvonal külön `PLAYER_CHECKPOINT_DATABASE` konfigurációt használ;
nem függ a `GE_ENABLED` állapottól és nem igényel GE-folyamatot. A meglévő
helyi világ kompatibilitása miatt az indító explicit a korábbi
`data/market.sqlite` fájlt jelöli ki checkpoint-authorityként, de már nem a
`GE_DATABASE` jelentése vagy a GE bekapcsolása adja az authorityt. Új világ
dedikált `data/player-checkpoints.sqlite` fájlt használhat.

## Legacy migráció és rollback

Mindkét migráció offline, explicit `--confirm-stopped` kapuval fut, előbb
`VACUUM INTO` SQLite snapshotot készít és `integrity_check`-kel ellenőrzi.

- A régi player escrow terminális `consume` sora teljes, determinisztikus
  rekordként a `player_escrow_legacy_archive` táblába került,
  `historical_atomicity=unverified` jelöléssel. Nem lett belőle élő shared
  escrow vagy utólag kitalált atomi audit. A forrásfájl változatlan maradt.
- A régi, audit nélküli treasury external-credit sora a
  `institution_treasury_legacy_external_credit_archive` táblába került,
  `historical_audit=unverified` és `balance_effect=preserved` jelöléssel.
  Az account-egyenleg nem változott; az új external-credit auditlánc üresen
  indult.

A helyi backupok és géppel olvasható rollback tervek:

- `.local/migrations/player-escrow-authority/20260928-22-3/`
- `.local/migrations/treasury-external-credit/20260928-22-3/`

Rollback csak leállított stacknél engedhető: előbb igazolni kell, hogy az új
shared escrow/auditált treasury ledgerben nem keletkezett új rekord, majd a
manifestben megnevezett target backup állítható vissza. A backupok és mentések
Gitből kizárt lokális adatok.

## Nem része a 22.3-nak

Elfogás, börtön/korlátozás, kártérítés, vagyon-visszaadás és új authority-
döntéstípus nem került ide; ezek a 22.4 acceptance contract részei.
