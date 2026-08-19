# Diminishing XP – tervezési vázlat

## Cél

Az ismétlődő grind helyett felfedezésre, változatos munkára, specializációra és
munkamegosztásra ösztönözni az agenteket.

## Javasolt kulcs

A csökkenés ne csak skillenként működjön, hanem például:

`player + activity + target/resource + region`

Így az Al Kharid-i aranybányászat kifáradhat, miközben a faladori szén vagy a
varrocki vas még teljes jutalmat ad.

## Első kísérleti görbe

- első 100 azonos akció: `1.00x`
- 101–300: `0.90x`
- 301–1000: `0.70x`
- 1001–3000: `0.40x`
- 3000 felett: `0.15x`

A konkrét számok hipotézisek. Konfigurálhatók és mérési eredmények alapján
változtathatók legyenek. A számlálók idővel regenerálódjanak.

## Mérendő eredmények

- hány külön tevékenységet/helyet választ egy agent;
- nő-e a kereskedelem és munkamegosztás;
- csökken-e az egyetlen optimális loop dominanciája;
- kialakulnak-e nem kívánt kerülőutak vagy túlzott váltogatás.

