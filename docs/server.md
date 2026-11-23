# Server: instellen en testen

De serverkant bestaat uit drie kleine functies in Firebase (regio `europe-west1`):

| Functie | Waarvoor | Adres |
|---|---|---|
| `api` | Taken aanmaken en lezen voor Siri, Chrome-extensie, scripts en de voice-agent. Ook `/api/transcribe`. | `/api/...` |
| `mcp` | De koppeling met Claude (Claude Code, Claude-app). | `/mcp` |
| `oauth` | Het "inloggen" van de Claude-app bij het koppelen. | `/oauth/...` en `/.well-known/...` |

Daarnaast zijn er vier geplande functies (Cloud Scheduler, tijd van Nederland):

| Functie | Wanneer | Waarvoor |
|---|---|---|
| `calendarScan` | elke dag 07:00 | agenda van de komende 14 dagen doorlopen, voorstellen maken |
| `chatScan` | werkdagen elk uur, 08:00 t/m 18:00 | Antwoorden-scan: wie wacht op jou in Google Chat, mail, Teams en Slack → kaarten op Antwoorden |
| `morningPush` | elke dag 08:00 | één melding met de taken van vandaag |
| `dueTimePush` | elke 5 minuten, 06:00 tot 22:00 | melding voor taken waarvan de tijd is aangebroken |

De code staat in `functions/`. Wat de koppelingen precies doen staat in `docs/koppelingen.md`.

## Eenmalig instellen (jij)

Dit doe je één keer. Alles hieronder gebeurt in je eigen Firebase-account; er staat nog niets online.

1. **Firebase-project maken.** Ga naar de Firebase-console, kies "Project toevoegen" en onthoud het project-id. Zet Firestore aan (regio `eur3`) en Authentication met Google-inloggen.
2. **Blaze-abonnement.** Cloud Functions werkt alleen op het betaalde Blaze-abonnement. Voor persoonlijk gebruik blijft dat in de praktijk bij een paar cent per maand (er is een gratis deel). Stel in de console meteen een budgetmelding in, bijvoorbeeld op 5 euro.
3. **Firebase CLI en inloggen.** In de terminal: `npm install -g firebase-tools`, dan `firebase login`.
4. **Project koppelen.** Kopieer `.firebaserc.example` naar `.firebaserc` en vul je project-id in.
5. **Sleutels zetten.** De sleutels komen nooit in de code, alleen in Firebase:
   ```
   firebase functions:secrets:set ANTHROPIC_API_KEY
   firebase functions:secrets:set ELEVENLABS_API_KEY
   ```
   Je plakt de sleutel als de CLI erom vraagt. `ANTHROPIC_API_KEY` is voor het slim splitsen van tekst (Claude Haiku 5.5). Zonder die sleutel werkt `/capture` nog steeds, maar met de vaste parser. `ELEVENLABS_API_KEY` is voor `/api/transcribe`.
6. **Alleen jij mag erin (aanbevolen).** Maak `functions/.env` met:
   ```
   ALLOWED_EMAILS=jouw.adres@voorbeeld.nl
   ```
   Dan komt alleen een inlog met dat adres binnen.
7. **Deployen.** Vanuit de hoofdmap van de app:
   ```
   npm run build
   firebase deploy
   ```
   Dit bouwt de app, bouwt de functies, en zet functies, regels, indexen en de website online.
8. **Opruimen laten gebeuren (aanbevolen).** Tijdelijke gegevens van het koppelen (codes, aangemelde apps, OAuth-tokens) kun je automatisch laten verlopen. De instelling staat al in `firestore.indexes.json` en gaat mee met `firebase deploy`.
9. **Persoonlijk token maken.** Open de app, ga naar Instellingen, Koppelingen en maak een token (bijvoorbeeld "Claude Code"). Je ziet het maar één keer; bewaar het in je wachtwoordbeheerder.

## Agenda, Chat, Airtable en meldingen koppelen (jij, eenmalig)

Dit zijn handelingen in jouw Google- en Airtable-account; ze kunnen niet vanuit de code. Doe ze in deze volgorde. Het Firebase-project `work-apps-48770` is ook het Google Cloud-project; je werkt in dezelfde omgeving.

### A. Google Cloud: API's aanzetten

