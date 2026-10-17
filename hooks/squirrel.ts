import type { EngineInterface } from 'claude-code'

import type { AddddSquirrel, SquirrelSource } from '../types'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' ? v : 0)

// ---------- topics: what this repo is about ----------

const LANG_BY_EXT: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', mjs: 'javascript', py: 'python', go: 'golang', rs: 'rust',
  swift: 'swift', kt: 'kotlin', rb: 'ruby', java: 'java', cs: 'csharp', php: 'php', ex: 'elixir', exs: 'elixir',
  dart: 'flutter', scala: 'scala', clj: 'clojure', hs: 'haskell', zig: 'zig', c: 'c', cpp: 'cpp', sql: 'postgres',
}

const DEP_TOPICS: Record<string, string> = {
  next: 'nextjs', react: 'react', 'react-native': 'react native', expo: 'expo', vue: 'vuejs', nuxt: 'nuxt', svelte: 'svelte',
  '@sveltejs/kit': 'sveltekit', astro: 'astro', remix: 'remix', express: 'nodejs', fastify: 'fastify', hono: 'hono',
  prisma: 'prisma', '@prisma/client': 'prisma', 'drizzle-orm': 'drizzle orm', tailwindcss: 'tailwindcss',
  '@supabase/supabase-js': 'supabase', stripe: 'stripe', ai: 'ai sdk', '@anthropic-ai/sdk': 'llm agents', openai: 'llm agents',
  zod: 'typescript', vitest: 'testing', jest: 'testing', playwright: 'playwright', electron: 'electron', tauri: 'tauri',
  graphql: 'graphql', '@trpc/server': 'trpc', redis: 'redis', ioredis: 'redis', pg: 'postgres', mongoose: 'mongodb',
  three: 'threejs', 'd3': 'data visualization', vite: 'vite', turbo: 'monorepo', eve: 'ai agents',
}

export function topicsFromPackageJson(text: string): string[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return []
  }
  if (!isObj(data)) return []
  const names = new Set<string>()
  for (const k of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const deps = data[k]
    if (isObj(deps)) for (const name of Object.keys(deps)) names.add(name)
  }
  const out = new Set<string>()
  for (const name of names) {
    const topic = DEP_TOPICS[name]
    if (topic) out.add(topic)
  }
  return [...out]
}

export function topicsFromFiles(paths: readonly string[]): string[] {
  const counts = new Map<string, number>()
  for (const p of paths) {
    const ext = p.slice(p.lastIndexOf('.') + 1).toLowerCase()
    const lang = LANG_BY_EXT[ext]
    if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([lang]) => lang)
}

const FALLBACK_TOPICS = ['developer tools', 'software engineering', 'programming languages', 'open source']

export async function topicsOf($: EngineInterface, root: string, override: string): Promise<string[]> {
  const given = override
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)
  if (given.length > 0) return given
  const topics = new Set<string>()
  try {
    for (const t of topicsFromPackageJson(await $.fs.read(`${root}/package.json`))) topics.add(t)
  } catch {
    // not a node project
  }
  try {
    const ran = await $.process.run(['git', 'ls-files'], { cwd: root, timeoutMs: 15000 })
    if (ran.exitCode === 0) for (const t of topicsFromFiles(ran.stdout.split('\n').slice(0, 5000))) topics.add(t)
  } catch {
    // no git
  }
  return topics.size > 0 ? [...topics] : FALLBACK_TOPICS
}

// ---------- candidates: real links from real feeds ----------

export type Candidate = { title: string; url: string; blurb: string; source: SquirrelSource; score: number }

export function parseHn(data: unknown): Candidate[] {
  if (!isObj(data) || !Array.isArray(data.hits)) return []
  return data.hits
    .filter(isObj)
    .map(h => ({
      title: str(h.title),
      url: str(h.url) || (h.objectID ? `https://news.ycombinator.com/item?id=${str(h.objectID)}` : ''),
      blurb: `${num(h.points)} points · ${num(h.num_comments)} comments on Hacker News`,
      source: 'hn' as const,
      score: num(h.points),
    }))
    .filter(c => c.title && c.url)
}

