Pak de volgende todo en voer hem uit.

Gebruik de MCP todo-server tools:
1. Roep `list_todos` aan zonder filter (limit 200). De server geeft de todo's al op datum gesorteerd, de dichtstbijzijnde eerst. Het resultaat bevat per todo `id`, `title`, `due`, `dueTime`, `estimateMin`, `bucket` en `project`.
2. Roep `get_brief` aan voor de datum van vandaag (veld `date`).
3. Kies de meest urgente todo op basis van:
   - Eerst: todo's met een due date vóór vandaag (verlopen)
   - Dan: todo's met due date vandaag
   - Dan: todo's met de dichtstbijzijnde due date
   - Zonder due date: de eerste in de lijst (de server levert die achteraan)
   - Todo's uit de groep `now` gaan voor die uit `later`, bij gelijke datum
4. Toon de gekozen todo aan Nino met titel, klant (`project`), due date, tijdsinschatting (`estimateMin`) en groep.
5. Vraag Nino wat hij wil doen:
   - De todo uitvoeren (help met de taak)
   - Overslaan naar de volgende
   - Markeren als afgerond (`complete_todo` met het `id` van de todo)