In de [Google Cloud-console](https://console.cloud.google.com/apis/library), project `work-apps-48770`, zet je aan:

1. **Google Calendar API**
2. **Google Chat API**
3. **Cloud Scheduler API** (de eerste `firebase deploy` met geplande functies zet hem meestal zelf aan; lukt dat niet, dan hier)
4. **Firebase Cloud Messaging API** (staat bij Firebase-projecten normaal al aan; zo niet, zet hem aan)

### B. Google Cloud: toestemmingsscherm (OAuth) op "Intern"

1. Console, "Google Auth Platform" (of "API's en services", "OAuth-toestemmingsscherm"). Kies bij doelgroep (Audience) **Intern**. Dat kan omdat je een Google Workspace-account hebt (onlinedialogue.com); alleen mensen van je organisatie kunnen dan inloggen, en Google-verificatie van de app is niet nodig.
2. Naam van de app: bv. "Todo". Ondersteunings-e-mail: je werkadres.
3. Bij "Gegevenstoegang" (Data Access) voeg je deze rechten toe:
   - `https://www.googleapis.com/auth/calendar.events.owned`
   - `https://www.googleapis.com/auth/chat.messages.readonly`
   - `https://www.googleapis.com/auth/chat.spaces.readonly`
   - `https://www.googleapis.com/auth/chat.memberships.readonly`
   - plus `openid` en `.../auth/userinfo.email` (basisgegevens)
4. Een refresh-token van een app in de status "Testen" verloopt na 7 dagen. Bij het type "Intern" hoort dat niet te gelden (Google noemt de beperking voor de status "Testen" en het uitzonderen van apps die door een Workspace-beheerder als "vertrouwd" zijn gemarkeerd); ik heb niet kunnen bevestigen dat het type "Intern" zelf de 7 dagen opheft. Merk je dat de koppeling na een week verloopt ("De koppeling is verlopen" in Instellingen), laat dan een beheerder de app in de Admin-console als vertrouwd markeren, of zet de status op "In productie".

### C. Google Cloud: OAuth-client maken

1. Console, "Referenties" (Credentials), "Referentie maken", "OAuth-client-ID", type **Webtoepassing**.
2. Bij "Geautoriseerde omleidings-URI's" zet je precies: `https://work-apps-48770.web.app/api/google/callback` (en, als je dat adres ook gebruikt, `https://work-apps-48770.firebaseapp.com/api/google/callback`). Een kleine afwijking geeft `redirect_uri_mismatch`.
3. Kopieer het client-id en het clientgeheim en zet ze als secret:
   ```
   firebase functions:secrets:set GOOGLE_CLIENT_ID
   firebase functions:secrets:set GOOGLE_CLIENT_SECRET
   ```

### D. Airtable

1. Maak op [airtable.com/create/tokens](https://airtable.com/create/tokens) een persoonlijk toegangstoken met de rechten `data.records:read` en `schema.bases:read`, en geef het toegang tot de bases waarvan je links wilt plakken.
2. Zet het als secret: `firebase functions:secrets:set AIRTABLE_API_TOKEN`.

### E. Meldingen (pushberichten)

1. Firebase-console, Projectinstellingen, tabblad **Cloud Messaging**, kopje "Web-configuratie" (Web Push-certificaten), "Sleutelpaar genereren".
2. Zet de **publieke** sleutel in `.env.local` (niet in git) als `VITE_FIREBASE_VAPID_KEY=...`. Zonder deze regel blijft de schakelaar Meldingen uit. De `VITE_FIREBASE_*`-regels die er al staan, gebruikt de service worker ook.

### F. Deployen en koppelen

1. `npm run build` in de hoofdmap, daarna `firebase deploy`. De CLI vraagt of de nieuwe secrets (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AIRTABLE_API_TOKEN`) gezet moeten worden als je dat nog niet deed; elke secret moet bestaan, anders weigert de deploy. Er komen vier Cloud Scheduler-taken bij (`firebase-schedule-calendarScan-europe-west1` en de drie andere). Daar gelden de prijzen van Cloud Scheduler: drie taken per Google-account zijn gratis, daarna $0,10 per taak per maand ([Firebase](https://firebase.google.com/docs/functions/schedule-functions)).
2. Open de app, Instellingen, **Agenda en Chat koppelen**, kies je werkaccount en laat alle rechten aangevinkt. Je komt terug in Instellingen. Klik "Agenda nu scannen" om te testen.
3. Instellingen, **Meldingen**: zet de schakelaar aan op elk apparaat waar je ze wilt (op een iPhone: eerst de app op het beginscherm zetten, zie `docs/koppelingen.md`). Gebruik "Testmelding".

### Geheimen op een rij

| Naam | Waarvoor | Waar |
|---|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | koppelen met Google | `firebase functions:secrets:set` |
| `AIRTABLE_API_TOKEN` | Airtable-links omzetten | `firebase functions:secrets:set` |
| `ANTHROPIC_API_KEY` | Haiku (bestond al; nu ook voor de agenda-beoordeling) | `firebase functions:secrets:set` |
| `VITE_FIREBASE_VAPID_KEY` | meldingen in de app (publiek, geen geheim) | `.env.local`, daarna opnieuw bouwen |

## Claude koppelen

**Claude Code.** Zet dit in `.mcp.json` (staat niet in git) en vervang de twee `<...>`:

```json
{
  "mcpServers": {
    "todo-app": {
      "type": "http",
      "url": "https://<jouw-site>.web.app/mcp",
      "headers": { "Authorization": "Bearer <persoonlijk token>" }
    }
  }
}
```

**Claude-app (claude.ai en mobiel).** Voeg een eigen connector toe: Customize, Connectors, Add custom connector.

1. Naam: bijvoorbeeld "Todo's". URL: `https://<jouw-site>.web.app/mcp`.
2. Authenticatie: "Sign in now". Bij de OAuth-client kies je "Register automatically" (die vorm ondersteunt onze server).
3. Klik op Connect. Je komt op de toestemmingspagina van je eigen site. Plak daar je persoonlijke token en klik "Toestemming geven".

Een connector die je op het web toevoegt, moet daarna ook in de mobiele app beschikbaar zijn. Anthropic noemt het toevoegen op mobiel zelf nog beta, dus doe het op de web- of desktopversie. Intrekken kan in de app bij Koppelingen (de OAuth-koppeling staat in de lijst met tokens).

## Lokaal testen (zonder Firebase-project)

Je hoeft hiervoor niet in te loggen.

```
cd functions
npm install
npm test          # alle tests, met een nep-opslag in het geheugen
npm run typecheck # type-controle
npm run build     # bundelt naar functions/lib/index.js
```

De tests gebruiken een opslag in het geheugen en doen geen echte aanroepen naar Claude of ElevenLabs. Ze testen onder meer de agenda- en chatscan (met een nep-Google), regels en werkdagen, het zoeken van een vrij blok, Airtable, het koppelen met Google en de meldingen (niet dubbel), de filters, de brief, het ontdubbelen van voorstellen, tokens, afvinken met herhaling, de terugval van `/capture`, de OAuth-flow en de MCP-server (ook echt over HTTP).

Met de Firebase-emulator kun je alles draaien op je eigen computer: `cd functions && npm run serve` (vereist Java; de eerste keer downloadt de CLI de emulator). Zet voor de sleutels een bestand `functions/.secret.local` met regels als `ANTHROPIC_API_KEY=...` (staat in `.gitignore`).

## Wat je daarna kunt controleren

- `curl https://<jouw-site>.web.app/api/health` geeft `{"ok":true}`.
- `curl -H "Authorization: Bearer <token>" https://<jouw-site>.web.app/api/brief` geeft je overzicht.
- `curl -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"text":"bel piet morgen","dryRun":true}' https://<jouw-site>.web.app/api/capture` laat zien wat er van een zin zou worden, zonder iets op te slaan.

## Als er iets misgaat

- **401 bij de Claude-app:** de connector moet opnieuw (verwijderen en weer toevoegen); instellingen van het inloggen kun je daar niet achteraf wijzigen.
- **Koppelen met Google:** `redirect_uri_mismatch` = het omleidings-adres in de OAuth-client wijkt af (zie C). "Dit is nog niet ingesteld op de server" in Instellingen = de twee Google-secrets ontbreken of de functies zijn nog niet opnieuw gedeployed. "Google gaf geen blijvende toegang" = trek de toegang van de app in via je Google-account (Beveiliging, Apps met toegang tot je account) en koppel opnieuw.
- **Scan geeft een fout van Google (403):** de Calendar API of Chat API staat niet aan in het project (A), of een beheerder van je Workspace blokkeert de toegang van apps tot Chat.
- **Geen meldingen:** controleer in Instellingen of de schakelaar aan staat, gebruik "Testmelding", en kijk in `firebase functions:log` naar `morningPush` en `dueTimePush`. Op iPhone moet de app op het beginscherm staan.
- **Logboek:** `firebase functions:log` of de console onder Functions.
- **Kosten in de gaten houden:** de functies hebben een maximum aantal gelijktijdige instanties (5 voor `api` en `mcp`) en `/capture` gebruikt Haiku, het goedkoopste model.
