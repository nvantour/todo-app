# Tab Antwoorden

Wie wacht er op Nino? Claude zet per gesprek een kaart klaar met een conceptantwoord; Nino past aan en verstuurt met het vinkje.

## Flow

1. Nino typt `/chats-ophalen` in Claude (skill in de werkmap: `.claude/skills/chats-ophalen/`).
2. Claude leest Google Chat, Slack, Teams en mail, en slaat kaarten op met de MCP-tool `save_reply_drafts` (of `POST /api/replies`).
3. In de app (`/antwoorden`) past Nino het antwoord aan en klikt op **Versturen**.
4. Versturen per kanaal:
   - **mail**: de app zelf (Gmail-API in de browser, `src/data/sendReply.ts`), als antwoord in de thread, met handtekening en citaat; daarna uit Nieuw.
   - **gchat**: `POST /api/replies/:id/send` → de server plaatst het bericht met de Google-koppeling (scope `chat.messages.create`). Alleen met het ID-token van de app.
   - **teams / slack**: status `approved`; het verzendscript op de Mac mini (`reply-sender/`) haalt de wachtrij op, typt precies `draft` in het gesprek op `target.url` en meldt `sending` → `sent`/`failed`.

**Claude verstuurt nooit.** Claude kan alleen kaarten als `open` aanleveren; goedkeuren kan alleen de app (Firestore-schrijfactie van de ingelogde gebruiker), en `/send` weigert elk token dat geen ID-token is.

## Statussen

`open` → (vinkje) → `approved` (Teams/Slack) of `sending` (mail/Chat) → `sent` | `failed`. Daarnaast `dismissed` (Negeren of Taak).
Terugzetten kan vanuit `approved` (zolang het script nog niet begonnen is) en vanuit `failed`.

Een nieuwe ronde van Claude (`mergeReply` in `src/data/replies.ts`):
- nieuw gesprek → nieuwe kaart;
- open/mislukt → berichten bijgewerkt; het concept alleen als Nino het niet zelf heeft aangepast (`draftEdited`);
- verstuurd/genegeerd → alleen weer open als er sindsdien een bericht van een ander is;
- goedgekeurd/bezig → niet aangeraakt.

## API

| Methode | Pad | Wie | Wat |
|---|---|---|---|
| POST | `/api/replies` | token of app | `{replies: IncomingReply[]}` → `{created, updated, reopened, skipped}` |
| GET | `/api/replies?status=approved&channel=teams,slack` | token of app | wachtrij voor het script |
| POST | `/api/replies/:id/result` | token | `{status: 'sending'|'sent'|'failed', error?}`; alleen approved→sending→sent/failed |
| POST | `/api/replies/:id/send` | alleen app (ID-token) | `{text}` → Google Chat versturen |

`target` per kanaal: mail `{threadId}` · gchat `{space, thread}` · slack `{url, channel, ts}` · teams `{url}`.
