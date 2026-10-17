import type { EngineInterface } from 'claude-code'

import type { AddddSlackMsg } from '../types'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' ? v : 0)

/** One Slack Web API call; resolves the JSON body, throws on transport or `ok: false`. */
export async function slackApi($: EngineInterface, token: string, method: string, params: Record<string, string> = {}): Promise<Obj> {
  const body = new URLSearchParams(params).toString()
  const res = await $.http.fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  let data: unknown
  try {
    data = JSON.parse(res.text)
  } catch {
    throw new Error(`${method}: HTTP ${res.status}`)
  }
  if (!isObj(data)) throw new Error(`${method}: odd reply`)
  if (data.ok !== true) throw new Error(`${method}: ${str(data.error) || `HTTP ${res.status}`}`)
  return data
}

export function tsNewer(a: string, b: string): boolean {
  return Number(a) > Number(b)
}

/** Messages of a conversation after `lastRead`, minus joins, bots and the operator's own. */
export function parseHistory(data: unknown, lastRead: string, self: string): { user: string; text: string; ts: string }[] {
  if (!isObj(data) || !Array.isArray(data.messages)) return []
  return data.messages
    .filter(isObj)
    .filter(m => str(m.type) === 'message' && !m.subtype && !m.bot_id && str(m.user) !== self && tsNewer(str(m.ts), lastRead))
    .map(m => ({ user: str(m.user), text: str(m.text), ts: str(m.ts) }))
    .sort((a, b) => Number(a.ts) - Number(b.ts))
}

/** `search.messages` matches newer than `since` that someone else wrote. */
export function parseMentions(data: unknown, since: string, self: string): AddddSlackMsg[] {
  if (!isObj(data) || !isObj(data.messages) || !Array.isArray(data.messages.matches)) return []
  return data.messages.matches
    .filter(isObj)
    .filter(m => str(m.user) !== self && tsNewer(str(m.ts), since))
    .map(m => {
      const channel = isObj(m.channel) ? m.channel : {}
      return {
        channel: str(channel.id),
        channelName: str(channel.name) ? `#${str(channel.name)}` : 'a channel',
        kind: 'mention' as const,
        user: str(m.user),
        userName: str(m.username) || str(m.user),
        text: str(m.text),
        ts: str(m.ts),
        permalink: str(m.permalink) || undefined,
      }
    })
    .filter(m => m.channel && m.ts)
    .sort((a, b) => Number(a.ts) - Number(b.ts))
}

export function parseConversations(data: unknown): { id: string; kind: 'dm' | 'mpim'; user?: string; name?: string }[] {
  if (!isObj(data) || !Array.isArray(data.channels)) return []
  return data.channels
    .filter(isObj)
    .map(c => ({
      id: str(c.id),
      kind: c.is_im === true ? ('dm' as const) : ('mpim' as const),
      user: str(c.user) || undefined,
      name: str(c.name) || undefined,
    }))
    .filter(c => c.id)
}

export type SlackSeen = Record<string, string>

export type SlackPoll = { messages: AddddSlackMsg[]; seen: SlackSeen }

/**
 * Finds what the operator has not read: unread DMs and group DMs, plus
 * @mentions anywhere. `seen` keeps the newest ts served per conversation
 * (`mentions` for the search), so a message is served once.
 */
