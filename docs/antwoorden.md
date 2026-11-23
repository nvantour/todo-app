# Tab Antwoorden

Wie wacht er op Nino? Alles waar een antwoord op moet komen staat hier: chats, mails, Slack en Teams.
Taken horen hier niet (die staan bij Voorstellen en Taken); een "Reageren op …"-voorstel bestaat niet meer.

Twee bronnen vullen de tab:

| Bron | Wanneer | Wat | Concept |
|---|---|---|---|
| **Scan op de server** (`functions/src/replyScan.ts`) | elk uur op werkdagen, 08:00 t/m 18:00, en met "Antwoorden nu scannen" in Instellingen | Google Chat, mail, en via de meldingsmails ook Teams en Slack | nee |
| **Claude** (`/chats-ophalen`) | als Nino het vraagt | alle kanalen, volledig gelezen (ook Airtable) | ja |

## De scan (zonder AI)

Vaste herkenning, geen Claude-sleutel. De scan leest alleen en verstuurt nooit iets.

- **Google Chat** (laatste 3 dagen): een DM waarvan het laatste bericht niet van jou is, en een vermelding (@jou) zonder later bericht van jou in dezelfde thread. Regels: `findReplyCandidates` in `chatScan.ts`.
- **Mail** (inbox, laatste 7 dagen): een mail van een mens, met jou bij **Aan** (alleen cc telt niet), waar jij daarna niet meer op hebt gereageerd. Nieuwsbrieven, meldingen, bonnetjes, automatische antwoorden, uitnodigingen en "gedeeld met jou" vallen af: op afzender (`noreply@`, `invoice@`, `notification.`-domeinen), op kopregels (`List-Unsubscribe`, `Auto-Submitted`), op onderwerp, en op de categorie die Gmail zelf geeft (Updates, Promoties, Sociaal, Forums). Een oude vraag in een thread die al langer dan 7 dagen zonder jou doorloopt (jij alleen nog in cc) telt ook niet. Regels: `classify` en `pendingMessage` in `mailScan.ts`.
- **Teams** (laatste 3 dagen): meldingsmails van `no-reply@teams.mail.microsoft` ("X sent a message") die nog in je inbox staan. De link in de mail wijst het gesprek aan; dat wordt het verzendadres (`target.url`).
- **Slack** (laatste 3 dagen): meldingsmails van `notification@slack.com` (vermelding of DM) die nog in je inbox staan. De kaart heeft geen verzendadres: uit de mail is niet zeker in welke thread het antwoord hoort. Antwoorden doe je in Slack zelf (knop "Open het gesprek"), of Claude vult het adres aan met `/chats-ophalen`.

Beperking bij Teams en Slack: de server ziet alleen wat als meldingsmail binnenkomt, dus berichten die je gemist hebt terwijl je weg was. Berichten die je in Teams of Slack zelf al zag, komen alleen via `/chats-ophalen`.

**Aansluiten op bestaande kaarten** (`alignWithExisting`): hoort een vondst bij een kaart die er al staat (zelfde mail-thread, chat, Teams-gesprek of Slack-kanaal), dan wordt die kaart bijgewerkt. Naam, verzendadres, concept en uitleg van Claude blijven staan.

**Vanzelf weg** (`closeAnswered`): een open kaart voor Google Chat of mail gaat naar `dismissed` zodra de scan ziet dat jij in dat gesprek hebt gereageerd ná het laatste bericht van de ander. Een kaart waarvan jij het antwoord hebt aangepast blijft staan. Voor Teams en Slack kan de server dit niet zien; daar klik je Negeren. Een mailkaart van de scan zelf (zonder concept) gaat ook weg als de scan de thread opnieuw leest en er geen openstaande mail meer in ziet.

## De kaart

- **Bovenaan staat het antwoord** (tekstvak met het concept), daaronder de knoppen, daaronder het gesprek.
- **Mail**: de app haalt de thread vers uit Gmail en toont de echte mail (opmaak, afbeeldingen, bijlagenamen), **nieuwste mail bovenaan**, in hetzelfde afgeschermde kader als de Mail-tab (`src/mail/render.ts`, `src/views/replies/mailLive.tsx` + `mailData.ts`). Lukt dat niet (testmodus, mail niet gekoppeld), dan staat de opgeslagen tekst van de scan er.
- **Handtekening** (mail): onder het tekstvak staat de handtekening uit Gmail zoals hij meegaat. De Gmail-API geeft alleen de handtekening die in Gmail als **standaard voor nieuwe e-mails** is gekozen. Staat die op "Geen handtekening", dan gaat de mail zonder weg en zegt de kaart dat.
- Een chat (Google Chat, Teams, Slack) blijft in de volgorde van het gesprek.

