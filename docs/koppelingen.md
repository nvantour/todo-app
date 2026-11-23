# Koppelingen

Hoe andere tools todo's in de app krijgen. Het datamodel staat in `src/model/types.ts`; dat bestand is leidend.

## Twee soorten invoer

| Soort | Wanneer | Waar komt het |
|---|---|---|
| **Todo** | De gebruiker vraagt er zelf om (typen, inspreken, "maak todo" in de mail-app, Claude op verzoek) | Direct in de lijst |
| **Voorstel** (`Suggestion`) | Een tool of AI bedenkt het zelf (agenda-scan, actiepunten uit een meeting, mail-scan) | Inbox, pas een todo na akkoord |

Elke todo en elk voorstel heeft een `source` met `type`, een leesbaar `label`, een `url` terug naar de bron en een `externalId`. Op `source.type + source.externalId` wordt ontdubbeld: hetzelfde bronitem levert nooit twee voorstellen op.

## Opslag (Firestore)

```
users/{uid}/todos/{id}          Todo
users/{uid}/projects/{id}       Project (klant)
users/{uid}/labels/{id}         Label
users/{uid}/suggestions/{id}    Suggestion
users/{uid}/calendarRules/{id}  CalendarRule
```

Alleen de server (Admin SDK) gebruikt deze losse verzamelingen; de regels in `firestore.rules` sluiten ze voor de app af:

```
apiTokens/{sha256-hash}         { id, hash, uid, name, kind, createdAt, lastUsedAt, expiresAt }
oauthClients/{clientId}         apps die zich bij de Claude-koppeling hebben aangemeld
oauthCodes/{sha256-hash}        eenmalige codes tijdens het koppelen (5 minuten geldig)
googleConnections/{uid}         Google-koppeling: account, toegekende rechten en het refresh-token (alleen op de server)
googleStates/{hash}             eenmalige `state` tijdens het koppelen met Google (10 minuten geldig)
pushDevices/{id}                apparaten die meldingen krijgen (FCM-registratietoken, naam)
serverState/{uid}               laatste scans, ochtendmelding van vandaag, verstuurde taaktijd-meldingen, standaardregel aangemaakt
```

`users/{uid}/calendarRules` bewerkt de app zelf (Instellingen, Agenda-regels); de server leest ze bij elke scan.

Tokens staan bewust **niet** onder `users/{uid}`: het document-id is de SHA-256-hash van het token, zodat de server een binnenkomend token in één opzoeking vindt zonder gebruikers af te lopen. `uid` in het document zegt van wie het is.

Datums zijn tekst: `YYYY-MM-DD` voor dagen, volledige ISO voor tijdstippen.

## 1. Mail (de Mail-tab in de app zelf)

De Mail-tab draait in de app en maakt een taak via de store (`makeTask` in `src/views/MailView.tsx`). Er komt een document in `users/{uid}/todos` met deze bron:

```json
{
  "title": "Reageren op vraag over SRM",
  "source": { "type": "mail", "label": "Re: SRM in test 42", "url": "<link naar de thread in de Mail-tab>", "externalId": "<Gmail threadId>" }
}
```

Alle overige velden krijgen de standaardwaarden uit `buildTodo()` in `src/data/store.ts`.

## 2. Koppelpunt voor alles buiten Firebase (`api`)

Adres: `https://<jouw-site>/api/...` (Firebase Hosting stuurt `/api/**` door naar de functie `api`, regio `europe-west1`).

### Inloggen

Elk verzoek (behalve `GET /api/health`) heeft `Authorization: Bearer <token>`:

| Soort | Waarvoor | Hoe |
|---|---|---|
| **Persoonlijk token** (`tdp_...`) | Siri, Chrome-extensie, scripts, Claude Code | Aanmaken in de app (Instellingen, Koppelingen) of via `POST /api/tokens`. Het token wordt één keer getoond; de server bewaart alleen de SHA-256-hash. |
| **Firebase ID-token** | De app zelf | Het token van de ingelogde gebruiker. Alleen hiermee kun je tokens beheren. |
| **OAuth-token** (`tda_...`) | De Claude-app (claude.ai en mobiel) | Komt uit de koppelflow, zie bij `mcp`. Werkt net als een persoonlijk token, verloopt na 1 uur en wordt automatisch ververst. |

