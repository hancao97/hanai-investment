<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import MarkdownIt from 'markdown-it'
import type { Conversation, Persona, AgentActivityItem } from '@shared/types'
import { useAppStore } from '../stores/app'
import PersonaPicker from '../components/PersonaPicker.vue'
import { fmtDateTime } from '../utils/format'

const md = new MarkdownIt({ breaks: true, linkify: false, html: false })

const route = useRoute()
const router = useRouter()
const app = useAppStore()

const conversations = ref<Conversation[]>([])
const current = ref<Conversation | null>(null)
const input = ref('')
const sending = ref(false)
const pickerOpen = ref(false)
const scrollEl = ref<HTMLDivElement | null>(null)
let offStream: (() => void) | null = null

const conversationId = computed(() => String(route.params.conversationId ?? ''))

const persona = computed<Persona | null>(
  () => app.personas.find((p) => p.id === current.value?.personaId) ?? null
)

const isStreaming = computed(() => current.value?.messages.some((m) => m.status === 'streaming') ?? false)

async function loadList(): Promise<void> {
  conversations.value = await window.hanai.chat.list()
}

async function loadCurrent(): Promise<void> {
  if (!conversationId.value) {
    current.value = null
    return
  }
  current.value = await window.hanai.chat.get(conversationId.value)
  await nextTick()
  scrollToBottom()
}

function scrollToBottom(): void {
  if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight
}

watch(conversationId, () => void loadCurrent())

onMounted(async () => {
  await loadList()
  await loadCurrent()
  offStream = app.onStream((e) => {
    if (e.type === 'chat-delta' && e.conversationId === current.value?.id) {
      const msg = current.value.messages.find((m) => m.id === e.messageId)
      if (msg) {
        msg.content += e.delta
        void nextTick(scrollToBottom)
      }
    } else if (e.type === 'chat-activity' && e.conversationId === current.value?.id) {
      const msg = current.value.messages.find((m) => m.id === e.messageId)
      if (msg) {
        if (!msg.activity) msg.activity = []
        msg.activity.push(e.item)
        void nextTick(scrollToBottom)
      }
    } else if ((e.type === 'chat-done' || e.type === 'chat-error') && e.conversationId === current.value?.id) {
      const msg = current.value.messages.find((m) => m.id === e.messageId)
      if (msg) msg.status = e.type === 'chat-done' ? 'done' : 'error'
      sending.value = false
      void loadList()
    }
  })
})
onBeforeUnmount(() => offStream?.())

async function send(): Promise<void> {
  const text = input.value.trim()
  if (!text || !current.value || sending.value) return
  sending.value = true
  input.value = ''
  current.value.messages.push({
    id: `local-${Date.now()}`,
    role: 'user',
    content: text,
    status: 'done',
    createdAt: new Date().toISOString()
  })
  await nextTick()
  scrollToBottom()
  try {
    const assistantMsg = await window.hanai.chat.send(current.value.id, text)
    current.value.messages.push({ ...assistantMsg, content: '' })
  } catch (e) {
    current.value.messages.push({
      id: `err-${Date.now()}`,
      role: 'system',
      content: `发送失败：${e instanceof Error ? e.message : e}`,
      status: 'error',
      createdAt: new Date().toISOString()
    })
    sending.value = false
  }
  await nextTick()
  scrollToBottom()
}

async function stop(): Promise<void> {
  if (current.value) await window.hanai.chat.stop(current.value.id)
}

async function newChat(personaId: string): Promise<void> {
  pickerOpen.value = false
  const conv = await window.hanai.chat.create(personaId)
  await loadList()
  void router.push(`/chat/${conv.id}`)
}

// Electron 渲染进程不支持 window.confirm，采用二次点击确认
const confirmingDelete = ref('')
let confirmTimer: ReturnType<typeof setTimeout> | null = null

async function removeConversation(id: string): Promise<void> {
  if (confirmingDelete.value !== id) {
    confirmingDelete.value = id
    if (confirmTimer) clearTimeout(confirmTimer)
    confirmTimer = setTimeout(() => {
      confirmingDelete.value = ''
    }, 3000)
    return
  }
  confirmingDelete.value = ''
  await window.hanai.chat.delete(id)
  await loadList()
  if (conversationId.value === id) void router.push('/chat')
}

function personaOf(conv: Conversation): Persona | null {
  return app.personas.find((p) => p.id === conv.personaId) ?? null
}

function render(content: string): string {
  return md.render(content)
}

// ---------- 分析过程展示 ----------
const ACTIVITY_ICONS: Record<string, string> = {
  commandExecution: '❯',
  reasoning: '◔',
  agentMessage: '✎',
  webSearch: '⌕',
  fileChange: '±',
  mcpToolCall: '⚙',
  plan: '☰'
}

// messageId -> 是否展开（流式中默认展开，完成后默认收起）
const processOpen = ref<Record<string, boolean>>({})

function isProcessOpen(m: { id: string; status: string }): boolean {
  return processOpen.value[m.id] ?? m.status === 'streaming'
}

