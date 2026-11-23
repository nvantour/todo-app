import { describe, expect, it } from 'vitest'
import { classify, htmlToText, mailAnswered, mailCard, mergeNotices, pendingMessage, slackNotice, stripQuoted, teamsNotice, toMe, triageThread } from '../src/mailScan'
import { runReplyScan } from '../src/replyScan'
import { UID } from './helpers'
import { MY_MAIL, mailMsg, mailThread, scanSetup } from './sources.helpers'

const ME = MY_MAIL
const ANNA = 'Anna de Vries <anna@wehkamp.nl>'
const SENT = { labels: ['SENT'], to: 'anna@wehkamp.nl' }
/** Grens voor meldingsmails in de tests: alles vanaf 16 november telt. */
const CUTOFF = Date.parse('2026-11-16T00:00:00Z')

const TEAMS_LINK = 'https://teams.microsoft.com/l/chat/19:5e97e197_f9f356ae@unq.gbl.spaces/conversations?tenantId=86D19827-d8ad-455a-99ae-399f8f2135c3'
const teamsMail = (who: string, snippet: string, at = '2026-11-17T16:58:00Z') =>
  mailMsg(`"${who} in Teams" <no-reply@teams.mail.microsoft>`, {
    subject: `${who} sent a message`,
    at,
    snippet,
    html: `<table><tr><td>${snippet}</td></tr><tr><td><a href="${TEAMS_LINK.replace('?', '?x=1&amp;')}">Reply in Teams</a></td></tr></table>`,
  })

const SLACK_MENTION = `Hi Nino van Tour,

You have a new mention from the Onlinedialogue workspace (https://onlinedialogue-talk.slack.com/x-p37-76-125/team).

---

thread in online-dialogue
View in the archives: https://onlinedialogue-talk.slack.com/x-p37-76-125/archives/C07MH80RX7B/p1793892818214579

Nino van Tour (4:33 PM, November 5th)

Hi everyone, below a recap of today.

Nicola (1:39 PM, November 6th)

@Nino van Tour the convert credits should be enough.
Ewald keeps an eye on it.

* * *

You can snooze these notifications for
an hour: https://onlinedialogue-talk.slack.com/unsub/U07-notify-mute-1h`

const SLACK_DM = `Hi Nino van Tour,

You have a new direct message from the Onlinedialogue workspace (https://onlinedialogue-talk.slack.com/x-p37/team).

---

@Jill Manders
View in the archives: https://onlinedialogue-talk.slack.com/x-p37/archives/D09R8K9NYHH/p1793182780636149

Jill Manders (11:19 AM, October 28th)

Hi Nino, zou jij door de slides heen kunnen lopen?

* * *

You can snooze these notifications`

const slackMail = (text: string, subject: string, at = '2026-11-17T12:52:00Z') => mailMsg('Slack <notification@slack.com>', { subject, at, text, snippet: 'You have a new mention' })

describe('wat voor mail is dit?', () => {
  it('herkent een mens, jezelf en automatische afzenders', () => {
    expect(classify(mailMsg(ANNA), ME)).toBe('person')
    expect(classify(mailMsg('Nino <nino@onlinedialogue.com>', SENT), ME)).toBe('mine')
    expect(classify(mailMsg('Airtable <noreply@airtable.com>'), ME)).toBe('auto')
    expect(classify(mailMsg('Stripe <invoice@stripe.com>'), ME)).toBe('auto')
    expect(classify(mailMsg('Conversion Hotel <app@conversionhotel.com>'), ME)).toBe('auto')
    expect(classify(mailMsg('Nieuwsbrief <hallo@beehiiv.com>', { headers: { 'List-Unsubscribe': '<mailto:x@y.z>' } }), ME)).toBe('auto')
    expect(classify(mailMsg('Maxime <maxime@fr.transavia.com>', { subject: 'Réponse automatique : in path full vs lite' }), ME)).toBe('auto')
    expect(classify(mailMsg('Maxime <maxime@fr.transavia.com>', { headers: { 'Auto-Submitted': 'auto-replied' } }), ME)).toBe('auto')
    expect(classify(mailMsg('Sacha Serra <sacha@diymaxeda.com>', { subject: 'Sacha Serra shared "Plan_V2" with you' }), ME)).toBe('auto')
    expect(classify(mailMsg('Agenda <anna@wehkamp.nl>', { subject: 'Uitnodiging: Bi-weekly @ do 26 nov' }), ME)).toBe('auto')
    expect(classify(teamsMail('Sacha Serra', 'Hi'), ME)).toBe('teams')
    expect(classify(slackMail(SLACK_DM, 'Jill Manders sent you a message'), ME)).toBe('slack')
  })

  it('aan jou gericht = jouw adres bij Aan, ook met andere schrijfwijze; alleen cc telt niet', () => {
    expect(toMe(mailMsg(ANNA, { to: 'Lotte <lotte@onlinedialogue.com>, Nino <n.i.n.o@onlinedialogue.com>' }), ME)).toBe(true)
    expect(toMe(mailMsg(ANNA, { to: 'lotte@onlinedialogue.com', cc: ME }), ME)).toBe(false)
  })
})