Tokenbeheer (alleen met een ID-token): `GET /api/tokens` (lijst, zonder het token zelf), `POST /api/tokens` met `{ "name": "Siri" }` (antwoord bevat `token`, één keer), `DELETE /api/tokens/{id}` (intrekken; antwoord 204).

Optioneel: zet `ALLOWED_EMAILS` (kommalijst) in `functions/.env`; dan komt alleen een ID-token van die adressen binnen.

### Fouten

Altijd JSON: `{ "error": { "code": "invalid_input", "message": "titel: Titel is verplicht" } }`. Codes: `unauthorized` (401), `forbidden` (403), `invalid_input` / `bad_request` / `bad_filter` (400), `not_found` (404), `too_large` (413), `internal` (500), `not_available` (501).

### Routes

`POST /api/capture` — vrije tekst in, todo's uit. Voor Siri, de Chrome-extensie, de voice-agent, scripts.

```
{ "text": "wehkamp deck morgen en uren schrijven", "source": { "type": "api", "label": "Siri" }, "dryRun": false }
→ 201 { "dryRun": false, "engine": "ai", "todos": [ { "id": "...", "title": "Deck", "due": "2026-11-19", "projectId": "...", ... }, ... ] }
```

- Claude Haiku 5.5 splitst de tekst (ook een ingesproken zin met meerdere taken) in taken met titel, datum, tijd, herhaling, klant en nu/niet-vergeten. De klantenlijst en de datum van vandaag (Europe/Amsterdam) gaan mee.
- Geen sleutel of een fout bij Haiku? Dan valt de server terug op de vaste parser (`parseQuickAdd`), met één taak per regel (of per `;`). `engine` zegt welke het werd: `ai` of `fallback`.
- `dryRun: true`: alleen het resultaat, er wordt niets opgeslagen (status 200). Elke taak heeft dan ook `projectName`, handig om terug te lezen. De voice-agent gebruikt dit om te laten bevestigen.
- `source` is optioneel (standaard `{ "type": "api" }`) en wordt op elke aangemaakte taak gezet.

`GET /api/todos?filter=...&limit=...` → `{ "todos": [...] }` (alleen open taken, de eerste datum bovenaan).

| filter | Betekenis |
|---|---|
| (leeg) of `all` | alle open taken |
| `now` | om nu te doen: bucket `now`, plus alles waarvan de datum vandaag of eerder is |
| `later` | om niet te vergeten en nog niet aan de beurt |
| `overdue` | datum vóór vandaag |
| `upcoming:<dagen>` | datum na vandaag tot en met vandaag + dagen (`upcoming:3` = morgen t/m over 3 dagen) |
| `project:<id>` | één klant; `project:none` = zonder klant |

`POST /api/todos` (taak maken; alleen `title` is verplicht, de rest krijgt de standaardwaarden van `buildTodo`; klant wordt herkend als `projectId` ontbreekt) · `GET /api/todos/{id}` · `PATCH /api/todos/{id}` (alleen de velden die veranderen; `done: false` zet een taak terug) · `POST /api/todos/{id}/complete`.

`POST /api/todos/{id}/complete` doet hetzelfde als afvinken in de app: een gewone taak wordt afgevinkt, een terugkerende schuift door naar de volgende datum na vandaag (subtaken weer open). Antwoord: `{ "todo": ..., "recurred": true|false, "alreadyDone": true|false }`. Opnieuw afvinken van een afgevinkte taak verandert niets (`alreadyDone: true`).

`POST /api/suggestions` — voorstel in de inbox:

```
{ "title": "Reageren op vraag over SRM", "reason": "Wacht op antwoord", "source": { "type": "mail", "label": "Re: SRM in test 42", "url": "...", "externalId": "<threadId>" } }
→ 201 { "created": true, "suggestion": { ... } }
→ 200 { "created": false, "duplicateOf": "suggestion" | "todo", ... }   // bronitem bestaat al
```

Ontdubbelen op `source.type + source.externalId`, tegen alle voorstellen (ook geaccepteerde en afgewezen) en alle bestaande taken. Zonder `externalId` wordt niets ontdubbeld.

