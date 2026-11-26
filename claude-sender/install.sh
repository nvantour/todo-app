#!/bin/zsh
# Installeert of werkt de wachter bij op deze Mac.
# macOS laat een dienst (launchd) niet in ~/Documents werken, dus de wachter draait vanuit een kopie in
# ~/.local/share/todo-app/claude-sender. Draai dit script opnieuw na elke wijziging in deze map.
set -e
SRC="${0:A:h}"
DEST="$HOME/.local/share/todo-app/claude-sender"
LABEL="nl.onlinedialogue.claude-sender"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

mkdir -p "$DEST"
cp "$SRC"/watch.mjs "$SRC"/lib.mjs "$SRC"/notify.mjs "$SRC"/opdracht.md "$SRC"/run.sh "$DEST"/
chmod +x "$DEST/run.sh"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/zsh</string><string>$DEST/run.sh</string></array>
  <key>WorkingDirectory</key><string>$DEST</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/claude-sender.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/claude-sender.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
# Wachten tot de oude dienst echt weg is: meteen opnieuw laden geeft "Bootstrap failed: 5: Input/output error".
for i in {1..20}; do launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || break; sleep 0.5; done
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Wachter draait vanuit $DEST. Log: ~/Library/Logs/claude-sender.log"