describe('wacht deze mail op jou?', () => {
  it('ja: iemand mailde jou en jij hebt daarna niet gereageerd', () => {
    expect(triageThread(mailThread('t1', mailMsg(ANNA)), ME, CUTOFF)).toBe('person')
    // ook als iemand anders daarna nog iets aan de groep stuurt met jou in cc
    const t = mailThread('t2', mailMsg(ANNA, { at: '2026-11-17T09:00:00Z' }), mailMsg('Rick <rick@wehkamp.nl>', { to: 'anna@wehkamp.nl', cc: ME, at: '2026-11-17T10:00:00Z' }))
    expect(triageThread(t, ME, CUTOFF)).toBe('person')
    expect(pendingMessage(t.messages!, ME)?.id).toBe(t.messages![0].id)
  })

  it('nee: jij reageerde als laatste, je staat alleen in cc, of het is een automatische mail', () => {
    expect(triageThread(mailThread('t1', mailMsg(ANNA, { at: '2026-11-17T09:00:00Z' }), mailMsg('Nino <nino@onlinedialogue.com>', { ...SENT, at: '2026-11-17T10:00:00Z' })), ME, CUTOFF)).toBeNull()
    expect(triageThread(mailThread('t2', mailMsg(ANNA, { to: 'lotte@onlinedialogue.com', cc: ME })), ME, CUTOFF)).toBeNull()
    expect(triageThread(mailThread('t3', mailMsg('Airtable <noreply@airtable.com>')), ME, CUTOFF)).toBeNull()
    expect(triageThread(mailThread('t4', mailMsg(ANNA, { labels: ['INBOX', 'DRAFT'] })), ME, CUTOFF)).toBeNull()
  })

  it('meldingsmail van Teams of Slack telt alleen als hij recent is en nog in je inbox staat', () => {
    expect(triageThread(mailThread('t1', teamsMail('Sacha Serra', 'Hi')), ME, CUTOFF)).toBe('notify')
    expect(triageThread(mailThread('t2', teamsMail('Sacha Serra', 'Hi', '2026-11-10T09:00:00Z')), ME, CUTOFF)).toBeNull()
    const archived = { ...teamsMail('Sacha Serra', 'Hi'), labelIds: ['CATEGORY_UPDATES'] }
    expect(triageThread(mailThread('t3', archived), ME, CUTOFF)).toBeNull()
  })

  it('weet wanneer jij al hebt geantwoord', () => {
    const t = mailThread('t1', mailMsg(ANNA, { at: '2026-11-17T09:00:00Z' }), mailMsg('Nino <nino@onlinedialogue.com>', { ...SENT, at: '2026-11-17T10:00:00Z' }))
    expect(mailAnswered(t, ME, Date.parse('2026-11-17T09:00:00Z'))).toBe(true)
    expect(mailAnswered(t, ME, Date.parse('2026-11-17T11:00:00Z'))).toBe(false)
    expect(mailAnswered(mailThread('t2', mailMsg(ANNA)), ME, 0)).toBe(false)
  })
})

describe('tekst uit een mail', () => {
  it('haalt de aangehaalde eerdere mail eraf', () => {
    expect(stripQuoted('Prima, donderdag kan.\n\nOn Mon, Nov 16, 2026 at 10:00 AM Nino <nino@od.com> wrote:\n> Kan donderdag?')).toBe('Prima, donderdag kan.')
    expect(stripQuoted('Akkoord.\n\nOp ma 16 nov 2026 om 10:00 schreef Nino <nino@od.com>:\nKan het?')).toBe('Akkoord.')
    expect(stripQuoted('Zie hieronder.\n\nFrom: Nino\nSent: maandag 16 november\nTo: Anna')).toBe('Zie hieronder.')
    expect(stripQuoted('Geen citaat hier.')).toBe('Geen citaat hier.')
  })

  it('zet HTML om naar leesbare tekst, zonder het citaat', () => {
    expect(htmlToText('<style>p{}</style><p>Hoi Nino,</p><p>Kan het &amp; wanneer?<br>Groet</p><div class="gmail_quote">oud bericht</div>')).toBe('Hoi Nino,\nKan het & wanneer?\nGroet')
  })
})

