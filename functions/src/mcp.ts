import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { Project, Todo } from '../../src/model/types'
import { buildBrief } from './brief'
import { errorResponse } from './api'
import { HttpError } from './errors'
import { incomingReplySchema, isoDate, recurrenceSchema, sourceSchema, timeOfDay } from './schemas'
import { parseFilter, type TodoService } from './service'
import type { ScheduleResult } from './schedule'

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }

const text = (value: unknown): ToolResult => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] })

function fail(e: unknown): ToolResult {
  const res = errorResponse(e)
  const err = (res.body as { error: { message: string } }).error
  return { content: [{ type: 'text', text: `Mislukt: ${err.message}` }], isError: true }
}

async function guard(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn()
  } catch (e) {
    if (!(e instanceof HttpError) && !(e instanceof z.ZodError)) console.error(e)
    return fail(e)
  }
}

const present = (t: Todo, names: Map<string, string>) => ({
  id: t.id,
  title: t.title,
  note: t.note || undefined,
  done: t.done,
  due: t.due,
  dueTime: t.dueTime,
  bucket: t.bucket,
  projectId: t.projectId,
  project: t.projectId ? (names.get(t.projectId) ?? null) : null,
  recurrence: t.recurrence,
  estimateMin: t.estimateMin,
  calendarEventId: t.calendarEventId,
  source: { type: t.source.type, label: t.source.label, url: t.source.url },
})

/** Eén MCP-server voor één gebruiker (stateless: per verzoek een nieuwe). */
export type ScheduleFn = (id: string, minutes: number, replace?: boolean) => Promise<ScheduleResult>