## Altijd een concept

Elke open kaart hoort een conceptantwoord te hebben. De scan schrijft er geen (de server heeft bewust geen Claude-sleutel); Claude vult ze aan. `list_replies` geeft per kaart `hasDraft`; met `details: true` komen de berichten, het verzendadres en de uitleg mee, zodat Claude het concept kan schrijven en met `save_reply_drafts` (zelfde kanaal en `externalId`) op de kaart zet. Zie de skill `/chats-ophalen`, onderdeel "Alleen concepten aanvullen".

## Flow met Claude

1. Nino typt `/chats-ophalen` in Claude (skill in de werkmap: `.claude/skills/chats-ophalen/`).
2. Claude leest Google Chat, Slack, Teams en mail, en slaat kaarten op met de MCP-tool `save_reply_drafts` (of `POST /api/replies`).
3. In de app (`/antwoorden`) past Nino het antwoord aan en klikt op **Versturen**.
4. Versturen per kanaal:
   - **mail**: de app zelf (Gmail-API in de browser, `src/data/sendReply.ts`), als antwoord in de thread, met handtekening en citaat; daarna uit Nieuw.
   - **gchat**: `POST /api/replies/:id/send` → de server plaatst het bericht met de Google-koppeling (scope `chat.messages.create`). Alleen met het ID-token van de app. Vereist een Chat-app-configuratie in Google Cloud (API Google Chat → Configuratie: naam Werk-OS, interactief uit), ingesteld 2026-11-23.
   - **airtable**: zelfde endpoint → de server plaatst een reactie op het record (`target.baseId/tableId/recordId`, `parentCommentId` voor een antwoord in de draad) met `AIRTABLE_API_TOKEN` (scope `data.recordComments:write`).
   - **teams / slack**: status `approved`; het verzendscript op de Mac mini (`reply-sender/`) haalt de wachtrij op, typt precies `draft` in het gesprek op `target.url` en meldt `sending` → `sent`/`failed`.

**Claude verstuurt nooit.** Claude kan alleen kaarten als `open` aanleveren; goedkeuren kan alleen de app (Firestore-schrijfactie van de ingelogde gebruiker), en `/send` weigert elk token dat geen ID-token is.

## Statussen

`open` → (vinkje) → `approved` (Teams/Slack) of `sending` (mail/Chat) → `sent` | `failed`. Daarnaast `dismissed` (Negeren of Taak).
Terugzetten kan vanuit `approved` (zolang het script nog niet begonnen is) en vanuit `failed`.

Een nieuwe ronde van Claude of van de scan (`mergeReply` in `src/data/replies.ts`):
- nieuw gesprek → nieuwe kaart;
- open/mislukt → berichten bijgewerkt; het concept alleen als Nino het niet zelf heeft aangepast (`draftEdited`) én de ronde een concept meegeeft (de scan geeft er geen, dus het concept van Claude blijft staan);
- verstuurd/genegeerd → alleen weer open als er sindsdien een bericht van een ander is;
- goedgekeurd/bezig → niet aangeraakt.

## API

| Methode | Pad | Wie | Wat |
|---|---|---|---|
| POST | `/api/replies` | token of app | `{replies: IncomingReply[]}` → `{created, updated, reopened, skipped}` |
| GET | `/api/replies?status=approved&channel=teams,slack` | token of app | wachtrij voor het script |
| POST | `/api/replies/:id/result` | token | `{status: 'sending'|'sent'|'failed', error?}`; alleen approved→sending→sent/failed |
| POST | `/api/replies/:id/send` | alleen app (ID-token) | `{text}` → Google Chat versturen |

`externalId` per kanaal (zo geeft de scan ze; Claude neemt de naam van een bestaande kaart over): mail `gmail:<threadId>` · gchat de thread `spaces/X/threads/Y`, of voor een DM de space `spaces/X` · teams `teams:<chat-id>` · slack `slack:<kanaal>:<ts>`, of voor een DM `slack:<kanaal>`.

`target` per kanaal: mail `{threadId}` · gchat `{space, thread}` (DM: alleen `space`) · slack `{url, channel, ts}` · teams `{url}` = `https://teams.microsoft.com/l/chat/<chat-id>/0?tenantId=<tenant>` · airtable `{baseId, tableId, recordId, parentCommentId?}`.
