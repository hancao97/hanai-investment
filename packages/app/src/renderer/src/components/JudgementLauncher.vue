<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { SearchResult, SecurityMaster } from '@shared/types'
import { useAppStore } from '../stores/app'

const props = withDefaults(defineProps<{ open: boolean; secId?: string; stockName?: string }>(), {
  secId: '',
  stockName: ''
})
const emit = defineEmits<{ 'update:open': [boolean] }>()

const app = useAppStore()
const router = useRouter()
const selectedPersonaId = ref('')
const selectedStock = ref<SecurityMaster | SearchResult | null>(null)
const query = ref('')
const results = ref<SearchResult[]>([])
const searching = ref(false)
const submitting = ref(false)
const error = ref('')
let searchToken = 0

const codexReady = computed(() => app.codexState?.status === 'ready')

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    error.value = ''
    submitting.value = false
    results.value = []
    if (!app.personas.length) await app.refreshPersonas()
    if (!selectedPersonaId.value) selectedPersonaId.value = app.personas[0]?.id ?? ''
    if (props.secId) {
      selectedStock.value = await window.hanai.master.get(props.secId)
      query.value = props.stockName || selectedStock.value?.name || ''
    } else {
      selectedStock.value = null
      query.value = ''
    }
  }
)

async function search(): Promise<void> {
  selectedStock.value = null
  const q = query.value.trim()
  const token = ++searchToken
  if (!q) {
    results.value = []
    return
  }
  searching.value = true
  try {
    const found = await window.hanai.master.search(q)
    if (token === searchToken) results.value = found.slice(0, 8)
  } finally {
    if (token === searchToken) searching.value = false
  }
}

function pickStock(stock: SearchResult): void {
  selectedStock.value = stock
  query.value = `${stock.name} ${stock.code}`
  results.value = []
}

