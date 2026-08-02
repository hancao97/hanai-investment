<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import type { MarketOverview, SectorBoard, RankEntry, StockQuote, ProviderMeta } from '@shared/types'
import type { EChartsCoreOption } from 'echarts/core'
import EChart from '../components/EChart.vue'
import { fmtNum, fmtPct, fmtSign, fmtAmount, pctClass, fmtTime } from '../utils/format'

const router = useRouter()

const overview = ref<MarketOverview | null>(null)
const sectors = ref<SectorBoard | null>(null)
const sectorType = ref<'industry' | 'concept'>('industry')
const drill = ref<{ code: string; name: string; stocks: StockQuote[]; meta: ProviderMeta } | null>(null)
const rankKind = ref<'gainers' | 'losers' | 'amount' | 'turnover'>('gainers')
const ranks = ref<RankEntry[]>([])
const loading = ref(true)
const refreshing = ref(false)
const sectorLoading = ref(false)
const rankLoading = ref(false)
const errorMsg = ref('')
const lastUpdated = ref<string | null>(null)
let timer: ReturnType<typeof setInterval> | null = null

const statusLabel = computed(() => {
  const map: Record<string, string> = {
    pre: '盘前',
    trading: '交易中',
    break: '午间休市',
    closed: '已收盘',
    unknown: '状态未知'
  }
  return map[overview.value?.marketStatus ?? 'unknown']
})

