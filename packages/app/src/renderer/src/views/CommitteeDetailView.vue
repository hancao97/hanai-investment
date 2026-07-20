<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import MarkdownIt from 'markdown-it'
import type { AnalysisRun, AnalysisArtifact, AgentActivityItem } from '@shared/types'
import { useAppStore } from '../stores/app'
import { fmtDateTime, fmtTime } from '../utils/format'

const md = new MarkdownIt({ breaks: true, linkify: false, html: false })
const route = useRoute()
const router = useRouter()
const app = useAppStore()

const hash = computed(() => String(route.params.hash ?? ''))
const run = ref<AnalysisRun | null>(null)
const artifacts = ref<AnalysisArtifact[]>([])
const logs = ref<string[]>([])
// seatId:round -> 活动条目
const activity = ref<Map<string, AgentActivityItem[]>>(new Map())
const activeUnitKey = ref('')
const processOpen = ref(true)
let offStream: (() => void) | null = null

const isSolo = computed(() => run.value?.mode === 'solo')

// ---------- 阶段条 ----------
const STAGES = computed(() =>
  isSolo.value
    ? [
        { key: 'evidence_locked', label: '证据锁定' },
        { key: 'completed', label: '大师分析' }
      ]
    : [
        { key: 'evidence_locked', label: '证据锁定' },
        { key: 'round1_locked', label: '第一轮' },
        { key: 'round2_locked', label: '第二轮互评' },
        { key: 'completed', label: '主持终审' }
      ]
)

const STAGE_ORDER = [
  'created',
  'evidence_locked',
  'round1_running',
  'round1_locked',
  'round2_running',
  'round2_locked',
  'moderating',
  'completed'
]

function stageState(stageKey: string): 'done' | 'running' | 'pending' | 'stopped' {
  const r = run.value
  if (!r) return 'pending'
  const cur = STAGE_ORDER.indexOf(r.stage)
  const target = STAGE_ORDER.indexOf(stageKey)
  if (r.stage === 'cancelled' || r.stage === 'failed') {
    return target <= cur ? 'done' : 'stopped'
  }
  if (cur >= target) return 'done'
  if (
    (stageKey === 'round1_locked' && r.stage === 'round1_running') ||
    (stageKey === 'round2_locked' && r.stage === 'round2_running') ||
    (stageKey === 'completed' && r.stage === 'moderating') ||
    (stageKey === 'completed' && isSolo.value && r.stage === 'round1_running')
  ) {
    return 'running'
  }
  return 'pending'
}

const isRunning = computed(() =>
  ['round1_running', 'round2_running', 'moderating', 'evidence_locked', 'created'].includes(run.value?.stage ?? '')
)

// ---------- 统一报告/过程单元：席位 × 轮次 ----------
const roundLabels = computed<Record<string, string>>(() =>
  isSolo.value
    ? ({ turn01: '大师分析' } as Record<string, string>)
    : ({ turn01: '第一轮', turn02: '第二轮', final: '终审' } as Record<string, string>)
)

interface Unit {
  key: string
  seatId: string
  personaName: string
  seatRole: 'moderator' | 'participant'
  round: string
  label: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  artifact: AnalysisArtifact | null
}

const units = computed<Unit[]>(() => {
  const r = run.value
  if (!r) return []
  const out: Unit[] = []
  const rounds = isSolo.value ? ['turn01'] : ['turn01', 'turn02']
  for (const round of rounds) {
    for (const seat of r.seats.filter((s) => s.seatRole === 'participant')) {
      out.push(makeUnit(seat.seatId, seat.personaName, 'participant', round))
    }
  }
  if (!isSolo.value) {
    const mod = r.seats.find((s) => s.seatId === 'moderator')
    if (mod) out.push(makeUnit('moderator', mod.personaName, 'moderator', 'final'))
  }
  return out

  function makeUnit(seatId: string, personaName: string, seatRole: Unit['seatRole'], round: string): Unit {
    const seat = r!.seats.find((s) => s.seatId === seatId)
    const status = (seat?.turnStatus[round] ?? 'pending') as Unit['status']
    const artifact =
      artifacts.value.find((a) => a.seatId === seatId && a.type === round) ?? null
    return {
      key: `${seatId}:${round}`,
      seatId,
      personaName,
      seatRole,
      round,
      label: `${personaName} · ${roundLabels.value[round] ?? round}`,
      status: artifact && status === 'pending' ? 'completed' : status,
      artifact
    }
  }
})

