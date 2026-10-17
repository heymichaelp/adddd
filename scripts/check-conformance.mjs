#!/usr/bin/env node
// Checks this package against Agent Plugins 1.0.0 (https://agent-plugins.org/specification)
// and keeps the Claude Code manifest in lockstep. No dependencies: node scripts/check-conformance.mjs
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? '.')
const problems = []
const fail = (m) => problems.push(m)
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

// §5 manifest
const PLUGIN_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'
const MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json'
const NAME = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/
const TOP = new Set(['$schema', 'name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'extensions'])
const manifestPath = join(root, 'plugin.json')
let manifest
if (!existsSync(manifestPath)) fail('plugin.json missing at the plugin root (§4.1)')
else {
  try { manifest = readJson(manifestPath) } catch (e) { fail(`plugin.json is not JSON: ${e.message}`) }
}
if (isObj(manifest)) {
  if (manifest.$schema !== PLUGIN_SCHEMA) fail(`plugin.json $schema must be ${PLUGIN_SCHEMA} (§5.2)`)
  if (typeof manifest.name !== 'string' || manifest.name.length < 1 || manifest.name.length > 64 || !NAME.test(manifest.name)) fail('plugin.json name violates §5.5')
  for (const k of Object.keys(manifest)) if (!TOP.has(k)) fail(`plugin.json has unknown top-level field "${k}" (§5.2)`)
  for (const k of ['version', 'description', 'homepage', 'repository', 'license']) if (k in manifest && typeof manifest[k] !== 'string') fail(`plugin.json ${k} must be a string (§5.4)`)
  if ('keywords' in manifest && !(Array.isArray(manifest.keywords) && manifest.keywords.every((x) => typeof x === 'string'))) fail('plugin.json keywords must be string[] (§5.4)')
  if ('author' in manifest) {
    if (!isObj(manifest.author)) fail('plugin.json author must be an object (§5.4)')
    else for (const [k, v] of Object.entries(manifest.author)) if (!['name', 'email', 'url'].includes(k) || typeof v !== 'string') fail(`plugin.json author.${k} is not allowed or not a string (§5.4)`)
  }
  if ('extensions' in manifest) {
    if (!isObj(manifest.extensions)) fail('plugin.json extensions must be an object (§8.1)')
    else for (const [ns, v] of Object.entries(manifest.extensions)) if (!isObj(v)) fail(`plugin.json extensions.${ns} must be an object (§8.1)`)
  }
} else if (manifest !== undefined) fail('plugin.json must be a JSON object (§5.2)')

// §7.2 mcp.json
const mcpPath = join(root, 'mcp.json')
if (existsSync(mcpPath)) {
  let mcp
  try { mcp = readJson(mcpPath) } catch (e) { fail(`mcp.json is not JSON: ${e.message}`) }
  if (isObj(mcp)) {
    for (const k of Object.keys(mcp)) if (!['$schema', 'mcpServers'].includes(k)) fail(`mcp.json has unknown top-level field "${k}" (§7.2.1)`)
    if (mcp.$schema !== MCP_SCHEMA) fail(`mcp.json $schema must be ${MCP_SCHEMA} (§7.2.1)`)
    if (!isObj(mcp.mcpServers)) fail('mcp.json mcpServers must be an object (§7.2.1)')
    else for (const [name, s] of Object.entries(mcp.mcpServers)) {
      if (!isObj(s)) { fail(`mcp.json server "${name}" must be an object`); continue }
      const keys = Object.keys(s)
      if (s.type === 'stdio') {
        for (const k of keys) if (!['type', 'command', 'args', 'env', 'cwd'].includes(k)) fail(`server "${name}": unknown field "${k}"`)
        if (typeof s.command !== 'string' || !s.command) fail(`server "${name}": command required`)
        else if (/[\s]/.test(s.command) || (s.command.includes('/') && !s.command.startsWith('./'))) fail(`server "${name}": command must be a bare executable or a ./ plugin-relative path (§7.2.1)`)
        if ('cwd' in s && !(s.cwd.startsWith('./') || s.cwd === '${PLUGIN_ROOT}' || s.cwd.startsWith('${PLUGIN_ROOT}/') || s.cwd === '${PLUGIN_DATA}' || s.cwd.startsWith('${PLUGIN_DATA}/'))) fail(`server "${name}": cwd form invalid (§7.2.1)`)
        if (isObj(s.env)) for (const k of Object.keys(s.env)) if (k === 'PLUGIN_ROOT' || k === 'PLUGIN_DATA') fail(`server "${name}": env must not set ${k} (§9.2)`)
      } else if (s.type === 'streamable-http' || s.type === 'sse') {
        for (const k of keys) if (!['type', 'url', 'headers'].includes(k)) fail(`server "${name}": unknown field "${k}"`)
        let u
        try { u = new URL(s.url) } catch { fail(`server "${name}": url must be absolute`) }
        if (u) {
          const loop = u.hostname === 'localhost' || /^127\./.test(u.hostname) || u.hostname === '[::1]' || u.hostname === '::1'
          if (!['http:', 'https:'].includes(u.protocol)) fail(`server "${name}": url must be http(s)`)
          if (u.protocol === 'http:' && !loop) fail(`server "${name}": non-loopback url must be https (§7.2.1)`)
          if (u.username || u.password || u.hash) fail(`server "${name}": url must not carry user info or a fragment (§7.2.1)`)
        }
        if (isObj(s.headers)) {
          const seen = new Set()
          for (const [h, v] of Object.entries(s.headers)) {
            if (typeof v !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(h)) fail(`server "${name}": bad header ${h}`)
            if (seen.has(h.toLowerCase())) fail(`server "${name}": header ${h} repeated with different casing`)
            seen.add(h.toLowerCase())
            if (/authorization|cookie|token|secret|key/i.test(h) || /^(xox[a-z]-|sk-|ghp_)/.test(v)) fail(`server "${name}": headers must not carry credentials (§7.2.1)`)
          }
        }
      } else fail(`server "${name}": type must be stdio, streamable-http or sse (§7.2.1)`)
    }
  } else if (mcp !== undefined) fail('mcp.json must be a JSON object')
}

// §7.1 skills (Agent Skills frontmatter basics)
const skillsDir = join(root, 'skills')
if (existsSync(skillsDir)) {
  if (!statSync(skillsDir).isDirectory()) fail('skills exists but is not a directory (§6.2)')
  else for (const d of readdirSync(skillsDir)) {
    const p = join(skillsDir, d, 'SKILL.md')
    if (!existsSync(p)) continue
    const text = readFileSync(p, 'utf8')
    const m = text.match(/^---\n([\s\S]*?)\n---\n/)
    if (!m) { fail(`skills/${d}/SKILL.md has no YAML frontmatter`); continue }
    const fm = Object.fromEntries(m[1].split('\n').filter((l) => /^[a-z-]+:/.test(l)).map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]))
    if (fm.name !== d) fail(`skills/${d}: frontmatter name "${fm.name}" must equal the directory name`)
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(fm.name ?? '') || /--/.test(fm.name ?? '') || (fm.name ?? '').length > 64) fail(`skills/${d}: name violates Agent Skills naming`)
    if (!fm.description || fm.description.length > 1024) fail(`skills/${d}: description missing or over 1024 characters`)
    if (fm.compatibility && fm.compatibility.length > 500) fail(`skills/${d}: compatibility over 500 characters`)
  }
}

// Claude Code manifest stays in lockstep (client-specific, outside the spec)
const ccPath = join(root, '.claude-plugin', 'plugin.json')
if (existsSync(ccPath) && isObj(manifest)) {
  const cc = readJson(ccPath)
  if (cc.name !== manifest.name) fail(`.claude-plugin/plugin.json name "${cc.name}" differs from plugin.json "${manifest.name}"`)
  if (cc.version !== manifest.version) fail(`.claude-plugin/plugin.json version "${cc.version}" differs from plugin.json "${manifest.version}"`)
}
const dotMcp = join(root, '.mcp.json')
if (existsSync(dotMcp) && existsSync(mcpPath)) {
  const a = Object.keys(readJson(dotMcp)).sort().join(',')
  const b = Object.keys(readJson(mcpPath).mcpServers ?? {}).sort().join(',')
  if (a !== b) fail(`.mcp.json servers (${a}) differ from mcp.json servers (${b})`)
}

if (problems.length) {
  console.error(`✘ ${problems.length} conformance problem${problems.length === 1 ? '' : 's'}:`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log('✔ conforms to Agent Plugins 1.0.0 (plugin.json, mcp.json, skills/) and the Claude Code manifest is in lockstep')