function toggleProcess(m: { id: string; status: string }): void {
  processOpen.value = { ...processOpen.value, [m.id]: !isProcessOpen(m) }
}

function lastActivity(m: { activity?: AgentActivityItem[] }): AgentActivityItem | null {
  return m.activity?.length ? m.activity[m.activity.length - 1] : null
}
</script>

<template>
  <div class="chat-layout">
    <!-- 会话列表 -->
    <aside class="conv-list">
      <div class="conv-header">
        <span>会话</span>
        <button class="btn small primary" @click="pickerOpen = true">＋ 新对话</button>
      </div>
      <div class="conv-scroll">
        <div
          v-for="c in conversations"
          :key="c.id"
          class="conv-item"
          :class="{ active: c.id === conversationId }"
          @click="router.push(`/chat/${c.id}`)"
        >
          <span
            class="conv-avatar"
            :style="{ color: personaOf(c)?.color ?? '#8b93a7', borderColor: personaOf(c)?.color ?? '#8b93a7' }"
          >
            {{ personaOf(c)?.shortName ?? '?' }}
          </span>
          <div class="conv-info">
            <div class="conv-title">{{ c.title }}</div>
            <div class="conv-time">{{ fmtDateTime(c.updatedAt) }}</div>
          </div>
          <button
            class="conv-del"
            :class="{ confirming: confirmingDelete === c.id }"
            :title="confirmingDelete === c.id ? '再次点击确认删除' : '删除'"
            @click.stop="removeConversation(c.id)"
          >
            {{ confirmingDelete === c.id ? '确认?' : '×' }}
          </button>
        </div>
        <div v-if="!conversations.length" class="empty">暂无会话<br />点击「新对话」选择一位大师</div>
      </div>
    </aside>

    <!-- 对话区 -->
    <div class="chat-main">
      <template v-if="current">
        <header class="chat-head">
          <span
            class="conv-avatar big"
            :style="{ color: persona?.color ?? '#8b93a7', borderColor: persona?.color ?? '#8b93a7' }"
          >
            {{ persona?.shortName ?? '?' }}
          </span>
          <div>
            <div class="chat-title">{{ current.title }}</div>
            <div class="meta-line">
              AI 模拟视角 · 非本人
              <template v-if="current.secId">
                · 已绑定证据快照
                <button class="link" @click="router.push(`/stock/${current.secId}`)">查看股票</button>
              </template>
            </div>
          </div>
        </header>

        <div ref="scrollEl" class="messages">
          <div v-if="current.evidenceId" class="evidence-note">
            本会话绑定了生成时刻的不可变证据快照（行情 / 基本面 / 估值），角色回答中的数字均应来自该快照。
          </div>
          <div v-for="m in current.messages" :key="m.id" class="msg" :class="m.role">
            <div v-if="m.role === 'assistant'" class="msg-avatar" :style="{ color: persona?.color, borderColor: persona?.color }">
              {{ persona?.shortName }}
            </div>
            <div class="bubble">
              <!-- agent 分析过程（实时可展开） -->
              <div v-if="m.role === 'assistant' && m.activity?.length" class="process-box">
                <button class="process-head" @click="toggleProcess(m)">
                  <span class="chev">{{ isProcessOpen(m) ? '▾' : '▸' }}</span>
                  分析过程（{{ m.activity.length }} 步）
                  <span v-if="m.status === 'streaming' && lastActivity(m)" class="process-latest">
                    {{ lastActivity(m)!.summary }}
                  </span>
                </button>
                <div v-if="isProcessOpen(m)" class="process-list">
                  <div v-for="a in m.activity" :key="a.id" class="process-item" :class="a.status">
                    <span class="pi-icon">{{ ACTIVITY_ICONS[a.type] ?? '·' }}</span>
                    <div class="pi-body">
                      <div class="pi-summary">{{ a.summary }}</div>
                      <pre v-if="a.detail" class="pi-detail">{{ a.detail }}</pre>
                    </div>
                  </div>
                </div>
              </div>
              <div v-if="m.role === 'assistant'" class="md" v-html="render(m.content || '…')" />
              <template v-else>{{ m.content }}</template>
              <div v-if="m.status === 'streaming'" class="streaming-hint">
                <span class="pulse" /> {{ m.activity?.length ? '分析中…点上方查看过程，可随时停止' : '思考中…可随时停止' }}
              </div>
              <div v-else-if="m.status === 'interrupted'" class="meta-line">已停止（保留已完成内容）</div>
              <div v-else-if="m.status === 'error'" class="meta-line" style="color: var(--danger)">生成失败</div>
            </div>
          </div>
          <div v-if="!current.messages.length" class="empty" style="padding-top: 80px">
            <div style="font-size: 15px; color: var(--text-secondary)">与{{ persona?.name }}开始对话</div>
            <div v-if="persona?.defaultPrompt" class="prompt-suggestion" @click="input = persona!.defaultPrompt!">
              {{ persona.defaultPrompt }}
            </div>
          </div>
        </div>

        <footer class="composer">
          <textarea
            v-model="input"
            class="field"
            rows="2"
            :placeholder="`向${persona?.name ?? '角色'}提问… (Enter 发送，Shift+Enter 换行)`"
            @keydown.enter.exact.prevent="send"
          />
          <div class="composer-actions">
            <button v-if="isStreaming" class="btn danger" @click="stop">停止</button>
            <button v-else class="btn primary" :disabled="!input.trim() || sending" @click="send">发送</button>
          </div>
        </footer>
      </template>

      <div v-else class="empty" style="height: 100%">
        <div style="font-size: 15px">选择或创建一个会话</div>
        <button class="btn primary" @click="pickerOpen = true">＋ 新对话</button>
      </div>
    </div>

    <PersonaPicker v-model:open="pickerOpen" @pick="newChat" />
  </div>
