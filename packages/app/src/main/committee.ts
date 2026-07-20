import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync, renameSync } from 'node:fs'
import { WORKDIR } from './paths'
import { getDb } from './db'
import { codex } from './codex'
import { getPersona, personaInstructions } from './personas'
import { createEvidenceSnapshot, evidenceToPromptBlock } from './evidence'
import type {
  AnalysisRun,
  AnalysisSeat,
  AnalysisArtifact,
  AnalysisActivityEntry,
  AgentActivityItem,
  StreamEvent,
  EvidenceSnapshot
} from '../shared/types'

type Emit = (e: StreamEvent) => void
let emit: Emit = () => {}
export function setCommitteeEmitter(fn: Emit): void {
  emit = fn
}

const TURN_TIMEOUT_MS = 20 * 60 * 1000
const runningStops = new Map<string, boolean>() // analysisHash -> stop requested

// ---------- 持久化 ----------
function saveRun(run: AnalysisRun): void {
  run.updatedAt = new Date().toISOString()
  getDb()
    .prepare(
      `INSERT INTO analysis_runs(analysis_hash, payload, updated_at) VALUES(?, ?, ?)
       ON CONFLICT(analysis_hash) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
    )
    .run(run.analysisHash, JSON.stringify(run), run.updatedAt)
  emit({ type: 'analysis-update', analysis: run })
}

/** 兼容旧版本没有 mode 字段的归档数据 */
function normalizeRun(run: AnalysisRun): AnalysisRun {
  if (!run.mode) run.mode = 'committee'
  return run
}

export function listRuns(): AnalysisRun[] {
  const rows = getDb()
    .prepare('SELECT payload FROM analysis_runs ORDER BY updated_at DESC')
    .all() as { payload: string }[]
  return rows.map((r) => normalizeRun(JSON.parse(r.payload) as AnalysisRun))
}

export function getRun(analysisHash: string): AnalysisRun | null {
  const row = getDb()
    .prepare('SELECT payload FROM analysis_runs WHERE analysis_hash = ?')
    .get(analysisHash) as { payload: string } | undefined
  return row ? normalizeRun(JSON.parse(row.payload) as AnalysisRun) : null
}

export function deleteRun(analysisHash: string): void {
  getDb().prepare('DELETE FROM analysis_runs WHERE analysis_hash = ?').run(analysisHash)
}

function logEvent(run: AnalysisRun, event: string, detail: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...detail })
  try {
    appendFileSync(join(run.directory, 'events.jsonl'), line + '\n')
  } catch {
    // 日志失败不阻塞流程
  }
  emit({ type: 'analysis-log', analysisHash: run.analysisHash, line: `${event} ${JSON.stringify(detail)}` })
}

// ---------- 工具 ----------
function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex')
}

function sanitizeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\s]/g, '').slice(0, 24) || 'persona'
}

/** 应用侧原子写入：先写临时文件再改名 */
function atomicWrite(path: string, content: string): void {
  const tmp = `${path}.tmp-${randomUUID().slice(0, 8)}`
  writeFileSync(tmp, content, 'utf-8')
  renameSync(tmp, path)
}

function frontmatter(fields: Record<string, string | null>): string {
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${v ?? 'null'}`)
  return ['---', ...lines, '---', ''].join('\n')
}

