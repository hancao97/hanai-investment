<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import MarkdownIt from 'markdown-it'
import type { AgentActivityItem, JudgementReport, JudgementRun, JudgementStreamChannel } from '@shared/types'
import { useAppStore } from '../stores/app'
import JudgementLauncher from '../components/JudgementLauncher.vue'
import { fmtBytes, fmtDateTime, fmtTime } from '../utils/format'

interface LiveDraft {
  id: string
  channel: JudgementStreamChannel
  text: string
}

interface ActivityEntry {
  kind: 'activity'
  id: string
  item: AgentActivityItem
}

interface ToolBatchEntry {
  kind: 'tools'
  id: string
  items: AgentActivityItem[]
}

type ConversationEntry = ActivityEntry | ToolBatchEntry

const route = useRoute()
const router = useRouter()
const app = useAppStore()
const md = new MarkdownIt({ breaks: true, html: false, linkify: true })
md.renderer.rules.link_open = (tokens, index, options, _env, self) => {
  const token = tokens[index]
  if (token.attrGet('href') === '#judgement-report') {
    token.attrJoin('class', 'report-action-link')
  } else {
    token.attrSet('target', '_blank')
    token.attrSet('rel', 'noopener noreferrer')
    token.attrJoin('class', 'report-source-link')
  }
  return self.renderToken(tokens, index, options)
}
const id = computed(() => String(route.params.id ?? ''))
const run = ref<JudgementRun | null>(null)
const report = ref<JudgementReport | null>(null)
const activity = ref<AgentActivityItem[]>([])
const liveDrafts = ref<Record<string, LiveDraft>>({})
const pageRoot = ref<HTMLElement | null>(null)
const conversation = ref<HTMLElement | null>(null)
const processOpen = ref(false)
const launcherOpen = ref(false)
let offStream: (() => void) | null = null
let poller: ReturnType<typeof setInterval> | null = null

const isActive = computed(() => ['preparing', 'running', 'verifying'].includes(run.value?.status ?? ''))
const persona = computed(() => app.personas.find((item) => item.id === run.value?.personaId))
const personaFallbacks: Record<string, { mark: string; color: string }> = {
  'duan-yongping-perspective': { mark: '段', color: '#d4a017' },
  'munger-perspective': { mark: '芒', color: '#5b8def' },
  'warren-buffett-perspective': { mark: '巴', color: '#34a870' },
  'hunjianglong-perspective': { mark: '混', color: '#c4573d' }
}
const personaMark = computed(() =>
  persona.value?.shortName ?? personaFallbacks[run.value?.personaId ?? '']?.mark ?? '研'
)
const personaColor = computed(() =>
  persona.value?.color ?? personaFallbacks[run.value?.personaId ?? '']?.color ?? 'var(--accent-strong)'
)
const statusLabel = computed(() => (Object.assign({
  preparing: '正在准备',
  running: '正在分析',
  verifying: '正在整理报告',
  completed: '研判完成',
  failed: '研判失败'
}, {}) as Record<string, string>)[run.value?.status ?? ''] ?? '')

const taskRequest = computed(() => {
  if (!run.value) return ''
  return `请使用${run.value.personaName}的分析方法，对${run.value.stockName}（${run.value.code}）进行完整投资研判，核验最新公开资料并形成报告。`
})

const visibleActivity = computed(() => {
  const merged = new Map<string, AgentActivityItem>()
  for (const item of activity.value) {
    const key = item.id.replace(/-(started|completed)$/, '')
    const previous = merged.get(key)
    if (!previous || previous.status === 'started' || item.status !== 'started') {
      const normalized = { ...item, id: key }
      if (normalized.type === 'contextCompaction') normalized.summary = '已整理对话上下文'
      if (normalized.type === 'stage') {
        if (normalized.summary === '工作区已创建') normalized.summary = '研判任务已创建'
        if (normalized.summary === 'Agent 已启动') normalized.summary = '开始研判'
        if (normalized.summary === '正在校验报告') normalized.summary = '正在整理报告'
        if (normalized.summary === '研判报告已归档') normalized.summary = '研判报告已完成'
        if (normalized.detail?.includes('专家 Skill 已同步至')) normalized.detail = `${run.value?.personaName ?? '专家'}的分析框架已就绪`
        if (normalized.detail?.includes('检查 REPORT.md')) normalized.detail = '检查报告结构和内容完整性'
        if (normalized.detail?.startsWith('REPORT.md ·')) normalized.detail = normalized.detail.slice('REPORT.md ·'.length).trim()
      }
      merged.set(key, normalized)
    }
  }
  return [...merged.values()]
})