export function parseGithub(data: unknown): Candidate[] {
  if (!isObj(data) || !Array.isArray(data.items)) return []
  return data.items
    .filter(isObj)
    .map(r => ({
      title: str(r.full_name),
      url: str(r.html_url),
      blurb: `${str(r.description).slice(0, 160) || 'no description'} · ★ ${num(r.stargazers_count)}`,
      source: 'github' as const,
      score: num(r.stargazers_count),
    }))
    .filter(c => c.title && c.url)
}

export function parseDevto(data: unknown): Candidate[] {
  if (!Array.isArray(data)) return []
  return data
    .filter(isObj)
    .map(a => ({
      title: str(a.title),
      url: str(a.url),
      blurb: `${str(a.description).slice(0, 160)} · ${num(a.positive_reactions_count)} reactions on dev.to`,
      source: 'devto' as const,
      score: num(a.positive_reactions_count),
    }))
    .filter(c => c.title && c.url)
}

function daysAgo(now: number, days: number): string {
  return new Date(now - days * 86400000).toISOString().slice(0, 10)
}

export async function fetchCandidates($: EngineInterface, topic: string, source: SquirrelSource, now: number): Promise<Candidate[]> {
  const q = encodeURIComponent(topic)
  let url: string
  let headers: Record<string, string> = { accept: 'application/json', 'user-agent': 'adddd-squirrel' }
  if (source === 'hn') {
    const since = Math.floor((now - 45 * 86400000) / 1000)
    url = `https://hn.algolia.com/api/v1/search?query=${q}&tags=story&hitsPerPage=25&numericFilters=points%3E40,created_at_i%3E${since}`
  } else if (source === 'github') {
    // mid-sized and alive: the giants everyone knows are not squirrels
    url = `https://api.github.com/search/repositories?q=${q}+stars:300..25000+pushed:>${daysAgo(now, 30)}&sort=updated&order=desc&per_page=25`
    headers = { ...headers, accept: 'application/vnd.github+json' }
  } else {
    const tag = topic.toLowerCase().replace(/[^a-z0-9]/g, '')
    url = tag ? `https://dev.to/api/articles?tag=${tag}&top=30&per_page=25` : 'https://dev.to/api/articles?top=7&per_page=25'
  }
  const res = await $.http.fetch(url, { headers })
  if (!res.ok) throw new Error(`${source}: HTTP ${res.status}`)
  let data: unknown
  try {
    data = JSON.parse(res.text)
  } catch {
    throw new Error(`${source}: unreadable JSON`)
  }
  return source === 'hn' ? parseHn(data) : source === 'github' ? parseGithub(data) : parseDevto(data)
}

// ---------- curation: the model picks one and says why ----------

export function parseCuration(text: string, count: number): { pick: number; why: string } | undefined {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return undefined
  try {
    const data: unknown = JSON.parse(m[0])
    if (!isObj(data)) return undefined
    const pick = Number(data.pick)
    const why = str(data.why).trim()
    if (!Number.isInteger(pick) || pick < 1 || pick > count) return undefined
    return { pick, why }
  } catch {
    return undefined
  }
}

export async function curate(
  $: EngineInterface,
  topic: string,
  candidates: readonly Candidate[],
  context: readonly string[],
): Promise<{ pick: number; why: string } | undefined> {
  const list = candidates.map((c, i) => `${i + 1}. ${c.title}\n   ${c.blurb}\n   ${c.url}`).join('\n')
  const prompt = [
    `A developer with ADD is between tickets. Their recent tickets: ${context.slice(0, 6).join('; ') || 'unknown'}. Topic in play: ${topic}.`,
    'Pick the ONE link below they would actually enjoy for two minutes: surprising, concrete, relevant to what they build. Avoid listicles, hype and anything generic.',
    'Answer with JSON only: {"pick": <number>, "why": "<at most 22 words, second person, plain, no exclamation marks>"}',
    '',
    list,
  ].join('\n')
  const r = await $.model.complete({ model: 'haiku', prompt, maxTokens: 200, timeoutMs: 25000 })
  if (!r.isAnswered) return undefined
  return parseCuration(r.text, candidates.length)
}

