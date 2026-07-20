<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import type { AnalysisRun } from '@shared/types'
import { useAppStore } from '../stores/app'
import { fmtDateTime } from '../utils/format'

const router = useRouter()
const app = useAppStore()
const runs = ref<AnalysisRun[]>([])
let offStream: (() => void) | null = null

const STAGE_LABELS: Record<string, { label: string; cls: string }> = {
  created: { label: '已创建', cls: '' },
  evidence_locked: { label: '证据已锁定', cls: '' },
  round1_running: { label: '第一轮进行中', cls: 'gold' },
  round1_locked: { label: '第一轮已封存', cls: '' },
  round2_running: { label: '第二轮互评中', cls: 'gold' },
  round2_locked: { label: '第二轮已封存', cls: '' },
  moderating: { label: '主持终审中', cls: 'gold' },
  completed: { label: '已完成', cls: 'green' },
  cancelled: { label: '已中止', cls: '' },
  failed: { label: '失败', cls: 'red' }
}

function stageLabel(r: AnalysisRun): { label: string; cls: string } {
  if (r.mode === 'solo' && r.stage === 'round1_running') return { label: '大师分析中', cls: 'gold' }
  return STAGE_LABELS[r.stage] ?? { label: r.stage, cls: '' }
}

async function load(): Promise<void> {
  runs.value = await window.hanai.committee.list()
}

onMounted(() => {
  void load()
  offStream = app.onStream((e) => {
    if (e.type === 'analysis-update') void load()
  })
})
onBeforeUnmount(() => offStream?.())

// Electron 渲染进程不支持 window.confirm，采用二次点击确认
const confirmingDelete = ref('')
let confirmTimer: ReturnType<typeof setTimeout> | null = null

async function remove(hash: string): Promise<void> {
  if (confirmingDelete.value !== hash) {
    confirmingDelete.value = hash
    if (confirmTimer) clearTimeout(confirmTimer)
    confirmTimer = setTimeout(() => {
      confirmingDelete.value = ''
    }, 3000)
    return
  }
  confirmingDelete.value = ''
  await window.hanai.committee.delete(hash)
  await load()
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1>分析讨论</h1>
      <span class="sub">在股票详情页点击「发起大师分析」：选 1 名大师做深度分析，选 2–4 名组成投资委员会</span>
    </div>

    <div v-if="runs.length" class="run-list">
      <div v-for="r in runs" :key="r.analysisHash" class="card run-card" @click="router.push(`/committee/${r.analysisHash}`)">
        <div class="run-head">
          <b>{{ r.stockName }}</b>
          <span class="num" style="color: var(--text-muted)">{{ r.code }}</span>
          <span class="tag" :class="r.mode === 'solo' ? '' : 'gold'">{{ r.mode === 'solo' ? '大师分析' : '委员会' }}</span>
          <span class="tag" :class="stageLabel(r).cls">{{ stageLabel(r).label }}</span>
          <span v-if="r.topic" class="topic">议题：{{ r.topic }}</span>
        </div>
        <div class="run-meta">
          <span class="seats">
            <span v-for="s in r.seats" :key="s.seatId" class="tag">
              {{ s.personaName }}{{ s.seatRole === 'moderator' ? '（主持）' : '' }}
            </span>
          </span>
          <span class="meta-line" style="margin-left: auto">
            {{ fmtDateTime(r.createdAt) }} · <span class="num">{{ r.analysisHash.slice(0, 10) }}</span>
          </span>
          <button
            class="btn small ghost"
            :style="confirmingDelete === r.analysisHash ? 'color: var(--down)' : ''"
            @click.stop="remove(r.analysisHash)"
          >
            {{ confirmingDelete === r.analysisHash ? '确认删除？' : '删除' }}
          </button>
        </div>
        <div v-if="r.error" class="run-error">{{ r.error }}</div>
      </div>
    </div>
    <div v-else class="empty" style="padding-top: 100px">
      <div style="font-size: 15px; color: var(--text-secondary)">还没有分析记录</div>
      <div>打开任意股票详情页，点击「发起大师分析」，让大师独立分析或多位大师交叉互评</div>
    </div>
  </div>
</template>

<style scoped>
.run-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.run-card {
  cursor: pointer;
  transition: border-color 0.15s ease;
}
.run-card:hover {
  border-color: rgba(224, 179, 76, 0.35);
}
.run-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  font-size: 14px;
}
.topic {
  font-size: 12px;
  color: var(--text-secondary);
}
.run-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}
.seats {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}
.run-error {
  margin-top: 8px;
  font-size: 12px;
  color: var(--warn);
}
</style>