const activeUnit = computed<Unit | null>(
  () => units.value.find((u) => u.key === activeUnitKey.value) ?? null
)

const activeActivity = computed<AgentActivityItem[]>(() =>
  activeUnit.value ? activity.value.get(activeUnit.value.key) ?? [] : []
)

function pickDefaultUnit(): void {
  if (activeUnitKey.value && units.value.some((u) => u.key === activeUnitKey.value)) return
  // 优先：正在运行的单元 > 终审 > 最后一个已完成
  const running = units.value.find((u) => u.status === 'running')
  const final = units.value.find((u) => u.round === 'final' && u.artifact)
  const lastDone = [...units.value].reverse().find((u) => u.artifact)
  const pick = running ?? final ?? lastDone ?? units.value[0]
  if (pick) activeUnitKey.value = pick.key
}

// ---------- 加载 ----------
async function load(): Promise<void> {
  run.value = await window.hanai.committee.get(hash.value)
  artifacts.value = await window.hanai.committee.artifacts(hash.value)
  pickDefaultUnit()
}

async function loadActivity(): Promise<void> {
  const entries = await window.hanai.committee.activity(hash.value)
  const map = new Map<string, AgentActivityItem[]>()
  for (const e of entries) {
    const key = `${e.seatId}:${e.round}`
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(e.item)
  }
  activity.value = map
}

onMounted(() => {
  void load()
  void loadActivity()
  offStream = app.onStream((e) => {
    if (e.type === 'analysis-update' && e.analysis.analysisHash === hash.value) {
      run.value = e.analysis
      void load()
    }
    if (e.type === 'analysis-log' && e.analysisHash === hash.value) {
      logs.value.push(e.line)
      if (logs.value.length > 200) logs.value.shift()
    }
    if (e.type === 'analysis-activity' && e.analysisHash === hash.value) {
      const key = `${e.seatId}:${e.round}`
      const map = new Map(activity.value)
      const list = [...(map.get(key) ?? []), e.item]
      map.set(key, list)
      activity.value = map
    }
  })
})
onBeforeUnmount(() => offStream?.())

async function stop(): Promise<void> {
  await window.hanai.committee.stop(hash.value)
}

async function resume(): Promise<void> {
  await window.hanai.committee.start(hash.value)
}

async function openDir(): Promise<void> {
  if (run.value) await window.hanai.app.openPath(run.value.directory)
}

function render(content: string): string {
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '')
  return md.render(body)
}

const ACTIVITY_ICONS: Record<string, string> = {
  commandExecution: '❯',
  reasoning: '◔',
  agentMessage: '✎',
  webSearch: '⌕',
  fileChange: '±',
  mcpToolCall: '⚙',
  plan: '☰'
}
</script>