const conversationEntries = computed<ConversationEntry[]>(() => {
  const entries: ConversationEntry[] = []
  let pending: AgentActivityItem[] = []
  const flushTools = (): void => {
    if (!pending.length) return
    entries.push({ kind: 'tools', id: `tools-${pending[0].id}`, items: pending })
    pending = []
  }

  for (const item of visibleActivity.value) {
    if (isToolActivity(item)) {
      pending.push(item)
      continue
    }
    flushTools()
    entries.push({ kind: 'activity', id: item.id, item })
  }
  flushTools()
  return entries
})

const draftList = computed(() => Object.values(liveDrafts.value))

const toolIcons: Record<string, string> = {
  commandExecution: '›_',
  webSearch: '⌕',
  fileChange: '±',
  mcpToolCall: '◆',
  dynamicToolCall: '◆',
  plan: '☷',
  contextCompaction: '↻'
}

const toolLabels: Record<string, string> = {
  commandExecution: '命令',
  webSearch: '检索',
  fileChange: '文件',
  mcpToolCall: '工具',
  dynamicToolCall: '工具',
  plan: '计划',
  contextCompaction: '上下文'
}

function isToolActivity(item: AgentActivityItem): boolean {
  return item.type !== 'agentMessage' && item.type !== 'reasoning' && item.type !== 'stage'
}

function toolBatchStatus(items: AgentActivityItem[]): AgentActivityItem['status'] {
  if (items.some((item) => item.status === 'failed')) return 'failed'
  if (items.some((item) => item.status === 'started')) return 'started'
  return 'completed'
}

function toolBatchSummary(items: AgentActivityItem[]): string {
  if (items.length === 1) return items[0].summary
  const counts = new Map<string, number>()
  for (const item of items) {
    const label = toolLabels[item.type] ?? '工具'
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts.entries()].map(([label, count]) => `${label} ${count}`).join(' · ')
}

function render(content: string): string {
  return md.render(content.replace(/^---\n[\s\S]*?\n---\n?/, ''))
}

function renderConversation(content: string): string {
  const cleaned = content
    .replace(/(?:已完成，)?完整研判报告已(?:经)?写入\s*\[(?:`?REPORT\.md`?|研判报告)\]\([^)]+\)[。.]?/gi, '研判报告已完成，[查看报告](#judgement-report)。')
    .replace(/\[(?:`?REPORT\.md`?|研判报告)\]\([^)]+\)/gi, '[查看报告](#judgement-report)')
    .replace(/最终仅写入根目录\s*`?REPORT\.md`?/gi, '最终形成完整研判报告')
    .replace(/完整研判报告已经写入\s*`?REPORT\.md`?/gi, '完整研判报告已经完成')
    .replace(/`?REPORT\.md`?/gi, '研判报告')
    .replace(/\bSkill\b/gi, '分析框架')
    .replace(/分析框架\s+要求/g, '分析框架要求')
  return render(cleaned)
}

function handleMarkdownClick(event: MouseEvent): void {
  const target = event.target as Element | null
  const link = target?.closest<HTMLAnchorElement>('a')
  if (link?.getAttribute('href') !== '#judgement-report') return
  event.preventDefault()
  processOpen.value = false
  void nextTick(() => pageRoot.value?.scrollTo({ top: 0, behavior: 'smooth' }))
}