`GET /api/brief` · `GET /api/projects` (niet-gearchiveerde klanten met `id`, `name`, `keywords`).

`POST /api/todos/{id}/schedule` met `{ "minutes": 60 }` (15 tot 480; optioneel `"replace": true`) zoekt het eerstvolgende vrije blok in je agenda en maakt daar een afspraak met de titel van de taak. Antwoord: `{ todo, eventId, start, end, afterDue }`. `calendarEventId` staat daarna op de taak. Fouten: `already_scheduled` (409, tenzij `replace`), `no_free_slot` (409), `google_not_connected` / `google_reauth` / `google_scope_missing` (409), `not_available` (501, geen Google-instellingen op de server).

`POST /api/scan/calendar` en `POST /api/scan/chat` starten de scan meteen voor jou (zelfde als de geplande). Antwoord `{ found, created, duplicates }`.

`POST /api/airtable/resolve` met `{ "url": "<Airtable-link>" }` geeft `{ baseId, baseName, tableId, recordId, recordName, label, projectId }` (zie hoofdstuk 5).

`GET /api/google/status` · `POST /api/google/connect` (antwoord `{ url }`, daar stuur je de gebruiker heen) · `DELETE /api/google` (ontkoppelen; antwoord 204) · `GET /api/google/callback` (de terugkeer van Google, zonder token; stuurt door naar `/instellingen?google=ok|gedeeltelijk|geweigerd|fout`). Koppelen en ontkoppelen kan alleen met het ID-token van de app, net als tokens beheren.

`GET /api/push/devices` · `POST /api/push/devices` met `{ "token": "<FCM-token>", "label": "iPhone" }` · `DELETE /api/push/devices/{id}` · `POST /api/push/test` (stuurt een testmelding naar je apparaten). Alleen met een ID-token of persoonlijk token van de eigenaar.

`POST /api/transcribe` — audio naar tekst. Body is het geluidsbestand zelf (`Content-Type: audio/webm` e.d.), maximaal 10 MB. Antwoord `{ "text": "..." }`. Werkt met een ID-token of persoonlijk token.

CORS staat open voor `*.web.app`, `*.firebaseapp.com` en `localhost`; extra herkomsten via `ALLOWED_ORIGINS` (kommalijst).

## 3. Claude (`mcp`)

MCP-server op afstand (Streamable HTTP, stateless) op `https://<jouw-site>/mcp`. Tools: `list_todos`, `add_todo`, `update_todo`, `complete_todo`, `suggest_todo`, `list_projects`, `get_brief`, `schedule_todo` (taak inplannen in de agenda; `id`, `minutes`, optioneel `replace`).

Afspraak voor Claude-taken: iets wat de gebruiker letterlijk vraagt → `add_todo`; iets wat Claude zelf uit een meeting of mail haalt → `suggest_todo` (altijd met een stabiele `sourceExternalId`, zodat hetzelfde bronitem nooit twee voorstellen geeft).

### Inloggen vanuit Claude

- **Claude Code**: persoonlijk token in een header, geen OAuth nodig. In `.mcp.json`:
  ```json
  { "mcpServers": { "todo-app": { "type": "http", "url": "https://<jouw-site>/mcp", "headers": { "Authorization": "Bearer <persoonlijk token>" } } } }
  ```
- **Claude-app (claude.ai en mobiel)**: een eigen connector gebruikt OAuth 2.0, geen losse token. De server heeft daarvoor een kleine OAuth-server (`oauth`): ontdekking via `/.well-known/oauth-protected-resource` en `/.well-known/oauth-authorization-server`, registratie van de app (`/oauth/register`, DCR), toestemming (`/oauth/authorize`, met PKCE S256) en tokens (`/oauth/token`, refresh met rotatie). Bij het koppelen plak je één keer een persoonlijk token op de toestemmingspagina; dat is je "inloggen". De Claude-app krijgt daarna een eigen OAuth-token (1 uur geldig, wordt vanzelf ververst, 60 dagen refresh). In de app zie je zo'n koppeling in de lijst met tokens en kun je hem intrekken.
- Niet-ingelogde verzoeken krijgen `401` met `WWW-Authenticate: Bearer resource_metadata="..."`, zoals de MCP-specificatie vraagt.

