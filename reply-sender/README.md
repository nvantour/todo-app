# Reply-sender (Teams + Slack)

Klein script dat goedgekeurde antwoorden uit de todo-app verstuurt in **Microsoft Teams** en **Slack** (web).

Zo werkt het:

1. In de tab "Antwoorden" keurt Nino een concept goed → status `approved`.
2. Dit script vraagt elke 15 s aan de server: `GET /api/replies?status=approved&channel=teams,slack`.
3. Per antwoord (één tegelijk):
   - zet de status op `sending` (lukt dat niet → niet versturen);
   - opent `target.url` in een eigen Chrome-profiel;
   - typt **precies** de tekst `draft` (nieuwe regel = Shift+Enter) en controleert dat het invoerveld exact die tekst bevat;
   - drukt op Enter en controleert dat het bericht als laatste bericht in het gesprek staat;
   - zet de status op `sent`, of op `failed` met een korte reden.
4. Een antwoord dat al op `sending` staat, wordt overgeslagen. Blijft er een op `sending` hangen (bijv. na een crash), dan lost Nino dat zelf op. Het script probeert nooit vanzelf opnieuw.

Staat er al tekst in het invoerveld (een oud concept), dan raakt het script niets aan en wordt het `failed`.

## Emoji (sinds 2026-11-26)

Zet Nino in de app een emoji op een Teams- of Slack-bericht, dan komt die als verzoek in de wachtrij van de kaart (`reactionQueue`, status `queued`). Het script haalt elke ronde ook `GET /api/reactions?status=queued&channel=teams,slack` op en zet ze één voor één:

- meldt eerst `sending` (lukt dat niet: niet zetten), daarna `sent` of `failed` met een korte reden, via `POST /api/replies/:id/reactions/:rid/result`;
- **Slack**: opent het gesprek en gebruikt de eigen API van de Slack-webapp in de ingelogde pagina (`reactions.add`). Het bericht wordt gevonden op de ts (`messageId`), of anders op tijd + tekst via `conversations.history`/`conversations.replies`. Het token blijft in de pagina en wordt nooit gelogd.
- **Teams**: opent het gesprek, zoekt het bericht (op id, anders op tekst), beweegt erover en klikt de snelle reactie (👍 ❤️ 😂) of zoekt de emoji op in "Meer reacties" (🙏 ✅ 👀 🎉 🙌).
- Mislukt het op een kaart die Nino al had afgehandeld ("Klaar zo?" → Afhandelen), dan zet de server de kaart weer open, zodat hij het ziet.

Dry-run: Slack controleert de sessie (`auth.test`) en vindt het bericht, maar zet niets. Teams opent de reactiebalk of "Meer reacties", vindt de juiste emoji en drukt dan Escape.

> De Teams-stappen zijn gebouwd zonder live Teams om te testen (selectors op basis van bekende namen). Draai na het bijwerken eerst `node sender.mjs --dry-run --once --headful` met een echt verzoek in de wachtrij.

## Installeren

Google Chrome moet geïnstalleerd zijn (Playwright gebruikt die, er wordt geen aparte browser gedownload).

```bash
cd apps/todo-app/reply-sender
npm install
npm test          # tests van de losse logica
```

Het token komt uit `TODO_APP_TOKEN` (staat in `~/.zprofile`). Het staat nooit in een bestand in deze map en wordt nooit gelogd.

## Eenmalig inloggen

```bash
node sender.mjs --login
```

Er opent een Chrome-venster met Teams en Slack. Log zelf in (ook de gast-tenants Transavia en Customer Collective één keer openen). Sluit daarna het venster. De login blijft bewaard in `~/.config/todo-app/reply-sender-profile` (buiten de repo).

Staat een antwoord op `failed` met "Niet ingelogd bij Teams/Slack — draai het script met --login": stop de dienst, draai `--login` opnieuw en start de dienst weer. Het profiel kan maar door één proces tegelijk gebruikt worden.

## Testen zonder te versturen

```bash
node sender.mjs --dry-run --once            # één ronde, onzichtbaar
node sender.mjs --dry-run --once --headful  # meekijken
```

Dry-run doet alles (openen, typen, controleren) behalve de laatste Enter. Daarna wordt het invoerveld weer leeggemaakt, zodat er geen concept achterblijft. De status blijft `approved`; er gaat niets naar de server.

Overige vlaggen: `--headful` (browser zichtbaar), `--once` (één ronde), `--interval=30` (elke 30 s).
Omgevingsvariabelen (optioneel): `TODO_APP_API` (andere server, bijv. een lokale testserver), `REPLY_SENDER_PROFILE` (andere profielmap).

Stoppen: Ctrl+C maakt de huidige stap af en stopt dan. Nog een keer Ctrl+C = direct stoppen.

## Als dienst op de Mac mini (launchd)

`run.sh` leest `~/.zprofile` (token + PATH met node) en start daarna het script. Zo staat het token niet in de plist.

Zet dit als `~/Library/LaunchAgents/nl.onlinedialogue.reply-sender.plist` en pas het pad aan naar de plek van de map op de mini. Gebruik een **LaunchAgent** (draait als jouw gebruiker, in je ingelogde sessie), geen LaunchDaemon: Chrome heeft je sleutelhanger nodig om de opgeslagen login te lezen.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>nl.onlinedialogue.reply-sender</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>/PAD/NAAR/apps/todo-app/reply-sender/run.sh</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>StandardOutPath</key>
  <string>/tmp/reply-sender.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/reply-sender.log</string>
</dict>
</plist>
```

Starten / stoppen / log:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/nl.onlinedialogue.reply-sender.plist
launchctl bootout   gui/$(id -u)/nl.onlinedialogue.reply-sender
tail -f /tmp/reply-sender.log
```

Werkt Teams niet in de onzichtbare modus, zet dan `--headful` achter `run.sh` in de plist (de mini heeft een ingelogde sessie, dus een venster mag).

## Bestanden

- `sender.mjs` — hoofdscript (server, browser, Teams, Slack, emoji).
- `lib.mjs` — losse logica: welke antwoorden, link-controle, login-herkenning, tekst → toetsen, vergelijken, statussen.
- `lib.test.mjs` — tests (`node --test`).
- `run.sh` — wrapper voor launchd.

## Bekende aandachtspunten

- Teams-deeplinks (`/l/chat/...`) openen eerst een "download de app"-pagina. Het script opent daarom meteen de web-app-route `https://teams.microsoft.com/_#/l/...`.
- De selectors voor het invoerveld en de berichtenlijst zijn gekozen op basis van eerder uitlezen van Teams en de bekende `data-qa`-namen van Slack, maar pas echt te controleren na inloggen. Draai na de eerste login een `--dry-run --once --headful` met een echt goedgekeurd antwoord.
- In een Teams-**kanaal** is er geen aparte markering voor eigen berichten; de controle kijkt daar naar het laatste bericht.