// ---------- 创建分析 ----------
// 单角色与委员会共用同一流程：solo = 证据锁定 → 大师分析；committee = 证据锁定 → 两轮 → 终审
export async function createAnalysis(params: {
  secId: string
  moderatorPersonaId: string
  participantPersonaIds: string[]
  topic: string | null
}): Promise<AnalysisRun> {
  const { secId, moderatorPersonaId, participantPersonaIds, topic } = params
  if (!participantPersonaIds.length) throw new Error('至少需要一名参与角色')
  if (participantPersonaIds.length > 4) throw new Error('参与角色最多 4 名')
  const mode: AnalysisRun['mode'] = participantPersonaIds.length === 1 ? 'solo' : 'committee'
  if (mode === 'committee' && participantPersonaIds.includes(moderatorPersonaId)) {
    throw new Error('同一角色不得同时担任主持人与参与者')
  }
  if (new Set(participantPersonaIds).size !== participantPersonaIds.length) {
    throw new Error('参与角色不得重复')
  }
  if (!codex.isReady()) throw new Error('Codex 不可用，无法发起讨论')

  const evidence = await createEvidenceSnapshot(secId)

  const nonce = randomUUID()
  const createdAt = new Date().toISOString()
  const analysisHash = sha256(
    JSON.stringify({ secId, evidenceHash: evidence.hash, moderatorPersonaId, participantPersonaIds, topic, createdAt, nonce, protocol: 'v1' })
  ).slice(0, 40)

  const directory = join(WORKDIR, analysisHash)
  mkdirSync(join(directory, 'manifests'), { recursive: true })

  const seats: AnalysisSeat[] = []
  // solo 模式没有主持人席位
  if (mode === 'committee') {
    const moderator = getPersona(moderatorPersonaId)
    if (!moderator) throw new Error(`未找到主持人角色: ${moderatorPersonaId}`)
    const modDir = `${sanitizeName(moderator.name)}--moderator`
    mkdirSync(join(directory, modDir, '_attempts'), { recursive: true })
    seats.push({
      seatId: 'moderator',
      seatRole: 'moderator',
      personaId: moderatorPersonaId,
      personaName: moderator.name,
      directory: modDir,
      codexThreadId: null,
      turnStatus: {}
    })
  }
  participantPersonaIds.forEach((pid, i) => {
    const p = getPersona(pid)
    if (!p) throw new Error(`未找到角色: ${pid}`)
    const seatId = `participant-${String(i + 1).padStart(2, '0')}`
    const dir = `${sanitizeName(p.name)}--${seatId}`
    mkdirSync(join(directory, dir, '_attempts'), { recursive: true })
    seats.push({
      seatId,
      seatRole: 'participant',
      personaId: pid,
      personaName: p.name,
      directory: dir,
      codexThreadId: null,
      turnStatus: {}
    })
  })

  // 证据落盘（不可变）
  atomicWrite(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2))

  const run: AnalysisRun = {
    analysisHash,
    mode,
    secId,
    code: evidence.code,
    stockName: evidence.name,
    topic,
    stage: 'evidence_locked',
    directory,
    evidenceHash: evidence.hash,
    seats,
    createdAt,
    updatedAt: createdAt,
    error: null
  }

  atomicWrite(
    join(directory, 'analysis.json'),
    JSON.stringify(
      {
        analysisHash,
        mode,
        topic,
        stock: { secId, code: evidence.code, name: evidence.name },
        moderator: mode === 'committee' ? { seatId: 'moderator', personaId: moderatorPersonaId } : null,
        participants: seats.filter((s) => s.seatRole === 'participant').map((s) => ({ seatId: s.seatId, personaId: s.personaId })),
        speakerSeats: speakerSeats(run).map((s) => s.seatId),
        evidenceHash: evidence.hash,
        budget: { maxParticipants: 4, rounds: mode === 'solo' ? 1 : 2, turnTimeoutMs: TURN_TIMEOUT_MS },
        protocolVersion: 'v1',
        createdAt,
        stage: run.stage
      },
      null,
      2
    )
  )
  writeCodexSessions(run)
  logEvent(run, 'analysis_created', { analysisHash, secId, topic })
  saveRun(run)
  return run
}

/** 发言席：全部参与者（solo 模式仅一席；委员会模式主持人不发言只终审） */
function speakerSeats(run: AnalysisRun): AnalysisSeat[] {
  return run.seats.filter((s) => s.seatRole === 'participant')
}