export function makeSquirrel(c: Candidate, topic: string, why: string, now: number): AddddSquirrel {
  return { id: `${c.source}:${c.url}`, title: c.title, url: c.url, blurb: c.blurb, source: c.source, topic, why, foundAt: now }
}

const SOURCES: SquirrelSource[] = ['hn', 'github', 'devto']

/** Hunts one squirrel: a random source on a random topic, minus what the operator has already seen. */
export async function huntSquirrel(
  $: EngineInterface,
  topics: readonly string[],
  seen: ReadonlySet<string>,
  context: readonly string[],
  rand: () => number = Math.random,
): Promise<AddddSquirrel | undefined> {
  const now = await $.clock.now()
  const order = [...SOURCES].sort(() => rand() - 0.5)
  const topic = topics[Math.floor(rand() * topics.length)] ?? 'software engineering'
  for (const source of order) {
    let candidates: Candidate[]
    try {
      candidates = (await fetchCandidates($, topic, source, now)).filter(c => !seen.has(c.url))
    } catch {
      continue
    }
    if (candidates.length === 0) continue
    const top = candidates.sort((a, b) => b.score - a.score).slice(0, 12)
    let choice = await curate($, topic, top, context).catch(() => undefined)
    if (!choice) {
      const i = Math.floor(rand() * top.length)
      choice = { pick: i + 1, why: 'the model was out; this one looked popular' }
    }
    const c = top[choice.pick - 1] ?? top[0]!
    return makeSquirrel(c, topic, choice.why, now)
  }
  return undefined
}

// ---------- look: the gist of the page ----------

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseBullets(text: string): string[] {
  return text
    .split('\n')
    .map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 3)
}

export async function gistOf($: EngineInterface, s: AddddSquirrel): Promise<string[]> {
  const res = await $.http.fetch(s.url, { headers: { 'user-agent': 'adddd-squirrel', accept: 'text/html,application/json;q=0.9,*/*;q=0.5' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = stripHtml(res.text).slice(0, 9000)
  const prompt = [
    `Page title: ${s.title}`,
    `Give exactly three bullets, each at most 18 words: what it is, why it matters, one concrete takeaway. Plain text bullets starting with "- ". No preamble.`,
    '',
    text,
  ].join('\n')
  const r = await $.model.complete({ model: 'haiku', prompt, maxTokens: 300, timeoutMs: 30000 })
  if (!r.isAnswered) throw new Error(r.reason)
  const bullets = parseBullets(r.text)
  if (bullets.length === 0) throw new Error('no gist')
  return bullets
}

// ---------- slack: DM yourself ----------

export async function sendSlack($: EngineInterface, webhook: string, s: AddddSquirrel): Promise<string | undefined> {
  const lines = [`🐿️ *${s.title}*`, ...(s.url ? [s.url] : []), s.why, ...(s.gist ?? []).map(b => `• ${b}`), `_from ${s.source} · ${s.topic}_`]
  const res = await $.http.fetch(webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: lines.join('\n') }),
  })
  return res.ok ? undefined : `Slack said ${res.status}: ${res.text.slice(0, 120)}`
}

export async function openInBrowser($: EngineInterface, url: string): Promise<string | undefined> {
  const uname = await $.process.run(['uname', '-s'], { timeoutMs: 5000 }).catch(() => undefined)
  const opener = uname?.stdout.trim() === 'Darwin' ? 'open' : 'xdg-open'
  const ran = await $.process.run([opener, url], { timeoutMs: 10000 }).catch(() => undefined)
  return ran && ran.exitCode === 0 ? undefined : `could not run ${opener}`
}
