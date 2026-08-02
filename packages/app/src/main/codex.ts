import { spawn, execFile, type ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createInterface } from 'node:readline'
import { WORKDIR } from './paths'
import type { CodexState, AgentActivityItem } from '../shared/types'

type Json = Record<string, unknown>

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

export interface TurnHandlers {
  onDelta?: (delta: string, itemId: string) => void
  onReasoningDelta?: (delta: string, itemId: string) => void
  onItem?: (item: AgentActivityItem) => void
  onCompleted?: (turn: Json) => void
  onFailed?: (error: string) => void
}

/** 把 codex ThreadItem 转成 UI 可展示的活动条目 */
function toActivityItem(raw: Json, status: 'started' | 'completed'): AgentActivityItem | null {
  const type = String(raw.type ?? '')
  const id = String(raw.id ?? '')
  let summary = ''
  let detail: string | null = null
  let finalStatus: AgentActivityItem['status'] = status
  switch (type) {
    case 'commandExecution': {
      const cmd = String(raw.command ?? '')
      summary = status === 'started' ? '运行命令' : '命令执行完成'
      detail = cmd
      const output = String(raw.aggregatedOutput ?? '').trim()
      if (status === 'completed' && output) detail = `${cmd}\n\n${output.slice(0, 6000)}`
      if (status === 'completed' && raw.exitCode != null && Number(raw.exitCode) !== 0) {
        finalStatus = 'failed'
        summary = `命令失败（exit ${raw.exitCode}）`
      }
      break
    }
    case 'reasoning': {
      if (status === 'started') return null
      const sum = Array.isArray(raw.summary) ? raw.summary.join('\n') : String(raw.summary ?? '')
      if (!sum.trim()) return null
      summary = '分析思路'
      detail = sum
      break
    }
    case 'agentMessage': {
      if (status === 'started') return null
      summary = 'Codex'
      const text = String(raw.text ?? '')
      detail = text || null
      break
    }
    case 'webSearch':
      summary = `联网搜索`
      detail = String(raw.query ?? '')
      break
    case 'fileChange': {
      const changes = Array.isArray(raw.changes) ? raw.changes.length : 0
      summary = status === 'started' ? '修改文件' : `文件修改完成（${changes} 处）`
      break
    }
    case 'mcpToolCall':
      summary = `调用工具 ${String(raw.server ?? '')}/${String(raw.tool ?? '')}`
      break
    case 'dynamicToolCall':
      summary = `调用工具 ${String(raw.tool ?? '')}`
      break
    case 'plan': {
      if (status === 'started') return null
      summary = '更新计划'
      detail = String(raw.text ?? '') || null
      break
    }
    case 'imageView':
    case 'userMessage':
    case 'hookPrompt':
      return null
    case 'contextCompaction':
      if (status === 'started') return null
      summary = '已整理对话上下文'
      break
    default:
      if (status === 'started') return null
      summary = type
  }
  return { id: id || `${type}-${Date.now()}`, type, status: finalStatus, summary, detail, at: new Date().toISOString() }
}

const APP_SERVER_ARGS = ['app-server']

export class CodexManager {
  private proc: ChildProcessByStdio<Writable, Readable, Readable> | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private turnHandlers = new Map<string, TurnHandlers>() // key: threadId
  private state: CodexState = {
    status: 'connecting',
    version: null,
    path: null,
    account: null,
    models: [],
    selectedModel: null,
    lastError: null,
    modelCatalogError: null
  }
  private onStateChange: (s: CodexState) => void = () => {}
  private starting: Promise<void> | null = null

  setStateListener(cb: (s: CodexState) => void): void {
    this.onStateChange = cb
  }

  getState(): CodexState {
    return { ...this.state }
  }

  setModel(model: string | null): void {
    this.state.selectedModel = model
    this.emitState()
  }

  private emitState(): void {
    this.onStateChange(this.getState())
  }

  private setStatus(status: CodexState['status'], error: string | null = null): void {
    this.state.status = status
    this.state.lastError = error
    this.emitState()
  }