/** 活动记录：追加到席位目录并实时推送到 UI */
function recordActivity(run: AnalysisRun, seat: AnalysisSeat, round: string, item: AgentActivityItem): void {
  try {
    appendFileSync(
      join(run.directory, seat.directory, 'activity.jsonl'),
      JSON.stringify({ seatId: seat.seatId, round, item }) + '\n'
    )
  } catch {
    // 活动日志失败不阻塞流程
  }
  emit({ type: 'analysis-activity', analysisHash: run.analysisHash, seatId: seat.seatId, round, item })
}

/** 读取全部席位的历史活动（用于详情页回放） */
export function getActivity(analysisHash: string): AnalysisActivityEntry[] {
  const run = getRun(analysisHash)
  if (!run) return []
  const out: AnalysisActivityEntry[] = []
  for (const seat of run.seats) {
    const p = join(run.directory, seat.directory, 'activity.jsonl')
    if (!existsSync(p)) continue
    for (const line of readFileSync(p, 'utf-8').split('\n')) {
      if (!line.trim()) continue
      try {
        out.push(JSON.parse(line) as AnalysisActivityEntry)
      } catch {
        // 跳过损坏行
      }
    }
  }
  return out
}

function writeCodexSessions(run: AnalysisRun): void {
  const sessions = run.seats.map((s) => ({
    analysisHash: run.analysisHash,
    seatId: s.seatId,
    seatRole: s.seatRole,
    personaId: s.personaId,
    personaVersion: 'v1',
    sessionOwnerKey: `${run.analysisHash}+${s.seatId}`,
    codexThreadId: s.codexThreadId,
    sessionStatus: s.codexThreadId ? 'ready' : 'preparing',
    turns: Object.entries(s.turnStatus).map(([purpose, status]) => ({ purpose, status }))
  }))
  atomicWrite(
    join(run.directory, 'codex-sessions.json'),
    JSON.stringify({ analysisHash: run.analysisHash, sessions }, null, 2)
  )
}

// ---------- 讨论执行 ----------
export async function startAnalysis(analysisHash: string): Promise<void> {
  const run = getRun(analysisHash)
  if (!run) throw new Error('分析不存在')
  runningStops.set(analysisHash, false)
  try {
    await executeFrom(run)
  } catch (e) {
    run.error = e instanceof Error ? e.message : String(e)
    if (run.stage !== 'cancelled') run.stage = 'failed'
    logEvent(run, 'analysis_failed', { error: run.error })
    saveRun(run)
  }
}

export async function stopAnalysis(analysisHash: string): Promise<void> {
  runningStops.set(analysisHash, true)
  const run = getRun(analysisHash)
  if (run && !['completed', 'failed', 'cancelled'].includes(run.stage)) {
    run.stage = 'cancelled'
    run.error = '用户中止'
    logEvent(run, 'analysis_cancelled')
    saveRun(run)
  }
}

function checkStopped(run: AnalysisRun): void {
  if (runningStops.get(run.analysisHash)) {
    run.stage = 'cancelled'
    throw new Error('用户中止')
  }
}