function clearDraft(item: AgentActivityItem): void {
  const keys = Object.keys(liveDrafts.value).filter((key) => key.endsWith(`:${item.id}`))
  if (!keys.length) return
  const next = { ...liveDrafts.value }
  for (const key of keys) delete next[key]
  liveDrafts.value = next
}

function appendDraft(channel: JudgementStreamChannel, itemId: string, delta: string): void {
  if (!delta) return
  const stableId = itemId || channel
  const key = `${channel}:${stableId}`
  const previous = liveDrafts.value[key]
  liveDrafts.value = {
    ...liveDrafts.value,
    [key]: { id: stableId, channel, text: `${previous?.text ?? ''}${delta}` }
  }
  void nextTick(() => scrollToLatest())
}

function scrollToLatest(force = false): void {
  const el = conversation.value
  if (!el) return
  const closeToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 180
  if (force || closeToBottom) el.scrollTo({ top: el.scrollHeight, behavior: force ? 'auto' : 'smooth' })
}

async function load(): Promise<void> {
  run.value = await window.hanai.judgement.get(id.value)
  const entries = await window.hanai.judgement.activity(id.value)
  activity.value = entries.map((entry) => entry.item)
  report.value = await window.hanai.judgement.report(id.value)
}

onMounted(async () => {
  await load()
  await nextTick()
  scrollToLatest(true)
  offStream = app.onStream((event) => {
    if (event.type === 'judgement-update' && event.judgement.id === id.value) {
      run.value = event.judgement
      if (event.judgement.status === 'completed') void load()
    }
    if (event.type === 'judgement-activity' && event.judgementId === id.value) {
      clearDraft(event.item)
      activity.value = [...activity.value, event.item]
      void nextTick(() => scrollToLatest())
    }
    if (event.type === 'judgement-delta' && event.judgementId === id.value) {
      appendDraft(event.channel, event.itemId, event.delta)
    }
  })
  poller = setInterval(() => void load(), 4000)
})

onBeforeUnmount(() => {
  offStream?.()
  if (poller) clearInterval(poller)
})

</script>

