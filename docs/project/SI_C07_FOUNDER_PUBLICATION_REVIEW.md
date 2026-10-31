# SI-C07 – Három konkrét eljárás publikálási előnézete

2026-10-31. **Mindhárom jóváhagyva és publikálva.**
[Végrehajtási nyugta](SI_C07_FOUNDER_PUBLICATION_RESULT.json).
A felhasználó válasza: „Jóváhagyom mindhárom publikálását”. A normál admin
publish-handler mindhárom esetben201-et adott, a trialok published és a gapek
verified állapotúak. A pontos definíciók a közös verziózott katalógusba kerültek.
Az alábbi jóváhagyási előnézet és digestjei történeti, változatlan bizonyítékok.
[Teljes definition, futás-/report-/approval-kötés](SI_C07_FOUNDER_TRIAL_RESULT.json),
[mérés és hibajavítások](SI_C07_FOUNDER_TRIAL_STAGE.md).

## Jóváhagyás tárgya

Három eljárás megosztott, verified1.0.0 verziójának normál publikálása és
az exact ellenőrzött definitionök elérhetővé tétele a közös founder-előkészítéshez.
Ettől nincs új learned tudás, elindított autonóm folyamat vagy közös világ.

- **`procedure.mining.gather-tin@1.0.0`:** Varrock keleti bánya3285,3365,
  majd egy source-bound tin ore. Mining1 és meglévő bronze pickaxe kell;
  legfeljebb60s gather,120s teljes eljárás,2 művelet. Nincs bank/trade/GP művelet.
- **`procedure.metallurgy.smelt-bronze@1.0.0`:** út a tényleges Lumbridge
  kemencéhez3225,3255; egy copper +egy tin→egy tényleges bronze bar, natív
  escrow/fogyasztás. Smithing1;120s/2 művelet, legfeljebb60s work kérés.
- **`procedure.tools.repair-bronze-pickaxe@1.0.0`:** út a Varrock műhelyhez
  3245,3404; az owned sérült csákány helyreállítása50 kapacitással, egy bronze
  bar és600 simulation másodperc natív munkával. Explicit `business-id`,
  aktív Business/Property/worker/work-surface és Smithing1 kell;120s/2 művelet.
  Nem új eszköz vagy készletfeltöltés; legfeljebb60s work kérés.

## Tényleges bizonyíték

Saját frozen-source F trial-stage, normál SDK/Lite/SkillExecutor és packed map.
**Két-két független futás, három tartós normál review és readonly inspect PASS**;
teljes külső kör4perc7s. Két natív tin output, két bronze bar, két native repair;
ugyanazon tool100→99→98, majd deklarált sérülésekből két repair, záró durability50.
A repair sérülési előfeltételei nem Mining-kopás/warmup vagy minimum-credit.

A három külön approval digest:

- Tin: `0462da0261481dec23b82781968c54456742812166400ffceb5138e97068423a`.
- Smelt: `247db3233a541d3b98556af6b8eb472ae386201a5fb658c360b622f94ad75551`.
- Repair: `50de1f8dce545cd76312eab29fa7078859cce86f3157b5822de6f77cfefbc792`.

Teljes előnézet digest:
`f9087161e5e7cb6d59bc152f296c0df5f9d281272c5dee5f28c6f5d6993e34a8`.
Publikálás előtt ugyanazon F-világ exact forrásain új readonly ellenőrzés történt;
változott run/report/definition vagy native effect továbbra új review-t igényel.

## Határ és külön jóváhagyás oka

Provider0 kérés/0 költség. Ez eljárásképesség-bizonyíték, nem az eredeti1+7 napos
C07 önfenntartás, valódi warmup→repair→reuse ciklus vagy validált288:1 időarány.
Egy háttér poison-timer a meglévő work-lock guardon elutasult; a diagnosztika
megőrzött a teljes előnézetben. A hosszú gazdasági működés nem minősült PASS-nak.

A meglévő [admin publication-kapu](../../server/gateway/admin/routes.ts#L1471)
explicit feltétele: „A publikáláshoz külön emberi jóváhagyás szükséges.”
Ez az alkalmazás követelménye, nem a fejlesztési skillből következtetett engedélykérés.
A hosszú C07 run és providerhasználat továbbra külön konkrét tervet igényel.
