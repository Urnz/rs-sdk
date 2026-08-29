# Konfiguráció

Csak verziókezelhető minták és nem titkos alapértékek kerüljenek ide. A tényleges
jelszavak, API-kulcsok, tokenek és lokális botadatok nem commitolhatók.

- `world-mods.json`: a modok manifestje és szerkeszthető alapbeállításai.
- `properties.json`: a verziózott ingatlankatalógus; tulajdonosi állapot soha nem
  kerül ebbe a fájlba.
- `llm-runtime.json`: titokmentes provider-, modell- és biztonsági limitminta;
  alapértelmezetten kikapcsolt mock providerrel. API-kulcs soha nem kerül ide.
- `llm-runtime.openai.example.json`: másolható Responses API minta. A tényleges
  kulcsot `OPENAI_API_KEY` környezeti változóként kell átadni a gatewaynek.

