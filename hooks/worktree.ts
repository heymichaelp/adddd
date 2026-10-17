import type { EngineInterface } from 'claude-code'

export const WORKTREES_DIR = '.claude/worktrees/adddd'

async function git($: EngineInterface, cwd: string, args: readonly string[], timeoutMs = 60000) {
  const ran = await $.process.run(['git', ...args], { cwd, timeoutMs })
  return { ...ran, out: ran.stdout.trim(), err: ran.stderr.trim() }
}

/** `origin/main` when origin says so, else the branch checked out at the root. */
export async function baseBranch($: EngineInterface, root: string): Promise<string> {
  const head = await git($, root, ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD'])
  if (head.exitCode === 0 && head.out) return head.out
  const current = await git($, root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (current.exitCode === 0 && current.out && current.out !== 'HEAD') return current.out
  return 'main'
}

export async function listWorktrees($: EngineInterface, root: string): Promise<string[]> {
  const ran = await git($, root, ['worktree', 'list', '--porcelain'])
  if (ran.exitCode !== 0) return []
  return ran.out
    .split('\n')
    .filter(line => line.startsWith('worktree '))
    .map(line => line.slice('worktree '.length).trim())
}

async function ensureExcluded($: EngineInterface, root: string): Promise<void> {
  const common = await git($, root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  if (common.exitCode !== 0 || !common.out) return
  const exclude = `${common.out}/info/exclude`
  const line = '.claude/worktrees/'
  let text = ''
  try {
    text = await $.fs.read(exclude)
  } catch {
    text = ''
  }
  if (text.split('\n').some(l => l.trim() === line)) return
  try {
    await $.fs.write(exclude, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`)
  } catch {
    // best effort: a worktree inside the repo shows up as untracked without it, nothing worse
  }
}

/** Creates (or reuses) the worktree for a ticket and resolves its absolute path. */
export async function ensureWorktree($: EngineInterface, root: string, key: string, branch: string, base: string): Promise<string> {
  const path = `${root}/${WORKTREES_DIR}/${key}`
  const existing = await listWorktrees($, root)
  if (existing.includes(path)) return path
  await ensureExcluded($, root)
  const hasBranch = (await git($, root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])).exitCode === 0
  const args = hasBranch ? ['worktree', 'add', path, branch] : ['worktree', 'add', '-b', branch, path, base]
  const ran = await git($, root, args, 120000)
  if (ran.exitCode !== 0) throw new Error(`git worktree add: ${ran.err.slice(0, 300) || `exit ${ran.exitCode}`}`)
  return path
}

/** Files the branch changed against its base, plus what is still uncommitted in the worktree. */
export async function touchedFiles($: EngineInterface, worktree: string, base: string, branch: string): Promise<string[]> {
  const files = new Set<string>()
  const committed = await git($, worktree, ['diff', '--name-only', `${base}...${branch}`])
  if (committed.exitCode === 0) for (const f of committed.out.split('\n')) if (f.trim()) files.add(f.trim())
  const status = await git($, worktree, ['status', '--porcelain', '--untracked-files=all'])
  if (status.exitCode === 0)
    for (const line of status.out.split('\n')) {
      const f = line.slice(3).trim()
      if (f) files.add(f.includes(' -> ') ? f.split(' -> ')[1]! : f)
    }
  return [...files].sort()
}

export async function isDirty($: EngineInterface, worktree: string): Promise<boolean> {
  const status = await git($, worktree, ['status', '--porcelain'])
  return status.exitCode !== 0 || status.out.length > 0
}

export async function commitCount($: EngineInterface, worktree: string, base: string, branch: string): Promise<number> {
  const ran = await git($, worktree, ['rev-list', '--count', `${base}..${branch}`])
  return ran.exitCode === 0 ? Number(ran.out) || 0 : 0
}

export async function lastCommits($: EngineInterface, worktree: string, base: string, branch: string): Promise<string[]> {
  const ran = await git($, worktree, ['log', '--oneline', '--no-decorate', '-n', '5', `${base}..${branch}`])
  return ran.exitCode === 0 && ran.out ? ran.out.split('\n') : []
}

/** Removes a worktree directory (never the branch). Resolves the error text, or undefined. */
export async function removeWorktree($: EngineInterface, root: string, worktree: string): Promise<string | undefined> {
  const ran = await git($, root, ['worktree', 'remove', worktree])
  return ran.exitCode === 0 ? undefined : ran.err.slice(0, 200) || `exit ${ran.exitCode}`
}