Zie `docs/server.md` voor het toevoegen van de connector in Claude.

## 4. Google koppelen

Eén keer koppelen geeft de server blijvende, alleen-lezen toegang tot je agenda en Google Chat, plus het recht om afspraken aan te maken (voor inplannen). Instellingen, "Agenda en Chat koppelen".

- **Hoe:** de app vraagt `POST /api/google/connect` en stuurt je naar Google (authorization-code-flow, `access_type=offline`, `prompt=consent`, met een eenmalige `state`). Google stuurt je terug naar `/api/google/callback`; de server wisselt de code in en bewaart alleen het **refresh-token**, in `googleConnections/{uid}` (voor de app dicht; zie `firestore.rules`). Het toegangstoken (1 uur) wordt per verzoek ververst en nergens bewaard. Firestore versleutelt de opslag zelf; er zit geen extra laag overheen. Wil je die wel, dan kan het token naar Secret Manager of Cloud KMS verhuizen; dat is niet gedaan.
- **Rechten (scopes), zo smal mogelijk:**

  | Scope | Waarvoor |
  |---|---|
  | `calendar.events.owned` | afspraken in je eigen agenda lezen en aanmaken (scan en inplannen; verwijderen alleen bij opnieuw inplannen) |
  | `chat.messages.readonly` | berichten lezen |
  | `chat.spaces.readonly` | lijst van je gesprekken |
  | `chat.memberships.readonly` | namen van afzenders opzoeken als de API ze niet meegeeft |
  | `openid`, `email` | welk Google-account het is (en je Chat-id) |

  `calendar.events.owned` ("zie, maak, wijzig en verwijder afspraken in agenda's die je zelf bezit") is smaller dan `calendar.events` ("alle agenda's"). Werkt jouw agenda daar onverwacht niet mee, wissel dan in `functions/src/googleAuth.ts` naar `https://www.googleapis.com/auth/calendar.events` en zet die scope ook in het toestemmingsscherm.
- **Toegestaan door de gebruiker:** Google laat je bij het toestemmen elk recht los uitvinken. De server bewaart wat echt is toegekend (`scopes`); Instellingen toont per onderdeel "Toegestaan" of "Geen toestemming", en een scan zonder recht geeft een duidelijke fout.
- **Verlopen:** wijst Google het refresh-token af (`invalid_grant`, bv. ingetrokken in je Google-account), dan staat de koppeling op `needsReauth`, de scans slaan je over en Instellingen vraagt om opnieuw koppelen.
- **Ontkoppelen** trekt de toegang bij Google in (`oauth2.googleapis.com/revoke`) en verwijdert het token hier. Voorstellen en taken blijven staan.

## 5. Agenda (`calendarScan`)

Dagelijks 07:00 (Europe/Amsterdam) en op verzoek (`POST /api/scan/calendar`, knop in Instellingen). Leest de komende 14 dagen van je primaire agenda (`events.list` met `singleEvents=true`).