<template>
  <div ref="pageRoot" class="page">
    <template v-if="run">
      <div class="page-header">
        <button class="btn small ghost" @click="router.push('/judgements')">← 返回</button>
        <div class="title-block">
          <h1>{{ run.stockName }} <span class="num">{{ run.code }}</span></h1>
          <span>{{ run.personaName }} · {{ fmtDateTime(run.createdAt) }} · {{ run.model ?? '默认模型' }}</span>
        </div>
        <span class="tag" :class="run.status === 'completed' ? 'green' : run.status === 'failed' ? 'red' : 'gold'">{{ statusLabel }}</span>
        <span v-if="run.status === 'failed'" class="header-actions">
          <button class="btn small primary" @click="launcherOpen = true">重新研判</button>
        </span>
      </div>

      <div v-if="run.error" class="failure card">
        <b>本次研判未完成</b>
        <span>{{ run.error }}</span>
      </div>

      <div v-if="report" class="workspace completed-layout" :class="{ 'showing-process': processOpen }">
        <aside class="archive-info card">
          <div class="eyebrow">本次研判</div>
          <dl>
            <div><dt>股票</dt><dd>{{ run.stockName }} {{ run.code }}</dd></div>
            <div><dt>分析专家</dt><dd>{{ run.personaName }}</dd></div>
            <div><dt>开始时间</dt><dd>{{ fmtDateTime(run.createdAt) }}</dd></div>
            <div v-if="run.completedAt"><dt>完成时间</dt><dd>{{ fmtDateTime(run.completedAt) }}</dd></div>
            <div><dt>模型</dt><dd>{{ run.model ?? '默认模型' }}</dd></div>
            <div><dt>报告大小</dt><dd>{{ fmtBytes(report.size) }}</dd></div>
          </dl>
          <button class="btn" @click="processOpen = !processOpen">{{ processOpen ? '隐藏' : '查看' }}研判过程</button>
        </aside>
        <article v-if="!processOpen" class="report-card card">
          <div class="report-head">
            <div><span class="eyebrow">分析结果</span><h2>研判报告</h2></div>
            <span class="tag green">已完成</span>
          </div>
          <div class="md report" v-html="render(report.content)" />
        </article>
        <section v-else class="archived-conversation card">
          <div class="conversation-head compact-head">
            <span class="persona-mark" :style="{ color: personaColor, borderColor: personaColor }">{{ personaMark }}</span>
            <div><h2>研判过程</h2><span>{{ visibleActivity.length }} 条记录</span></div>
          </div>
          <div class="archive-events" @click="handleMarkdownClick">
            <template v-for="entry in conversationEntries" :key="entry.id">
              <div v-if="entry.kind === 'activity' && entry.item.type === 'agentMessage' && entry.item.detail" class="message-row assistant-row">
                <span class="assistant-avatar" :style="{ color: personaColor, borderColor: personaColor }">{{ personaMark }}</span>
                <div class="assistant-message md" v-html="renderConversation(entry.item.detail)" />
              </div>
              <div v-else-if="entry.kind === 'activity' && entry.item.type === 'reasoning' && entry.item.detail" class="commentary-message">
                <span class="commentary-dot" /><div class="md" v-html="renderConversation(entry.item.detail)" />
              </div>
              <div v-else-if="entry.kind === 'activity' && entry.item.type === 'stage'" class="system-message">
                <span class="ok-dot">✓</span><div><b>{{ entry.item.summary }}</b><span v-if="entry.item.detail">{{ entry.item.detail }}</span></div><time>{{ fmtTime(entry.item.at) }}</time>
              </div>
              <details v-else-if="entry.kind === 'tools'" class="tool-call" :class="toolBatchStatus(entry.items)">
                <summary>
                  <span class="tool-icon">✦</span>
                  <b>{{ toolBatchSummary(entry.items) }}</b>
                  <span v-if="entry.items.length > 1" class="batch-count">共 {{ entry.items.length }} 次</span>
                  <time>{{ fmtTime(entry.items[entry.items.length - 1].at) }}</time>
                  <span class="chevron">⌄</span>
                </summary>
                <div v-if="entry.items.length > 1" class="tool-call-list">
                  <details v-for="item in entry.items" :key="item.id" class="tool-call-item" :class="item.status">
                    <summary><span class="tool-icon">{{ toolIcons[item.type] ?? '·' }}</span><b>{{ item.summary }}</b><time>{{ fmtTime(item.at) }}</time><span class="chevron">⌄</span></summary>
                    <pre v-if="item.detail">{{ item.detail }}</pre>
                  </details>
                </div>
                <pre v-else-if="entry.items[0].detail">{{ entry.items[0].detail }}</pre>
              </details>
            </template>
          </div>
        </section>
      </div>

      <section v-else class="conversation-card card">
        <div class="conversation-head">
          <span class="persona-mark" :style="{ color: personaColor, borderColor: personaColor }">{{ personaMark }}</span>
          <div>
            <h2>研判对话</h2>
            <span>{{ run.personaName }}正在分析公开资料</span>
          </div>
          <span v-if="isActive" class="live"><i />{{ statusLabel }}</span>
        </div>

        <div ref="conversation" class="conversation" @click="handleMarkdownClick">
          <div class="message-row user-row">
            <div class="user-message">{{ taskRequest }}</div>
          </div>

          <template v-for="entry in conversationEntries" :key="entry.id">
            <div v-if="entry.kind === 'activity' && entry.item.type === 'agentMessage' && entry.item.detail" class="message-row assistant-row">
              <span class="assistant-avatar" :style="{ color: personaColor, borderColor: personaColor }">{{ personaMark }}</span>
              <div class="assistant-message md" v-html="renderConversation(entry.item.detail)" />
            </div>

            <div v-else-if="entry.kind === 'activity' && entry.item.type === 'reasoning' && entry.item.detail" class="commentary-message">
              <span class="commentary-dot" />
              <div class="md" v-html="renderConversation(entry.item.detail)" />
            </div>

            <div v-else-if="entry.kind === 'activity' && entry.item.type === 'stage'" class="system-message">
              <span :class="entry.item.status === 'failed' ? 'error-dot' : 'ok-dot'">{{ entry.item.status === 'failed' ? '!' : '✓' }}</span>
              <div><b>{{ entry.item.summary }}</b><span v-if="entry.item.detail">{{ entry.item.detail }}</span></div>
              <time>{{ fmtTime(entry.item.at) }}</time>
            </div>

            <details v-else-if="entry.kind === 'tools'" class="tool-call" :class="toolBatchStatus(entry.items)">
              <summary>
                <span class="tool-icon">✦</span>
                <b>{{ toolBatchSummary(entry.items) }}</b>
                <span v-if="entry.items.length > 1" class="batch-count">共 {{ entry.items.length }} 次</span>
                <span v-if="toolBatchStatus(entry.items) === 'started'" class="spinner" />
                <time>{{ fmtTime(entry.items[entry.items.length - 1].at) }}</time>
                <span class="chevron">⌄</span>
              </summary>
              <div v-if="entry.items.length > 1" class="tool-call-list">
                <details v-for="item in entry.items" :key="item.id" class="tool-call-item" :class="item.status">
                  <summary><span class="tool-icon">{{ toolIcons[item.type] ?? '·' }}</span><b>{{ item.summary }}</b><time>{{ fmtTime(item.at) }}</time><span class="chevron">⌄</span></summary>
                  <pre v-if="item.detail">{{ item.detail }}</pre>
                </details>
              </div>
              <pre v-else-if="entry.items[0].detail">{{ entry.items[0].detail }}</pre>
            </details>
          </template>

          <div v-for="draft in draftList" :key="`${draft.channel}:${draft.id}`">
            <div v-if="draft.channel === 'assistant'" class="message-row assistant-row streaming">
              <span class="assistant-avatar" :style="{ color: personaColor, borderColor: personaColor }">{{ personaMark }}</span>
              <div class="assistant-message md" v-html="renderConversation(draft.text)" />
            </div>
            <div v-else class="commentary-message streaming">
              <span class="commentary-dot pulse" />
              <div class="md" v-html="renderConversation(draft.text)" />
            </div>
          </div>

          <div v-if="isActive && !draftList.length" class="thinking">
            <span /><span /><span />
          </div>
        </div>
      </section>

      <JudgementLauncher v-model:open="launcherOpen" :sec-id="run.secId" :stock-name="run.stockName" />
    </template>
    <div v-else class="empty" style="padding-top: 120px">未找到该研判</div>
  </div>