describe('kaarten uit mail', () => {
  it('mail van een mens: onderwerp zonder Re:, tekst zonder citaat, link naar de Mail-tab', () => {
    const t = mailThread(
      'th1',
      mailMsg('Nino <nino@onlinedialogue.com>', { ...SENT, subject: 'Newsletter A/B-testing', at: '2026-11-16T09:00:00Z', text: 'Hi Yentl, shall we plan a call?' }),
      mailMsg('Yentl van Hees <yentl@transavia.com>', { subject: 'RE: Newsletter A/B-testing', at: '2026-11-17T09:00:00Z', text: 'Yes, Thursday works.\n\nOn Mon, Nov 16, 2026 at 10:00 AM Nino <nino@onlinedialogue.com> wrote:\n> Hi Yentl' }),
    )
    expect(mailCard(t, ME)).toEqual({
      channel: 'mail',
      externalId: 'gmail:th1',
      title: 'Newsletter A/B-testing',
      who: 'Yentl van Hees',
      url: 'https://work-apps-48770.web.app/mail#mail-th1',
      target: { threadId: 'th1' },
      messages: [
        { author: 'Nino', text: 'Hi Yentl, shall we plan a call?', at: '2026-11-16T09:00:00.000Z', mine: true },
        { author: 'Yentl van Hees', text: 'Yes, Thursday works.', at: '2026-11-17T09:00:00.000Z' },
      ],
      draft: '',
      reason: 'Yentl van Hees mailde je; je hebt nog niet geantwoord.',
    })
  })

  it('een agenda-uitnodiging wordt geen kaart', () => {
    const invite = mailMsg(ANNA, { subject: 'Bi-weekly' })
    invite.payload!.parts!.push({ mimeType: 'text/calendar', body: { data: 'QkVHSU4', size: 5 } })
    expect(mailCard(mailThread('th2', invite), ME)).toBeNull()
  })

  it('Teams-melding: het gesprek uit de link wordt het verzendadres', () => {
    expect(teamsNotice(teamsMail('Sacha Serra', 'In the meantime, have a very nice weekend!'))).toEqual({
      channel: 'teams',
      externalId: 'teams:19:5e97e197_f9f356ae@unq.gbl.spaces',
      title: 'Chat met Sacha Serra',
      who: 'Sacha Serra',
      url: 'https://teams.microsoft.com/l/chat/19:5e97e197_f9f356ae@unq.gbl.spaces/0?tenantId=86d19827-d8ad-455a-99ae-399f8f2135c3',
      target: { url: 'https://teams.microsoft.com/l/chat/19:5e97e197_f9f356ae@unq.gbl.spaces/0?tenantId=86d19827-d8ad-455a-99ae-399f8f2135c3' },
      messages: [{ author: 'Sacha Serra', text: 'In the meantime, have a very nice weekend!', at: '2026-11-17T16:58:00.000Z' }],
      draft: '',
      reason: 'Sacha Serra stuurde je een bericht in Teams terwijl je weg was.',
    })
    // zonder link naar een gesprek: geen kaart
    expect(teamsNotice(mailMsg('"Teams" <no-reply@teams.mail.microsoft>', { subject: 'You have new activity', html: '<p>Open Teams</p>' }))).toBeNull()
  })

  it('Slack-vermelding in een kanaal: berichten uitgelezen, zonder verzendadres', () => {
    const card = slackNotice(slackMail(SLACK_MENTION, 'Nicola mentioned you in #online-dialogue'))!
    expect(card).toMatchObject({
      channel: 'slack',
      externalId: 'slack:C07MH80RX7B:1793892818.214579',
      title: '#online-dialogue',
      who: 'Nicola',
      url: 'https://onlinedialogue-talk.slack.com/archives/C07MH80RX7B/p1793892818214579',
      target: { channel: 'C07MH80RX7B', ts: '1793892818.214579' },
      draft: '',
    })
    expect(card.target.url).toBeUndefined()
    expect(card.messages).toEqual([
      { author: 'Nino van Tour', text: 'Hi everyone, below a recap of today.', at: null, mine: true },
      { author: 'Nicola', text: '@Nino van Tour the convert credits should be enough.\nEwald keeps an eye on it.', at: '2026-11-17T12:52:00.000Z' },
    ])
  })

  it('Slack-DM: één gesprek per persoon', () => {
    expect(slackNotice(slackMail(SLACK_DM, 'Jill Manders sent you a message'))).toMatchObject({
      externalId: 'slack:D09R8K9NYHH',
      title: 'DM Jill Manders',
      who: 'Jill Manders',
      messages: [{ author: 'Jill Manders', text: 'Hi Nino, zou jij door de slides heen kunnen lopen?' }],
    })
  })

  it('twee meldingen over hetzelfde gesprek worden één kaart', () => {
    const a = teamsNotice(teamsMail('Sacha Serra', 'Hi Nino', '2026-11-17T09:00:00Z'))!
    const b = teamsNotice(teamsMail('Sacha Serra', 'Heb je het document gezien?', '2026-11-17T09:05:00Z'))!
    const merged = mergeNotices([a, b, { ...b }])
    expect(merged).toHaveLength(1)
    expect(merged[0].messages.map((m) => m.text)).toEqual(['Hi Nino', 'Heb je het document gezien?'])
  })
})