</template>

<style scoped>
.chat-layout {
  display: flex;
  height: 100%;
}
.conv-list {
  width: 250px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
}
.conv-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 14px 10px;
  font-size: 13px;
  font-weight: 600;
}
.conv-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 12px;
}
.conv-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 10px;
  border-radius: var(--radius-m);
  cursor: pointer;
  position: relative;
}
.conv-item:hover {
  background: var(--bg-hover);
}
.conv-item.active {
  background: var(--bg-active);
}
.conv-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1.5px solid;
  background: var(--bg-raised-2);
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.conv-avatar.big {
  width: 36px;
  height: 36px;
  font-size: 14px;
}
.conv-info {
  flex: 1;
  min-width: 0;
}
.conv-title {
  font-size: 12.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.conv-time {
  font-size: 10.5px;
  color: var(--text-muted);
}
.conv-del {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 15px;
  opacity: 0;
  transition: opacity 0.15s;
}
.conv-item:hover .conv-del,
.conv-del.confirming {
  opacity: 1;
}
.conv-del.confirming {
  color: var(--danger);
  font-size: 11px;
}
.conv-del:hover {
  color: var(--danger);
}

.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.chat-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border-subtle);
}
.chat-title {
  font-size: 14px;
  font-weight: 600;
}
.link {
  background: none;
  border: none;
  color: var(--accent-strong);
  cursor: pointer;
  font-size: 11px;
  padding: 0;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 18px 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.evidence-note {
  align-self: center;
  font-size: 11px;
  color: var(--text-muted);
  background: var(--bg-raised);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-m);
  padding: 6px 14px;
  max-width: 560px;
  text-align: center;
}
.msg {
  display: flex;
  gap: 10px;
  max-width: 88%;
}
.msg.user {
  align-self: flex-end;
}
.msg.system {
  align-self: center;
}
.msg-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1.5px solid;
  background: var(--bg-raised-2);
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;
}
.bubble {
  background: var(--bg-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-l);
  padding: 10px 14px;
  font-size: 13px;
  min-width: 60px;
}
.msg.user .bubble {
  background: var(--accent-dim);
  border-color: rgba(224, 179, 76, 0.25);
  white-space: pre-wrap;
}
.msg.system .bubble {
  color: var(--danger);
  font-size: 12px;
}
.streaming-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--accent);
  margin-top: 6px;
}

/* 分析过程面板 */
.process-box {
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-s);
  background: rgba(0, 0, 0, 0.18);
  margin-bottom: 8px;
}
.process-head {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 6px 10px;
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
}
.chev {
  margin-right: 5px;
  font-size: 10px;
}
.process-latest {
  margin-left: 8px;
  font-weight: 400;
  color: var(--accent);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.process-list {
  max-height: 240px;
  overflow-y: auto;
  padding: 0 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.process-item {
  display: flex;
  gap: 8px;
  font-size: 11.5px;
}
.process-item.failed .pi-summary {
  color: var(--danger);
}
.pi-icon {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background: var(--bg-raised-2);
  color: var(--accent-strong);
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 1px;
}
.pi-body {
  flex: 1;
  min-width: 0;
}
.pi-summary {
  color: var(--text-secondary);
}
.pi-detail {
  margin: 2px 0 0;
  padding: 5px 8px;
  background: rgba(0, 0, 0, 0.28);
  border-radius: 5px;
  font-size: 10.5px;
  line-height: 1.55;
  color: var(--text-muted);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 110px;
  overflow-y: auto;
}
.pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  animation: pulse 1.2s infinite;
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.25;
  }
}
.prompt-suggestion {
  max-width: 480px;
  padding: 9px 14px;
  background: var(--bg-raised);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-m);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
}
.prompt-suggestion:hover {
  border-color: var(--accent);
  color: var(--text-primary);
}

.composer {
  padding: 12px 20px 16px;
  border-top: 1px solid var(--border-subtle);
  display: flex;
  gap: 10px;
  align-items: flex-end;
}
.composer .field {
  flex: 1;
  resize: none;
  line-height: 1.5;
}
.composer-actions {
  display: flex;
  gap: 8px;
}
</style>
