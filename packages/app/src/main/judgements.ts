import { createHash, randomUUID } from 'node:crypto'
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { getDb } from './db'
import { getMaster } from './master'
import { getPersona } from './personas'
import { JUDGEMENTS_DIR } from './paths'
import { codex } from './codex'
import type {
  AgentActivityItem,
  JudgementActivityEntry,
  JudgementReport,
  JudgementRun,
  StreamEvent
} from '../shared/types'

type Emitter = (event: StreamEvent) => void

let emit: Emitter = () => {}
const active = new Set<string>()

export function setJudgementEmitter(fn: Emitter): void {
  emit = fn
}

function persist(run: JudgementRun): void {
  run.updatedAt = new Date().toISOString()
  getDb()
    .prepare(
      'INSERT INTO judgements(id, payload, updated_at) VALUES(?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at'
    )
    .run(run.id, JSON.stringify(run), run.updatedAt)
  mkdirSync(run.directory, { recursive: true })
  writeFileSync(join(run.directory, 'RUN.json'), JSON.stringify(run, null, 2), 'utf-8')
  emit({ type: 'judgement-update', judgement: run })
}

function parseRun(payload: string): JudgementRun | null {
  try {
    return JSON.parse(payload) as JudgementRun
  } catch {
    return null
  }
}

export function listJudgements(): JudgementRun[] {
  return (getDb().prepare('SELECT payload FROM judgements ORDER BY updated_at DESC').all() as { payload: string }[])
    .map((row) => parseRun(row.payload))
    .filter((run): run is JudgementRun => run !== null)
}

export function getJudgement(id: string): JudgementRun | null {
  const row = getDb().prepare('SELECT payload FROM judgements WHERE id = ?').get(id) as
    | { payload: string }
    | undefined
  return row ? parseRun(row.payload) : null
}

/** 应用重启后不伪装任务仍在运行；原目录和过程日志保留为失败归档。 */
export function recoverInterruptedJudgements(): void {
  for (const run of listJudgements()) {
    if (run.status === 'running' || run.status === 'verifying') {
      run.status = 'failed'
      run.error = '应用在报告完成前退出，本次研判未形成有效报告；请重新创建任务。'
      persist(run)
    }
  }
}

function shouldCopySkillEntry(path: string): boolean {
  const normalized = path.replaceAll('\\', '/')
  const base = normalized.split('/').pop() ?? ''
  if (base.startsWith('.')) return false
  if (/\/(sources|scripts|node_modules|\.git)(\/|$)/.test(normalized)) return false
  if (/\.(pdf|jpg|jpeg|png|gif|html|srt|mp4|zip)$/i.test(base)) return false
  return true
}

function syncSkill(personaId: string, skillPath: string, directory: string): string {
  const destination = join(directory, '.agents', 'skills', personaId)
  mkdirSync(destination, { recursive: true })
  cpSync(dirname(skillPath), destination, {
    recursive: true,
    force: true,
    filter: shouldCopySkillEntry
  })
  const syncedSkillPath = join(destination, 'SKILL.md')
  if (!existsSync(syncedSkillPath)) throw new Error('专家 Skill 同步失败：缺少 SKILL.md')
  return syncedSkillPath
}

function createWorkspaceInstructions(run: JudgementRun): string {
  return [
    '# 大师研判工作区',
    '',
    `本目录只服务于 ${run.stockName}（${run.code}）的一次性投资研判。`,
    `必须使用并遵循专家 Skill：$${run.personaId}`,
    '主动联网获取最新公开信息并交叉核验，不向用户提问，不等待用户补充材料。',
    '只可在当前工作目录内写文件。唯一交付物是根目录 REPORT.md。',
    '报告必须使用简体中文，区分事实、推断与假设，并为关键事实注明来源链接和日期。',
    '严禁编造数据、来源或引文；资料不足时明确标记不确定性。',
    '完成 REPORT.md 后只用一句话确认已完成，不在最终回复中重复整份报告。'
  ].join('\n')
}

function taskPrompt(run: JudgementRun): string {
  return [
    `以 ${run.personaName} 身份，主动获取与 ${run.stockName}（${run.code}，${run.secId}）有关的最新公开信息，进行详细投资分析，并出具完整报告至 ${run.reportPath}。`,
    '',
    `本次必须调用 $${run.personaId}，按其中的分析框架、启发式和表达方式执行。`,
    '不要要求用户提供原始资料，不要向用户提问；自行检索公司公告、财报、监管披露、行业资料和其他必要的一手或可信来源。',
    '报告至少包含：执行摘要、信息时点与来源、业务与护城河/竞争格局、财务质量、估值与关键假设、催化剂、核心风险、乐观/基准/悲观情景、需要持续验证的清单，以及符合该专家框架的最终研判。',
    '对事实、推断和主观判断做清楚区分；所有关键数字写明口径与日期。不要给出收益承诺或伪造精确目标。',
    'REPORT.md 是唯一正式成果，必须内容完整、结构专业且可独立阅读。'
  ].join('\n')
}

function activityPath(run: JudgementRun): string {
  return join(run.directory, 'activity.jsonl')
}

function recordActivity(run: JudgementRun, item: AgentActivityItem): void {
  appendFileSync(activityPath(run), JSON.stringify({ item } satisfies JudgementActivityEntry) + '\n', 'utf-8')
  emit({ type: 'judgement-activity', judgementId: run.id, item })
}

