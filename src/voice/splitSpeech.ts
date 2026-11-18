// Splitst gesproken tekst in losse taken. Dit is de lokale route (zonder server);
// de server (AI) doet het slimmer. Vervolg op legacy/src/utils/voiceParser.js,
// maar voorzichtiger met "en": "mail Wehkamp en Keesing" blijft één taak.

const DATE_WORDS =
  '(?:vandaag|morgen|overmorgen|vanavond|vanmiddag|vanochtend|vanmorgen|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|volgende week|volgende maand|komende)'

/** Altijd een nieuwe taak: komma, puntkomma, punt, "daarnaast", "verder", "ook nog", "en dan nog", genummerd. */
const HARD_SPLIT = [
  /\s+\d+[.)]\s+/,
  /\s*(?<!\d)[;.!?]+\s+/,
  /\s*,\s+(?:en\s+|ook\s+|daarnaast\s+|verder\s+)?/i,
  /\s+(?:daarnaast|verder|vervolgens|en\s+dan\s+nog|en\s+ook\s+nog|ook\s+nog)\s+/i,
]

/** "en" splitst alleen als er duidelijk een nieuwe taak volgt: een datumwoord of minstens drie woorden. */
const EN_SPLIT = /\s+(?:en|plus|ook)\s+(?:ook\s+)?/i

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean)

function splitOnEn(piece: string): string[] {
  const out: string[] = []
  let rest = piece
  for (;;) {
    const re = new RegExp(EN_SPLIT.source, 'gi')
    let cut: { index: number; length: number } | null = null
    let m: RegExpExecArray | null
    while ((m = re.exec(rest))) {
      const left = rest.slice(0, m.index)
      const right = rest.slice(m.index + m[0].length)
      const startsWithDate = new RegExp(`^${DATE_WORDS}\\b`, 'i').test(right)
      const longEnough = words(left).length >= 2 && words(right).length >= 3
      if (words(left).length >= 2 && (startsWithDate || longEnough)) {
        cut = { index: m.index, length: m[0].length }
        break
      }
    }
    if (!cut) break
    out.push(rest.slice(0, cut.index))
    rest = rest.slice(cut.index + cut.length)
  }
  out.push(rest)
  return out
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function splitSpeech(text: string): string[] {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim().replace(/^\d+[.)]\s+/, '')
  if (!clean) return []

  let pieces = [clean]
  for (const pattern of HARD_SPLIT) {
    const next: string[] = []
    for (const piece of pieces) {
      const parts = piece.split(pattern).filter((p) => p && p.trim().length > 0)
      // een stukje van één woord hoort bij de vorige ("Wehkamp, Keesing") — alleen splitsen als elk deel ≥ 2 woorden heeft
      next.push(...(parts.length > 1 && parts.every((p) => words(p).length >= 2) ? parts : [piece]))
    }
    pieces = next
  }
  pieces = pieces.flatMap(splitOnEn)

  return pieces
    .map((p) => p.trim().replace(/[.,;]+$/, ''))
    .filter((p) => p.length > 2)
    .map(capitalize)
}