1. **Welke afspraken tellen:** niet geannuleerd, niet door jou geweigerd, alleen gewone afspraken (geen verjaardag, afwezig, werklocatie of focustijd). Hele-dag-afspraken tellen mee.
2. **Regels** (`calendarRules`, beheer je in Instellingen): staat het woord (hoofdletters maken niet uit) in de titel, dan komt er een voorstel met de titel uit het sjabloon (`{titel}` = naam van de afspraak) en als datum **n werkdagen voor de afspraak** (maandag t/m vrijdag; feestdagen tellen als werkdag; valt de afspraak in het weekend, dan telt de vrijdag ervoor als begin). Is dat al voorbij, dan wordt het vandaag. De standaardregel "QBR", 3 werkdagen ervoor, wordt één keer aangemaakt bij het koppelen; wie hem verwijdert, krijgt hem niet terug.
3. **Haiku** (`claude-haiku-5-5`, gestructureerde uitvoer, alleen als `ANTHROPIC_API_KEY` er is) kijkt naar de overige afspraken en kiest alleen wat echt voorbereiding vraagt (presentatie, kwartaalgesprek, workshop, pitch). De opdracht is streng: liever geen voorstel dan ruis. Naar Haiku gaan alleen titel, dag, tijd, aantal deelnemers en de domeinen van externe deelnemers; geen e-mailadressen, geen beschrijving. Terugkerende afspraken en vrije-tijd-blokken worden niet aan Haiku voorgelegd (regels gelden wel). Een fout bij Haiku is niet erg: de regels werken gewoon door.
4. **Klant:** herkend uit de titel en de e-mailadressen van externe deelnemers (eigen domein telt niet); trefwoorden van een klant mogen een domein zijn, bv. `wehkamp.nl`.
5. **Voorstel:** `source = { type: 'calendar', label: '<titel> · <datum>', url: <link naar de afspraak>, externalId: <id van de afspraak> }`. Een terugkerende reeks geeft per voorkomen een eigen voorstel (het id is dat van dat voorkomen). Een afspraak die twee regels raakt, krijgt voor de tweede regel `externalId = <id>#<regel-id>`.
6. **Ontdubbelen** op bron, tegen alle voorstellen (ook afgewezen) en taken: opnieuw scannen maakt niets dubbel, en een afgewezen voorstel komt niet terug. Wijzigt een afspraak van datum, dan verandert een bestaand voorstel niet.

## 6. Airtable

Plak je een Airtable-link in een invoerregel of in het detailpaneel ("Airtable-link"), dan krijgt de taak `source = { type: 'airtable', label, url, externalId: <recordId> }`. Staat er naast de link nog tekst, dan wordt dat de titel; staat er alleen een link, dan heet de taak "Bekijk Airtable-record" en wordt dat de naam van het record zodra die bekend is.

- **Links:** `https://airtable.com/app…/tbl…/viw…/rec…?…` (base, tabel, view, record) of de interface-vorm `…/app…/pag…/rec…`. Een link zonder record-id wordt niet herkend.
- **Naam ophalen:** `POST /api/airtable/resolve { url }`. De server leest de naam van de base (`GET /v0/meta/bases`, scope `schema.bases:read`), de tabellen met hun eerste veld (`GET /v0/meta/bases/{base}/tables`) en het record (`GET /v0/{base}/{tabel}/{record}`, scope `data.records:read`). `label` is "Recordnaam (Basenaam)"; de recordnaam is de waarde van het eerste veld van de tabel. Staat er geen tabel in de link, dan probeert de server een tabel van de base; volgens de Airtable-documentatie zoekt Airtable het record dan in de hele base, en de server kiest de tabel waarvan het eerste veld in het record zit.
- **Klant:** herkend uit de naam van de base en het record (`projectId` in het antwoord). De app zet die alleen als de taak nog geen klant heeft.
- **Zonder server of sleutel** (of bij een fout, of als het token die base niet mag zien): de link blijft gewoon als bron staan, met het label "Airtable-record".
- Sleutel: secret `AIRTABLE_API_TOKEN` (persoonlijk toegangstoken met `data.records:read` en `schema.bases:read`, en toegang tot de bases die je wilt kunnen plakken).

## 7. Chat (`chatScan`)

Google Chat, werkaccount. Twee keer per werkdag (09:00 en 15:00) en op verzoek (`POST /api/scan/chat`). Kijkt naar de laatste **3 dagen**.

**Wat telt als "hier moet ik nog op reageren":**

- **Directe berichten:** het laatste bericht van het gesprek is niet van jou en niet van een bot.
- **Vermeldingen (@jou)** in spaces en groepsgesprekken: er is daarna geen bericht van jou in dezelfde thread (in een space zonder threads: geen later bericht van jou in de space). Per thread telt de laatste vermelding. @iedereen, berichten van bots, je eigen berichten en verwijderde berichten tellen niet. Een groepsgesprek zonder naam telt alleen via vermeldingen.
- Voorstel: `source = { type: 'chat', label: <afzender, of de naam van de space bij een vermelding>, url: <link naar het gesprek>, externalId: <naam van het bericht, spaces/…/messages/…> }`, titel "Reageren op <afzender>: <eerste ±60 tekens van het bericht>". De titel komt uit het bericht zelf; er gaat niets naar Haiku.
- **Ontdubbelen** op het bericht. Daarnaast maakt een nieuw bericht in een DM waarvoor al een open voorstel staat geen tweede voorstel.

