# Tab Antwoorden

Wie wacht er op Nino? Alles waar een antwoord op moet komen staat hier: chats, mails, Slack en Teams.
Taken horen hier niet (die staan bij Voorstellen en Taken); een "Reageren op …"-voorstel bestaat niet meer.

Twee bronnen vullen de tab:

| Bron | Wanneer | Wat | Concept |
|---|---|---|---|
| **Scan op de server** (`functions/src/replyScan.ts`) | elk uur op werkdagen, 08:00 t/m 18:00, en met "Antwoorden nu scannen" in Instellingen | Google Chat, mail, en via de meldingsmails ook Teams en Slack | nee |
| **Claude** (`/chats-ophalen`) | als Nino het vraagt | alle kanalen, volledig gelezen (ook Airtable) | ja |
| **Claude, uurronde** (geplande taak `antwoorden-concepten`) | werkdagen elk uur om :05 | Slack (DM's + vermeldingen), Teams (Activity + chatlijst, zonder chats te openen), Airtable (reacties waar iets van Nino nodig is) | ja |

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

## Emoji (sinds 2026-11-26)

Onder elk chatbericht (Google Chat, Teams, Slack) staan de emoji die erop gegeven zijn, met hoe vaak; die van Nino zelf zijn gekleurd. Met de knop ernaast (smiley met plus) zet Nino er zelf een: 👍 ❤️ 😂 🙏 ✅ 👀 🎉 🙌. Een emoji van een ander aanklikken = dezelfde erbij zetten. Na een emoji vraagt de kaart "Klaar met dit gesprek?": **Afhandelen** zet de kaart op `dismissed` (komt terug bij een nieuw bericht), **Ik antwoord ook** laat hem open.

**Lezen** (`ReplyMessage.reactions`, met `id` = het bericht-id in de bron):
- Google Chat: de scan leest `emojiReactionSummaries` mee. Google zegt niet wie een emoji gaf; dat het de jouwe is, onthoudt de kaart zelf (`mergeMessages` houdt `mine` vast).
- Teams en Slack: alleen via Claude (`/chats-ophalen` en de uurronde), die per bericht `id` en `reactions` meegeeft. De scan van meldingsmails kent ze niet; een ronde zonder `reactions` laat bestaande staan.

**Zetten** (`Reply.reactionQueue`, één `ReactionRequest` per emoji; alleen de app maakt ze aan, Claude nooit):
- Google Chat: de app roept `POST /api/replies/:id/react` aan (alleen ID-token van de app); de server zet de emoji met de Google-koppeling (scope `chat.messages.reactions.create`, vraagt één keer opnieuw koppelen; zie Instellingen → "Chat emoji").
- Teams en Slack: status `queued`. De **wachter op de laptop** (`claude-sender/`) ziet dat binnen 15 s en start `claude -p`: MCP `list_reaction_queue` → per emoji `report_reaction_result` `sending` → zetten → `sent`/`failed`. Slack met de Slack-koppeling (`slack_add_reaction`), Teams in Nino's eigen Chrome (Claude in Chrome). Niet ingelogd → `failed` met de reden en een macOS-melding. Claude zet alleen wat in de wachtrij staat, nooit iets eigens. Noodroute met de hand: `/chats-ophalen emoji`.
- Het verzendscript op de Mac mini (`reply-sender/`) kan het ook, maar draait nu nergens (mini niet in gebruik, en Nino wil geen apart browserprofiel om op in te loggen; 2026-11-26).
- Statussen: `queued` → `sending` → `sent` | `failed` (Chat begint meteen bij `sending`). Bij `sent` komt de emoji onder het bericht (`withReaction`). Mislukt het terwijl de kaart al was afgehandeld, dan gaat de kaart weer open. Een mislukte emoji staat rood; aanklikken = opnieuw proberen.
- Een emoji-resultaat verandert `updatedAt` van de kaart niet: het is geen nieuw bericht.

Logica gedeeld tussen app en server in `src/data/replies.ts` (`canReact`, `shownReactions`, `stepReaction`, `mergeMessages`), knoppen in `src/views/replies/Reactions.tsx`.

## Altijd een concept

Elke open kaart hoort een conceptantwoord te hebben. De scan schrijft er geen (de server heeft bewust geen Claude-sleutel); Claude vult ze aan. `list_replies` geeft per kaart `hasDraft`; met `details: true` komen de berichten, het verzendadres en de uitleg mee, zodat Claude het concept kan schrijven en met `save_reply_drafts` (zelfde kanaal en `externalId`) op de kaart zet. Zie de skill `/chats-ophalen`, onderdeel "Alleen concepten aanvullen".

Dat gebeurt vanzelf door de geplande taak **`antwoorden-concepten`** in de Claude-app (werkdagen elk uur om :05, kort na de scan; prompt in `~/.claude/scheduled-tasks/antwoorden-concepten/SKILL.md`). De taak draait alleen als de Claude-app op de laptop open staat; staat hij dicht, dan vult de eerstvolgende ronde aan. De taak verstuurt niets en maakt geen taken.

Sinds 2026-11-26 zoekt dezelfde taak eerst zelf naar nieuwe gesprekken in **Slack, Teams en Airtable** (skill `/chats-ophalen`, onderdeel "Uurronde"). Reden: de scan ziet Teams en Slack alleen als ze een meldingsmail sturen (alleen als Nino een tijd inactief was, in de praktijk een paar per twee weken), en Airtable-meldingen (`noreply@airtable.com`) vallen in de scan af als automatische mail. Teams loopt via de ingebouwde browser waar Nino is ingelogd; de taak opent geen chats, zodat niets ongemerkt op gelezen komt. Bij Airtable beslist de taak aan de manier van taggen en de vraag zelf of er iets van Nino nodig is (`CC: @Nino` = nee).

## Flow met Claude

1. Nino typt `/chats-ophalen` in Claude (skill in de werkmap: `.claude/skills/chats-ophalen/`).
2. Claude leest Google Chat, Slack, Teams en mail, en slaat kaarten op met de MCP-tool `save_reply_drafts` (of `POST /api/replies`).
3. In de app (`/antwoorden`) past Nino het antwoord aan en klikt op **Versturen**.
4. Versturen per kanaal:
   - **mail**: de app zelf (Gmail-API in de browser, `src/data/sendReply.ts`), als antwoord in de thread, met handtekening en citaat; daarna uit Nieuw.
   - **gchat**: `POST /api/replies/:id/send` → de server plaatst het bericht met de Google-koppeling (scope `chat.messages.create`). Alleen met het ID-token van de app. Vereist een Chat-app-configuratie in Google Cloud (API Google Chat → Configuratie: naam Werk-OS, interactief uit), ingesteld 2026-11-23.
   - **airtable**: zelfde endpoint → de server plaatst een reactie op het record (`target.baseId/tableId/recordId`, `parentCommentId` voor een antwoord in de draad) met `AIRTABLE_API_TOKEN` (scope `data.recordComments:write`).
   - **teams / slack**: status `approved`; de wachter op de laptop (`claude-sender/`) start `claude -p`, die met MCP `list_send_queue` de wachtrij ophaalt, precies `draft` verstuurt (Slack via de Slack-koppeling, Teams in Nino's eigen Chrome) en met `report_reply_result` `sending` → `sent`/`failed` meldt. (Het oude verzendscript op de Mac mini, `reply-sender/`, doet hetzelfde via REST maar draait nu niet.)

**Claude keurt nooit goed.** Claude kan alleen kaarten als `open` aanleveren; goedkeuren kan alleen de app (Firestore-schrijfactie van de ingelogde gebruiker), en `/send` weigert elk token dat geen ID-token is. Claude verstuurt alleen wat Nino met het vinkje goedkeurde (Teams/Slack, via de wachter), precies zoals hij het goedkeurde.

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
| POST | `/api/replies/:id/react` | alleen app (ID-token) | `{messageId, emoji}` → emoji op een Google Chat-bericht |
| GET | `/api/reactions?status=queued&channel=teams,slack` | token of app | emoji-wachtrij voor het script: `{reactions: [{replyId, channel, title, url, target, reaction}]}` |
| POST | `/api/replies/:id/reactions/:rid/result` | token | `{status: 'sending'|'sent'|'failed', error?}`; alleen queued→sending→sent/failed |

`externalId` per kanaal (zo geeft de scan ze; Claude neemt de naam van een bestaande kaart over): mail `gmail:<threadId>` · gchat de thread `spaces/X/threads/Y`, of voor een DM de space `spaces/X` · teams `teams:<chat-id>` · slack `slack:<kanaal>:<ts>`, of voor een DM `slack:<kanaal>`.

`target` per kanaal: mail `{threadId}` · gchat `{space, thread}` (DM: alleen `space`) · slack `{url, channel, ts}` · teams `{url}` = `https://teams.microsoft.com/l/chat/<chat-id>/0?tenantId=<tenant>` · airtable `{baseId, tableId, recordId, parentCommentId?}`.
