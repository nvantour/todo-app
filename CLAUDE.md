# CLAUDE.md

Nino's eigen todo-app: AI-native, voor laptop en telefoon. Live op **https://work-apps-48770.web.app**. Vervangt sinds 2026-11-18 het oude `todos.md`-systeem en de oude webapp.

## Taal & communicatie

Spreek Nederlands. Gebruiker: Nino. Bevestig altijd voor grote acties. UI-tekst in eenvoudig Nederlands.

## Commands

```bash
npm run dev         # Dev-server (logt in op het echte project via .env.local)
npm run dev -- --mode qa --port 5177   # Testmodus: lokale opslag met voorbeelddata, geen login, raakt echte taken niet
npm run typecheck   # TypeScript, ook de service worker
npm run lint
npm test            # Vitest (app)
npm run build       # → dist/

cd functions && npx vitest run && npm run build   # Server: tests + bundel
firebase deploy --only hosting                     # Alleen de app
firebase deploy --only functions,hosting,firestore # Alles
```

Deploy is handmatig met de Firebase-CLI (project `work-apps-48770`). Er is geen automatische deploy bij een push.

## Wat de app doet

- De app groeit uit tot Nino's **werk-OS** (plan: `Ideeën/Werk-OS (todo-app als centrale plek).md` in de werkmap). Tabs: Vandaag · Taken · Om te bespreken · Meetings · Mail · Voorstellen · Per klant. Meetings en Mail zijn nog een lege staat (`src/views/ComingSoonView.tsx`).
- **Vandaag** (`/vandaag`, startpagina): dagstart-blok (nog leeg, wordt gevuld door `/werkronde`), voorstellen-banner, max. 5 taken "om nu te doen", bespreekgroepen met open punten. Op de telefoon staan Meetings, Mail en Per klant onder "Meer".
- Scherm **Taken** met twee groepen: *Om nu te doen* (`bucket: 'now'`) en *Om niet te vergeten* (`'later'`). Een taak met een datum schuift op die dag vanzelf naar "nu". Geen prioriteiten.
- **Per klant**: raster met een blok per klant plus "Overig".
- **Voorstellen**: wat tools of AI zelf vinden (agenda, meeting, mail, chat). Wordt pas een taak na akkoord.
- Checklist zoals Notes: klik in de tekst om te bewerken, lege regel onderaan om door te typen. Klant, datum, tijd en herhaling worden herkend uit de tekst (`src/lib/parse.ts`, `src/lib/detect.ts`).
- Inspreken (`src/voice/`), zoeken (⌘K), instellingen (thema, agenda-regels, meldingen, koppelingen).

## Architectuur

**App** (`src/`): Vite + React 19 + TypeScript, plain CSS met tokens in `src/styles/tokens.css`, Poppins (lokaal meegeleverd), PWA met eigen service worker `src/sw.ts`.

- `src/model/types.ts` — het datamodel; leidend voor app, server en koppelingen. Alleen uitbreiden, niet hernoemen.
- `src/data/store.ts` — de `Store`-interface waar alle schermen mee praten. Daaronder: lokale opslag (testmodus) of Firestore (`firestoreStore.ts`), gewisseld door `connection.ts`.
- `src/data/session.ts` — Google-login. `authDomain` is bewust het hostingadres (`web.app`), anders loopt inloggen in de geïnstalleerde app in een lus.
- Datums zijn overal ISO-tekst (`YYYY-MM-DD`), geen Timestamps.

**Server** (`functions/`): Cloud Functions v2, Node 22, regio `europe-west1`. Logica los van Firestore (`repo.ts` + `MemoryRepo` voor tests).

- `api` — REST-koppelpunt (`/api/...`): capture, todos, suggestions, brief, tokens, transcribe, scans, airtable, schedule.
- `mcp` — Claude-koppeling op `/mcp` (Streamable HTTP). `oauth` — inlogroute voor de Claude-app.
- `calendarScan`, `chatScan`, `morningPush`, `dueTimePush` — geplande taken.
- **Geen Claude API-sleutel** (bewuste keuze van Nino: geen extra kosten). Slim werk loopt via Claude zelf over de MCP-koppeling; de server gebruikt vaste herkenning.

**Opslag** (Firestore, eur3): `users/{uid}/{todos,projects,labels,suggestions,calendarRules}`; tokens en Google-koppeling in collecties die voor clients dicht zijn. Zie `firestore.rules`.