**Wat de Chat API met jouw inlog wel en niet toelaat** (bron: de [Chat API-referentie](https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces.messages/list)):

- Met gebruikersrechten (`chat.messages.readonly`, `chat.spaces.readonly`) lees je de gesprekken waar jij zelf in zit, niet meer. Spaces ophalen kan met een filter op soort (`SPACE`, `GROUP_CHAT`, `DIRECT_MESSAGE`); berichten met een filter op `createTime` en `thread.name`.
- **Geen link naar het losse bericht.** Een bericht heeft geen permalink-veld. De bron-link gaat naar het **gesprek** (`spaceUri` uit de API, anders `https://mail.google.com/mail/u/0/#chat/space/<id>`). Tikken op de bron opent dus het gesprek, niet precies dat bericht.
- **Wie ben ik?** Het id in `users/{id}` is hetzelfde als het id in de People-API ([Chat API, User](https://developers.google.com/workspace/chat/api/reference/rest/v1/User)). De server gebruikt daarvoor het account-id uit de Google-inlog (`sub`). Dat `sub` precies dat id is, volgt uit de documentatie maar is niet met een echt account gecontroleerd.
- **Namen:** de naam van een afzender zit niet altijd in het bericht; de server zoekt hem dan op in de ledenlijst van het gesprek (daarom het recht `chat.memberships.readonly`). Lukt dat niet, dan staat er "een collega".
- **Geen leesstatus.** De API geeft niet door of je een bericht al gelezen hebt, en een reactie met een emoji telt niet als antwoord. Een "bedankt" aan het eind van een DM telt dus ook als "reageren".
- **Grenzen:** de 80 meest recent actieve gesprekken, per gesprek maximaal 10.000 berichten uit de laatste 3 dagen. Een admin van je Workspace kan toegang van apps tot Chat blokkeren; dan geeft de scan een foutmelding.
- Voor alleen-lezen aanroepen als gebruiker hoeft er volgens Google geen "Chat-app" te zijn ingesteld; aanzetten van de Chat API in het project en een OAuth-client is genoeg (gevonden via de zoekresultaten van de Google-documentatie, niet met een echt account gecontroleerd).

**Slack** loopt niet via de server maar via Claude: de dagelijkse Claude-taak met de Slack-koppeling leest openstaande berichten en stuurt ze met `suggest_todo` (`sourceType: "chat"`, `sourceExternalId` = het bericht-id, `sourceUrl` = de link naar het bericht). Er is geen Slack-code in deze app. **Teams** is niet gebouwd; tot die tijd: link plakken of doorsturen naar `/capture`.

## 8. Inplannen in de agenda

`POST /api/todos/{id}/schedule` en de MCP-tool `schedule_todo`. In het detailpaneel: "Plan in agenda" met 30, 60, 90 of 120 minuten.

- Zoekt het eerstvolgende vrije blok: werkdagen 09:00 tot 17:30 (Europe/Amsterdam), een raster van 15 minuten, weekenden worden overgeslagen, vandaag begint op z'n vroegst nu. Dezelfde regels als `findFreeSlots` in de oude app (`legacy/src/utils/calendarApi.js`), nu op de server (`functions/src/slots.ts`).
- **Bezet** is: afspraken met een tijd die niet geannuleerd, niet door jou geweigerd en niet op "beschikbaar" gezet zijn, plus hele dagen "afwezig". Gewone hele-dag-meldingen (verjaardag e.d.) blokkeren niet. Het zoekt maximaal 14 dagen vooruit.
- Maakt in je primaire agenda een afspraak met de titel van de taak (notitie en bronlink in de beschrijving, geen uitnodigingen) en zet `calendarEventId` op de taak. Is `estimateMin` leeg, dan wordt dat het aantal minuten. De datum van de taak verandert niet; valt het blok erna, dan meldt het antwoord `afterDue: true` en toont de app een waarschuwing.
- Staat de taak al in de agenda, dan weigert de server (`already_scheduled`). "Opnieuw inplannen" maakt een nieuw blok en haalt het oude uit de agenda.
- Feestdagen en andere agenda's dan de primaire tellen niet mee; zitten daar afspraken op die jou bezighouden, dan kan het blok botsen.

## 9. Meldingen en morning brief

- `GET /api/brief` en de MCP-tool `get_brief` geven één overzicht, als JSON én als korte leesbare Nederlandse tekst (`text`): `now` (om nu te doen, inclusief achterstallig en vandaag), `today` (datum is vandaag), `upcoming` (de komende 3 dagen, na vandaag), `overdue`, `suggestions` (open voorstellen), plus `date` en `dateLabel` van vandaag (Europe/Amsterdam). Bedoeld voor de morning brief van Claude en voor andere tools.
- `list_todos` kent het filter `upcoming:<dagen>` voor "wat zit eraan te komen".
- **Pushmeldingen** (Firebase Cloud Messaging voor het web), per apparaat aan te zetten in Instellingen, Meldingen:
  - **08:00 elke ochtend** één melding: "Vandaag: N taken" met de eerste drie titels (achterstallige taken tellen mee). Geen taken, geen melding. Per dag maar één keer; de server legt dat vast vóór het versturen, dus een herstart van de scheduler stuurt hem niet dubbel.
  - **Op het tijdstip van een taak met `dueTime`**: een scheduler draait elke 5 minuten tussen 06:00 en 22:00; een taak krijgt zijn melding zodra de tijd is aangebroken (tot 30 minuten te laat, voor het geval de scheduler hapert) en per taak-tijd precies één keer (`serverState.notified`, sleutel `taak|datum|tijd`, na 2 dagen opgeruimd). Wijzig je de tijd, dan telt dat als een nieuwe melding. Een melding voor een taak die al voorbij is, komt niet meer.
  - Het zijn FCM-"data"-berichten; de service worker (`src/sw.ts`) toont de melding zelf, zodat tik en opmaak overal gelijk zijn. Een tik opent de app op `/taken`.
  - Apparaten worden per token bewaard (`pushDevices`). Antwoordt FCM dat een token niet meer bestaat (`messaging/registration-token-not-registered`), dan wordt het apparaat verwijderd. `messaging/invalid-argument` telt alleen als de rest van dezelfde groep wel slaagde, zodat een fout in het bericht niet al je apparaten wist.
  - **Eén service worker.** De app gebruikte `generateSW` van `vite-plugin-pwa`; dat kan geen eigen code (FCM) meenemen. Nu staat er een eigen `src/sw.ts` (`strategies: 'injectManifest'`) die zowel de bestanden voor offline gebruik vastlegt als de meldingen toont. FCM krijgt die service worker mee via `getToken(..., { serviceWorkerRegistration })`, dus er is geen apart `firebase-messaging-sw.js`. De Firebase-instellingen komen bij het bouwen in `sw.js` (uit dezelfde `VITE_FIREBASE_*`-variabelen).
  - **iPhone en iPad:** alleen een app die op het beginscherm staat, kan meldingen krijgen (iOS 16.4 of nieuwer), en de toestemming moet uit een tik komen ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)). De app legt dat uit in Instellingen en toont de schakelaar pas als dat klopt. In een gewoon Safari-tabblad op iOS is dit niet beschikbaar.
  - **Tokens of FID's:** `firebase-admin` 14 markeert registratietokens als verouderd ten gunste van "Firebase Installation IDs". De web-SDK van de app (firebase 12) levert nog tokens, en die werken. Overstappen kan later in `functions/src/fcm.ts`.

## Klant automatisch herkennen

Elke bron levert tekst waarin de klant te vinden is: de titel en deelnemers van een agenda-afspraak, de naam van de Airtable-base, het onderwerp en de afzender van een mail, de naam van het chatkanaal. De server haalt die door dezelfde herkenning als de app (`src/lib/detect.ts`, trefwoorden per klant; e-maildomeinen tellen ook als trefwoord). Vindt die niets, dan kiest Haiku uit de lijst met klanten of laat het veld leeg (bij `/capture`; voor voorstellen en `add_todo` blijft het dan leeg).
