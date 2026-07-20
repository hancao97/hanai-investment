<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import type { WatchGroup, StockQuote, SearchResult } from '@shared/types'
import { fmtNum, fmtPct, fmtAmount, pctClass, fmtTime } from '../utils/format'

const router = useRouter()

const groups = ref<WatchGroup[]>([])
const activeGroupId = ref<string>('')
const quotes = ref<Map<string, StockQuote>>(new Map())
const lastUpdated = ref<string | null>(null)
const staleWarn = ref(false)
const sortKey = ref<'changePct' | 'amount' | 'marketCap' | 'pe' | null>(null)
const sortDesc = ref(true)
let timer: ReturnType<typeof setInterval> | null = null

// 组内添加搜索
const addQuery = ref('')
const addResults = ref<SearchResult[]>([])
let addSeq = 0

const activeGroup = computed(() => groups.value.find((g) => g.id === activeGroupId.value) ?? null)

type WatchRow = (StockQuote | { secId: string; placeholder: true }) & {
  addedAt: string | null
  sinceAddPct: number | null
}

const rows = computed<WatchRow[]>(() => {
  const g = activeGroup.value
  if (!g) return []
  const itemMap = new Map(g.items.map((i) => [i.secId, i]))
  const withMeta = (secId: string, q: StockQuote | null): WatchRow => {
    const item = itemMap.get(secId)
    const base = item?.basePrice
    const price = q?.price
    const sinceAddPct =
      base != null && base > 0 && price != null ? ((price - base) / base) * 100 : null
    const partial = q ?? { secId, placeholder: true as const }
    return { ...partial, addedAt: item?.addedAt ?? null, sinceAddPct }
  }
  const list = g.secIds
    .filter((id) => quotes.value.has(id))
    .map((id) => withMeta(id, quotes.value.get(id)!))
  const missing = g.secIds.filter((id) => !quotes.value.has(id)).map((id) => withMeta(id, null))
  const base: WatchRow[] = [...list, ...missing]
  if (!sortKey.value) return base
  const k = sortKey.value
  return [...base].sort((a, b) => {
    const av = 'placeholder' in a ? null : (a as StockQuote & WatchRow)[k]
    const bv = 'placeholder' in b ? null : (b as StockQuote & WatchRow)[k]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    return sortDesc.value ? bv - av : av - bv
  })
})

function fmtAddedDate(iso: string | null): string {
  if (!iso) return '—'
  return iso.slice(0, 10)
}

function toggleSort(k: 'changePct' | 'amount' | 'marketCap' | 'pe'): void {
  if (sortKey.value === k) {
    if (sortDesc.value) sortDesc.value = false
    else {
      sortKey.value = null
      sortDesc.value = true
    }
  } else {
    sortKey.value = k
    sortDesc.value = true
  }
}

async function loadGroups(): Promise<void> {
  groups.value = await window.hanai.watch.groups()
  if (!activeGroupId.value && groups.value.length) activeGroupId.value = groups.value[0].id
}

async function refreshQuotes(): Promise<void> {
  const g = activeGroup.value
  if (!g || !g.secIds.length) return
  try {
    // reactive Proxy 数组无法通过 contextBridge 序列化，必须展开为纯数组
    const r = await window.hanai.market.quotes([...g.secIds])
    const map = new Map(quotes.value)
    for (const q of r.quotes) map.set(q.secId, q)
    quotes.value = map
    if (r.meta.cacheState === 'fresh') {
      lastUpdated.value = new Date().toISOString()
      staleWarn.value = false
    } else {
      staleWarn.value = true
    }
  } catch {
    staleWarn.value = true
  }
}

async function onAddSearch(): Promise<void> {
  const mySeq = ++addSeq
  if (!addQuery.value.trim()) {
    addResults.value = []
    return
  }
  const r = await window.hanai.master.search(addQuery.value.trim())
  if (mySeq === addSeq) addResults.value = r.slice(0, 8)
}

