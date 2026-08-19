# Saját agent skillek

Az rs-sdk meglévő műveleteiből itt épülnek fel a több lépéses, önállóan futó
képességek. Ezek lesznek később az LLM stratégiai tervező eszközei.

Tervezett felosztás:

- `mining/` – például `mine_gold_al_kharid`
- `banking/` – helyspecifikus deposit/withdraw folyamatok
- `production/` – smithing, cooking és későbbi termelési láncok
- `commerce/` – shop, player trade, később szerződések
- `property/` – ingatlan vizsgálata, vásárlása és kezelése

Az agent ne szakmaspecifikus osztály legyen. Egy általános agent rendelkezzen a
megtanult/engedélyezett `Skill[]` halmazzal.

