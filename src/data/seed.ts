import type { AppData, Project, Todo } from '../model/types'
import { addDays, todayISO } from '../lib/dates'

// Voorbeelddata voor ontwerp en ontwikkeling; alleen gebruikt zonder Firebase-config.

const PROJECTS: Array<[string, string]> = [
  ['Bidfood', '#2F9E6E'],
  ['Keesing', '#D9822B'],
  ['Mantel', '#C2410C'],
  ['Maxeda', '#0E8A9C'],
  ['Prominent', '#8B5CF6'],
  ['RAI Amsterdam', '#DB2777'],
  ['Sunny Cars', '#EAB308'],
  ['Transavia', '#16A34A'],
  ['Unilin', '#64748B'],
  ['Wehkamp', '#E11D48'],
  ['Intern', '#5B4BDB'],
]

/** Alleen de klantenlijst; dit krijgt een nieuwe gebruiker bij de eerste login (geen voorbeeldtaken). */
export function seedProjects(): Project[] {
  return PROJECTS.map(([name, color], i) => ({
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    color,
    keywords: name === 'RAI Amsterdam' ? ['rai', 'rai amsterdam'] : name === 'Sunny Cars' ? ['sunny', 'sunny cars'] : [name.toLowerCase()],
    order: i,
    archived: false,
  }))
}

export function seedData(): AppData {
  const today = todayISO()
  const stamp = new Date().toISOString()
  const projects = seedProjects()

  let order = 0
  const todo = (title: string, extra: Partial<Todo> = {}): Todo => ({
    id: `seed-${++order}`,
    title,
    note: '',
    done: false,
    completedAt: null,
    due: today,
    dueTime: null,
    bucket: 'now',
    projectId: null,
    labelIds: [],
    subtasks: [],
    estimateMin: null,
    recurrence: null,
    source: { type: 'manual' },
    calendarEventId: null,
    order,
    createdAt: stamp,
    updatedAt: stamp,
    ...extra,
  })

  return {
    projects,
    labels: [
      { id: 'wacht-op', name: 'wacht op', color: '#D9822B' },
      { id: 'idee', name: 'idee', color: '#8B5CF6' },
    ],
    todos: [
      todo('Testanalyse PDP-badges afronden', { projectId: 'wehkamp', due: addDays(today, -1), estimateMin: 90 }),
      todo('Hypotheses checkout aanscherpen', { projectId: 'keesing', due: addDays(today, -2) }),
      todo('QBR-deck voorbereiden', {
        projectId: 'transavia',
        estimateMin: 120,
        source: { type: 'calendar', label: 'QBR Transavia · di 24 nov' },
        subtasks: [
          { id: 'a', title: 'Resultaten Q3 ophalen', done: true },
          { id: 'b', title: 'Roadmap Q1 schetsen', done: false },
          { id: 'c', title: 'Slides nalopen', done: false },
        ],
      }),
      todo('Reageren op vraag over sample ratio mismatch', {
        projectId: 'mantel',
        bucket: 'now',
        source: { type: 'mail', label: 'Re: SRM in test 42' },
      }),
      todo('Dev-ticket verrijken met element-HTML', { projectId: 'unilin', bucket: 'later', estimateMin: 30, source: { type: 'airtable', label: 'UNI-118' } }),
      todo('Testplanning bijwerken in Airtable', { projectId: 'wehkamp', bucket: 'later', due: addDays(today, 7), recurrence: { freq: 'week', interval: 1, weekdays: [3] } }),
      todo('Uren schrijven', { projectId: 'intern', dueTime: '17:00', recurrence: { freq: 'week', interval: 1, weekdays: [1, 2, 3, 4, 5] } }),
      todo('Actiepunten weekstart uitwerken', { projectId: 'maxeda', due: addDays(today, 1), source: { type: 'meeting', label: 'Weekstart Maxeda' } }),
      todo('LinkedIn-post over novelty effect schrijven', { due: null, bucket: 'later' }),
      todo('Reageren op vraag over de planning', { projectId: 'keesing', due: null, source: { type: 'chat', label: 'Google Chat · Keesing-team' } }),
      todo('Onderzoeksopzet kaartsortering', { projectId: 'bidfood', due: addDays(today, 3), bucket: 'later' }),
      todo('Factuur november controleren', { due: null, bucket: 'later' }),
    ],
    suggestions: [
      {
        id: 'sug-1',
        title: 'QBR Wehkamp voorbereiden',
        note: '',
        due: addDays(today, 5),
        projectId: 'wehkamp',
        bucket: 'now',
        source: { type: 'calendar', label: 'QBR Wehkamp · do 26 nov 10:00' },
        reason: 'Over 6 werkdagen staat een QBR in je agenda.',
        status: 'open',
        createdAt: stamp,
      },
      {
        id: 'sug-2',
        title: 'Testresultaten delen met Sanne',
        note: '',
        due: addDays(today, 1),
        projectId: 'keesing',
        bucket: 'later',
        source: { type: 'meeting', label: 'Bi-weekly Keesing' },
        reason: 'Jij zei in de meeting dat je dit deze week zou sturen.',
        status: 'open',
        createdAt: stamp,
      },
    ],
    calendarRules: [{ id: 'qbr', match: 'QBR', titleTemplate: '{titel} voorbereiden', workdaysBefore: 3, enabled: true }],
  }
}