async function addStock(secId: string): Promise<void> {
  if (!activeGroupId.value) return
  await window.hanai.watch.add(activeGroupId.value, secId)
  addQuery.value = ''
  addResults.value = []
  await loadGroups()
  await refreshQuotes()
}

async function removeStock(secId: string): Promise<void> {
  if (!activeGroupId.value) return
  await window.hanai.watch.remove(activeGroupId.value, secId)
  await loadGroups()
}

// Electron 渲染进程不支持 window.prompt，使用内联输入框
const addingGroup = ref(false)
const newGroupName = ref('')
const groupInputEl = ref<HTMLInputElement | null>(null)

async function beginAddGroup(): Promise<void> {
  addingGroup.value = true
  newGroupName.value = ''
  await nextTick()
  groupInputEl.value?.focus()
}

async function confirmAddGroup(): Promise<void> {
  // 回车确认后输入框卸载会再触发 blur，先复位状态防止重复提交
  if (!addingGroup.value) return
  const name = newGroupName.value.trim()
  addingGroup.value = false
  newGroupName.value = ''
  if (!name) return
  const g = await window.hanai.watch.addGroup(name)
  await loadGroups()
  activeGroupId.value = g.id
  await refreshQuotes()
}

// Electron 渲染进程同样不支持 window.confirm，采用二次点击确认
const confirmingRemove = ref(false)
let confirmTimer: ReturnType<typeof setTimeout> | null = null

async function removeGroup(): Promise<void> {
  const g = activeGroup.value
  if (!g) return
  if (!confirmingRemove.value) {
    confirmingRemove.value = true
    if (confirmTimer) clearTimeout(confirmTimer)
    confirmTimer = setTimeout(() => {
      confirmingRemove.value = false
    }, 3000)
    return
  }
  confirmingRemove.value = false
  if (confirmTimer) clearTimeout(confirmTimer)
  await window.hanai.watch.removeGroup(g.id)
  activeGroupId.value = ''
  await loadGroups()
  await refreshQuotes()
}

async function switchGroup(id: string): Promise<void> {
  activeGroupId.value = id
  await refreshQuotes()
}