<template>
  <div class="page">
    <template v-if="run">
      <div class="page-header">
        <button class="btn small ghost" @click="router.push('/committee')">← 返回</button>
        <h1>{{ run.stockName }} <span class="num" style="font-size: 13px; color: var(--text-muted)">{{ run.code }}</span></h1>
        <span class="tag" :class="isSolo ? '' : 'gold'">{{ isSolo ? '大师分析' : '投资委员会' }}</span>
        <span v-if="run.topic" class="sub">议题：{{ run.topic }}</span>
        <span style="margin-left: auto; display: flex; gap: 8px">
          <button class="btn small" @click="openDir">打开归档目录</button>
          <button v-if="isRunning" class="btn small danger" @click="stop">中止</button>
          <button
            v-else-if="run.stage === 'cancelled' || run.stage === 'failed'"
            class="btn small primary"
            @click="resume"
          >
            从断点继续
          </button>
        </span>
      </div>

      <!-- 阶段进度 -->
      <div class="card stage-card">
        <div class="stages">
          <template v-for="(s, i) in STAGES" :key="s.key">
            <div class="stage" :class="stageState(s.key)">
              <span class="stage-dot">
                <template v-if="stageState(s.key) === 'done'">✓</template>
                <template v-else-if="stageState(s.key) === 'running'">●</template>
                <template v-else>{{ i + 1 }}</template>
              </span>
              <span class="stage-label">{{ s.label }}</span>
            </div>
            <div v-if="i < STAGES.length - 1" class="stage-line" :class="{ done: stageState(STAGES[i + 1].key) !== 'pending' }" />
          </template>
        </div>
        <div class="stage-meta">
          <span class="meta-line">
            analysis-hash <span class="num">{{ run.analysisHash.slice(0, 16) }}…</span>
            · 证据 <span class="num">{{ run.evidenceHash?.slice(0, 12) ?? '—' }}…</span>
            · {{ fmtDateTime(run.createdAt) }}
          </span>
          <span v-if="run.error" class="tag" style="color: var(--warn)">{{ run.error }}</span>
        </div>
      </div>

      <!-- 融合视图：席位×轮次 单元卡 + 过程 + 报告 -->
      <div class="card unit-card">
        <div class="unit-tabs">
          <button
            v-for="u in units"
            :key="u.key"
            class="unit-tab"
            :class="[u.status, { active: activeUnitKey === u.key }]"
            @click="activeUnitKey = u.key"
          >
            <span class="unit-name">{{ u.personaName }}</span>
            <span class="unit-round">
              {{ roundLabels[u.round] ?? u.round }}
              <template v-if="u.status === 'running'"> · 进行中</template>
              <template v-else-if="u.status === 'failed'"> · 失败</template>
              <template v-else-if="u.status === 'pending'"> · 等待</template>
            </span>
            <span v-if="u.status === 'running'" class="pulse-dot" />
          </button>
        </div>

        <template v-if="activeUnit">
          <!-- 分析过程（实时） -->
          <div v-if="activeActivity.length" class="process-box">
            <button class="process-head" @click="processOpen = !processOpen">
              <span class="chev">{{ processOpen ? '▾' : '▸' }}</span>
              分析过程（{{ activeActivity.length }} 步）
              <span v-if="activeUnit.status === 'running'" class="tag gold" style="margin-left: 6px">实时</span>
            </button>
            <div v-if="processOpen" class="process-list">
              <div v-for="a in activeActivity" :key="a.id" class="process-item" :class="a.status">
                <span class="pi-icon">{{ ACTIVITY_ICONS[a.type] ?? '·' }}</span>
                <div class="pi-body">
                  <div class="pi-summary">
                    {{ a.summary }}
                    <span class="pi-time num">{{ fmtTime(a.at) }}</span>
                  </div>
                  <pre v-if="a.detail" class="pi-detail">{{ a.detail }}</pre>
                </div>
              </div>
            </div>
          </div>
          <div v-else-if="activeUnit.status === 'running'" class="process-box">
            <div class="process-head" style="cursor: default">
              <span class="pulse-dot" style="position: static; margin-right: 8px" />
              {{ activeUnit.personaName }} 正在启动分析…
            </div>
          </div>

          <!-- 报告正文 -->
          <template v-if="activeUnit.artifact">
            <div class="meta-line" style="margin: 10px 0">
              SHA-256 <span class="num">{{ activeUnit.artifact.sha256.slice(0, 20) }}…</span>（封存后不可修改）
            </div>
            <div class="md report" v-html="render(activeUnit.artifact.content)" />
          </template>
          <div v-else-if="activeUnit.status === 'running'" class="empty" style="padding: 30px 0">
            报告生成中…完成校验并封存后展示全文，上方可实时查看分析过程
          </div>
          <div v-else-if="activeUnit.status === 'failed'" class="empty" style="padding: 30px 0">
            本轮生成失败，已按缺席处理（可在归档目录 _attempts 查看未通过校验的草稿）
          </div>
          <div v-else class="empty" style="padding: 30px 0">等待前序阶段完成</div>
        </template>
      </div>

      <!-- 运行日志 -->
      <div v-if="logs.length" class="card" style="margin-top: 14px">
        <div class="card-title">运行日志</div>
        <div class="logs num">
          <div v-for="(l, i) in logs" :key="i">{{ l }}</div>
        </div>
      </div>
    </template>
    <div v-else class="empty" style="padding-top: 120px">分析不存在或已删除</div>
  </div>
