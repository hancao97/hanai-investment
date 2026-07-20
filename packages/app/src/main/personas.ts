import { app } from 'electron'
import { join, resolve, dirname } from 'node:path'
import { existsSync, readdirSync, readFileSync, mkdirSync, cpSync } from 'node:fs'
import { PERSONAS_DIR } from './paths'
import { kvGet, kvSet } from './db'
import type { Persona } from '../shared/types'

// 内置中立主持人：不是名人角色，只负责流程、证据一致性和总结
export const MODERATOR_ID = 'neutral-moderator'

const PERSONA_THEME: Record<
  string,
  { shortName: string; color: string; tags: string[]; roleTag: string | null }
> = {
  'duan-yongping-perspective': { shortName: '段', color: '#d4a017', tags: ['本分', '消费者导向', '长期价值'], roleTag: '价值投资' },
  'munger-perspective': { shortName: '芒', color: '#5b8def', tags: ['多元思维', '逆向思考', '认知偏误'], roleTag: '价值投资' },
  'warren-buffett-perspective': { shortName: '巴', color: '#34a870', tags: ['护城河', '内在价值', '资本配置'], roleTag: '价值投资' },
  'hunjianglong-perspective': { shortName: '混', color: '#c4573d', tags: ['题材周期', '情绪', '弱转强'], roleTag: '游资大佬' },
  [MODERATOR_ID]: { shortName: '持', color: '#8b93a7', tags: ['中立主持', '流程', '证据一致性'], roleTag: null }
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

/** 拷贝过滤：排除大体积原始资料（PDF/图片/HTML）与脚本，仅保留文本知识文件 */
function shouldCopy(p: string): boolean {
  const base = p.split('/').pop() ?? ''
  if (base.startsWith('.')) return false
  // 目录名判断
  if (/\/(scripts|node_modules|\.git)(\/|$)/.test(p)) return false
  if (/\/references\/sources(\/|$)/.test(p)) return false
  // 文件类型判断（目录无扩展名会通过）
  if (/\.(pdf|jpg|jpeg|png|gif|html|srt|mp4|zip)$/i.test(base)) return false
  return true
}

/** 首次启动导入内置角色包（完整拷贝 SKILL.md + references 知识文件）；旧版仅有 SKILL.md 的目录自动补齐 */
export function importBundledPersonas(): void {
  const src = findBundledAgentsDir()
  if (!src) return
  for (const dir of readdirSync(src, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    const srcDir = join(src, dir.name)
    if (!existsSync(join(srcDir, 'SKILL.md'))) continue
    const dest = join(PERSONAS_DIR, dir.name, 'v1')
    const needFull = !existsSync(join(dest, 'SKILL.md'))
    const needRefs =
      existsSync(join(srcDir, 'references')) && !existsSync(join(dest, 'references'))
    if (!needFull && !needRefs) continue
    mkdirSync(dest, { recursive: true })
    cpSync(srcDir, dest, {
      recursive: true,
      filter: (s) => shouldCopy(s)
    })
    // agents/openai.yaml 提升到根目录，便于元数据读取
    const yamlNested = join(dest, 'agents', 'openai.yaml')
    if (existsSync(yamlNested) && !existsSync(join(dest, 'openai.yaml'))) {
      cpSync(yamlNested, join(dest, 'openai.yaml'))
    }
  }
}

function enabledMap(): Record<string, boolean> {
  try {
    return JSON.parse(kvGet('persona_enabled') ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

export function setPersonaEnabled(id: string, enabled: boolean): void {
  const map = enabledMap()
  map[id] = enabled
  kvSet('persona_enabled', JSON.stringify(map))
}

export function listPersonas(): Persona[] {
  const enabled = enabledMap()
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
        PERSONA_THEME[dir.name] ?? { shortName: dir.name[0], color: '#8b93a7', tags: [], roleTag: null }
      const hasFidelity = existsSync(join(versionDir, 'FIDELITY.md'))
      const titleMatch = md.match(/^#\s+(.+)$/m)
      personas.push({
        id: dir.name,
        name: yaml.displayName ?? titleMatch?.[1]?.trim() ?? fm.name ?? dir.name,
        shortName: theme.shortName,
        description: fm.description ?? '',
        avatar: null,
        color: theme.color,
        skillPath,
        hasFidelity,
        verified: hasFidelity,
        roleTag: theme.roleTag,
        enabled: enabled[dir.name] !== false,
        defaultPrompt: yaml.defaultPrompt,
        tags: theme.tags,
        builtin: false
      })
    }
  }
  // 中立主持人
  const modTheme = PERSONA_THEME[MODERATOR_ID]
  personas.push({
    id: MODERATOR_ID,
    name: '中立主持人',
    shortName: modTheme.shortName,
    description: '不是名人角色。负责流程推进、证据一致性检查与终审总结，不输出自有投资立场。',
    avatar: null,
    color: modTheme.color,
    skillPath: '',
    hasFidelity: true,
    verified: true,
    roleTag: null,
    enabled: enabled[MODERATOR_ID] !== false,
    defaultPrompt: null,
    tags: modTheme.tags,
    builtin: true
  })
  return personas
}

export function getPersona(id: string): Persona | null {
  return listPersonas().find((p) => p.id === id) ?? null
}

export function personaInstructions(id: string): string {
  if (id === MODERATOR_ID) {
    return [
      '你是一名中立主持人，负责主持多角色投资研究讨论。',
      '你不是任何名人，也没有自己的投资立场。你的职责：',
      '1. 保证流程与证据一致性：所有结论必须能追溯到证据包中的证据 ID 与数据时间。',
      '2. 保留分歧：不制造假共识，不按人数多数自动判定结论，不把缺席视为赞同。',
      '3. 输出条件式结论（如“可进入研究清单 / 等待条件 / 暂不满足 / 证据不足”），不输出收益承诺、确定目标价或买卖指令。',
      '4. 不引入证据包之外的新数字事实；不改写参与者原文。',
      '始终使用简体中文。'
    ].join('\n')
  }
  const p = getPersona(id)
  if (!p || !p.skillPath) throw new Error(`未找到角色: ${id}`)
  const skill = readFileSync(p.skillPath, 'utf-8')
  const personaDir = dirname(p.skillPath)
  const hasRefs = existsSync(join(personaDir, 'references'))
  return [
    `以下是角色技能定义（SKILL.md）。请按其中的框架、启发式与表达风格工作。`,
    `重要：你是基于公开资料构建的 AI 模拟视角，并非本人，也未获本人背书。`,
    `用户明确使用了该角色，视为已满足技能的激活条件。始终使用简体中文回答。`,
    hasRefs
      ? `角色资料目录（含 SKILL.md 引用的 references/ 研究资料）位于：${personaDir}\n当 SKILL.md 提示查阅 references/ 下的文件时，请用该绝对路径读取。`
      : '',
    '',
    skill
  ]
    .filter(Boolean)
    .join('\n')
}