  // ---------- 环境检测 ----------
  private findBinary(): string | null {
    const candidates = [
      ...(process.env.PATH ?? '').split(':').map((d) => join(d, 'codex')),
      '/opt/homebrew/bin/codex',
      '/usr/local/bin/codex',
      join(homedir(), '.local/bin/codex'),
      join(homedir(), '.npm-global/bin/codex')
    ]
    for (const c of candidates) {
      if (c && existsSync(c)) return c
    }
    return null
  }

  private detectVersion(bin: string): Promise<string | null> {
    return new Promise((resolve) => {
      execFile(bin, ['--version'], { timeout: 8000 }, (err, stdout) => {
        if (err) return resolve(null)
        const m = stdout.match(/(\d+\.\d+\.\d+)/)
        resolve(m ? m[1] : stdout.trim() || null)
      })
    })
  }

  // ---------- 生命周期 ----------
  async start(): Promise<void> {
    if (this.starting) return this.starting
    this.starting = this.doStart().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async doStart(): Promise<void> {
    this.setStatus('connecting')
    this.state.modelCatalogError = null
    const bin = this.findBinary()
    if (!bin) {
      this.state.path = null
      this.setStatus('not-installed', '未在 PATH 或常见安装位置找到 codex 可执行文件')
      return
    }
    this.state.path = bin
    const version = await this.detectVersion(bin)
    if (!version) {
      this.setStatus('error', '无法读取 codex 版本（执行 codex --version 失败）')
      return
    }
    this.state.version = version

    try {
      this.proc = spawn(bin, APP_SERVER_ARGS, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
      }) as ChildProcessByStdio<Writable, Readable, Readable>
    } catch (e) {
      this.setStatus('error', `启动 app-server 失败: ${e instanceof Error ? e.message : e}`)
      return
    }

    const proc = this.proc
    const rl = createInterface({ input: proc.stdout })
    rl.on('line', (line) => this.handleLine(line))
    proc.stderr.on('data', (chunk) => {
      const line = String(chunk)
      if (line.includes('failed to load models cache')) {
        this.state.modelCatalogError =
          '当前 Codex CLI 无法解析最新模型目录（通常是 CLI 版本过旧），因此新模型可能缺失。请升级 @openai/codex 后重启检测。'
        this.emitState()
      }
    })
    proc.on('exit', (code) => {
      if (this.proc !== proc) return
      this.proc = null
      for (const p of this.pending.values()) p.reject(new Error('codex app-server 已退出'))
      this.pending.clear()
      if (this.state.status !== 'not-installed') {
        this.setStatus('error', `codex app-server 进程退出（code=${code ?? '未知'}），可在设置中重启`)
      }
    })

    try {
      await this.request('initialize', {
        clientInfo: { name: 'hanai-investment', title: 'Hanai Investment', version: '0.1.0' }
      })
      this.notify('initialized', {})
      const account = (await this.request('account/read', { refreshToken: false })) as Json
      const acct = account?.account as Json | undefined
      if (!acct) {
        this.setStatus('not-logged-in', '本机 Codex 未登录，请先在终端运行 codex 登录')
        return
      }
      this.state.account = {
        type: String(acct.type ?? 'unknown'),
        email: typeof acct.email === 'string' ? acct.email : null,
        plan: typeof acct.planType === 'string' ? acct.planType : null
      }
      try {
        const models = (await this.request('model/list', { includeHidden: false })) as { data?: Json[] }
        this.state.models = (models.data ?? [])
          .map((m) => ({
            id: String(m.model ?? m.id ?? ''),
            displayName: String(m.displayName ?? m.model ?? m.id ?? '')
          }))
          .filter((m) => m.id)
        const def = (models.data ?? []).find((m) => m.isDefault === true)
        if (!this.state.selectedModel || !this.state.models.some((m) => m.id === this.state.selectedModel)) {
          this.state.selectedModel = def ? String(def.model ?? def.id) : (this.state.models[0]?.id ?? null)
        }
      } catch (e) {
        this.state.models = []
        this.state.modelCatalogError = e instanceof Error ? e.message : String(e)
      }
      this.setStatus('ready')
    } catch (e) {
      this.setStatus('error', `app-server 握手失败: ${e instanceof Error ? e.message : e}`)
    }
  }

