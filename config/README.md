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

Az adminpanel „AI beállítások” füle szerverenkénti helyi override-ot ír a
`.local/admin/llm-runtime.json` fájlba. Ez elsőbbséget élvez a verziózott
alapbeállítással szemben. Az adminpanelen megadott OpenAI-kulcs ettől elkülönítve,
a `.local/admin/secrets/openai-api-key.txt` fájlban marad, és az API csak azt
jelzi vissza, hogy van-e beállított kulcs; magát a titkot soha nem adja vissza.

Az opcionális `skillBuilder` blokk alapból ki van kapcsolva. Engedélyezve csak az
OpenAI providerrel működik: a gateway konfigurált időközönként legfeljebb egy
deduplikált gapet dolgoz fel, kizárólag deklaratív draftot ment, és per-gap valamint
napi költséglimitet is betart.

