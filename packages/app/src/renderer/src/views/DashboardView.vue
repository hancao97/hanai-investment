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

async function refresh(): Promise<void> {
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
  }
}

async function switchSectorType(t: 'industry' | 'concept'): Promise<void> {
  sectorType.value = t
  drill.value = null
  sectors.value = await window.hanai.market.sectors(t)
}

async function switchRank(k: typeof rankKind.value): Promise<void> {
  rankKind.value = k
  const r = await window.hanai.market.ranks(k)
  ranks.value = r.entries
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
    const minorAmount = minors.reduce((sum, s) => sum + (s.amount as number), 0)
    const weightedPct =
      minorAmount > 0
        ? minors.reduce((sum, s) => sum + (s.changePct ?? 0) * (s.amount as number), 0) / minorAmount
        : null
    const upN = minors.filter((s) => (s.changePct ?? 0) > 0).length
    data.push({
      name: `其他 ${minors.length} 个板块`,
      value: minorAmount,
      changePct: weightedPct,
      upCount: upN,
      downCount: minors.length - upN,
      leaderName: null,
      leaderChangePct: null,
      sectorCode: null,
      isOthers: true,
      minorNames: minors.slice(0, 12).map((s) => s.name),
      itemStyle: { color: '#262b36' },
      label: {
        formatter: (p: { data: { changePct: number | null } }): string => {
          const pct = p.data.changePct
          return `其他 ${minors.length} 个\n${pct == null ? '—' : (pct > 0 ? '+' : '') + pct.toFixed(2) + '%'}`
        }
      }
    })
  }
  return {
    tooltip: {
      backgroundColor: '#161b26',
      borderColor: 'rgba(255,255,255,0.14)',
      textStyle: { color: '#e8eaf0', fontSize: 12 },
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
          minorNames?: string[]
        }
      }): string => {
        const d = p.data
        const pct = d.changePct
        const pctStr = pct == null ? '—' : `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`
        if (d.isOthers) {
          return [
            `<b>${p.name}</b>&nbsp;&nbsp;<span style="color:${pct != null && pct > 0 ? '#f04a55' : '#2fac74'}">${pctStr}（成交额加权）</span>`,
            `合计成交额 ${fmtAmount(p.value)}`,
            `上涨 ${d.upCount ?? '—'} 个 / 下跌 ${d.downCount ?? '—'} 个板块`,
            d.minorNames?.length ? `含 ${d.minorNames.join('、')} 等` : '',
            `<span style="color:#5c6474">成交额占比过小的板块合并展示</span>`
          ]
            .filter(Boolean)
            .join('<br/>')
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
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1>今日市场</h1>
      <span class="tag" :class="{ gold: overview?.marketStatus === 'trading' }">{{ statusLabel }}</span>
      <span class="sub">数据来源 东方财富 · 近实时快照 · 更新于 {{ fmtTime(lastUpdated) }}</span>
      <button class="btn small ghost" style="margin-left: auto" @click="refresh">刷新</button>
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
        市场宽度
        <span v-if="overview" class="meta-line">两市成交 {{ fmtAmount(overview.breadth.totalAmount) }}</span>
      </div>
      <template v-if="overview && breadthTotal > 0">
        <div class="breadth-bar">
          <div
            class="seg seg-up"
            :style="{ width: ((overview.breadth.up ?? 0) / breadthTotal) * 100 + '%' }"
          />
          <div
            class="seg seg-flat"
            :style="{ width: ((overview.breadth.flat ?? 0) / breadthTotal) * 100 + '%' }"
          />
          <div
            class="seg seg-down"
            :style="{ width: ((overview.breadth.down ?? 0) / breadthTotal) * 100 + '%' }"
          />
        </div>
        <div class="breadth-stats">
          <span class="up">上涨 <b class="num">{{ overview.breadth.up }}</b></span>
          <span class="up">涨停 <b class="num">{{ overview.breadth.limitUp ?? '—' }}</b></span>
          <span class="flat">平盘 <b class="num">{{ overview.breadth.flat }}</b></span>
          <span class="down">跌停 <b class="num">{{ overview.breadth.limitDown ?? '—' }}</b></span>
          <span class="down">下跌 <b class="num">{{ overview.breadth.down }}</b></span>
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
                :class="{ primary: sectorType === 'industry' }"
                @click="switchSectorType('industry')"
              >
                行业
              </button>
              <button
                class="btn small"
                :class="{ primary: sectorType === 'concept' }"
                @click="switchSectorType('concept')"
              >
                概念
              </button>
            </template>
            <button v-else class="btn small" @click="drill = null">← 返回板块</button>
          </span>
        </div>

        <div v-if="!drill" class="treemap-body">
          <EChart :option="treemapOption" @chart-click="onTreemapClick" />
          <div class="legend">
            <span class="legend-label">跌</span>
            <span
              v-for="(c, i) in [-6, -3, -1, 0, 1, 3, 6]"
              :key="i"
              class="legend-swatch"
              :style="{ background: heatColor(c) }"
              :title="c + '%'"
            />
            <span class="legend-label">涨</span>
            <span class="legend-note">面积 = 成交额</span>
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
              :class="{ primary: rankKind === t.key }"
              @click="switchRank(t.key)"
            >
              {{ t.label }}
            </button>
          </span>
        </div>
        <div class="rank-body">
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
.seg-up {
  background: linear-gradient(90deg, #d8434e, #f04a55);
}
.seg-flat {
  background: #3a4150;
}
.seg-down {
  background: linear-gradient(90deg, #2fac74, #27946a);
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
