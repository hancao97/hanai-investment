<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { JudgementRun } from '@shared/types'
import { useAppStore } from '../stores/app'
import JudgementLauncher from '../components/JudgementLauncher.vue'
import { fmtDateTime } from '../utils/format'

const router = useRouter()
const route = useRoute()
const app = useAppStore()
const runs = ref<JudgementRun[]>([])
const launcherOpen = ref(false)
const stockFilter = ref('')
const personaFilter = ref('')
let offStream: (() => void) | null = null

const filtered = computed(() => {
  const stock = stockFilter.value.trim().toLowerCase()
  return runs.value.filter((run) => {
    const matchesStock = !stock || `${run.stockName} ${run.code}`.toLowerCase().includes(stock)
    const matchesPersona = !personaFilter.value || run.personaId === personaFilter.value
    return matchesStock && matchesPersona
  })
})

const statusMap: Record<string, { label: string; cls: string }> = {
  preparing: { label: '正在准备', cls: 'gold' },
  running: { label: '研判进行中', cls: 'gold' },
  verifying: { label: '正在整理报告', cls: 'gold' },
  completed: { label: '已完成', cls: 'green' },
  failed: { label: '未完成', cls: 'red' }
}

async function load(): Promise<void> {
  runs.value = await window.hanai.judgement.list()
}

onMounted(() => {
  personaFilter.value = String(route.query.persona ?? '')
  void load()
  offStream = app.onStream((event) => {
    if (event.type === 'judgement-update') void load()
  })
})
onBeforeUnmount(() => offStream?.())

watch(
  () => route.query.persona,
  (persona) => {
    personaFilter.value = String(persona ?? '')
  }
)
</script>

<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h1>大师研判</h1>
        <div class="sub">由一位专家独立检索并核验公开资料，形成完整投资研判报告</div>
      </div>
      <button class="btn primary" style="margin-left: auto" @click="launcherOpen = true">＋ 新建研判</button>
    </div>

    <div class="toolbar card">
      <input v-model="stockFilter" class="field" placeholder="筛选股票名或代码" />
      <select v-model="personaFilter" class="field">
        <option value="">全部分析人</option>
        <option v-for="persona in app.personas" :key="persona.id" :value="persona.id">{{ persona.name }}</option>
      </select>
      <span class="count">{{ filtered.length }} 份研判归档</span>
    </div>

    <div v-if="filtered.length" class="run-grid">
      <button v-for="run in filtered" :key="run.id" class="run-card card" @click="router.push(`/judgements/${run.id}`)">
        <div class="run-top">
          <span class="stock-name">{{ run.stockName }}</span>
          <span class="num code">{{ run.code }}</span>
          <span class="tag" :class="statusMap[run.status]?.cls">{{ statusMap[run.status]?.label ?? run.status }}</span>
        </div>
        <div class="analyst">
          <span class="avatar" :style="{ color: app.personas.find((p) => p.id === run.personaId)?.color }">
            {{ app.personas.find((p) => p.id === run.personaId)?.shortName ?? '研' }}
          </span>
          <span><small>分析人</small><b>{{ run.personaName }}</b></span>
        </div>
        <div class="run-meta">
          <span><small>分析日期</small>{{ fmtDateTime(run.createdAt) }}</span>
          <span><small>模型</small><span class="num">{{ run.model ?? '默认模型' }}</span></span>
        </div>
        <div v-if="run.error" class="error">{{ run.error }}</div>
        <div class="open-label">{{ run.status === 'completed' ? '查看报告' : '查看执行过程' }} →</div>
      </button>
    </div>
    <div v-else class="empty-state">
      <div class="empty-icon">研</div>
      <b>{{ runs.length ? '没有符合筛选条件的报告' : '还没有大师研判' }}</b>
      <span>{{ runs.length ? '调整股票或分析人筛选条件' : '选择一只股票和一位专家，Codex 会主动获取信息并生成详细报告' }}</span>
      <button v-if="!runs.length" class="btn primary" @click="launcherOpen = true">创建第一份研判</button>
    </div>

    <JudgementLauncher v-model:open="launcherOpen" />
  </div>
</template>

<style scoped>
.page-header { align-items: flex-start; }
.page-header h1 { margin-bottom: 3px; }
.toolbar { display: flex; align-items: center; gap: 9px; margin-bottom: 14px; padding: 10px 12px; }
.toolbar .field { width: 220px; }
.count { margin-left: auto; color: var(--text-muted); font-size: 11px; }
.run-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.run-card { display: flex; flex-direction: column; gap: 14px; min-height: 214px; cursor: pointer; color: var(--text-primary); text-align: left; transition: border-color .15s, transform .15s; }
.run-card:hover { border-color: rgba(224, 179, 76, .38); transform: translateY(-1px); }
.run-top { display: flex; align-items: center; gap: 8px; }
.stock-name { font-size: 16px; font-weight: 720; }
.code { color: var(--text-muted); font-size: 11px; }
.run-top .tag { margin-left: auto; }
.analyst { display: flex; align-items: center; gap: 9px; }
.avatar { width: 32px; height: 32px; display: grid; place-items: center; background: var(--bg-raised-2); border: 1px solid var(--border-strong); border-radius: 50%; font-weight: 700; }
.analyst > span:last-child { display: flex; flex-direction: column; gap: 2px; }
small { display: block; color: var(--text-muted); font-size: 9.5px; font-weight: 400; }
.analyst b { font-size: 12px; }
.run-meta { display: grid; grid-template-columns: 1.3fr 1fr; gap: 8px; color: var(--text-secondary); font-size: 11px; }
.error { overflow: hidden; color: var(--down); font-size: 10.5px; text-overflow: ellipsis; white-space: nowrap; }
.open-label { margin-top: auto; padding-top: 10px; border-top: 1px solid var(--border-subtle); color: var(--accent-strong); font-size: 11px; }
.empty-state { min-height: 380px; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 9px; color: var(--text-muted); text-align: center; }
.empty-state b { color: var(--text-secondary); font-size: 14px; }
.empty-state span { max-width: 480px; font-size: 12px; }
.empty-icon { width: 46px; height: 46px; display: grid; place-items: center; margin-bottom: 4px; color: var(--accent-strong); background: var(--bg-active); border: 1px solid rgba(224, 179, 76, .28); border-radius: 14px; font-size: 18px; font-weight: 700; }
@media (max-width: 1350px) { .run-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
