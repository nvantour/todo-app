// Leest het oude Operationeel/todos.md en zet de regels om naar het nieuwe datamodel.
// Schrijft alleen een JSON-bestand; er wordt niets in de app of in todos.md gewijzigd.
//
// Gebruik:  node scripts/todos-md-naar-json.mjs <pad naar todos.md> <uitvoer.json> [--met-afgerond]
import { readFileSync, writeFileSync } from 'node:fs'

const [input, output, flag] = process.argv.slice(2)
if (!input || !output) {
  console.error('Gebruik: node scripts/todos-md-naar-json.mjs <todos.md> <uitvoer.json> [--met-afgerond]')
  process.exit(1)
}
const withDone = flag === '--met-afgerond'

const lines = readFileSync(input, 'utf8').split('\n')
const todos = []
let inCodeBlock = false

for (const line of lines) {
  if (line.trim().startsWith('```')) {
    inCodeBlock = !inCodeBlock // Dataview-query's overslaan
    continue
  }
  if (inCodeBlock) continue
  const match = line.match(/^\s*- \[( |x|X)\] (.+)$/)
  if (!match) continue

  const done = match[1] !== ' '
  if (done && !withDone) continue
  let text = match[2]

  const take = (regex) => {
    const m = text.match(regex)
    if (m) text = text.replace(regex, ' ')
    return m
  }
  const due = take(/\[due::\s*(\d{4}-\d{2}-\d{2})\]/)?.[1] ?? null
  const completed = take(/✅\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? null
  const client = take(/#klant\/([\w-]+)/)?.[1] ?? null
  const idea = Boolean(take(/#idee\b/))
  const title = text.replace(/\s+/g, ' ').trim()
  if (!title) continue

  todos.push({
    title,
    done,
    completedAt: done ? `${completed ?? due ?? '2026-01-01'}T12:00:00.000Z` : null,
    due,
    // een los idee is iets "om niet te vergeten"; de rest is "om nu te doen"
    bucket: idea ? 'later' : 'now',
    projectId: client, // zelfde vorm als de klant-id's in de app (bv. "rai-amsterdam")
    source: { type: 'manual', label: 'todos.md' },
  })
}

writeFileSync(output, JSON.stringify(todos, null, 2))
const open = todos.filter((t) => !t.done).length
console.log(`${todos.length} taken omgezet (${open} open, ${todos.length - open} afgerond) → ${output}`)
