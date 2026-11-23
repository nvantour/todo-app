import type { AppData, Discussion, Project, Reply, Todo } from '../model/types'
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

/** Nino's lijst uit Apple Notes, als voorbeeld voor "Om te bespreken". */
function seedDiscussions(stamp: string): Discussion[] {
  const groups: Array<[string, string | null, string[]]> = [
    ['Prominent', 'prominent', ['Surveys', 'Onderzoek modular builder', 'Onderzoek prijspercenten', 'Prio testen', 'Analyse testen', 'Planning:', 'PDP', 'Pop-ups']],
    [
      'Maxeda',
      'maxeda',
      [
        'Process mining',
        'CRO Specialist',
        'Sessie over A/B testen - Brico',
        'AI Feature:',
        'In stappen uitvoeren -> eerst interne pijlen',
        'Daarna model testen / verbeteren ... testen.',
        'Maandag vertellen of anders lossen met Alex/Benthe.',
      ],
    ],
    ['Wehkamp', 'wehkamp', ['QA flow', 'Airtable migration', 'Experiments']],
    ['Nicola / Ewald', null, ['Coming to the office', 'Omoda / Wehkamp deck', 'Additional ideas Florien', 'USP tests']],
  ]
  return groups.map(([title, projectId, items], g) => ({
    id: `disc-${g + 1}`,
    title,
    projectId,
    items: items.map((text, i) => ({ id: `disc-${g + 1}-${i + 1}`, text, done: false, doneAt: null })),
    order: g,
    createdAt: stamp,
    updatedAt: stamp,
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
    discussions: seedDiscussions(stamp),
    statuses: [],
    replies: seedReplies(stamp),
    calendarRules: [{ id: 'qbr', match: 'QBR', titleTemplate: '{titel} voorbereiden', workdaysBefore: 3, enabled: true }],
  }
}

/** Voorbeeldgesprekken voor de tab Antwoorden (alleen testmodus). */
function seedReplies(stamp: string): Reply[] {
  const base = { projectId: null, draftEdited: false, status: 'open' as const, error: null, approvedAt: null, sentAt: null, createdAt: stamp, updatedAt: stamp }
  return [
    {
      ...base,
      id: 'r-mail',
      channel: 'mail',
      title: 'Planning Q1-tests',
      who: 'Thalia (Transavia)',
      url: '/mail#mail-voorbeeld',
      target: { threadId: 'voorbeeld' },
      externalId: 'gmail:voorbeeld',
      messages: [
        { author: 'Nino', text: 'Hoi Thalia, de resultaten van Q4 staan in het rapport. Laat je weten wat je voor Q1 nodig hebt?', at: '2026-11-20T10:00:00Z', mine: true },
        { author: 'Thalia', text: 'Hoi Nino, kun je voor vrijdag laten weten welke tests we in Q1 als eerste oppakken?', at: '2026-11-23T08:12:00Z' },
      ],
      draft: 'Hoi Thalia,\n\nDat lukt. Ik stuur je donderdag de volgorde met een korte onderbouwing per test.\n\nGroet,\nNino',
      reason: 'Thalia vraagt voor vrijdag om de volgorde van de Q1-tests.',
    },
    {
      ...base,
      id: 'r-gchat',
      channel: 'gchat',
      title: 'Keesing-team',
      who: 'Mark',
      url: 'https://mail.google.com/mail/u/0/#chat/space/AAAA',
      target: { space: 'spaces/AAAA', thread: 'spaces/AAAA/threads/BBBB' },
      externalId: 'spaces/AAAA/threads/BBBB',
      messages: [
        { author: 'Mark', text: 'Staat ID66 al live?', at: '2026-11-23T09:01:00Z' },
        { author: 'Mark', text: 'Klant vraagt ernaar', at: '2026-11-23T09:02:00Z' },
      ],
      draft: 'Nog niet, ik zet hem vandaag na de QA live. Ik laat het je weten.',
      reason: 'Mark vraagt of ID66 live staat.',
    },
    {
      ...base,
      id: 'r-slack',
      channel: 'slack',
      title: '#od_wrg_wow',
      who: 'Lisa (Wehkamp)',
      url: 'https://app.slack.com/client/T000/C000',
      target: { url: 'https://app.slack.com/client/T000/C000/thread/C000-1700000000.000100', channel: 'C000', ts: '1700000000.000100' },
      externalId: 'slack:C000:1700000000.000100',
      messages: [{ author: 'Lisa', text: 'Kunnen we de Black Friday-test een week langer laten lopen?', at: '2026-11-23T10:30:00Z' }],
      draft: 'Ja, dat kan. Ik verleng hem tot 7 december; dan halen we ook het weekend na Black Friday mee.',
      reason: 'Lisa vraagt of de Black Friday-test langer mag lopen.',
    },
    {
      ...base,
      id: 'r-teams',
      channel: 'teams',
      title: 'CRO Prominent x Velder',
      who: 'Rick',
      url: 'https://teams.microsoft.com/l/chat/voorbeeld',
      target: { url: 'https://teams.microsoft.com/l/chat/voorbeeld' },
      externalId: 'teams:voorbeeld',
      messages: [{ author: 'Rick', text: 'Wanneer kunnen we de eind- en startdatums doorlopen?', at: '2026-11-23T11:00:00Z' }],
      draft: 'Donderdag om 10:00 kan ik. Past dat?',
      reason: 'Rick wil een moment om de testdatums door te lopen.',
    },
    // Zo zet de scan op de server een gesprek klaar: zonder concept.
    {
      ...base,
      id: 'r-scan-gchat',
      channel: 'gchat',
      title: 'DM Maud',
      who: 'Maud',
      url: 'https://mail.google.com/mail/u/0/#chat/space/CCCC',
      target: { space: 'spaces/CCCC' },
      externalId: 'spaces/CCCC',
      messages: [{ author: 'Maud', text: 'Kun je uiterlijk donderdag de learnings van CH delen?', at: '2026-11-23T12:10:00Z' }],
      draft: '',
      reason: 'Maud stuurde je een bericht waar je nog niet op hebt gereageerd.',
    },
    // Slack-vermelding uit een meldingsmail: zonder verzendadres, antwoorden doe je in Slack zelf.
    {
      ...base,
      id: 'r-scan-slack',
      channel: 'slack',
      title: '#online-dialogue',
      who: 'Nicola (Wehkamp)',
      url: 'https://onlinedialogue-talk.slack.com/archives/C111/p1700000000000200',
      target: { channel: 'C111', ts: '1700000000.000200' },
      externalId: 'slack:C111:1700000000.000200',
      messages: [{ author: 'Nicola', text: '@Nino van Tour can OD30 go live today?', at: '2026-11-23T12:30:00Z' }],
      draft: '',
      reason: 'Nicola noemde je in #online-dialogue (Slack) terwijl je weg was.',
    },
  ]
}
