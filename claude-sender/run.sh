#!/bin/zsh
# Wrapper voor launchd: leest ~/.zprofile (TODO_APP_TOKEN, PATH met node en claude) en start de wachter.
source "$HOME/.zprofile" >/dev/null 2>&1
cd "${0:A:h}" || exit 1
exec node watch.mjs "$@"