async function refresh(showFeedback = false): Promise<void> {
  if (refreshing.value) return
  if (showFeedback) refreshing.value = true
  errorMsg.value = ''
  try {
    const [ov, sec, rk] = await Promise.all([
      window.hanai.market.overview(),
      window.hanai.market.sectors(sectorType.value),
      window.hanai.market.ranks(rankKind.value)
    ])
    overview.value = ov
    sectors.value = sec
    ranks.value = rk.entries
    lastUpdated.value = new Date().toISOString()
    if (drill.value) {
      const d = await window.hanai.market.sectorStocks(drill.value.code)
      drill.value = { ...drill.value, stocks: d.stocks, meta: d.meta }
    }
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

async function switchSectorType(t: 'industry' | 'concept'): Promise<void> {
  if (sectorLoading.value || t === sectorType.value) return
  errorMsg.value = ''
  sectorType.value = t
  drill.value = null
  sectorLoading.value = true
  try {
    sectors.value = await window.hanai.market.sectors(t)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    sectorLoading.value = false
  }
}

async function switchRank(k: typeof rankKind.value): Promise<void> {
  if (rankLoading.value || k === rankKind.value) return
  errorMsg.value = ''
  rankKind.value = k
  rankLoading.value = true
  try {
    const r = await window.hanai.market.ranks(k)
    ranks.value = r.entries
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    rankLoading.value = false
  }
}

onMounted(() => {
  void refresh()
  timer = setInterval(() => void refresh(), 30000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

// ---------- 树图 ----------
function heatColor(pct: number | null): string {
  if (pct == null) return '#2a2f3a'
  const t = Math.max(-1, Math.min(1, pct / 6))
  if (Math.abs(t) < 0.03) return '#333a47'
  if (t > 0) {
    const k = Math.pow(t, 0.7)
    return `rgb(${Math.round(58 + k * 165)}, ${Math.round(48 - k * 12)}, ${Math.round(58 - k * 4)})`
  }
  const k = Math.pow(-t, 0.7)
  return `rgb(${Math.round(42 - k * 14)}, ${Math.round(58 + k * 100)}, ${Math.round(58 + k * 42)})`
}

function escapeHtml(value: string): string {
  const chars: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }
  return value.replace(/[&<>"']/g, (char) => chars[char])
}

const treemapOption = computed<EChartsCoreOption | null>(() => {
  if (!sectors.value) return null
  const valid = sectors.value.sectors
    .filter((s) => s.amount != null && s.amount > 0)
    .sort((a, b) => (b.amount as number) - (a.amount as number))
  const totalAmount = valid.reduce((sum, s) => sum + (s.amount as number), 0)
  // 成交额小的长尾板块合并为「其他」，避免树图尾部密密麻麻不可读
  const MAX_TILES = 40
  const MIN_SHARE = 0.004
  const majors = valid.filter((s, i) => i < MAX_TILES && (s.amount as number) / totalAmount >= MIN_SHARE)
  const minors = valid.slice(majors.length)
  const majorAmount = majors.reduce((sum, s) => sum + (s.amount as number), 0)
  const data: Record<string, unknown>[] = majors.map((s) => ({
    name: s.name,
    value: s.amount as number,
    changePct: s.changePct,
    upCount: s.upCount,
    downCount: s.downCount,
    leaderName: s.leaderName,
    leaderChangePct: s.leaderChangePct,
    sectorCode: s.code,
    itemStyle: { color: heatColor(s.changePct) },
    label: {
      formatter: (p: { name: string; data: { changePct: number | null } }): string => {
        const pct = p.data.changePct
        return `${p.name}\n${pct == null ? '—' : (pct > 0 ? '+' : '') + pct.toFixed(2) + '%'}`
      }
    }
  }))
  if (minors.length) {
    // 「其他」只用于容纳长尾信息，不参与成交额比例布局；固定占树图面积的 3.5%。
    // 数据保持降序且关闭 ECharts 自动排序后，最后一个节点会稳定落在右下角。
    const OTHER_TILE_SHARE = 0.035
    const otherLayoutValue = majorAmount > 0 ? (majorAmount * OTHER_TILE_SHARE) / (1 - OTHER_TILE_SHARE) : 1
    const upN = minors.filter((s) => (s.changePct ?? 0) > 0).length
    const downN = minors.filter((s) => (s.changePct ?? 0) < 0).length
    const minorSectors = [...minors]
      .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
      .map((s) => ({ code: s.code, name: s.name, amount: s.amount, changePct: s.changePct }))
    data.push({
      name: `其他 ${minors.length} 个板块`,
      value: otherLayoutValue,
      changePct: null,
      upCount: upN,
      downCount: downN,
      leaderName: null,
      leaderChangePct: null,
      sectorCode: null,
      isOthers: true,
      minorSectors,
      itemStyle: { color: '#262b36' },
      label: {
        formatter: (): string => `其他 ${minors.length} 个`
      }
    })
  }
  return {
    tooltip: {
      backgroundColor: '#161b26',
      borderColor: 'rgba(255,255,255,0.14)',
      textStyle: { color: '#e8eaf0', fontSize: 12 },
      renderMode: 'html',
      enterable: true,
      confine: true,
      hideDelay: 500,
      transitionDuration: 0,
      position: (
        point: [number, number],
        params: unknown,
        _el: unknown,
        _rect: { x: number; y: number; width: number; height: number } | null,
        size: { contentSize: [number, number]; viewSize: [number, number] }
      ): [number, number] => {
        const item = params as { data?: { isOthers?: boolean } }
        const [contentWidth, contentHeight] = size.contentSize
        const [viewWidth, viewHeight] = size.viewSize
        if (item.data?.isOthers) {
          // 文字与色块背景属于不同图形元素，不能使用它们各自的边界定位。
          // 统一钉在图表右下区域，并向右覆盖「其他」色块，保证鼠标可以连续移入。
          const rightOverlap = Math.min(96, viewWidth * 0.1)
          const left = Math.max(8, viewWidth - contentWidth - rightOverlap)
          const top = Math.max(8, viewHeight - contentHeight - 8)
          return [left, top]
        }
        const gap = 12
        const left = point[0] + gap + contentWidth <= viewWidth ? point[0] + gap : point[0] - contentWidth - gap
        const top = point[1] + gap + contentHeight <= viewHeight ? point[1] + gap : point[1] - contentHeight - gap
        return [Math.max(0, left), Math.max(0, top)]
      },
      formatter: (p: {
        name: string
        value: number
        data: {
          changePct: number | null
          upCount: number | null
          downCount: number | null
          leaderName: string | null
          leaderChangePct: number | null
          isOthers?: boolean
          minorSectors?: { code: string; name: string; amount: number | null; changePct: number | null }[]
        }
      }): string => {
        const d = p.data
        const pct = d.changePct
        const pctStr = pct == null ? '—' : `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`
        if (d.isOthers) {
          const rows = (d.minorSectors ?? [])
            .map((sector, index) => {
              const sectorPct = sector.changePct
              const sectorPctStr = sectorPct == null ? '—' : `${sectorPct > 0 ? '+' : ''}${sectorPct.toFixed(2)}%`
              const pctClass = sectorPct == null || sectorPct === 0 ? 'is-flat' : sectorPct > 0 ? 'is-up' : 'is-down'
              return `<button type="button" class="other-tooltip-row" data-sector-code="${escapeHtml(sector.code)}" data-sector-name="${escapeHtml(sector.name)}"><span class="other-tooltip-rank">${index + 1}</span><span class="other-tooltip-name">${escapeHtml(sector.name)}</span><span class="other-tooltip-amount">${fmtAmount(sector.amount)}</span><span class="other-tooltip-pct ${pctClass}">${sectorPctStr}</span></button>`
            })
            .join('')
          return `<div class="other-tooltip"><div class="other-tooltip-head"><b>${escapeHtml(p.name)}</b><span>按成交额排序</span></div><div class="other-tooltip-summary">上涨 ${d.upCount ?? '—'} 个 · 下跌 ${d.downCount ?? '—'} 个</div><div class="other-tooltip-columns"><span>#</span><span>板块</span><span>成交额</span><span>涨跌幅</span></div><div class="other-tooltip-list">${rows}</div><div class="other-tooltip-hint">点击板块下钻成分股</div></div>`
        }
        return [
          `<b>${p.name}</b>&nbsp;&nbsp;<span style="color:${pct != null && pct > 0 ? '#f04a55' : '#2fac74'}">${pctStr}</span>`,
          `成交额 ${fmtAmount(p.value)}`,
          `上涨 ${d.upCount ?? '—'} 家 / 下跌 ${d.downCount ?? '—'} 家`,
          d.leaderName
            ? `领涨 ${d.leaderName} ${d.leaderChangePct == null ? '' : (d.leaderChangePct > 0 ? '+' : '') + d.leaderChangePct.toFixed(2) + '%'}`
            : '',
          `<span style="color:#5c6474">东方财富 · 点击下钻成分股</span>`
        ]
          .filter(Boolean)
          .join('<br/>')
      }
    },
    series: [
      {
        type: 'treemap',
        roam: false,
        nodeClick: false,
        sort: false,
        breadcrumb: { show: false },
        width: '100%',
        height: '100%',
        itemStyle: {
          borderColor: 'rgba(11,14,20,0.9)',
          borderWidth: 1.5,
          gapWidth: 1.5,
          borderRadius: 3
        },
        label: {
          show: true,
          color: 'rgba(255,255,255,0.92)',
          fontSize: 11,
          lineHeight: 15,
          fontWeight: 600
        },
        upperLabel: { show: false },
        levels: [{ itemStyle: { borderWidth: 0, gapWidth: 1.5 } }],
        data
      }
    ]
  }
})

async function onTreemapClick(params: unknown): Promise<void> {
  const p = params as { data?: { sectorCode?: string; name?: string } }
  if (!p.data?.sectorCode) return
  const d = await window.hanai.market.sectorStocks(p.data.sectorCode)
  drill.value = { code: p.data.sectorCode, name: p.data.name ?? '', stocks: d.stocks, meta: d.meta }
}

const rankTabs = [
  { key: 'gainers', label: '涨幅榜' },
  { key: 'losers', label: '跌幅榜' },
  { key: 'amount', label: '成交额' },
  { key: 'turnover', label: '换手率' }
] as const

const breadthTotal = computed(() => {
  const b = overview.value?.breadth
  if (!b || b.up == null || b.down == null || b.flat == null) return 0
  return b.up + b.down + b.flat
})

// 东方财富的上涨/下跌家数包含涨停/跌停；拆成互斥的五段，避免可视化重复计数。
const breadthSegments = computed(() => {
  const b = overview.value?.breadth
  const limitUp = Math.max(0, b?.limitUp ?? 0)
  const limitDown = Math.max(0, b?.limitDown ?? 0)
  return {
    limitUp,
    up: Math.max(0, (b?.up ?? 0) - limitUp),
    flat: Math.max(0, b?.flat ?? 0),
    down: Math.max(0, (b?.down ?? 0) - limitDown),
    limitDown
  }
})
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1>今日市场</h1>
      <span class="tag" :class="{ gold: overview?.marketStatus === 'trading' }">{{ statusLabel }}</span>
      <span class="sub">数据来源 东方财富 · 近实时快照 · 更新于 {{ fmtTime(lastUpdated) }}</span>
      <button
        class="btn small ghost"
        :class="{ loading: refreshing }"
        style="margin-left: auto"
        :disabled="refreshing"
        @click="refresh(true)"
      >
        <span v-if="refreshing" class="loading-spinner" />
        {{ refreshing ? '刷新中' : '刷新' }}
      </button>
    </div>

    <div v-if="errorMsg" class="card" style="border-color: rgba(240,74,85,0.4); margin-bottom: 14px">
      <b>行情获取失败：</b>{{ errorMsg }}
      <div class="meta-line" style="margin-top: 4px">请检查网络后点击刷新；本页其他面板将展示最近成功的数据。</div>
    </div>

    <!-- 指数卡片 -->
    <div class="index-grid">
      <template v-if="overview">
        <div
          v-for="idx in overview.indices"
          :key="idx.code"
          class="card index-card"
          :class="pctClass(idx.changePct)"
        >
          <div class="idx-name">{{ idx.name }}</div>
          <div class="idx-price num">{{ fmtNum(idx.price) }}</div>
          <div class="idx-change num">
            <span>{{ fmtSign(idx.change) }}</span>
            <span class="idx-pct">{{ fmtPct(idx.changePct) }}</span>
          </div>
          <div class="idx-amount">成交 {{ fmtAmount(idx.amount) }}</div>
        </div>
      </template>
      <template v-else>
        <div v-for="i in 6" :key="i" class="skeleton" style="height: 108px" />
      </template>
    </div>

    <!-- 市场宽度 -->
    <div class="card breadth-card">
      <div class="card-title">
        <span class="breadth-title">
          市场宽度
          <span class="breadth-scope">东方财富口径 · 沪深北非 ST</span>
        </span>
        <span v-if="overview" class="meta-line">两市成交 {{ fmtAmount(overview.breadth.totalAmount) }}</span>
      </div>
      <template v-if="overview && breadthTotal > 0">
        <div class="breadth-bar">
          <div
            v-if="breadthSegments.limitUp > 0"
            class="seg seg-limit-up"
            :style="{ width: (breadthSegments.limitUp / breadthTotal) * 100 + '%' }"
            :title="`涨停 ${breadthSegments.limitUp}`"
          />
          <div
            v-if="breadthSegments.up > 0"
            class="seg seg-up"
            :style="{ width: (breadthSegments.up / breadthTotal) * 100 + '%' }"
            :title="`上涨 ${breadthSegments.up}`"
          />
          <div
            v-if="breadthSegments.flat > 0"
            class="seg seg-flat"
            :style="{ width: (breadthSegments.flat / breadthTotal) * 100 + '%' }"
            :title="`平盘 ${breadthSegments.flat}`"
          />
          <div
            v-if="breadthSegments.down > 0"
            class="seg seg-down"
            :style="{ width: (breadthSegments.down / breadthTotal) * 100 + '%' }"
            :title="`下跌 ${breadthSegments.down}`"
          />
          <div
            v-if="breadthSegments.limitDown > 0"
            class="seg seg-limit-down"
            :style="{ width: (breadthSegments.limitDown / breadthTotal) * 100 + '%' }"
            :title="`跌停 ${breadthSegments.limitDown}`"
          />
        </div>
        <div class="breadth-stats">
          <span class="limit-up">涨停 <b class="num">{{ breadthSegments.limitUp }}</b></span>
          <span class="up">上涨 <b class="num">{{ breadthSegments.up }}</b></span>
          <span class="flat">平盘 <b class="num">{{ breadthSegments.flat }}</b></span>
          <span class="down">下跌 <b class="num">{{ breadthSegments.down }}</b></span>
          <span class="limit-down">跌停 <b class="num">{{ breadthSegments.limitDown }}</b></span>
        </div>
      </template>
      <div v-else-if="!loading" class="empty">暂无涨跌分布数据</div>
      <div v-else class="skeleton" style="height: 40px" />
    </div>

    <div class="main-grid">
      <!-- 板块树图 -->
      <div class="card treemap-card">
        <div class="card-title">
          <span>
            板块热力
            <template v-if="drill"> · {{ drill.name }}</template>
          </span>
          <span class="title-actions">
            <template v-if="!drill">
              <button
                class="btn small"
                :class="{
                  primary: sectorType === 'industry',
                  loading: sectorLoading && sectorType === 'industry'
                }"
                :disabled="sectorLoading"
                @click="switchSectorType('industry')"
              >
                <span v-if="sectorLoading && sectorType === 'industry'" class="loading-spinner" />
                行业
              </button>
              <button
                class="btn small"
                :class="{
                  primary: sectorType === 'concept',
                  loading: sectorLoading && sectorType === 'concept'
                }"
                :disabled="sectorLoading"
                @click="switchSectorType('concept')"
              >
                <span v-if="sectorLoading && sectorType === 'concept'" class="loading-spinner" />
                概念
              </button>
            </template>
            <button v-else class="btn small" @click="drill = null">← 返回板块</button>
          </span>
        </div>

        <div v-if="!drill" class="treemap-body" :class="{ 'panel-updating': sectorLoading }">
          <div v-if="sectorLoading" class="panel-loading-indicator">
            <span class="loading-spinner" />正在更新板块
          </div>
          <EChart :option="treemapOption" @chart-click="onTreemapClick" />
          <div class="legend">
            <span class="legend-label">涨</span>
            <span
              v-for="(c, i) in [6, 3, 1, 0, -1, -3, -6]"
              :key="i"
              class="legend-swatch"
              :style="{ background: heatColor(c) }"
              :title="c + '%'"
            />
            <span class="legend-label">跌</span>
            <span class="legend-note">面积 = 板块成交额（个股可重叠）· 其他固定</span>
          </div>
        </div>

        <div v-else class="drill-body">
          <table class="data">
            <thead>
              <tr>
                <th>名称</th>
                <th>最新价</th>
                <th>涨跌幅</th>
                <th>成交额</th>
                <th>换手率</th>
                <th>市值</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in drill.stocks" :key="s.secId" @click="router.push(`/stock/${s.secId}`)">
                <td>
                  <b>{{ s.name }}</b>
                  <span class="num" style="color: var(--text-muted); margin-left: 6px">{{ s.code }}</span>
                </td>
                <td class="num">{{ fmtNum(s.price) }}</td>
                <td class="num" :class="pctClass(s.changePct)">{{ fmtPct(s.changePct) }}</td>
                <td class="num">{{ fmtAmount(s.amount) }}</td>
                <td class="num">{{ s.turnoverRate == null ? '—' : s.turnoverRate.toFixed(2) + '%' }}</td>
                <td class="num">{{ fmtAmount(s.marketCap) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 榜单 -->
      <div class="card rank-card">
        <div class="card-title">
          <span>榜单</span>
          <span class="title-actions">
            <button
              v-for="t in rankTabs"
              :key="t.key"
              class="btn small"
              :class="{
                primary: rankKind === t.key,
                loading: rankLoading && rankKind === t.key
              }"
              :disabled="rankLoading"
              @click="switchRank(t.key)"
            >
              <span v-if="rankLoading && rankKind === t.key" class="loading-spinner" />
              {{ t.label }}
            </button>
          </span>
        </div>
        <div class="rank-body" :class="{ 'panel-updating': rankLoading }">
          <div v-if="rankLoading" class="panel-loading-indicator">
            <span class="loading-spinner" />正在更新榜单
          </div>
          <table class="data">
            <thead>
              <tr>
                <th>名称</th>
                <th>最新价</th>
                <th>涨跌幅</th>
                <th>{{ rankKind === 'turnover' ? '换手率' : '成交额' }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in ranks" :key="r.secId" @click="router.push(`/stock/${r.secId}`)">
                <td>
                  <b>{{ r.name }}</b>
                  <div class="num" style="color: var(--text-muted); font-size: 11px">{{ r.code }}</div>
                </td>
                <td class="num">{{ fmtNum(r.price) }}</td>
                <td class="num" :class="pctClass(r.changePct)">{{ fmtPct(r.changePct) }}</td>
                <td class="num">
                  {{
                    rankKind === 'turnover'
                      ? r.turnoverRate == null
                        ? '—'
                        : r.turnoverRate.toFixed(2) + '%'
                      : fmtAmount(r.amount)
                  }}
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="!ranks.length && !loading" class="empty">暂无榜单数据</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.loading-spinner {
  display: inline-block;
  width: 11px;
  height: 11px;
  flex: 0 0 auto;
  border: 1.5px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: loading-spin 0.7s linear infinite;
}
@keyframes loading-spin {
  to {
    transform: rotate(360deg);
  }
}
.btn.loading:disabled {
  cursor: default;
  opacity: 0.82;
}
.panel-updating {
  pointer-events: none;
}
.panel-updating > :not(.panel-loading-indicator) {
  opacity: 0.5;
  transition: opacity 0.15s ease;
}
.panel-loading-indicator {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 9px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-s);
  background: rgba(11, 14, 20, 0.88);
  color: var(--text-secondary);
  font-size: 11px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.24);
}
:deep(.other-tooltip) {
  width: 390px;
}
:deep(.other-tooltip-head) {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 4px;
}
:deep(.other-tooltip-head b) {
  font-size: 13px;
}
:deep(.other-tooltip-head span),
:deep(.other-tooltip-summary),
:deep(.other-tooltip-hint) {
  color: var(--text-muted);
  font-size: 10.5px;
}
:deep(.other-tooltip-summary) {
  padding-bottom: 7px;
  border-bottom: 1px solid var(--border-subtle);
}
:deep(.other-tooltip-columns) {
  display: grid;
  grid-template-columns: 27px minmax(0, 1fr) 82px 62px;
  gap: 7px;
  padding: 5px 8px 3px;
  color: var(--text-muted);
  font-size: 10px;
}
:deep(.other-tooltip-columns span:nth-child(1)),
:deep(.other-tooltip-columns span:nth-child(3)),
:deep(.other-tooltip-columns span:nth-child(4)) {
  text-align: right;
}
:deep(.other-tooltip-list) {
  max-height: 238px;
  overflow-y: auto;
  overscroll-behavior: contain;
  margin: 3px -5px 0;
  padding: 0 3px;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
}
:deep(.other-tooltip-list::-webkit-scrollbar) {
  width: 6px;
}
:deep(.other-tooltip-list::-webkit-scrollbar-thumb) {
  border-radius: 99px;
  background: var(--border-strong);
}
:deep(.other-tooltip-row) {
  display: grid;
  grid-template-columns: 27px minmax(0, 1fr) 82px 62px;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 6px 5px;
  border: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.045);
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
:deep(.other-tooltip-row:hover) {
  background: var(--bg-hover);
  color: var(--text-primary);
}
:deep(.other-tooltip-rank) {
  color: var(--text-muted);
  font-family: var(--font-num);
  font-size: 10px;
  text-align: right;
}
:deep(.other-tooltip-name) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:deep(.other-tooltip-pct) {
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
:deep(.other-tooltip-amount) {
  color: var(--text-secondary);
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
:deep(.other-tooltip-pct.is-up) {
  color: var(--up);
}
:deep(.other-tooltip-pct.is-down) {
  color: var(--down);
}
:deep(.other-tooltip-pct.is-flat) {
  color: var(--flat);
}
:deep(.other-tooltip-hint) {
  padding-top: 6px;
  text-align: right;
}
.index-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 12px;
  margin-bottom: 14px;
}
.index-card {
  padding: 13px 15px;
  transition: border-color 0.2s ease;
}
.index-card.up {
  border-color: rgba(240, 74, 85, 0.25);
}
.index-card.down {
  border-color: rgba(47, 172, 116, 0.25);
}
.idx-name {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 5px;
}
.idx-price {
  font-size: 21px;
  font-weight: 700;
  color: inherit;
}
.index-card.up .idx-price,
.index-card.up .idx-change {
  color: var(--up);
}
.index-card.down .idx-price,
.index-card.down .idx-change {
  color: var(--down);
}
.idx-change {
  display: flex;
  gap: 8px;
  font-size: 12.5px;
  margin-top: 2px;
}
.idx-amount {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 6px;
}

.breadth-card {
  margin-bottom: 14px;
}
.breadth-title {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.breadth-scope {
  color: var(--text-muted);
  font-size: 10.5px;
  font-weight: 400;
  letter-spacing: 0;
}
.breadth-bar {
  display: flex;
  height: 14px;
  border-radius: 7px;
  overflow: hidden;
  gap: 2px;
  margin-bottom: 9px;
}
.seg {
  transition: width 0.25s ease;
}
.seg-limit-up {
  background: linear-gradient(90deg, #9f303c, #bd3b48);
}
.seg-up {
  background: linear-gradient(90deg, #d34450, #e6525d);
}
.seg-flat {
  background: #3a4150;
}
.seg-down {
  background: linear-gradient(90deg, #299666, #2fac74);
}
.seg-limit-down {
  background: linear-gradient(90deg, #237a59, #298f66);
}
.breadth-stats {
  display: flex;
  gap: 22px;
  font-size: 12px;
}
.breadth-stats b {
  font-size: 13.5px;
  margin-left: 3px;
}
.breadth-stats .limit-up {
  color: #cf5964;
}
.breadth-stats .limit-down {
  color: #329d73;
}

.main-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(340px, 1fr);
  gap: 14px;
  align-items: start;
}
.treemap-card {
  min-height: 560px;
  display: flex;
  flex-direction: column;
}
.treemap-body {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 480px;
}
.treemap-body .echart {
  flex: 1;
}
.legend {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-top: 10px;
  font-size: 11px;
  color: var(--text-muted);
}
.legend-swatch {
  width: 26px;
  height: 10px;
  border-radius: 2px;
}
.legend-label {
  margin: 0 4px;
}
.legend-note {
  margin-left: auto;
}
.drill-body {
  flex: 1;
  overflow-y: auto;
  max-height: 520px;
}
.title-actions {
  display: flex;
  gap: 6px;
}
.rank-card {
  /* 与左侧树图卡片等高，内部滚动，避免撑出页面级滚动条 */
  height: 560px;
  display: flex;
  flex-direction: column;
}
.rank-body {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.rank-body thead th {
  position: sticky;
  top: 0;
  background: #131722;
  z-index: 1;
}
</style>