export async function pollSlack(
  $: EngineInterface,
  token: string,
  self: string,
  seen: SlackSeen,
  nameOf: (user: string) => Promise<string>,
): Promise<SlackPoll> {
  const out: AddddSlackMsg[] = []
  const next: SlackSeen = { ...seen }
  const convos = parseConversations(await slackApi($, token, 'users.conversations', { types: 'im,mpim', exclude_archived: 'true', limit: '200' }))
  for (const c of convos) {
    let info: Obj
    try {
      info = await slackApi($, token, 'conversations.info', { channel: c.id })
    } catch {
      continue
    }
    const ch = isObj(info.channel) ? info.channel : {}
    const unread = num(ch.unread_count_display) || num(ch.unread_count)
    if (unread <= 0) continue
    const lastRead = str(ch.last_read) || '0'
    const floor = tsNewer(seen[c.id] ?? '0', lastRead) ? (seen[c.id] ?? '0') : lastRead
    let history: Obj
    try {
      history = await slackApi($, token, 'conversations.history', { channel: c.id, oldest: floor, limit: '20' })
    } catch {
      continue
    }
    for (const m of parseHistory(history, floor, self)) {
      const userName = await nameOf(m.user)
      const channelName = c.kind === 'dm' ? `DM from ${userName}` : `group DM${c.name ? ` ${c.name}` : ''}`
      out.push({ channel: c.id, channelName, kind: c.kind, user: m.user, userName, text: m.text, ts: m.ts })
      if (tsNewer(m.ts, next[c.id] ?? '0')) next[c.id] = m.ts
    }
  }
  try {
    const found = await slackApi($, token, 'search.messages', { query: `<@${self}>`, sort: 'timestamp', sort_dir: 'desc', count: '20' })
    for (const m of parseMentions(found, seen.mentions ?? '0', self)) {
      if (out.some(o => o.channel === m.channel && o.ts === m.ts)) continue
      m.userName = await nameOf(m.user)
      out.push(m)
      if (tsNewer(m.ts, next.mentions ?? '0')) next.mentions = m.ts
    }
  } catch {
    // search:read not granted, or search is off: DMs still work
  }
  out.sort((a, b) => Number(a.ts) - Number(b.ts))
  return { messages: out, seen: next }
}

export async function whoAmI($: EngineInterface, token: string): Promise<string> {
  const data = await slackApi($, token, 'auth.test')
  const id = str(data.user_id)
  if (!id) throw new Error('auth.test: no user_id')
  return id
}

export async function userName($: EngineInterface, token: string, user: string): Promise<string> {
  try {
    const data = await slackApi($, token, 'users.info', { user })
    const u = isObj(data.user) ? data.user : {}
    const profile = isObj(u.profile) ? u.profile : {}
    return str(profile.display_name) || str(u.real_name) || str(u.name) || user
  } catch {
    return user
  }
}

export async function markRead($: EngineInterface, token: string, m: AddddSlackMsg): Promise<void> {
  try {
    await slackApi($, token, 'conversations.mark', { channel: m.channel, ts: m.ts })
  } catch {
    // no write scope: the plugin's own seen-list still keeps it from coming back
  }
}

/** Replies: in the thread for a channel mention, plainly in a DM. */
export async function sayBack($: EngineInterface, token: string, m: AddddSlackMsg, text: string): Promise<string | undefined> {
  const params: Record<string, string> = { channel: m.channel, text }
  if (m.kind === 'mention') params.thread_ts = m.ts
  try {
    await slackApi($, token, 'chat.postMessage', params)
    return undefined
  } catch (err) {
    return (err as Error)?.message ?? String(err)
  }
}

export async function dmSelf($: EngineInterface, token: string, self: string, text: string): Promise<string | undefined> {
  try {
    await slackApi($, token, 'chat.postMessage', { channel: self, text })
    return undefined
  } catch (err) {
    return (err as Error)?.message ?? String(err)
  }
}

export async function permalinkOf($: EngineInterface, token: string, m: AddddSlackMsg): Promise<string | undefined> {
  if (m.permalink) return m.permalink
  try {
    const data = await slackApi($, token, 'chat.getPermalink', { channel: m.channel, message_ts: m.ts })
    return str(data.permalink) || undefined
  } catch {
    return undefined
  }
}

/** Slack's `<@U123>` and `<https://x|label>` markup, made readable. */
export function plainText(text: string, names: Readonly<Record<string, string>> = {}): string {
  return text
    .replace(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g, (_, id: string) => `@${names[id] ?? id}`)
    .replace(/<#[A-Z0-9]+\|([^>]*)>/g, '#$1')
    .replace(/<([^|>]+)\|([^>]*)>/g, '$2 ($1)')
    .replace(/<([^>]+)>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}
