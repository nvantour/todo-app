Toon mijn openstaande todo's, gegroepeerd per groep en per klant.

Gebruik de MCP todo-server tools:
1. Roep `list_todos` aan zonder filter (limit 200) om alle open todo's te zien. Het resultaat bevat per todo `title`, `due`, `dueTime`, `estimateMin`, `bucket` en `project` (de klant, of leeg).
2. Roep `get_brief` aan om de datum van vandaag te krijgen (veld `date`). Dat heb je nodig voor de urgente markering.
3. Toon het resultaat overzichtelijk, in twee groepen:
   - **Om nu te doen** (`bucket: "now"`)
   - **Om niet te vergeten** (`bucket: "later"`)
   - Groepeer per groep op klant (`project`). Todo's zonder klant komen onder "Zonder klant".
   - Per todo: titel, due date (als gezet), tijd (`dueTime`) en tijdsinschatting (`estimateMin`, als gezet).
   - Toon het totaal aantal open todo's.
   - Sla een klant zonder todo's over.
4. Markeer todo's met een due date vandaag of eerder als urgent.
5. Wil Nino maar één klant zien? Gebruik dan `list_projects` voor de id en roep `list_todos` aan met `filter: "project:<id>"`.