async function executeFrom(run: AnalysisRun): Promise<void> {
  const evidence = JSON.parse(readFileSync(join(run.directory, 'evidence.json'), 'utf-8')) as EvidenceSnapshot

  // 阶段 1：为全部席位并发创建/恢复 session（每席位唯一，禁止按轮新建）
  if (!run.seats.every((s) => s.codexThreadId)) {
    logEvent(run, 'sessions_preparing', { seats: run.seats.map((s) => s.seatId) })
    await Promise.all(
      run.seats.map(async (seat) => {
        if (seat.codexThreadId) {
          const ok = await codex.resumeThread(seat.codexThreadId, run.directory)
          if (!ok) throw new Error(`席位 ${seat.seatId} 的 session 无法恢复（session_unrecoverable）`)
          return
        }
        const { threadId } = await codex.startThread({
          cwd: run.directory,
          developerInstructions: personaInstructions(seat.personaId)
        })
        seat.codexThreadId = threadId
      })
    )
    writeCodexSessions(run)
    logEvent(run, 'sessions_ready', {
      sessions: run.seats.map((s) => ({ seatId: s.seatId, threadId: s.codexThreadId }))
    })
    saveRun(run)
  }
  checkStopped(run)

  const speakers = speakerSeats(run)

  // 阶段 2：第一轮（solo 模式下即「大师分析」，完成后直接结束）
  if (!manifestSealed(run, 'turn01')) {
    await runRound(run, evidence, speakers, 'turn01')
  }
  checkStopped(run)

  if (run.mode !== 'solo') {
    // 阶段 3：第二轮互评
    if (!manifestSealed(run, 'turn02')) {
      await runRound(run, evidence, speakers, 'turn02')
    }
    checkStopped(run)

    // 阶段 4：主持终审
    if (!manifestSealed(run, 'final')) {
      await runFinalReview(run, evidence)
    }
  }

  run.stage = 'completed'
  run.error = null
  logEvent(run, 'analysis_completed')
  saveRun(run)
}

function manifestSealed(run: AnalysisRun, name: 'turn01' | 'turn02' | 'final'): boolean {
  return existsSync(join(run.directory, 'manifests', `${name}.json`))
}

function reportRequirements(round: 'turn01' | 'turn02', run: AnalysisRun, seat: AnalysisSeat): string {
  if (round === 'turn01') {
    return [
      run.mode === 'solo'
        ? '请以 Markdown 输出你的大师分析报告，结构至少包含以下章节：'
        : '请以 Markdown 输出你的第一轮独立研究报告，结构至少包含以下章节：',
      '## 核心结论（含置信度：高/中/低）',
      '## 关键事实（每条注明证据字段 ID 与数据时间）',
      '## 商业模式与护城河',
      '## 管理层与财务质量',
      '## 估值判断',
      '## 主要风险与未知项',
      '## 成立条件与失效条件',
      run.mode === 'solo' ? '## 建议投资者自查的问题' : '## 希望其他参与者重点挑战的问题',
      '',
      '要求：只使用证据快照中的数字；证据缺失处明确写"证据不足"；',
      '区分【事实】与【框架推断】；不给出确定目标价或收益承诺；使用简体中文。',
      '直接输出报告正文，不要输出与报告无关的说明。'
    ].join('\n')
  }
  return [
    '请以 Markdown 输出你的第二轮互评报告，结构至少包含：',
    '## 阅读回执（列出你读到的每份其他席位报告：席位 ID、角色名、报告哈希）',
    '## 对每份报告的逐项回应（每份至少回应一个具体观点：赞同/反对/补充/无法判断，并说明理由）',
    '## 相比第一轮的立场变化（新增、删除或修正的判断；若不变请说明为何不变）',
    '## 更新后的条件式结论（含置信度与仍未解决的问题）',
    '',
    '要求：不得只复述自己的首轮报告；仍然只引用证据快照内数字；使用简体中文。',
    '直接输出报告正文。'
  ].join('\n')
}