onMounted(async () => {
  await loadGroups()
  await refreshQuotes()
  timer = setInterval(() => void refreshQuotes(), 15000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1>自选与发现</h1>
      <span class="sub">
        仅刷新当前分组 · 更新于 {{ fmtTime(lastUpdated) }}
        <span v-if="staleWarn" class="tag" style="color: var(--warn); margin-left: 6px">数据已过期（网络异常）</span>
      </span>
    </div>

    <div class="toolbar">
      <div class="group-tabs">
        <button
          v-for="g in groups"
          :key="g.id"
          class="btn small"
          :class="{ primary: g.id === activeGroupId }"
          @click="switchGroup(g.id)"
        >
          {{ g.name }}
          <span class="count num">{{ g.secIds.length }}</span>
        </button>
        <input
          v-if="addingGroup"
          ref="groupInputEl"
          v-model="newGroupName"
          class="field group-input"
          placeholder="分组名称，回车确认"
          @keydown.enter="confirmAddGroup"
          @keydown.esc="addingGroup = false"
          @blur="confirmAddGroup"
        />
        <button v-else class="btn small ghost" @click="beginAddGroup">＋ 分组</button>
        <button
          v-if="groups.length > 1"
          class="btn small ghost"
          :style="confirmingRemove ? 'color: var(--down)' : ''"
          @click="removeGroup"
        >
          {{ confirmingRemove ? '确认删除？' : '删除分组' }}
        </button>
      </div>
      <div class="add-box">
        <input
          v-model="addQuery"
          class="field"
          placeholder="添加自选：代码 / 名称 / 拼音"
          @input="onAddSearch"
        />
        <div v-if="addResults.length" class="add-results card">
          <button v-for="r in addResults" :key="r.secId" class="add-item" @click="addStock(r.secId)">
            <span class="num" style="color: var(--text-muted)">{{ r.code }}</span>
            <b>{{ r.name }}</b>
            <span class="tag">{{ r.exchange }}</span>
            <span style="margin-left: auto; color: var(--accent-strong)">添加</span>
          </button>
        </div>
      </div>
    </div>

    <div class="card">
      <table class="data">
        <thead>
          <tr>
            <th>名称</th>
            <th>最新价</th>
            <th class="sortable" @click="toggleSort('changePct')">
              涨跌幅 <span v-if="sortKey === 'changePct'">{{ sortDesc ? '↓' : '↑' }}</span>
            </th>
            <th class="sortable" @click="toggleSort('amount')">
              成交额 <span v-if="sortKey === 'amount'">{{ sortDesc ? '↓' : '↑' }}</span>
            </th>
            <th>换手率</th>
            <th class="sortable" @click="toggleSort('marketCap')">
              总市值 <span v-if="sortKey === 'marketCap'">{{ sortDesc ? '↓' : '↑' }}</span>
            </th>
            <th class="sortable" @click="toggleSort('pe')">
              PE(动) <span v-if="sortKey === 'pe'">{{ sortDesc ? '↓' : '↑' }}</span>
            </th>
            <th>PB</th>
            <th>加入日期</th>
            <th>加入以来</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.secId" @click="router.push(`/stock/${row.secId}`)">
            <template v-if="'placeholder' in row">
              <td colspan="10" style="color: var(--text-muted)">{{ row.secId }} · 行情加载中或不可用</td>
              <td @click.stop>
                <button class="btn small ghost" @click="removeStock(row.secId)">移除</button>
              </td>
            </template>
            <template v-else>
              <td>
                <b>{{ row.name }}</b>
                <span class="num" style="color: var(--text-muted); margin-left: 6px">{{ row.code }}</span>
              </td>
              <td class="num" :class="pctClass(row.changePct)">{{ fmtNum(row.price) }}</td>
              <td class="num" :class="pctClass(row.changePct)">{{ fmtPct(row.changePct) }}</td>
              <td class="num">{{ fmtAmount(row.amount) }}</td>
              <td class="num">{{ row.turnoverRate == null ? '—' : row.turnoverRate.toFixed(2) + '%' }}</td>
              <td class="num">{{ fmtAmount(row.marketCap) }}</td>
              <td class="num">{{ row.pe == null || row.pe <= 0 ? '—' : row.pe.toFixed(1) }}</td>
              <td class="num">{{ row.pb == null || row.pb <= 0 ? '—' : row.pb.toFixed(2) }}</td>
              <td class="num" style="color: var(--text-muted)">{{ fmtAddedDate(row.addedAt) }}</td>
              <td class="num" :class="pctClass(row.sinceAddPct)" :title="row.sinceAddPct == null ? '加入时未记录基准价' : '相对加入时价格'">
                {{ row.sinceAddPct == null ? '—' : fmtPct(row.sinceAddPct) }}
              </td>
              <td @click.stop>
                <button class="btn small ghost" @click="removeStock(row.secId)">移除</button>
              </td>
            </template>
          </tr>
        </tbody>
      </table>
      <div v-if="!rows.length" class="empty">
        <div>当前分组暂无自选股</div>
        <div>使用上方搜索框或 ⌘K 全局搜索添加</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 14px;
}
.group-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.count {
  opacity: 0.65;
  margin-left: 4px;
  font-size: 11px;
}
.group-input {
  width: 160px;
  height: 28px;
  font-size: 12.5px;
}
.add-box {
  position: relative;
  width: 280px;
  flex-shrink: 0;
}
.add-box .field {
  width: 100%;
}
.add-results {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 20;
  padding: 6px;
  background: #141822;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.45);
}
.add-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  background: transparent;
  border: none;
  border-radius: var(--radius-s);
  color: var(--text-primary);
  font-size: 12.5px;
  cursor: pointer;
  text-align: left;
}
.add-item:hover {
  background: var(--bg-hover);
}
th.sortable {
  cursor: pointer;
  user-select: none;
}
th.sortable:hover {
  color: var(--text-primary);
}
</style>