Het volledige contract voor koppelingen staat in `docs/koppelingen.md`; serverinstellingen en handmatige stappen in `docs/server.md`; spraak in `docs/voice.md`; Siri in `docs/siri.md`.

## Vaste afspraken

- Wat Nino letterlijk vraagt → taak (`add_todo`). Wat een tool of AI zelf vindt → voorstel (`suggest_todo`), nooit direct een taak.
- De service worker mag `/__/` (Firebase-login), `/api`, `/mcp`, `/oauth` en `/.well-known` niet onderscheppen.
- Sleutels staan nooit in de repo: Firebase-webconfig in `.env.local` (niet geheim), serversleutels in de kluis van het project (`firebase functions:secrets:set`), de persoonlijke sleutel voor Claude als `TODO_APP_TOKEN` in `~/.zprofile`.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` met waarde `-` betekent: Google-koppeling nog niet ingesteld.

## Mail (sinds 2026-11-22)

- De mail draait als Mail-tab: `src/mail/` (`mailApp.ts` is het hart) in een Shadow DOM via `src/views/MailView.tsx`. Eigen stijlen in `src/mail/mail.css` (`:host`, `@container mail`).
- De code komt uit de losse app Email-Client. Die is op 2026-11-23 uitgefaseerd: site `email-client-nino.web.app` en de server zijn offline, de lokale map `apps/Email client` is weg, de repo `nvantour/email-client` staat op alleen-lezen als naslag. Alleen de herkenningsregel `Email-Client thread:` in agenda-herinneringen heet nog zo, omdat bestaande herinneringen daarop gevonden worden.
- Inloggen via de Google-koppeling: scopes `gmail.modify` + `gmail.settings.basic`; `GET /api/google/token` (alleen ID-token van de app) geeft een toegangsbewijs van een uur; het refresh-token blijft op de server.
- Regels = Gmail-filters (werken ook als de app dicht is). Voorwaarden: afzender, onderwerp en/of bericht bevat (alles wat is ingevuld moet kloppen); actie: naar een map of doorsturen naar een adres, met optie "niet in Nieuw". Vertaling en controles in `src/mail/gmail/rules.ts` (los getest). Gmail stuurt alleen door naar adressen die in Gmail zijn toegevoegd en bevestigd (Instellingen › Doorsturen); een nieuw adres toevoegen kan niet via de app. Filters die meer doen dan dit toont de app als "Andere Gmail-regel" en laat hij met rust.
- De tellers in het menu verversen elke 30 s en tekenen alleen het menu opnieuw. Nooit alles opnieuw tekenen vanuit een timer: dan valt de cursor uit het schrijfvenster en gelden toetsen als sneltoets (E = Klaar, Backspace = prullenbak).
- "Maak taak" en "Bespreek" in een thread praten via `MailHooks` met de store. Gepland verzenden staat uit (daar is een taak op de server voor nodig; die heeft de todo-app nog niet).
- Google-koppeling ingesteld op 2026-11-22: OAuth-client "Todo server (agenda en chat)", secrets `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (versie 2).

## Antwoorden (sinds 2026-11-23)

- Tab `/antwoorden` (`src/views/RepliesView.tsx`): kaarten per gesprek (mail, Google Chat, Slack, Teams) met conceptantwoord; Nino verstuurt met het vinkje. Contract en statussen: `docs/antwoorden.md`.
- Kaarten komen van Claude via skill `/chats-ophalen` (werkmap) → MCP `save_reply_drafts` / `POST /api/replies`. Claude verstuurt nooit; `/api/replies/:id/send` accepteert alleen het ID-token van de app.
- Versturen: mail door de app (Gmail), Google Chat door de server (scope `chat.messages.create`, vraagt één keer opnieuw koppelen), Teams/Slack door `reply-sender/` op de Mac mini (Playwright, eigen ingelogd profiel).

## Stand (2026-11-18)

Werkt: app, login, sync, server, Claude-koppeling op de laptop. Nog in te stellen door Nino: Google-koppeling (agenda, Chat), meldingen (VAPID-sleutel), Claude-app op de telefoon, Siri-opdracht. Zie `docs/server.md`.

## Chrome-extensie (`chrome-extension/`)

MV3. Opent `https://work-apps-48770.web.app/quick-add?text=...` in een klein venster (contextmenu + Cmd+Shift+T in Chrome).

## QA

Na elke wijziging in webapp-functionaliteit: voer de `/qa` skill uit, in testmodus (`--mode qa`) zodat echte taken niet vervuild raken.
