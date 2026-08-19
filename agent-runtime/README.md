# Agent runtime

Az LLM-től független, tartós agentállapot tervezett helye.

- `identity`: név, háttértörténet, rövid core identity és személyiségjegyek.
- `goals`: életcél, hosszú távú, aktuális és azonnali cél.
- `memory`: working, episodic, semantic és social memória.
- `relationships`: bizalom, tartozások, ígéretek és kapcsolatok.
- `assets`: pénz, tárgyak, ingatlanok, üzletrészek és követelések.
- `skills`: ismert és használható magas szintű képességek.
- `planner`: kezdetben determinisztikus, később opcionális LLM adapter.

Egy stratégiai döntéshez nem a teljes élettörténetet kell átadni. A runtime rövid
core identity-t, aktuális helyzetet/célt és releváns emlékeket állít össze.

