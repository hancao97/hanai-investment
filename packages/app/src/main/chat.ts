import { randomUUID } from 'node:crypto'
import { getDb } from './db'
import { codex } from './codex'
import { personaInstructions, getPersona } from './personas'
import { createEvidenceSnapshot, getEvidenceSnapshot, evidenceToPromptBlock } from './evidence'
import type { Conversation, ChatMessage, StreamEvent, AgentActivityItem } from '../shared/types'

type Emit = (e: StreamEvent) => void
let emit: Emit = () => {}
export function setChatEmitter(fn: Emit): void {
  emit = fn
}

// conversationId -> 活动 turn
const activeTurns = new Map<string, { threadId: string; turnId: string | null }>()

interface ConvRow {
  id: string
  persona_id: string
  title: string
  sec_id: string | null
  evidence_id: string | null
  codex_thread_id: string | null
  created_at: string
  updated_at: string
}

interface MsgRow {
  id: string
  conversation_id: string
  role: string
  content: string
  status: string
  created_at: string
  activity: string | null
}

function rowToConv(r: ConvRow, messages: ChatMessage[] = []): Conversation {
  return {
    id: r.id,
    personaId: r.persona_id,
    title: r.title,
    secId: r.sec_id,
    evidenceId: r.evidence_id,
    codexThreadId: r.codex_thread_id,
    messages,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

function rowToMsg(r: MsgRow): ChatMessage {
  let activity: AgentActivityItem[] | undefined
  if (r.activity) {
    try {
      activity = JSON.parse(r.activity) as AgentActivityItem[]
    } catch {
      activity = undefined
    }
  }
  return {
    id: r.id,
    role: r.role as ChatMessage['role'],
    content: r.content,
    status: r.status as ChatMessage['status'],
    createdAt: r.created_at,
    activity
  }
}

export function listConversations(personaId?: string): Conversation[] {
  const db = getDb()
  const rows = (
    personaId
      ? db.prepare('SELECT * FROM conversations WHERE persona_id = ? ORDER BY updated_at DESC').all(personaId)
      : db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all()
  ) as ConvRow[]
  return rows.map((r) => rowToConv(r))
}

export function getConversation(id: string): Conversation | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as ConvRow | undefined
  if (!row) return null
  const msgs = db
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at')
    .all(id) as MsgRow[]
  return rowToConv(row, msgs.map(rowToMsg))
}

export async function createConversation(personaId: string, secId?: string | null): Promise<Conversation> {
  const persona = getPersona(personaId)
  if (!persona) throw new Error(`未找到角色: ${personaId}`)
  const now = new Date().toISOString()
  const id = randomUUID()
  let evidenceId: string | null = null
  let title = `与${persona.name}的对话`
  if (secId) {
    const ev = await createEvidenceSnapshot(secId)
    evidenceId = ev.id
    title = `${ev.name}（${ev.code}）· ${persona.name}`
  }
  getDb()
    .prepare(
      `INSERT INTO conversations(id, persona_id, title, sec_id, evidence_id, codex_thread_id, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?, NULL, ?, ?)`
    )
    .run(id, personaId, title, secId ?? null, evidenceId, now, now)
  return getConversation(id)!
}

export function renameConversation(id: string, title: string): void {
  getDb().prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, id)
}

export function deleteConversation(id: string): void {
  const db = getDb()
  db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(id)
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
}

function insertMessage(convId: string, msg: ChatMessage): void {
  getDb()
    .prepare('INSERT INTO messages(id, conversation_id, role, content, status, created_at) VALUES(?, ?, ?, ?, ?, ?)')
    .run(msg.id, convId, msg.role, msg.content, msg.status, msg.createdAt)
}

function updateMessage(
  id: string,
  content: string,
  status: ChatMessage['status'],
  activity?: AgentActivityItem[]
): void {
  getDb()
    .prepare('UPDATE messages SET content = ?, status = ?, activity = ? WHERE id = ?')
    .run(content, status, activity?.length ? JSON.stringify(activity) : null, id)
}

function touchConversation(id: string): void {
  getDb().prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), id)
}

export async function sendMessage(conversationId: string, text: string): Promise<ChatMessage> {
  const conv = getConversation(conversationId)
  if (!conv) throw new Error('会话不存在')
  if (!codex.isReady()) throw new Error('Codex 不可用，请先在设置中检查 Codex 状态')

  const now = new Date().toISOString()
  const userMsg: ChatMessage = { id: randomUUID(), role: 'user', content: text, status: 'done', createdAt: now }
  insertMessage(conversationId, userMsg)

  // 首条消息前创建 thread 并注入角色定义
  let threadId = conv.codexThreadId
  const isFirst = !threadId
  if (!threadId) {
    const created = await codex.startThread({
      developerInstructions: personaInstructions(conv.personaId)
    })
    threadId = created.threadId
    getDb().prepare('UPDATE conversations SET codex_thread_id = ? WHERE id = ?').run(threadId, conversationId)
  } else {
    await codex.resumeThread(threadId)
  }

  const parts: string[] = []
  if (isFirst && conv.evidenceId) {
    const ev = getEvidenceSnapshot(conv.evidenceId)
    if (ev) parts.push(evidenceToPromptBlock(ev))
  }
  if (isFirst) {
    parts.push(
      '提示：这是本会话第一条消息。回复开头用一句话声明你是基于公开资料的 AI 模拟视角（之后的回复不再重复）。' +
        '回复中区分【事实】【框架推断】【信息不足】。'
    )
  }
  parts.push(text)

  const assistantMsg: ChatMessage = {
    id: randomUUID(),
    role: 'assistant',
    content: '',
    status: 'streaming',
    createdAt: new Date().toISOString()
  }
  insertMessage(conversationId, assistantMsg)
  touchConversation(conversationId)

  activeTurns.set(conversationId, { threadId, turnId: null })
  let buffer = ''
  const activity: AgentActivityItem[] = []

  let stopped = false
  void codex.runTurn(threadId, parts.join('\n\n'), {
    onTurnStarted: (turnId) => {
      const at = activeTurns.get(conversationId)
      if (at) at.turnId = turnId
    },
    onDelta: (delta) => {
      buffer += delta
      emit({ type: 'chat-delta', conversationId, messageId: assistantMsg.id, delta })
    },
    onItem: (item) => {
      activity.push(item)
      emit({ type: 'chat-activity', conversationId, messageId: assistantMsg.id, item })
    },
    onCompleted: () => {
      updateMessage(assistantMsg.id, buffer, stopped ? 'interrupted' : 'done', activity)
      activeTurns.delete(conversationId)
      touchConversation(conversationId)
      emit({ type: 'chat-done', conversationId, messageId: assistantMsg.id })
    },
    onFailed: (err) => {
      updateMessage(assistantMsg.id, buffer, buffer ? 'interrupted' : 'error', activity)
      activeTurns.delete(conversationId)
      emit({ type: 'chat-error', conversationId, messageId: assistantMsg.id, error: err })
    }
  })

  const markStopped = (): void => {
    stopped = true
  }
  stopHooks.set(conversationId, markStopped)

  return assistantMsg
}

const stopHooks = new Map<string, () => void>()

export async function stopMessage(conversationId: string): Promise<void> {
  const at = activeTurns.get(conversationId)
  if (!at) return
  stopHooks.get(conversationId)?.()
  const conv = getConversation(conversationId)
  if (conv?.codexThreadId && at.turnId) {
    await codex.interruptTurn(conv.codexThreadId, at.turnId)
  }
}
