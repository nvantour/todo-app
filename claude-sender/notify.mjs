// macOS-meldingen van de wachter. Met een doel is de melding klikbaar: de klik opent de link (bv. Teams in Chrome).
// Klikbaar gaat via Hammerspoon (functie klikMelding uit Operationeel/Automatiseringen/klik-melding.lua in de werkmap):
// een gewone osascript-melding opent bij een klik niets. Reageert Hammerspoon niet, dan komt de gewone melding.

import { execFile } from 'node:child_process'
import { clickNotificationLua } from './lib.mjs'

const HS = '/opt/homebrew/bin/hs'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Voert een commando uit; geeft de uitvoer, of '' bij een fout of als het te lang duurt. */
const run = (cmd, args, timeout = 6000) =>
  new Promise((resolve) => {
    const child = execFile(cmd, args, { timeout }, (err, stdout) => resolve(err ? '' : String(stdout).trim()))
    // Invoer dicht: `hs` blijft anders wachten op een open invoerkanaal en geeft nooit antwoord.
    child.stdin?.end()
  })

const hs = (code) => run(HS, ['-q', '-t', '4', '-c', code])

async function clickable(title, body, target) {
  if (!(await run('pgrep', ['-x', 'Hammerspoon']))) await run('open', ['-ga', 'Hammerspoon'])
  // Hooguit ~15 s wachten (Hammerspoon start in een paar seconden), daarna de gewone melding.
  const stop = Date.now() + 15_000
  while (Date.now() < stop) {
    if ((await hs('return type(klikMelding)')) === 'function') return (await hs(clickNotificationLua(title, body, target))) === 'ok'
    await sleep(1000)
  }
  return false
}

/** Tekst als argument, niet in het script: zo kan geen tekst het script breken. */
function plain(title, body) {
  const script = 'on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv) sound name "Glass"\nend run'
  return new Promise((resolve) => execFile('osascript', ['-e', script, title, body], (err) => resolve(err ? `melding mislukt: ${err.message}` : 'gewoon')))
}

/** Stuurt de melding. Geeft terug hoe: 'klikbaar', 'gewoon' of een foutmelding. */
export async function notify(title, body, target) {
  const text = body.slice(0, 240)
  if (target && (await clickable(title, text, target))) return 'klikbaar'
  return plain(title, text)
}