</template>

<style scoped>
.page-header { gap: 12px; }
.title-block { display: flex; flex-direction: column; gap: 3px; }
.title-block h1 { display: flex; align-items: baseline; gap: 7px; }
.title-block h1 .num { color: var(--text-muted); font-size: 12px; font-weight: 400; }
.title-block > span { color: var(--text-muted); font-size: 10.5px; }
.header-actions { display: flex; gap: 7px; margin-left: auto; }
.failure { display: flex; flex-direction: column; gap: 5px; max-width: 1120px; margin: 0 auto 14px; border-color: rgba(240, 74, 85, .28); }
.failure b { color: var(--down); }
.failure span { font-size: 12px; }
.conversation-card { max-width: 1120px; min-height: calc(100vh - 122px); margin: 0 auto; padding: 0; overflow: hidden; }
.conversation-head { display: flex; align-items: center; gap: 11px; padding: 15px 19px; border-bottom: 1px solid var(--border-subtle); }
.conversation-head h2 { margin: 0 0 2px; font-size: 14px; }
.conversation-head > div > span { color: var(--text-muted); font-size: 10px; }
.persona-mark, .assistant-avatar { display: grid; place-items: center; flex: 0 0 auto; border: 1px solid; border-radius: 50%; background: var(--bg-raised-2); font-weight: 750; }
.persona-mark { width: 30px; height: 30px; font-size: 12px; }
.assistant-avatar { width: 28px; height: 28px; font-size: 11px; }
.live { display: flex; align-items: center; gap: 6px; margin-left: auto; color: var(--up); font-size: 10px; }
.live i { width: 6px; height: 6px; border-radius: 50%; background: var(--up); box-shadow: 0 0 0 4px rgba(52, 168, 112, .1); animation: pulse 1.3s infinite; }
.conversation { height: calc(100vh - 205px); min-height: 520px; overflow: auto; padding: 26px 28px 56px; scroll-behavior: smooth; }
.message-row { display: flex; gap: 10px; margin: 16px 0; }
.user-row { justify-content: flex-end; margin-top: 0; }
.user-message { max-width: 72%; padding: 11px 14px; border: 1px solid var(--border-subtle); border-radius: 14px 14px 4px 14px; background: var(--bg-raised-2); color: var(--text-primary); font-size: 12.5px; line-height: 1.65; }
.assistant-row { align-items: flex-start; }
.assistant-message { max-width: 820px; padding-top: 3px; color: var(--text-secondary); font-size: 12.5px; line-height: 1.75; }
.assistant-message :deep(p:first-child), .commentary-message :deep(p:first-child) { margin-top: 0; }
.assistant-message :deep(p:last-child), .commentary-message :deep(p:last-child) { margin-bottom: 0; }
.commentary-message { display: grid; grid-template-columns: 10px minmax(0, 1fr); gap: 8px; max-width: 850px; margin: 12px 0 12px 38px; color: var(--text-muted); font-size: 11.5px; line-height: 1.65; }
.commentary-dot { width: 6px; height: 6px; margin-top: 7px; border-radius: 50%; background: var(--accent-strong); opacity: .7; }
.system-message { display: flex; align-items: center; gap: 9px; max-width: 850px; margin: 9px 0 9px 38px; padding: 7px 10px; color: var(--text-muted); background: rgba(255, 255, 255, .018); border-radius: 7px; font-size: 10.5px; }
.system-message > div { display: flex; min-width: 0; gap: 7px; }
.system-message b { color: var(--text-secondary); font-weight: 600; }
.system-message time, .tool-call time { margin-left: auto; color: var(--text-muted); font: 9px var(--font-mono); }
.ok-dot, .error-dot { width: 17px; height: 17px; display: grid; place-items: center; flex: 0 0 auto; border-radius: 50%; font-size: 9px; }
.ok-dot { color: var(--up); background: rgba(52, 168, 112, .1); }
.error-dot { color: var(--down); background: rgba(240, 74, 85, .1); }
.tool-call { max-width: 850px; margin: 7px 0 7px 38px; border: 1px solid var(--border-subtle); border-radius: 8px; background: rgba(255, 255, 255, .012); }
.tool-call > summary { min-height: 37px; display: flex; align-items: center; gap: 8px; padding: 7px 11px; list-style: none; color: var(--text-muted); cursor: pointer; }
.tool-call summary::-webkit-details-marker, .tool-call-item summary::-webkit-details-marker { display: none; }
.tool-call > summary b { color: var(--text-secondary); font-size: 10.5px; font-weight: 600; }
.tool-call.failed { border-color: rgba(240, 74, 85, .22); }
.tool-call.failed .tool-icon { color: var(--down); }
.batch-count { padding: 1px 6px; border-radius: 10px; color: var(--text-muted); background: var(--bg-raised-2); font-size: 9px; }
.tool-icon { width: 22px; color: var(--accent-strong); font: 10px var(--font-mono); text-align: center; }
.chevron { margin-left: 2px; transition: transform .16s ease; }
.tool-call[open] > summary > .chevron, .tool-call-item[open] > summary > .chevron { transform: rotate(180deg); }
.tool-call > pre, .tool-call-item pre { max-height: 220px; overflow: auto; margin: 0; padding: 10px 12px; border-top: 1px solid var(--border-subtle); color: var(--text-muted); font: 9.5px/1.55 var(--font-mono); white-space: pre-wrap; word-break: break-word; }
.tool-call-list { padding: 3px 9px 7px; border-top: 1px solid var(--border-subtle); background: rgba(0, 0, 0, .08); }
.tool-call-item { border-bottom: 1px solid var(--border-subtle); }
.tool-call-item:last-child { border-bottom: 0; }
.tool-call-item > summary { min-height: 31px; display: flex; align-items: center; gap: 7px; padding: 4px 3px; list-style: none; color: var(--text-muted); cursor: pointer; }
.tool-call-item > summary b { color: var(--text-secondary); font-size: 9.5px; font-weight: 500; }
.tool-call-item.failed > summary b, .tool-call-item.failed .tool-icon { color: var(--down); }
.spinner { width: 10px; height: 10px; border: 1.5px solid var(--border-strong); border-top-color: var(--accent-strong); border-radius: 50%; animation: spin .7s linear infinite; }
.thinking { display: flex; gap: 4px; margin: 18px 0 0 40px; }
.thinking span { width: 5px; height: 5px; border-radius: 50%; background: var(--text-muted); animation: thinking 1.1s infinite; }
.thinking span:nth-child(2) { animation-delay: .14s; }
.thinking span:nth-child(3) { animation-delay: .28s; }
.streaming { opacity: .92; }
.pulse { animation: pulse 1.2s infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pulse { 50% { opacity: .35; } }
@keyframes thinking { 0%, 60%, 100% { transform: translateY(0); opacity: .35; } 30% { transform: translateY(-3px); opacity: 1; } }
.workspace { display: grid; gap: 14px; align-items: stretch; }
.completed-layout { grid-template-columns: 230px minmax(0, 1fr); min-height: calc(100vh - 168px); }
.archive-info { position: sticky; top: 0; align-self: start; }
.eyebrow { color: var(--text-muted); font-size: 9.5px; letter-spacing: .12em; text-transform: uppercase; }
dl { margin: 10px 0 14px; }
dl > div { padding: 9px 0; border-bottom: 1px solid var(--border-subtle); }
dt { margin-bottom: 3px; color: var(--text-muted); font-size: 9.5px; }
dd { margin: 0; color: var(--text-secondary); font-size: 11px; word-break: break-word; }
.archive-info .btn { width: 100%; }
.report-card { padding: 24px 30px; }
.report-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 14px; padding-bottom: 14px; border-bottom: 1px solid var(--border-subtle); }
.report-head h2 { margin: 3px 0 0; font-size: 16px; }
.report { max-width: 920px; margin: 0 auto; color: var(--text-secondary); font-size: 13px; line-height: 1.8; }
.md :deep(a.report-source-link) { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; padding: 2px 8px; border: 1px solid rgba(224, 179, 76, .24); border-radius: 6px; color: var(--accent-strong); background: rgba(224, 179, 76, .065); text-decoration: none; line-height: 1.5; vertical-align: middle; transition: border-color .15s ease, background .15s ease, color .15s ease; }
.md :deep(a.report-source-link::after) { content: '\2197'; flex: 0 0 auto; color: var(--text-muted); font-size: 9px; }
.md :deep(a.report-source-link:hover) { border-color: rgba(224, 179, 76, .5); background: rgba(224, 179, 76, .12); color: #f0ca68; }
.md :deep(a.report-source-link:focus-visible) { outline: 2px solid rgba(224, 179, 76, .52); outline-offset: 2px; }
.md :deep(a.report-action-link) { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border: 1px solid rgba(52, 168, 112, .28); border-radius: 6px; color: #58c990; background: rgba(52, 168, 112, .08); text-decoration: none; line-height: 1.5; }
.md :deep(a.report-action-link::after) { content: '›'; font-size: 11px; }
.md :deep(a.report-action-link:hover) { border-color: rgba(52, 168, 112, .52); background: rgba(52, 168, 112, .14); }
.archived-conversation { min-width: 0; min-height: 100%; padding: 0; overflow: hidden; }
.compact-head { padding-block: 12px; }
.archive-events { padding: 18px 24px 34px; }
@media (max-width: 1300px) { .completed-layout { grid-template-columns: 1fr; } .archive-info { position: static; } }
</style>