</template>

<style scoped>
.stage-card {
  margin-bottom: 14px;
}
.stages {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.stage {
  display: flex;
  align-items: center;
  gap: 8px;
}
.stage-dot {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 1.5px solid var(--border-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--text-muted);
  flex-shrink: 0;
}
.stage.done .stage-dot {
  background: var(--accent-dim);
  border-color: var(--accent);
  color: var(--accent-strong);
}
.stage.running .stage-dot {
  border-color: var(--accent);
  color: var(--accent);
  animation: pulse 1.4s infinite;
}
@keyframes pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(224, 179, 76, 0.35);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(224, 179, 76, 0);
  }
}
.stage-label {
  font-size: 12.5px;
  color: var(--text-secondary);
}
.stage.done .stage-label,
.stage.running .stage-label {
  color: var(--text-primary);
  font-weight: 600;
}
.stage-line {
  flex: 1;
  height: 1.5px;
  background: var(--border-subtle);
}
.stage-line.done {
  background: rgba(224, 179, 76, 0.4);
}
.stage-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

/* 单元 tabs */
.unit-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.unit-tab {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 14px;
  background: var(--bg-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-m);
  cursor: pointer;
  color: var(--text-secondary);
  transition: all 0.15s ease;
}
.unit-tab:hover {
  border-color: var(--border-strong);
}
.unit-tab.active {
  background: var(--bg-active);
  border-color: rgba(224, 179, 76, 0.45);
  color: var(--text-primary);
}
.unit-tab.running {
  border-color: rgba(224, 179, 76, 0.5);
}
.unit-tab.failed {
  border-color: rgba(240, 74, 85, 0.35);
}
.unit-name {
  font-size: 12.5px;
  font-weight: 600;
}
.unit-round {
  font-size: 10.5px;
  color: var(--text-muted);
}
.unit-tab.completed .unit-round {
  color: var(--ok);
}
.unit-tab.running .unit-round {
  color: var(--accent-strong);
}
.unit-tab.failed .unit-round {
  color: var(--danger);
}
.pulse-dot {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  animation: blink 1.2s infinite;
}
@keyframes blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.25;
  }
}

/* 分析过程 */
.process-box {
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-m);
  background: rgba(0, 0, 0, 0.18);
}
.process-head {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 9px 12px;
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
}
.chev {
  margin-right: 6px;
  font-size: 11px;
}
.process-list {
  max-height: 300px;
  overflow-y: auto;
  padding: 0 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.process-item {
  display: flex;
  gap: 9px;
  font-size: 12px;
}
.process-item.failed .pi-summary {
  color: var(--danger);
}
.pi-icon {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  background: var(--bg-raised-2);
  color: var(--accent-strong);
  font-size: 11px;
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
.pi-time {
  margin-left: 8px;
  font-size: 10px;
  color: var(--text-muted);
}
.pi-detail {
  margin: 3px 0 0;
  padding: 6px 9px;
  background: rgba(0, 0, 0, 0.28);
  border-radius: 6px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-muted);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 130px;
  overflow-y: auto;
}

.report {
  max-height: 640px;
  overflow-y: auto;
  padding: 4px 8px;
}
.logs {
  font-size: 11px;
  color: var(--text-muted);
  max-height: 180px;
  overflow-y: auto;
  line-height: 1.7;
}
</style>
