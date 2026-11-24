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
- **Voorstellen**: mogelijke **taken** die tools of AI zelf vinden (agenda, meeting, mail, chat). Wordt pas een taak na akkoord. Iets waar alleen een antwoord op moet komen is geen voorstel: dat hoort op **Antwoorden**.
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
- Voorstellen = taken, Antwoorden = berichten. Een chat, mail, Slack of Teams waar een antwoord op moet komen gaat naar de tab Antwoorden (`save_reply_drafts` of de scan), nooit als "Reageren op …" naar Voorstellen.
- De service worker mag `/__/` (Firebase-login), `/api`, `/mcp`, `/oauth` en `/.well-known` niet onderscheppen.
- Sleutels staan nooit in de repo: Firebase-webconfig in `.env.local` (niet geheim), serversleutels in de kluis van het project (`firebase functions:secrets:set`), de persoonlijke sleutel voor Claude als `TODO_APP_TOKEN` in `~/.zprofile`.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` met waarde `-` betekent: Google-koppeling nog niet ingesteld.

## Mail (sinds 2026-11-22)

- De mail draait als Mail-tab: `src/mail/` (`mailApp.ts` is het hart) in een Shadow DOM via `src/views/MailView.tsx`. Eigen stijlen in `src/mail/mail.css` (`:host`, `@container mail`).
- De code komt uit de losse app Email-Client. Die is op 2026-11-23 uitgefaseerd: site `email-client-nino.web.app` en de server zijn offline, het Firebase-project `email-client-nino` is afgesloten (Google verwijdert het definitief na 30 dagen; tot dan terug te halen via Google Cloud › Manage resources › Resources pending deletion), de lokale map `apps/Email client` is weg, de repo `nvantour/email-client` staat op alleen-lezen als naslag. Alleen de herkenningsregel `Email-Client thread:` in agenda-herinneringen heet nog zo, omdat bestaande herinneringen daarop gevonden worden.
- Inloggen via de Google-koppeling: scopes `gmail.modify` + `gmail.settings.basic`; `GET /api/google/token` (alleen ID-token van de app) geeft een toegangsbewijs van een uur; het refresh-token blijft op de server.
- Regels = Gmail-filters (werken ook als de app dicht is). Voorwaarden: afzender, onderwerp en/of bericht bevat (alles wat is ingevuld moet kloppen); actie: naar een map of doorsturen naar een adres, met optie "niet in Nieuw". Vertaling en controles in `src/mail/gmail/rules.ts` (los getest). Gmail stuurt alleen door naar adressen die in Gmail zijn toegevoegd en bevestigd (Instellingen › Doorsturen); een nieuw adres toevoegen kan niet via de app. Meer doorstuuradressen in één regel kan (komma ertussen of de knoppen met bevestigde adressen aanklikken): Gmail kent per filter maar één doorstuuradres, dus de app maakt één filter per adres (alles of niets) en toont filters met dezelfde voorwaarden als één rij; "Verwijder" haalt ze alle weg. Filters die meer doen dan dit toont de app als "Andere Gmail-regel" en laat hij met rust.
- Gmail-verzoeken gaan via `gmail()` in `gmail/api.ts`: hooguit 4 tegelijk, en bij 429/"rate limit" zelf opnieuw na 1-2-4-8-16 s. Nieuwe aanroepen altijd via `gmail()`, niet met een losse `fetch`, anders komt de melding "Gmail vraagt om even rustiger aan te doen" terug.
- De tellers in het menu verversen elke 30 s en tekenen alleen het menu opnieuw. Nooit alles opnieuw tekenen vanuit een timer: dan valt de cursor uit het schrijfvenster en gelden toetsen als sneltoets (E = Klaar, Backspace = prullenbak).
- Thread (sinds 2026-11-23): Beantwoord / Allen beantwoorden / Stuur door bovenaan in de balk; nieuwste bericht bovenaan; het schrijfvenster staat boven de berichten en verschijnt pas na zo'n klik (of als er al een concept is). Adresvelden zijn `textarea.addr` (lopen door, Enter doet niets). Afbeeldingen altijd aan, ook ingesloten `cid:`-afbeeldingen (`loadInline`). ↑/↓ = vorige/volgende thread. Klik op een datumveld opent de kalender (`showPicker`).
- Adressen aanvullen (sinds 2026-11-24): "eda" typen in Aan/Cc/Bcc toont suggesties (↑/↓, Enter of Tab, of klikken). Adresboek = `loadContacts` in `gmail/api.ts`: To/Cc van je verzonden mail (1 jaar, zwaarder) + afzenders van ontvangen mail (6 maanden), een dag bewaard in de browser; rangschikken en invoegen in `src/mail/contacts.ts` (los getest).
- Menu zonder mappen (een map maak je in het Map-menu van een thread); Regels en Sneltoetsen staan onder Instellingen.
- Meeting-acceptaties (`ACCEPTED_QUERY` in `gmail/api.ts`: onderwerp Geaccepteerd/Accepted + .ics) gaan via een vaste Gmail-regel gelezen naar de prullenbak; bij openen ruimt de app achterblijvers op.
- Label "Taak" (blauw) bij mails met een open taak in het werk-OS (`src/lib/mailTasks.ts`), "Opgeslagen" is zacht rood.
- "Maak taak" en "Bespreek" in een thread praten via `MailHooks` met de store. Gepland verzenden staat uit (daar is een taak op de server voor nodig; die heeft de todo-app nog niet).
- Google-koppeling ingesteld op 2026-11-22: OAuth-client "Todo server (agenda en chat)", secrets `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (versie 2).

