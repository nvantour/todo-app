# Claude-sender (wachter op de laptop)

Zet Teams- en Slack-emoji en verstuurt goedgekeurde Teams/Slack-antwoorden **direct** na Nino's klik in het werk-OS.
Vervangt voor nu het verzendscript op de Mac mini (`reply-sender/`), die niet in gebruik is (2026-11-26).

## Hoe het werkt

1. Nino klikt op de tab Antwoorden een emoji aan op een Teams/Slack-bericht (`reactionQueue`, status `queued`),
   of keurt een Teams/Slack-antwoord goed met het vinkje (status `approved`).
2. `watch.mjs` kijkt elke 15 s (`GET /api/replies?status=approved&channel=teams,slack` en
   `GET /api/reactions?status=queued&channel=teams,slack`, met `TODO_APP_TOKEN`).
3. Staat er iets klaar, dan start hij `claude -p` met `opdracht.md`, met `--chrome`, model `sonnet`,
   `--permission-mode dontAsk` en alleen deze tools: de vier wachtrij-tools van de todo-koppeling, vier Slack-tools
   (emoji, bericht, thread/kanaal lezen) en Claude in Chrome.
4. Claude meldt per onderdeel `sending` → zet/verstuurt → `sent` of `failed` (MCP `report_reaction_result` /
   `report_reply_result`). De server laat alleen die stappen toe: Claude kan zelf niets goedkeuren.
   - **Slack**: via de Slack-koppeling (geen browser).
   - **Teams**: in Nino's eigen Chrome (Claude in Chrome), in een eigen tabblad dat daarna dicht gaat.
5. Mislukt iets, dan krijgt Nino een macOS-melding (osascript), één keer per
   onderdeel. Bij "niet ingelogd" staat dat in de melding: dan moet Nino inloggen (Teams in Chrome).
6. Pakt Claude een onderdeel twee rondes niet op (blijft het `approved`/`queued`), dan laat de wachter het liggen
   en komt er één melding. Zo blijft hij niet eindeloos Claude starten.

Duur: een ronde met Teams kost ongeveer een minuut (Chrome openen, Teams laden). Slack is sneller.
Werkt alleen als de laptop aan staat en Chrome open is (voor Teams).

## Bestanden

- `watch.mjs` — de wachter. `--once` = één ronde.
- `opdracht.md` — de vaste opdracht voor Claude.
- `lib.mjs` + `lib.test.mjs` — losse logica (pogingen tellen, meldingen), `node --test`.
- `run.sh` — wrapper voor launchd (leest `~/.zprofile` voor `TODO_APP_TOKEN` en het pad naar node/claude).
- `install.sh` — kopieert naar `~/.local/share/todo-app/claude-sender` en zet de dienst aan.
- Status: `~/.config/todo-app/claude-sender-state.json` · log: `~/Library/Logs/claude-sender.log`.

## Als dienst (launchd)

macOS laat een dienst niet in `~/Documents` werken ("Operation not permitted"). Daarom kopieert `install.sh` de
wachter naar `~/.local/share/todo-app/claude-sender`, schrijft `~/Library/LaunchAgents/nl.onlinedialogue.claude-sender.plist`
en (her)start hem. **Na elke wijziging in deze map opnieuw draaien:**

```bash
./install.sh
```

```bash
launchctl bootout gui/$(id -u)/nl.onlinedialogue.claude-sender   # stoppen
tail -f ~/Library/Logs/claude-sender.log                         # meekijken
```

`claude -p` draait vanuit die kopie, dus zonder de CLAUDE.md's en hooks van de werkmap.

Vereist: Claude CLI ingelogd met het abonnement (`claude` → `/login`, optie 1), Claude in Chrome verbonden,
en in Chrome ingelogd op Teams.