function stageActivity(run: JudgementRun, summary: string, detail: string | null = null): void {
  recordActivity(run, {
    id: `stage-${randomUUID()}`,
    type: 'stage',
    status: 'completed',
    summary,
    detail,
    at: new Date().toISOString()
  })
}

export function createJudgement(params: { secId: string; personaId: string }): JudgementRun {
  if (!codex.isReady()) throw new Error('Codex Agent 尚未就绪，请先在“设置与诊断”完成登录或重启检测。')
  const security = getMaster(params.secId)
  if (!security) throw new Error(`未找到股票：${params.secId}`)
  const persona = getPersona(params.personaId)
  if (!persona?.skillPath) throw new Error(`未找到专家 Skill：${params.personaId}`)

  const createdAt = new Date().toISOString()
  const datePart = createdAt.slice(0, 10).replaceAll('-', '')
  const id = `${datePart}-${security.code}-${randomUUID().slice(0, 8)}`
  const directory = join(JUDGEMENTS_DIR, id)
  mkdirSync(directory, { recursive: true })
  const skillPath = syncSkill(persona.id, persona.skillPath, directory)
  const run: JudgementRun = {
    id,
    secId: security.secId,
    code: security.code,
    stockName: security.name,
    personaId: persona.id,
    personaName: persona.name,
    status: 'preparing',
    directory,
    reportPath: join(directory, 'REPORT.md'),
    skillPath,
    codexThreadId: null,
    model: codex.getState().selectedModel,
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
    error: null
  }
  writeFileSync(join(directory, 'AGENTS.md'), createWorkspaceInstructions(run), 'utf-8')
  persist(run)
  stageActivity(run, '研判任务已创建', `${persona.name}的分析框架已就绪`)
  return run
}

function validateReport(run: JudgementRun): string | null {
  if (!existsSync(run.reportPath)) return 'Agent 未创建 REPORT.md'
  const content = readFileSync(run.reportPath, 'utf-8').trim()
  if (content.length < 800) return 'REPORT.md 内容过短，未达到完整研判报告要求'
  return null
}

async function execute(run: JudgementRun): Promise<void> {
  try {
    run.status = 'running'
    persist(run)
    stageActivity(run, '开始研判', `${run.personaName}正在检索并分析 ${run.stockName}`)

    const thread = await codex.startThread({
      cwd: run.directory,
      developerInstructions: createWorkspaceInstructions(run),
      model: run.model,
      ephemeral: false
    })
    run.codexThreadId = thread.threadId
    persist(run)

    const handlers = {
      timeoutMs: 30 * 60 * 1000,
      onDelta: (delta: string, itemId: string) =>
        emit({ type: 'judgement-delta', judgementId: run.id, itemId, channel: 'assistant', delta }),
      onReasoningDelta: (delta: string, itemId: string) =>
        emit({ type: 'judgement-delta', judgementId: run.id, itemId, channel: 'commentary', delta }),
      onItem: (item: AgentActivityItem) => recordActivity(run, item)
    }
    let result = await codex.runTurn(thread.threadId, taskPrompt(run), handlers)
    if (!result.ok) throw new Error(result.error ?? 'Agent 执行失败')

    run.status = 'verifying'
    persist(run)
    stageActivity(run, '正在整理报告', '检查报告结构和内容完整性')
    let validationError = validateReport(run)
    if (validationError) {
      stageActivity(run, '正在补充报告', validationError)
      result = await codex.runTurn(
        thread.threadId,
        `${validationError}。请立即完成或补全 ${run.reportPath}，确保它是结构完整、信息有来源且可独立阅读的详细投资研判报告。不要向用户提问。`,
        handlers
      )
      if (!result.ok) throw new Error(result.error ?? '报告补全失败')
      validationError = validateReport(run)
    }
    if (validationError) throw new Error(validationError)

    run.status = 'completed'
    run.completedAt = new Date().toISOString()
    run.error = null
    persist(run)
    const bytes = statSync(run.reportPath).size
    stageActivity(run, '研判报告已完成', `${bytes} 字节`)
    await codex.archiveThread(thread.threadId)
  } catch (error) {
    run.status = 'failed'
    run.error = error instanceof Error ? error.message : String(error)
    persist(run)
    stageActivity(run, '研判失败', run.error)
    if (run.codexThreadId) await codex.archiveThread(run.codexThreadId)
  } finally {
    active.delete(run.id)
  }
}

export function startJudgement(id: string): void {
  const run = getJudgement(id)
  if (!run) throw new Error(`未找到研判任务：${id}`)
  if (run.status !== 'preparing') return
  if (active.has(id)) return
  active.add(id)
  void execute(run)
}

export function getJudgementActivity(id: string): JudgementActivityEntry[] {
  const run = getJudgement(id)
  if (!run || !existsSync(activityPath(run))) return []
  return readFileSync(activityPath(run), 'utf-8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as JudgementActivityEntry]
      } catch {
        return []
      }
    })
}

export function getJudgementReport(id: string): JudgementReport | null {
  const run = getJudgement(id)
  if (!run || run.status !== 'completed' || !existsSync(run.reportPath)) return null
  const content = readFileSync(run.reportPath, 'utf-8')
  return {
    content,
    sha256: createHash('sha256').update(content).digest('hex'),
    size: Buffer.byteLength(content)
  }
}