async function runRound(
  run: AnalysisRun,
  evidence: EvidenceSnapshot,
  speakers: AnalysisSeat[],
  round: 'turn01' | 'turn02'
): Promise<void> {
  run.stage = round === 'turn01' ? 'round1_running' : 'round2_running'
  saveRun(run)

  const roundBatchId = `${round}-${randomUUID().slice(0, 8)}`
  const scheduledAt = new Date().toISOString()

  // 第二轮：应用侧构建互评输入包（读取已封存 turn01）
  const turn01Reports = new Map<string, { content: string; hash: string }>()
  if (round === 'turn02') {
    for (const seat of speakers) {
      const p = join(run.directory, seat.directory, 'turn01.md')
      if (existsSync(p)) {
        const content = readFileSync(p, 'utf-8')
        turn01Reports.set(seat.seatId, { content, hash: sha256(content) })
      }
    }
  }

  interface SeatResult {
    seat: AnalysisSeat
    ok: boolean
    error: string | null
    content: string
    turnId: string
    dispatchedAt: string
    completedAt: string
    inputBundleHash: string
  }

  logEvent(run, `${round}_batch_dispatch`, {
    roundBatchId,
    expectedSeats: speakers.map((s) => s.seatId),
    scheduledAt
  })

  // 同一批次并发 fan-out，席位间无 await 依赖
  const results: SeatResult[] = await Promise.all(
    speakers.map(async (seat) => {
      const dispatchedAt = new Date().toISOString()
      seat.turnStatus[round] = 'running'
      saveRun(run)

      const parts: string[] = []
      if (round === 'turn01') {
        parts.push(
          run.mode === 'solo'
            ? `用户邀请你（角色：${seat.personaName}）对一只 A 股做独立的大师分析。`
            : `你是本次投资研究讨论的发言席「${seat.seatId}」（角色：${seat.personaName}）。`,
          `${run.mode === 'solo' ? '分析' : '讨论'}标的：${run.stockName}（${run.code}）。${run.topic ? `议题：${run.topic}。` : ''}`,
          evidenceToPromptBlock(evidence),
          reportRequirements('turn01', run, seat)
        )
      } else {
        const others = speakers.filter((s) => s.seatId !== seat.seatId)
        const bundle = others
          .map((o) => {
            const r = turn01Reports.get(o.seatId)
            if (!r) return `<同伴报告 seatId="${o.seatId}" 角色="${o.personaName}" 状态="缺席" />`
            return [
              `<同伴报告 seatId="${o.seatId}" 角色="${o.personaName}" sha256="${r.hash}">`,
              r.content,
              '</同伴报告>'
            ].join('\n')
          })
          .join('\n\n')
        const own = turn01Reports.get(seat.seatId)
        parts.push(
          `第二轮互评开始。你是发言席「${seat.seatId}」（角色：${seat.personaName}）。`,
          `你自己第一轮报告的哈希为 ${own?.hash ?? '未知'}。以下是其他席位已封存的第一轮报告全文：`,
          bundle,
          reportRequirements('turn02', run, seat)
        )
      }
      const inputText = parts.join('\n\n')
      const inputBundleHash = sha256(inputText)

      let buffer = ''
      const r = await codex.runTurn(seat.codexThreadId!, inputText, {
        timeoutMs: TURN_TIMEOUT_MS,
        onDelta: (d) => {
          buffer += d
        },
        onItem: (item) => recordActivity(run, seat, round, item)
      })
      const completedAt = new Date().toISOString()
      const ok = r.ok && buffer.trim().length > 200
      const error = r.ok && !ok ? '报告内容过短，校验失败' : r.error
      return { seat, ok, error, content: buffer, turnId: r.turnId, dispatchedAt, completedAt, inputBundleHash }
    })
  )

  // 应用侧校验、归档、哈希封存
  const manifest: Record<string, unknown> = {
    roundBatchId,
    expectedSeats: speakers.map((s) => s.seatId),
    scheduledAt,
    sealedAt: new Date().toISOString(),
    files: [] as Record<string, unknown>[]
  }
  const files = manifest.files as Record<string, unknown>[]
  let failures = 0
  for (const r of results) {
    const relPath = `${r.seat.directory}/${round}.md`
    if (r.ok) {
      const fm = frontmatter({
        analysisHash: run.analysisHash,
        artifactType: round,
        seatId: r.seat.seatId,
        personaId: r.seat.personaId,
        personaVersion: 'v1',
        sessionOwnerKey: `${run.analysisHash}+${r.seat.seatId}`,
        codexThreadId: r.seat.codexThreadId,
        codexSessionId: r.seat.codexThreadId,
        codexTurnId: r.turnId,
        purpose: round === 'turn01' ? 'round01' : 'round02',
        roundBatchId,
        evidenceHash: run.evidenceHash,
        inputBundleHash: r.inputBundleHash,
        createdAt: r.completedAt,
        status: 'completed'
      })
      const full = fm + '\n' + r.content.trim() + '\n'
      atomicWrite(join(run.directory, relPath), full)
      r.seat.turnStatus[round] = 'completed'
      files.push({
        seatId: r.seat.seatId,
        personaId: r.seat.personaId,
        path: relPath,
        sha256: sha256(full),
        bytes: Buffer.byteLength(full),
        codexThreadId: r.seat.codexThreadId,
        codexTurnId: r.turnId,
        roundBatchId,
        dispatchedAt: r.dispatchedAt,
        completedAt: r.completedAt,
        inputBundleHash: r.inputBundleHash,
        status: 'completed',
        error: null
      })
    } else {
      // 失败产物进入 _attempts/
      if (r.content) {
        const attempt = join(run.directory, r.seat.directory, '_attempts', `${round}-${Date.now()}.md`)
        try {
          writeFileSync(attempt, r.content)
        } catch {
          // 忽略
        }
      }
      failures++
      r.seat.turnStatus[round] = 'failed'
      files.push({
        seatId: r.seat.seatId,
        personaId: r.seat.personaId,
        path: relPath,
        sha256: null,
        status: 'failed',
        error: r.error,
        dispatchedAt: r.dispatchedAt,
        completedAt: r.completedAt
      })
    }
  }

  if (failures === results.length) {
    saveRun(run)
    throw new Error(`${round} 全部席位失败：${results.map((r) => r.error).filter(Boolean).join('；')}`)
  }

  atomicWrite(join(run.directory, 'manifests', `${round}.json`), JSON.stringify(manifest, null, 2))
  writeCodexSessions(run)
  run.stage = round === 'turn01' ? 'round1_locked' : 'round2_locked'
  if (failures > 0) {
    run.error = `${round} 有 ${failures} 个席位失败，已按缺席处理并封存`
  }
  logEvent(run, `${round}_sealed`, { roundBatchId, failures })
  saveRun(run)
}

