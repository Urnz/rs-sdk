# Phase 22.5 – observer-specifikus fencing és engine trade evidence

A player trade két tényleges inventory-mozgását az engine egy rövid életű
checkpointban párosítja. Az első `BOTH_MOVEINV` csak pending állapot: a másik fél
trade offerje még nem fizetési bizonyíték. A második mozgás után az opcionális
benchmark JSONL mellett külön SQLite evidence rekord készül a ténylegesen átadott
mindkét item/count listáról, a login username-ekről, engine tickről és értékekről.
A ledger append-only, hash-láncolt, exact ID replayre idempotens, sérülésnél
fail-closed.

Az engine rekord önmagában továbbra sem bizonyít orgazda-szerepet. A gateway/domain
adapter a receiptet pontos buyer/seller agent-avatar kötéshez, itemhez, mennyiséghez
és coin paymenthez ellenőrzi. Csak committed fencing settlement után hozható létre
a seller saját memóriájában közvetlen episode, semantic knowledge és forrás-attestált
`possible-fence-counterparty` claim. Más observer ebből nem kap tudást.

Az agent-döntés kizárólag a seller attested observer-contextjében látható, aktív
candidate-eket értékeli. A meglévő finite money/storage/capability/profit policy
változatlanul dönt; üres vagy kiesett candidate-lista `unavailable`, NPC fallback
nincs. A claim a candidate inaktívvá válásakor azonnal fail-closed és auditáltan
revokálható.

A Business shop útvonal trusted observer inspectiont és accepted sale decisiont
követel, majd ugyanaz a engine receipt mozgatja a provenance custodyt, a véges
Business stockot és a funded treasury reservationt. Direct player trade nem
fogyaszt merchant inspectiont, de ugyanúgy megőrzi a legal title-t és a provenance
láncot. A settlement saga restart-safe: minden részledger operation-ID alapján
idempotens, a recorded request pedig soha nem helyettesíti az engine receipt
ellenőrzését.

Persistencia: a v1 engine adatbázis `data/mods/trade-evidence.sqlite`, felülírható a
`TRADE_EVIDENCE_DB` környezeti változóval. Korábbi JSONL sorokból nincs backfill,
mert azokhoz nem igazolható közös engine-checkpoint. Rollbacknél az új fájlt
és a fencing/claim/agent-state adatbázisokat bizonyítékként meg kell őrizni; a
JSONL telemetry formátuma változatlan.