describe('antwoorden-scan: mail, Teams en Slack', () => {
  const depsOf = (ctx: ReturnType<typeof scanSetup>) => ({ repo: ctx.repo, service: ctx.service, google: ctx.google, ai: null, onError: () => undefined })
  const inbox = () => [
    mailThread('person', mailMsg(ANNA, { subject: 'Offerte Wehkamp', text: 'Hoi Nino, wanneer kan de offerte komen?' })),
    mailThread('cc', mailMsg(ANNA, { to: 'lotte@onlinedialogue.com', cc: MY_MAIL })),
    mailThread('news', mailMsg('Nieuws <news@beehiiv.com>')),
    mailThread('teams', teamsMail('Sacha Serra', 'Did you see the document?')),
    mailThread('slack', slackMail(SLACK_DM, 'Jill Manders sent you a message')),
  ]

  it('maakt kaarten voor mail van mensen en voor de meldingen van Teams en Slack; de rest slaat hij over', async () => {
    const ctx = scanSetup({ mail: inbox() })
    const r = await runReplyScan(depsOf(ctx), UID)
    expect(r).toMatchObject({ found: 3, created: 3, channels: { gchat: 0, mail: 1, teams: 1, slack: 1 } })
    const replies = await ctx.repo.listReplies(UID)
    expect(replies.map((x) => x.channel).sort()).toEqual(['mail', 'slack', 'teams'])
    expect(replies.find((x) => x.channel === 'mail')).toMatchObject({ title: 'Offerte Wehkamp', who: 'Anna de Vries', projectId: 'wehkamp', draft: '', status: 'open' })
    expect(replies.every((x) => x.status === 'open' && x.draft === '')).toBe(true)
    // nog een ronde: niets nieuws
    expect(await runReplyScan(depsOf(ctx), UID)).toMatchObject({ created: 0 })
    expect(await ctx.repo.listReplies(UID)).toHaveLength(3)
  })

  it('een Teams-kaart van Claude blijft zoals hij is als de melding niets nieuws bevat', async () => {
    const ctx = scanSetup({ mail: [mailThread('teams', teamsMail('Sacha Serra', 'Did you see the document?'))] })
    const url = 'https://teams.microsoft.com/l/chat/19:5e97e197_f9f356ae@unq.gbl.spaces/0?tenantId=86d19827-d8ad-455a-99ae-399f8f2135c3'
    await ctx.service.saveReplies(UID, [
      {
        channel: 'teams',
        externalId: 'teams:sacha',
        title: 'Sacha Serra (Maxeda)',
        who: 'Sacha Serra',
        target: { url },
        messages: [
          { author: 'Sacha Serra', text: 'Hi Nino, I shared the personalisation deck.', at: '2026-11-17T16:50:00.000Z' },
          { author: 'Sacha Serra', text: 'Did you see the document?', at: '2026-11-17T16:58:00.000Z' },
        ],
        draft: 'Thanks Sacha, I will read it tomorrow.',
        reason: 'Sacha vraagt of je het document hebt gezien.',
      },
    ])
    await runReplyScan(depsOf(ctx), UID)
    const replies = await ctx.repo.listReplies(UID)
    expect(replies).toHaveLength(1)
    expect(replies[0]).toMatchObject({ externalId: 'teams:sacha', draft: 'Thanks Sacha, I will read it tomorrow.' })
    expect(replies[0].messages).toHaveLength(2)
  })

  it('een mail-kaart gaat weg zodra jij hebt geantwoord', async () => {
    const data = { mail: inbox() }
    const ctx = scanSetup(data)
    await runReplyScan(depsOf(ctx), UID)
    data.mail[0].messages!.push(mailMsg('Nino <nino@onlinedialogue.com>', { ...SENT, at: '2026-11-17T12:00:00Z' }))
    expect(await runReplyScan(depsOf(ctx), UID)).toMatchObject({ closed: 1 })
    expect((await ctx.repo.listReplies(UID)).find((x) => x.channel === 'mail')?.status).toBe('dismissed')
  })

  it('mail niet te lezen: de scan meldt het en gaat verder', async () => {
    const ctx = scanSetup({ mail: inbox(), failMail: true })
    const r = await runReplyScan(depsOf(ctx), UID)
    expect(r.warning).toMatch(/Mail/)
    expect(r.found).toBe(0)
  })
})