async function runFinalReview(run: AnalysisRun, evidence: EvidenceSnapshot): Promise<void> {
  run.stage = 'moderating'
  saveRun(run)

  const moderator = run.seats.find((s) => s.seatId === 'moderator')!
  const speakers = speakerSeats(run)
  const moderatorIsSpeaker = speakers.some((s) => s.seatId === 'moderator')

  // 终审输入包：证据 + 全部封存报告 + manifest
  const docs: string[] = []
  const readDocs: { path: string; sha256: string }[] = []
  for (const round of ['turn01', 'turn02'] as const) {
    for (const seat of speakers) {
      const p = join(run.directory, seat.directory, `${round}.md`)
      if (existsSync(p)) {
        const content = readFileSync(p, 'utf-8')
        const hash = sha256(content)
        readDocs.push({ path: `${seat.directory}/${round}.md`, sha256: hash })
        docs.push(
          `<已封存报告 path="${seat.directory}/${round}.md" seatId="${seat.seatId}" 角色="${seat.personaName}" sha256="${hash}">\n${content}\n</已封存报告>`
        )
      }
    }
  }
  const absentSeats = speakers.filter((s) => s.turnStatus['turn01'] !== 'completed').map((s) => s.seatId)

  const prompt = [
    `第二轮已封存，现在进入主持终审。你是本次讨论的主持人（${moderator.personaName}）。`,
    moderatorIsSpeaker
      ? '注意：你同时参加了前两轮发言，终审报告首页必须披露这一双重角色及可能的框架偏向。'
      : '你未参加前两轮发言，仅负责终审。',
    evidenceToPromptBlock(evidence),
    docs.join('\n\n'),
    absentSeats.length ? `缺席席位：${absentSeats.join('、')}（其观点不得视为赞同任何结论）。` : '',
    '请以 Markdown 输出最终终审报告 final.md，结构至少包含：',
    '## 讨论完整性声明（analysis-hash、证据哈希、各席位完成/缺席状态、实际读取的文档及哈希）',
    '## 已验证事实摘要（不新增证据包之外的数字）',
    '## 各参与者观点变化（第一轮到第二轮）',
    '## 真正共识及其证据基础',
    '## 未解决分歧（分歧来自事实、假设还是价值框架）',
    '## 关键争议复盘与主持人裁定',
    '## 数据缺口与未知项',
    '## 投资逻辑成立条件与失效条件',
    '## 风险清单与建议的下一步研究动作',
    '## 最终条件式结论（可进入研究清单 / 等待条件 / 暂不满足 / 证据不足，四选一并说明）',
    '## 非投资建议声明',
    '',
    `本次 analysis-hash：${run.analysisHash}，证据哈希：${run.evidenceHash}。`,
    '不得改写参与者原文，不得把缺席视为赞同，不得按人数多数自动判定结论，不承诺收益。使用简体中文。',
    '直接输出报告正文。'
  ]
    .filter(Boolean)
    .join('\n\n')

  moderator.turnStatus['final'] = 'running'
  saveRun(run)
  logEvent(run, 'final_review_dispatch', { seatId: 'moderator', threadId: moderator.codexThreadId })

  let buffer = ''
  const r = await codex.runTurn(moderator.codexThreadId!, prompt, {
    timeoutMs: TURN_TIMEOUT_MS,
    onDelta: (d) => {
      buffer += d
    },
    onItem: (item) => recordActivity(run, moderator, 'final', item)
  })
  if (!r.ok || buffer.trim().length < 200) {
    moderator.turnStatus['final'] = 'failed'
    saveRun(run)
    throw new Error(`主持终审失败：${r.error ?? '报告过短'}`)
  }

  const completedAt = new Date().toISOString()
  const fm = frontmatter({
    analysisHash: run.analysisHash,
    artifactType: 'final',
    seatId: 'moderator',
    personaId: moderator.personaId,
    personaVersion: 'v1',
    sessionOwnerKey: `${run.analysisHash}+moderator`,
    codexThreadId: moderator.codexThreadId,
    codexSessionId: moderator.codexThreadId,
    codexTurnId: r.turnId,
    purpose: 'final-review',
    roundBatchId: null,
    evidenceHash: run.evidenceHash,
    inputBundleHash: sha256(prompt),
    createdAt: completedAt,
    status: 'completed'
  })
  const full = fm + '\n' + buffer.trim() + '\n'
  const relPath = `${moderator.directory}/final.md`
  atomicWrite(join(run.directory, relPath), full)
  moderator.turnStatus['final'] = 'completed'

  atomicWrite(
    join(run.directory, 'manifests', 'final.json'),
    JSON.stringify(
      {
        sealedAt: completedAt,
        file: { seatId: 'moderator', path: relPath, sha256: sha256(full), codexTurnId: r.turnId },
        readDocs,
        absentSeats
      },
      null,
      2
    )
  )
  writeCodexSessions(run)
  logEvent(run, 'final_sealed', {})
  saveRun(run)
}

// ---------- 报告读取 ----------
export function getArtifacts(analysisHash: string): AnalysisArtifact[] {
  const run = getRun(analysisHash)
  if (!run) return []
  const out: AnalysisArtifact[] = []
  for (const seat of run.seats) {
    for (const type of ['turn01', 'turn02', 'final'] as const) {
      const p = join(run.directory, seat.directory, `${type}.md`)
      if (existsSync(p)) {
        const content = readFileSync(p, 'utf-8')
        out.push({
          seatId: seat.seatId,
          personaName: seat.personaName,
          type,
          path: p,
          content,
          sha256: sha256(content)
        })
      }
    }
  }
  return out
}
