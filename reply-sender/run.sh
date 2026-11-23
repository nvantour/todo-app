#!/bin/zsh
# Wrapper voor launchd: leest ~/.zprofile (TODO_APP_TOKEN, PATH met node) en start de sender.
# Het token staat zo nooit in de plist of in deze map.
source "$HOME/.zprofile" >/dev/null 2>&1
cd "${0:A:h}" || exit 1
exec node sender.mjs "$@"