## Antwoorden (sinds 2026-11-23)

- Tab `/antwoorden` (`src/views/RepliesView.tsx`): kaarten per gesprek (mail, Google Chat, Slack, Teams) met conceptantwoord; Nino verstuurt met het vinkje. Contract en statussen: `docs/antwoorden.md`.
- Kaarten komen uit twee bronnen. (1) De **scan op de server** (`functions/src/replyScan.ts`, geplande functie `chatScan`, elk uur op werkdagen): Google Chat (`chatScan.ts`), mail en de meldingsmails van Teams en Slack (`mailScan.ts`); vaste herkenning, zonder concept. (2) **Claude** via skill `/chats-ophalen` (werkmap) → MCP `save_reply_drafts` / `POST /api/replies`: alle kanalen volledig, met concept. Niemand verstuurt vanzelf; `/api/replies/:id/send` accepteert alleen het ID-token van de app.
- De scan sluit aan op bestaande kaarten (concept en verzendadres van Claude blijven staan) en haalt een Chat- of mailkaart weg zodra Nino in het gesprek zelf heeft gereageerd. Teams en Slack ziet de server alleen via meldingsmails (gemiste berichten); Slack-kaarten uit de scan hebben geen verzendadres.
- De kaart: concept bovenin, daaronder het gesprek. Mail wordt vers uit Gmail getoond (opmaak, afbeeldingen, nieuwste bovenaan) met de handtekening onder het tekstvak (`src/views/replies/`, kader gedeeld met de Mail-tab via `src/mail/render.ts`). De handtekening komt uit Gmail en is alleen gevuld als hij daar als standaard voor nieuwe e-mails is gekozen.
- Elke open kaart hoort een concept te hebben: `list_replies` geeft `hasDraft`, met `details: true` de berichten; Claude vult aan via `save_reply_drafts`. Dat doet de geplande taak `antwoorden-concepten` in de Claude-app (werkdagen elk uur om :05).
- Versturen: mail door de app (Gmail), Google Chat door de server (scope `chat.messages.create`, vraagt één keer opnieuw koppelen), Teams/Slack door `reply-sender/` op de Mac mini (Playwright, eigen ingelogd profiel).

## Stand (2026-11-18)

Werkt: app, login, sync, server, Claude-koppeling op de laptop. Nog in te stellen door Nino: Google-koppeling (agenda, Chat), meldingen (VAPID-sleutel), Claude-app op de telefoon, Siri-opdracht. Zie `docs/server.md`.

## Chrome-extensie (`chrome-extension/`)

MV3. Opent `https://work-apps-48770.web.app/quick-add?text=...` in een klein venster (contextmenu + Cmd+Shift+T in Chrome).

## QA

Na elke wijziging in webapp-functionaliteit: voer de `/qa` skill uit, in testmodus (`--mode qa`) zodat echte taken niet vervuild raken.