async function launch(): Promise<void> {
  if (!selectedStock.value) {
    error.value = '请先选择一只股票'
    return
  }
  if (!selectedPersonaId.value) {
    error.value = '请选择一位分析专家'
    return
  }
  submitting.value = true
  error.value = ''
  try {
    const run = await window.hanai.judgement.create({
      secId: selectedStock.value.secId,
      personaId: selectedPersonaId.value
    })
    emit('update:open', false)
    await router.push(`/judgements/${run.id}`)
    await window.hanai.judgement.start(run.id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="overlay" @click.self="emit('update:open', false)">
      <div class="panel">
        <div class="panel-head">
          <div>
            <div class="p-title">新建大师研判</div>
            <div class="p-sub">单专家、一次性执行；完成后形成不可续聊的只读报告归档</div>
          </div>
          <button class="close" @click="emit('update:open', false)">×</button>
        </div>

        <div class="section">
          <div class="s-label">研判标的</div>
          <div class="stock-search">
            <input
              v-model="query"
              class="field"
              :disabled="Boolean(secId)"
              placeholder="输入股票代码、名称或拼音"
              @input="search"
            />
            <span v-if="searching" class="searching">检索中…</span>
            <div v-if="results.length" class="results">
              <button v-for="stock in results" :key="stock.secId" @click="pickStock(stock)">
                <span><b>{{ stock.name }}</b> <span class="num">{{ stock.code }}</span></span>
                <span class="num">{{ stock.exchange }}</span>
              </button>
            </div>
          </div>
          <div v-if="selectedStock" class="selected-stock">
            <span class="check">✓</span>
            <b>{{ selectedStock.name }}</b>
            <span class="num">{{ selectedStock.code }}</span>
            <span>{{ selectedStock.exchange }}</span>
          </div>
        </div>

        <div class="section">
          <div class="s-label">分析专家（仅可选择一位）</div>
          <div class="personas">
            <button
              v-for="persona in app.personas"
              :key="persona.id"
              class="persona"
              :class="{ active: selectedPersonaId === persona.id }"
              @click="selectedPersonaId = persona.id"
            >
              <span class="avatar" :style="{ color: persona.color, borderColor: persona.color }">{{ persona.shortName }}</span>
              <span class="persona-copy">
                <b>{{ persona.name }}</b>
                <span>{{ persona.roleTag ?? persona.tags.slice(0, 2).join(' · ') }}</span>
              </span>
              <span class="radio">{{ selectedPersonaId === persona.id ? '●' : '○' }}</span>
            </button>
          </div>
        </div>

        <div v-if="!codexReady" class="warn-box">
          Codex 当前不可用（{{ app.codexState?.status ?? '检测中' }}），请先到“设置与诊断”处理。
        </div>
        <div v-if="error" class="warn-box">{{ error }}</div>

        <div class="actions">
          <button class="btn ghost" @click="emit('update:open', false)">取消</button>
          <button class="btn primary" :disabled="submitting || !codexReady || !selectedStock" @click="launch">
            {{ submitting ? '正在创建研判…' : '开始研判' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center; background: rgba(2, 4, 8, .72); backdrop-filter: blur(4px); }
.panel { width: 650px; max-height: calc(100vh - 70px); overflow: auto; padding: 22px; background: #141822; border: 1px solid var(--border-strong); border-radius: var(--radius-l); box-shadow: 0 28px 80px rgba(0, 0, 0, .58); }
.panel-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
.p-title { font-size: 18px; font-weight: 750; }
.p-sub { margin-top: 4px; color: var(--text-muted); font-size: 12px; }
.close { border: 0; background: transparent; color: var(--text-muted); font-size: 22px; cursor: pointer; }
.section { margin-bottom: 18px; }
.s-label { margin-bottom: 8px; color: var(--text-secondary); font-size: 12px; font-weight: 600; }
.stock-search { position: relative; }
.stock-search .field { width: 100%; }
.searching { position: absolute; top: 9px; right: 10px; color: var(--text-muted); font-size: 11px; }
.results { position: absolute; left: 0; right: 0; top: 39px; z-index: 5; padding: 5px; background: #111620; border: 1px solid var(--border-strong); border-radius: var(--radius-m); box-shadow: 0 16px 34px rgba(0, 0, 0, .45); }
.results button { width: 100%; display: flex; justify-content: space-between; padding: 8px 10px; border: 0; border-radius: 6px; background: transparent; color: var(--text-primary); cursor: pointer; text-align: left; }
.results button:hover { background: var(--bg-hover); }
.selected-stock { display: flex; align-items: center; gap: 8px; margin-top: 8px; padding: 8px 10px; background: rgba(52, 168, 112, .08); border: 1px solid rgba(52, 168, 112, .22); border-radius: var(--radius-s); font-size: 12px; }
.check { color: var(--up); }
.selected-stock span:last-child { margin-left: auto; color: var(--text-muted); }
.personas { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.persona { display: flex; align-items: center; gap: 10px; padding: 10px; background: var(--bg-raised); border: 1px solid var(--border-subtle); border-radius: var(--radius-m); color: var(--text-primary); cursor: pointer; text-align: left; }
.persona:hover { border-color: var(--border-strong); }
.persona.active { background: var(--bg-active); border-color: rgba(224, 179, 76, .48); }
.avatar { width: 34px; height: 34px; flex: 0 0 auto; display: grid; place-items: center; border: 1.5px solid; border-radius: 50%; font-weight: 700; }
.persona-copy { min-width: 0; display: flex; flex: 1; flex-direction: column; gap: 3px; }
.persona-copy b { overflow: hidden; font-size: 12.5px; text-overflow: ellipsis; white-space: nowrap; }
.persona-copy span { color: var(--text-muted); font-size: 10.5px; }
.radio { color: var(--accent-strong); }
.warn-box { margin-bottom: 12px; padding: 9px 12px; background: rgba(240, 74, 85, .08); border: 1px solid rgba(240, 74, 85, .28); border-radius: var(--radius-s); font-size: 12px; }
.actions { display: flex; justify-content: flex-end; gap: 9px; }
</style>