  async restart(): Promise<void> {
    const old = this.proc
    if (old) {
      this.proc = null
      const exited = new Promise<void>((resolve) => old.once('exit', () => resolve()))
      old.kill()
      await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 2000))])
    }
    await this.start()
  }

  isReady(): boolean {
    return this.state.status === 'ready' && this.proc !== null
  }

  // ---------- JSON-RPC ----------
  private send(msg: Json): void {
    if (!this.proc) throw new Error('codex app-server 未运行')
    this.proc.stdin.write(JSON.stringify(msg) + '\n')
  }

  request(method: string, params: Json, timeoutMs = 60000): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`请求超时: ${method}`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer)
          resolve(v)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        }
      })
      try {
        this.send({ jsonrpc: '2.0', id, method, params })
      } catch (e) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  }

  private notify(method: string, params: Json): void {
    this.send({ jsonrpc: '2.0', method, params })
  }

  private respond(id: unknown, result: Json): void {
    this.send({ jsonrpc: '2.0', id: id as number, result })
  }

  private handleLine(line: string): void {
    let msg: Json
    try {
      msg = JSON.parse(line) as Json
    } catch {
      return
    }
    if (msg.id != null && (msg.result !== undefined || msg.error !== undefined)) {
      const p = this.pending.get(msg.id as number)
      if (p) {
        this.pending.delete(msg.id as number)
        if (msg.error !== undefined) {
          const err = msg.error as Json
          p.reject(new Error(String(err?.message ?? JSON.stringify(err))))
        } else {
          p.resolve(msg.result)
        }
      }
      return
    }
    if (msg.id != null && msg.method) {
      void this.handleServerRequest(msg)
      return
    }
    if (msg.method) {
      this.handleNotification(String(msg.method), (msg.params ?? {}) as Json)
    }
  }

  // ---------- 服务器请求 ----------
  private async handleServerRequest(msg: Json): Promise<void> {
    const method = String(msg.method)
    const params = (msg.params ?? {}) as Json

    if (method === 'item/commandExecution/requestApproval' || method === 'execCommandApproval') {
      if (method === 'execCommandApproval') {
        this.respond(msg.id, { decision: 'approved' })
      } else {
        this.respond(msg.id, { decision: 'accept' })
      }
      return
    }
    if (method === 'item/fileChange/requestApproval' || method === 'applyPatchApproval') {
      if (method === 'applyPatchApproval') {
        this.respond(msg.id, { decision: 'approved' })
      } else {
        this.respond(msg.id, { decision: 'accept' })
      }
      return
    }
    if (method === 'item/permissions/requestApproval') {
      const requested = (params.permissions ?? {}) as Json
      this.respond(msg.id, {
        permissions: {
          ...(requested.network ? { network: requested.network } : {}),
          ...(requested.fileSystem ? { fileSystem: requested.fileSystem } : {})
        },
        scope: 'session'
      })
      return
    }
    if (method === 'item/tool/requestUserInput') {
      this.respond(msg.id, { answers: {} })
      return
    }
    // 未知服务器请求：返回空对象避免挂起
    this.respond(msg.id, {})
  }

  // ---------- 通知 ----------
  private handleNotification(method: string, params: Json): void {
    const threadId = String(params.threadId ?? '')
    const h = this.turnHandlers.get(threadId)
    if (!h) return
    if (method === 'item/agentMessage/delta') {
      h.onDelta?.(String(params.delta ?? ''), String(params.itemId ?? ''))
    } else if (method === 'item/reasoning/summaryTextDelta' || method === 'item/reasoning/textDelta') {
      h.onReasoningDelta?.(String(params.delta ?? ''), String(params.itemId ?? ''))
    } else if (method === 'item/started' || method === 'item/completed') {
      const item = toActivityItem((params.item ?? {}) as Json, method === 'item/started' ? 'started' : 'completed')
      if (item) h.onItem?.(item)
    } else if (method === 'turn/completed') {
      const turn = (params.turn ?? {}) as Json
      const status = String(turn.status ?? '')
      if (status === 'failed' || status === 'error') {
        const err = turn.error as Json | undefined
        h.onFailed?.(String(err?.message ?? '轮次失败'))
      } else {
        h.onCompleted?.(turn)
      }
    } else if (method === 'error') {
      // willRetry=true 表示 codex 正在自动重连，不视为失败
      if (params.willRetry === true) return
      const err = params as Json
      const message = String((err.error as Json | undefined)?.message ?? err.message ?? '未知错误')
      h.onFailed?.(message)
    }
  }

  // ---------- 线程与轮次 ----------
  async startThread(opts: {
    cwd?: string
    developerInstructions?: string
    model?: string | null
    ephemeral?: boolean
  }): Promise<{ threadId: string }> {
    const result = (await this.request('thread/start', {
      cwd: opts.cwd ?? WORKDIR,
      developerInstructions: opts.developerInstructions ?? null,
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
      model: opts.model ?? this.state.selectedModel,
      ephemeral: opts.ephemeral ?? false
    })) as Json
    const thread = result.thread as Json
    return { threadId: String(thread.id) }
  }

  async resumeThread(threadId: string, cwd?: string): Promise<boolean> {
    try {
      await this.request('thread/resume', {
        threadId,
        cwd: cwd ?? null,
        approvalPolicy: 'never',
        sandbox: 'danger-full-access'
      })
      return true
    } catch {
      return false
    }
  }

  registerThreadHandlers(threadId: string, handlers: TurnHandlers): void {
    this.turnHandlers.set(threadId, handlers)
  }

  unregisterThreadHandlers(threadId: string): void {
    this.turnHandlers.delete(threadId)
  }

  async startTurn(threadId: string, text: string): Promise<{ turnId: string }> {
    const result = (await this.request(
      'turn/start',
      { threadId, input: [{ type: 'text', text }] },
      120000
    )) as Json
    const turn = result.turn as Json
    return { turnId: String(turn.id) }
  }

  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    try {
      await this.request('turn/interrupt', { threadId, turnId }, 10000)
    } catch {
      // 中止失败不阻塞 UI
    }
  }

  async archiveThread(threadId: string): Promise<void> {
    try {
      await this.request('thread/archive', { threadId }, 30000)
    } catch {
      // 研判报告已落盘时，Codex 线程归档失败不影响本地归档
    }
  }

  /** 运行一个完整轮次：发起 turn 并等待完成，流式回调 onDelta */
  runTurn(
    threadId: string,
    text: string,
    handlers: TurnHandlers & { timeoutMs?: number; onTurnStarted?: (turnId: string) => void }
  ): Promise<{ turnId: string; ok: boolean; error: string | null }> {
    const timeoutMs = handlers.timeoutMs ?? 15 * 60 * 1000
    return new Promise((resolve) => {
      let turnId = ''
      let settled = false
      const finish = (ok: boolean, error: string | null): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.unregisterThreadHandlers(threadId)
        resolve({ turnId, ok, error })
      }
      const timer = setTimeout(() => {
        if (turnId) void this.interruptTurn(threadId, turnId)
        finish(false, '轮次超时')
      }, timeoutMs)
      this.registerThreadHandlers(threadId, {
        onDelta: handlers.onDelta,
        onReasoningDelta: handlers.onReasoningDelta,
        onItem: handlers.onItem,
        onCompleted: (turn) => {
          handlers.onCompleted?.(turn)
          finish(true, null)
        },
        onFailed: (err) => {
          handlers.onFailed?.(err)
          finish(false, err)
        }
      })
      this.startTurn(threadId, text)
        .then((r) => {
          turnId = r.turnId
          handlers.onTurnStarted?.(r.turnId)
        })
        .catch((e) => finish(false, e instanceof Error ? e.message : String(e)))
    })
  }
}

export const codex = new CodexManager()
