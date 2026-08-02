import { app } from 'electron'
import { join, resolve } from 'node:path'
import { existsSync, readdirSync, readFileSync, mkdirSync, cpSync } from 'node:fs'
import { PERSONAS_DIR } from './paths'
import type { Persona } from '../shared/types'

const PERSONA_THEME: Record<
  string,
  { displayName: string; shortName: string; color: string; tags: string[]; roleTag: string | null }
> = {
  'duan-yongping-perspective': { displayName: '段永平', shortName: '段', color: '#d4a017', tags: ['本分', '消费者导向', '长期价值'], roleTag: '价值投资' },
  'munger-perspective': { displayName: '查理·芒格', shortName: '芒', color: '#5b8def', tags: ['多元思维', '逆向思考', '认知偏误'], roleTag: '价值投资' },
  'warren-buffett-perspective': { displayName: '沃伦·巴菲特', shortName: '巴', color: '#34a870', tags: ['护城河', '内在价值', '资本配置'], roleTag: '价值投资' },
  'hunjianglong-perspective': { displayName: '混江龙', shortName: '混', color: '#c4573d', tags: ['题材周期', '情绪', '弱转强'], roleTag: '游资大佬' }
}

function parseFrontmatter(md: string): Record<string, string> {
  const m = md.match(/^---\n([\s\S]*?)\n---/)
  if (!m) return {}
  const out: Record<string, string> = {}
  const lines = m[1].split('\n')
  let key = ''
  let buf: string[] = []
  for (const line of lines) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/)
    if (kv) {
      if (key) out[key] = buf.join(' ').trim()
      key = kv[1]
      buf = kv[2] === '|' || kv[2] === '>' ? [] : [kv[2]]
    } else if (key) {
      buf.push(line.trim())
    }
  }
  if (key) out[key] = buf.join(' ').trim()
  return out
}

function parseOpenaiYaml(text: string): { displayName: string | null; defaultPrompt: string | null } {
  const dn = text.match(/display_name:\s*"?([^"\n]+)"?/)
  const dp = text.match(/default_prompt:\s*"?([^"\n]+)"?/)
  return { displayName: dn ? dn[1].trim() : null, defaultPrompt: dp ? dp[1].trim() : null }
}

/** 查找仓库内置角色包目录（开发环境）或打包资源目录 */
function findBundledAgentsDir(): string | null {
  const appPath = app.getAppPath()
  const candidates = [
    resolve(appPath, '..', 'agents'),
    resolve(appPath, '..', '..', 'packages', 'agents'),
    join(process.resourcesPath ?? '', 'agents')
  ]
  for (const c of candidates) {
    if (c && existsSync(c)) return c
  }
  return null
}

/** 拷贝过滤：排除二进制资料与脚本，仅保留运行所需的文本知识文件 */
function shouldCopy(p: string): boolean {
  const base = p.split('/').pop() ?? ''
  if (base.startsWith('.')) return false
  // 目录名判断
  if (/\/(scripts|node_modules|\.git)(\/|$)/.test(p)) return false
  // 文件类型判断（目录无扩展名会通过）
  if (/\.(pdf|jpg|jpeg|png|gif|html|srt|mp4|zip)$/i.test(base)) return false
  return true
}

/** 启动时同步内置角色包，确保随应用发布的 SKILL.md 与文本知识文件及时更新 */
export function importBundledPersonas(): void {
  const src = findBundledAgentsDir()
  if (!src) return
  for (const dir of readdirSync(src, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    const srcDir = join(src, dir.name)
    if (!existsSync(join(srcDir, 'SKILL.md'))) continue
    const dest = join(PERSONAS_DIR, dir.name, 'v1')
    mkdirSync(dest, { recursive: true })
    cpSync(srcDir, dest, {
      recursive: true,
      filter: (s) => shouldCopy(s)
    })
    // agents/openai.yaml 提升到根目录，便于元数据读取
    const yamlNested = join(dest, 'agents', 'openai.yaml')
    if (existsSync(yamlNested)) {
      cpSync(yamlNested, join(dest, 'openai.yaml'))
    }
  }
}

export function listPersonas(): Persona[] {
  const personas: Persona[] = []
  if (existsSync(PERSONAS_DIR)) {
    for (const dir of readdirSync(PERSONAS_DIR, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue
      const versionDir = join(PERSONAS_DIR, dir.name, 'v1')
      const skillPath = join(versionDir, 'SKILL.md')
      if (!existsSync(skillPath)) continue
      const md = readFileSync(skillPath, 'utf-8')
      const fm = parseFrontmatter(md)
      const yamlPath = join(versionDir, 'openai.yaml')
      const yaml = existsSync(yamlPath)
        ? parseOpenaiYaml(readFileSync(yamlPath, 'utf-8'))
        : { displayName: null, defaultPrompt: null }
      const theme =
        PERSONA_THEME[dir.name] ?? { displayName: '', shortName: dir.name[0], color: '#8b93a7', tags: [], roleTag: null }
      const titleMatch = md.match(/^#\s+(.+)$/m)
      personas.push({
        id: dir.name,
        name: theme.displayName || yaml.displayName || titleMatch?.[1]?.trim() || fm.name || dir.name,
        shortName: theme.shortName,
        description: fm.description ?? '',
        avatar: null,
        color: theme.color,
        skillPath,
        roleTag: theme.roleTag,
        defaultPrompt: yaml.defaultPrompt,
        tags: theme.tags
      })
    }
  }
  return personas
}

export function getPersona(id: string): Persona | null {
  return listPersonas().find((p) => p.id === id) ?? null
}