export function createMcpServer(service: TodoService, uid: string, schedule?: ScheduleFn): McpServer {
  const server = new McpServer({ name: 'todo-app', version: '0.1.0' })
  const names = async () => new Map((await service.listProjects(uid)).map((p: Project) => [p.id, p.name]))

  server.registerTool(
    'list_todos',
    {
      title: 'List todos',
      description:
        "List the user's open todos. Optional filter: 'now' (to do now, includes overdue and due today), 'later' (not to forget, not due yet), 'overdue', 'upcoming:<days>' (due within the next N days, e.g. upcoming:7), 'project:<id>' (one client; use list_projects for ids, 'project:none' for no client). Without a filter all open todos are returned, soonest due first.",
      inputSchema: { filter: z.string().optional().describe("now | later | overdue | upcoming:<days> | project:<id>"), limit: z.number().int().min(1).max(200).optional().describe('Maximum number of todos (default 50)') },
      annotations: { readOnlyHint: true },
    },
    ({ filter, limit }) =>
      guard(async () => {
        const todos = await service.listTodos(uid, parseFilter(filter), limit ?? 50)
        const n = await names()
        return text({ count: todos.length, todos: todos.map((t) => present(t, n)) })
      }),
  )

  server.registerTool(
    'add_todo',
    {
      title: 'Add todo',
      description:
        "Add a todo to the user's list. Use this when the user literally asks for it (e.g. 'add a todo to ...', 'remind me to ...'). Do NOT use it for things you found yourself in a meeting, email or chat: use suggest_todo for those so the user can approve them. The client (project) is detected automatically from the title when projectId is omitted. Dates are YYYY-MM-DD, times HH:mm; today's date is available via get_brief.",
      inputSchema: {
        title: z.string().min(1).max(500).describe('Short description of what to do'),
        due: isoDate.optional().describe('Due date, YYYY-MM-DD'),
        dueTime: timeOfDay.optional().describe('Time, HH:mm'),
        note: z.string().max(10_000).optional(),
        projectId: z.string().optional().describe('Client id from list_projects; omit to auto-detect'),
        bucket: z.enum(['now', 'later']).optional().describe("'now' (default) = to do now, 'later' = not to forget"),
        estimateMin: z.number().int().min(0).optional().describe('Estimated minutes'),
        recurrence: recurrenceSchema.optional(),
        sourceLabel: z.string().max(300).optional().describe('Human-readable origin, e.g. the conversation topic'),
        sourceUrl: z.string().max(2000).optional(),
      },
    },
    ({ sourceLabel, sourceUrl, ...rest }) =>
      guard(async () => {
        const todo = await service.addTodo(uid, { ...rest, source: { type: 'claude', label: sourceLabel, url: sourceUrl } })
        return text({ added: present(todo, await names()) })
      }),
  )

  server.registerTool(
    'update_todo',
    {
      title: 'Update todo',
      description: "Change fields of an existing todo. Only send the fields that change; send null to clear due, dueTime, projectId, estimateMin or recurrence. To finish a todo use complete_todo.",
      inputSchema: {
        id: z.string().describe('Todo id from list_todos'),
        title: z.string().min(1).max(500).optional(),
        note: z.string().max(10_000).optional(),
        due: isoDate.nullable().optional(),
        dueTime: timeOfDay.nullable().optional(),
        projectId: z.string().nullable().optional(),
        bucket: z.enum(['now', 'later']).optional(),
        estimateMin: z.number().int().min(0).nullable().optional(),
        recurrence: recurrenceSchema.nullable().optional(),
      },
    },
    ({ id, ...patch }) =>
      guard(async () => text({ updated: present(await service.updateTodo(uid, id, patch), await names()) })),
  )

  server.registerTool(
    'complete_todo',
    {
      title: 'Complete todo',
      description: 'Mark a todo as done. A recurring todo is not closed but moves to its next date (the result says recurred: true and shows the new due date).',
      inputSchema: { id: z.string().describe('Todo id from list_todos') },
    },
    ({ id }) =>
      guard(async () => {
        const r = await service.completeTodo(uid, id)
        return text({ recurred: r.recurred, alreadyDone: r.alreadyDone, todo: present(r.todo, await names()) })
      }),
  )

  server.registerTool(
    'schedule_todo',
    {
      title: 'Schedule todo',
      description:
        "Block time in the user's Google Calendar for a todo: finds the first free slot (working days 09:00-17:30, Europe/Amsterdam, 15-minute grid, weekends skipped) and creates a calendar event with the todo's title. The todo's calendarEventId is set. Only use when the user asks to plan or schedule a todo. Fails if Google is not connected in the app, or if the todo is already scheduled (pass replace: true to move it).",
      inputSchema: {
        id: z.string().describe('Todo id from list_todos'),
        minutes: z.number().int().min(15).max(480).optional().describe('Length of the block in minutes (default 60)'),
        replace: z.boolean().optional().describe('Replace an earlier calendar block of this todo'),
      },
    },
    ({ id, minutes, replace }) =>
      guard(async () => {
        if (!schedule) throw new HttpError(501, 'not_available', 'Inplannen in de agenda is nog niet ingesteld op de server.')
        const r = await schedule(id, minutes ?? 60, replace)
        return text({ scheduled: true, start: r.start, end: r.end, afterDue: r.afterDue, todo: present(r.todo, await names()) })
      }),
  )

  server.registerTool(
    'suggest_todo',
    {
      title: 'Suggest todo',
      description:
        "Propose a todo that YOU found yourself: real work such as an action item from a meeting, or something a mail or chat asks the user to build, look into or deliver. It lands in the user's inbox ('Voorstellen') and becomes a todo only after approval. Do NOT use it for a message that only needs a reply ('Reageren op …'): conversations waiting for an answer belong on the 'Antwoorden' tab, via save_reply_drafts. Always pass a stable sourceExternalId (e.g. the meeting id or mail thread id): the same source item never creates two suggestions. For things the user explicitly asks for, use add_todo instead.",
      inputSchema: {
        title: z.string().min(1).max(500),
        reason: z.string().max(1000).describe('One sentence: why this is suggested'),
        sourceType: sourceSchema.shape.type.describe("Where it came from: meeting, mail, chat, calendar, airtable or claude"),
        sourceLabel: z.string().max(300).optional().describe('Readable name of the source, e.g. the meeting title or mail subject'),
        sourceUrl: z.string().max(2000).optional().describe('Link back to the source'),
        sourceExternalId: z.string().max(300).optional().describe('Id in the source system, used to avoid duplicates'),
        due: isoDate.nullable().optional(),
        projectId: z.string().nullable().optional(),
        note: z.string().max(10_000).optional(),
        bucket: z.enum(['now', 'later']).optional(),
      },
    },
    ({ sourceType, sourceLabel, sourceUrl, sourceExternalId, ...rest }) =>
      guard(async () => {
        const r = await service.suggest(uid, { ...rest, source: { type: sourceType, label: sourceLabel, url: sourceUrl, externalId: sourceExternalId } })
        if (r.created) return text({ created: true, suggestionId: r.suggestion!.id, message: 'Suggestion added to the inbox.' })
        return text({ created: false, duplicateOf: r.duplicateOf, message: `Skipped: this source item already exists as a ${r.duplicateOf === 'todo' ? 'todo' : 'suggestion'}.` })
      }),
  )

  server.registerTool(
    'save_reply_drafts',
    {
      title: 'Save reply drafts',
      description:
        "Put conversations that are waiting for the user's answer on the 'Antwoorden' tab, each with YOUR proposed reply. One item per conversation (mail thread, Google Chat thread, Slack thread or channel, Teams chat). The user edits the text and sends it himself with a checkmark in the app; you never send anything. A server scan also puts cards there on its own (Google Chat, mail, and Teams/Slack notification mails), without a draft: call list_replies first and, when a conversation already has a card, reuse that card's externalId so your draft lands on it instead of creating a second card. Otherwise pass a stable externalId per conversation ('gmail:<threadId>', the Chat thread name or, for a DM, the space name 'spaces/..', 'slack:<channel>:<thread_ts>' or 'slack:<channel>' for a DM, 'teams:<chat id>'): a known conversation is updated, a reply the user already edited is kept, approved replies are left alone, and a sent/dismissed one only reopens when there is a newer message from someone else. target per channel: mail {threadId}; gchat {space:'spaces/..', thread:'spaces/../threads/..'}; slack {url: web URL of the thread or channel (https://app.slack.com/client/<TEAM>/<CHANNEL>[/thread/<CHANNEL>-<TS>]), channel, ts}; teams {url: link that opens the exact chat or channel thread}. messages: the last messages oldest first (max ~10), with mine:true for the user's own. Write the draft in the language and tone of the conversation, in the user's voice; short.",
      inputSchema: { replies: z.array(incomingReplySchema).min(1).max(100) },
    },
    ({ replies }) =>
      guard(async () => {
        const counts = await service.saveReplies(uid, replies)
        return text({ ...counts, message: 'Saved on the Antwoorden tab. The user reviews and sends them in the app.' })
      }),
  )

  server.registerTool(
    'list_replies',
    {
      title: 'List replies',
      description: "List cards on the 'Antwoorden' tab with their status (open, approved, sending, sent, failed, dismissed). Use it to see what is already there before saving new drafts. Read-only.",
      inputSchema: { status: z.array(z.enum(['open', 'approved', 'sending', 'sent', 'failed', 'dismissed'])).optional() },
      annotations: { readOnlyHint: true },
    },
    ({ status }) =>
      guard(async () => {
        const list = await service.listReplies(uid, { status })
        return text({
          count: list.length,
          replies: list.map((r) => ({ id: r.id, channel: r.channel, externalId: r.externalId, title: r.title, who: r.who, status: r.status, draftEdited: r.draftEdited, error: r.error, lastMessageAt: r.messages.at(-1)?.at ?? null })),
        })
      }),
  )

  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description: "List the user's projects (clients) with their ids and keywords. Use the id as projectId in other tools.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () =>
      guard(async () => {
        const projects = await service.listProjects(uid)
        return text({ projects: projects.map((p) => ({ id: p.id, name: p.name, keywords: p.keywords })) })
      }),
  )

  server.registerTool(
    'get_brief',
    {
      title: 'Get brief',
      description:
        "Overview for the morning brief: what to do now, what is due today, the next 3 days, overdue items and open suggestions. Returns a short readable Dutch text first, then the same data as JSON. Also tells you today's date (Europe/Amsterdam).",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () =>
      guard(async () => {
        const { text: readable, ...data } = await buildBrief(service, uid)
        return { content: [{ type: 'text' as const, text: readable }, { type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
      }),
  )

  return server
}
