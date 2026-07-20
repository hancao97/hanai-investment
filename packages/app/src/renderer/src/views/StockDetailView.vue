<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { StockMetrics, ValuationSummary, KLineBar, TrendPoint, WatchGroup } from '@shared/types'
import type { EChartsCoreOption } from 'echarts/core'
import EChart from '../components/EChart.vue'
import PersonaPicker from '../components/PersonaPicker.vue'
import CommitteeLauncher from '../components/CommitteeLauncher.vue'
import { fmtNum, fmtPct, fmtSign, fmtAmount, pctClass, fmtTime, fmtDateTime } from '../utils/format'

const route = useRoute()
const router = useRouter()
const secId = computed(() => String(route.params.secId ?? ''))

const metrics = ref<StockMetrics | null>(null)
const valuation = ref<ValuationSummary | null>(null)
const valuationError = ref('')
const bars = ref<KLineBar[]>([])
const trend = ref<{ points: TrendPoint[]; prevClose: number | null } | null>(null)
const chartMode = ref<'trend' | 'daily' | 'weekly' | 'monthly'>('daily')
const watched = ref(false)
const groups = ref<WatchGroup[]>([])
const pickerOpen = ref(false)
const committeeOpen = ref(false)
const loading = ref(true)
let timer: ReturnType<typeof setInterval> | null = null

const VALUATION_LABELS: Record<number, string> = {
  0: '数据不足',
  1: '数据陈旧',
  2: '价值陷阱嫌疑',
  3: '严重低估',
  4: '低估',
  5: '合理范围',
  6: '高估',
  7: '严重高估'
}

function valuationTagClass(rank: number | null): string {
  if (rank == null) return ''
  if (rank === 3 || rank === 4) return 'green'
  if (rank === 6 || rank === 7) return 'red'
  if (rank === 5) return 'gold'
  return ''
}

async function loadAll(): Promise<void> {
  loading.value = true
  valuationError.value = ''
  metrics.value = await window.hanai.market.metrics(secId.value)
  loading.value = false
  void loadChart()
  void window.hanai.watch.isWatched(secId.value).then((w) => (watched.value = w))
  void window.hanai.watch.groups().then((g) => (groups.value = g))
  try {
    valuation.value = await window.hanai.valuation.get(secId.value)
    if (!valuation.value) valuationError.value = '暂无估值数据（供应商无此标的或不可用）'
  } catch (e) {
    valuationError.value = e instanceof Error ? e.message : String(e)
  }
}

async function loadChart(): Promise<void> {
  if (chartMode.value === 'trend') {
    const t = await window.hanai.market.trend(secId.value)
    trend.value = { points: t.points, prevClose: t.prevClose }
  } else {
    const klt = chartMode.value === 'daily' ? '101' : chartMode.value === 'weekly' ? '102' : '103'
    const k = await window.hanai.market.kline(secId.value, klt)
    bars.value = k.bars
  }
}

async function refreshQuote(): Promise<void> {
  const m = await window.hanai.market.metrics(secId.value)
  if (m) metrics.value = m
  if (chartMode.value === 'trend') void loadChart()
}

watch(secId, () => void loadAll())
watch(chartMode, () => void loadChart())

onMounted(() => {
  void loadAll()
  timer = setInterval(() => void refreshQuote(), 15000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

async function toggleWatch(): Promise<void> {
  const g = groups.value[0]
  if (!g) return
  if (watched.value) {
    for (const grp of groups.value) await window.hanai.watch.remove(grp.id, secId.value)
    watched.value = false
  } else {
    await window.hanai.watch.add(g.id, secId.value)
    watched.value = true
  }
}

async function startChat(personaId: string): Promise<void> {
  pickerOpen.value = false
  const conv = await window.hanai.chat.create(personaId, secId.value)
  void router.push(`/chat/${conv.id}`)
}

// ---------- 图表 ----------
const AXIS_STYLE = {
  axisLine: { lineStyle: { color: 'rgba(255,255,255,0.12)' } },
  axisLabel: { color: '#5c6474', fontSize: 10.5 },
  splitLine: { lineStyle: { color: 'rgba(255,255,255,0.045)' } }
}

const priceChartOption = computed<EChartsCoreOption | null>(() => {
  if (chartMode.value === 'trend') {
    if (!trend.value?.points.length) return null
    const pts = trend.value.points
    const base = trend.value.prevClose
    return {
      tooltip: { trigger: 'axis', backgroundColor: '#161b26', borderColor: 'rgba(255,255,255,0.14)', textStyle: { color: '#e8eaf0', fontSize: 11 } },
      grid: [
        { left: 52, right: 16, top: 12, height: '62%' },
        { left: 52, right: 16, top: '76%', height: '18%' }
      ],
      xAxis: [
        { type: 'category', data: pts.map((p) => p.time), gridIndex: 0, ...AXIS_STYLE },
        { type: 'category', data: pts.map((p) => p.time), gridIndex: 1, ...AXIS_STYLE, axisLabel: { show: false } }
      ],
      yAxis: [
        { scale: true, gridIndex: 0, ...AXIS_STYLE },
        { gridIndex: 1, axisLabel: { show: false }, splitLine: { show: false } }
      ],
      series: [
        {
          type: 'line',
          data: pts.map((p) => p.price),
          showSymbol: false,
          lineStyle: { color: '#e0b34c', width: 1.4 },
          areaStyle: { color: 'rgba(224,179,76,0.08)' },
          markLine: base
            ? {
                symbol: 'none',
                label: { show: false },
                lineStyle: { color: '#5c6474', type: 'dashed', width: 1 },
                data: [{ yAxis: base }]
              }
            : undefined
        },
        {
          type: 'line',
          data: pts.map((p) => p.avgPrice),
          showSymbol: false,
          lineStyle: { color: '#5b8def', width: 1 },
          xAxisIndex: 0,
          yAxisIndex: 0
        },
        {
          type: 'bar',
          data: pts.map((p) => p.volume),
          xAxisIndex: 1,
          yAxisIndex: 1,
          itemStyle: { color: 'rgba(139,147,167,0.5)' }
        }
      ]
    }
  }
  if (!bars.value.length) return null
  const b = bars.value
  return {
    tooltip: { trigger: 'axis', backgroundColor: '#161b26', borderColor: 'rgba(255,255,255,0.14)', textStyle: { color: '#e8eaf0', fontSize: 11 } },
    grid: [
      { left: 52, right: 16, top: 12, height: '62%' },
      { left: 52, right: 16, top: '76%', height: '18%' }
    ],
    xAxis: [
      { type: 'category', data: b.map((x) => x.date), gridIndex: 0, ...AXIS_STYLE },
      { type: 'category', data: b.map((x) => x.date), gridIndex: 1, ...AXIS_STYLE, axisLabel: { show: false } }
    ],
    yAxis: [
      { scale: true, gridIndex: 0, ...AXIS_STYLE },
      { gridIndex: 1, axisLabel: { show: false }, splitLine: { show: false } }
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1], start: 55, end: 100 },
      { type: 'slider', xAxisIndex: [0, 1], top: '95%', height: 14, borderColor: 'transparent', backgroundColor: 'rgba(255,255,255,0.04)' }
    ],
    series: [
      {
        type: 'candlestick',
        data: b.map((x) => [x.open, x.close, x.low, x.high]),
        itemStyle: {
          color: '#f04a55',
          color0: '#2fac74',
          borderColor: '#f04a55',
          borderColor0: '#2fac74'
        }
      },
      {
        type: 'bar',
        data: b.map((x) => ({
          value: x.volume,
          itemStyle: { color: x.close >= x.open ? 'rgba(240,74,85,0.5)' : 'rgba(47,172,116,0.5)' }
        })),
        xAxisIndex: 1,
        yAxisIndex: 1
      }
    ]
  }
})

const valuationChartOption = computed<EChartsCoreOption | null>(() => {
  const v = valuation.value
  if (!v || (!v.series.price.length && !v.series.medps.length)) return null
  const medps = v.series.medps
  // 估值色带：以价值线为基准的 ±10% / ±30% 区间（上方红=高估，下方绿=低估）
  const bandSeries = (
    name: string,
    fromRatio: number,
    toRatio: number,
    color: string
  ): Record<string, unknown>[] => [
    {
      name: `${name}-base`,
      type: 'line',
      data: medps.map(([t, val]) => [t, val * fromRatio]),
      stack: name,
      showSymbol: false,
      silent: true,
      lineStyle: { opacity: 0 },
      areaStyle: { opacity: 0 },
      tooltip: { show: false }
    },
    {
      name: `${name}-fill`,
      type: 'line',
      data: medps.map(([t, val]) => [t, val * (toRatio - fromRatio)]),
      stack: name,
      showSymbol: false,
      silent: true,
      lineStyle: { opacity: 0 },
      areaStyle: { color },
      tooltip: { show: false }
    }
  ]
  const fmt2 = (n: unknown): string => {
    const x = Number(n)
    return Number.isFinite(x) ? x.toFixed(2) : '—'
  }
  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#161b26',
      borderColor: 'rgba(255,255,255,0.14)',
      textStyle: { color: '#e8eaf0', fontSize: 11 },
      formatter: (params: { seriesName: string; value: [string | number, number]; marker: string; axisValueLabel?: string }[]): string => {
        const rows = params.filter((p) => p.seriesName === '价格' || p.seriesName === '大师价值线')
        if (!rows.length) return ''
        const date = String(rows[0].axisValueLabel ?? rows[0].value[0]).slice(0, 10)
        const price = rows.find((p) => p.seriesName === '价格')
        const fair = rows.find((p) => p.seriesName === '大师价值线')
        const lines = [`<b>${date}</b>`]
        if (price) lines.push(`${price.marker} 股价 <b>${fmt2(price.value[1])}</b>`)
        if (fair) {
          lines.push(`${fair.marker} 大师价值 <b>${fmt2(fair.value[1])}</b>`)
          if (price && Number(fair.value[1]) > 0) {
            const dev = ((Number(price.value[1]) - Number(fair.value[1])) / Number(fair.value[1])) * 100
            lines.push(`<span style="color:${dev > 0 ? '#f04a55' : '#2fac74'}">偏离 ${dev > 0 ? '+' : ''}${dev.toFixed(2)}%</span>`)
          }
        }
        return lines.join('<br/>')
      }
    },
    legend: {
      data: ['价格', '大师价值线'],
      textStyle: { color: '#9aa3b5', fontSize: 11 },
      top: 0,
      right: 0
    },
    grid: { left: 56, right: 16, top: 28, bottom: 24 },
    xAxis: { type: 'time', ...AXIS_STYLE },
    yAxis: { scale: true, ...AXIS_STYLE, axisLabel: { ...AXIS_STYLE.axisLabel, formatter: (val: number) => val.toFixed(0) } },
    series: [
      // 高估带（价值线上方，红色系，越远越深）
      ...bandSeries('band+30', 1.1, 1.3, 'rgba(240,74,85,0.16)'),
      ...bandSeries('band+10', 1.0, 1.1, 'rgba(240,74,85,0.07)'),
      // 低估带（价值线下方，绿色系）
      ...bandSeries('band-10', 0.9, 1.0, 'rgba(47,172,116,0.07)'),
      ...bandSeries('band-30', 0.7, 0.9, 'rgba(47,172,116,0.16)'),
      {
        name: '大师价值线',
        type: 'line',
        data: medps,
        showSymbol: false,
        z: 3,
        lineStyle: { color: '#e0b34c', width: 1.8 }
      },
      {
        name: '价格',
        type: 'line',
        data: v.series.price,
        showSymbol: false,
        z: 4,
        lineStyle: { color: '#7ab3f5', width: 1.3 }
      }
    ]
  }
})

const radarOption = computed<EChartsCoreOption | null>(() => {
  const d = valuation.value?.dimensions
  if (!d) return null
  const vals = [d.gfValue, d.growth, d.momentum, d.profitability, d.financialStrength]
  if (vals.every((v) => v == null)) return null
  return {
    radar: {
      indicator: [
        { name: '价值', max: 10 },
        { name: '成长', max: 10 },
        { name: '动量', max: 10 },
        { name: '盈利', max: 10 },
        { name: '财务', max: 10 }
      ],
      radius: '68%',
      splitNumber: 5,
      axisName: { color: '#9aa3b5', fontSize: 11 },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
      splitArea: { show: false },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } }
    },
    series: [
      {
        type: 'radar',
        data: [
          {
            value: vals.map((v) => v ?? 0),
            areaStyle: { color: 'rgba(224,179,76,0.22)' },
            lineStyle: { color: '#e0b34c' },
            itemStyle: { color: '#e0b34c' }
          }
        ]
      }
    ]
  }
})

const deviation = computed(() => {
  const price = metrics.value?.price
  const fair = valuation.value?.medps
  if (price == null || fair == null || fair <= 0) return null
  return ((price - fair) / fair) * 100
})

const chartTabs = [
  { key: 'trend', label: '分时' },
  { key: 'daily', label: '日K' },
  { key: 'weekly', label: '周K' },
  { key: 'monthly', label: '月K' }
] as const
</script>

<template>
  <div class="page">
    <template v-if="metrics">
      <!-- 头部 -->
      <div class="stock-header">
        <div class="sh-left">
          <div class="sh-name-row">
            <h1>{{ metrics.name }}</h1>
            <span class="num sh-code">{{ metrics.code }}</span>
            <span class="tag">{{ secId.startsWith('1.') ? '上交所' : '深交所' }}</span>
            <span v-if="metrics.industry" class="tag">{{ metrics.industry }}</span>
          </div>
          <div class="meta-line">行情 {{ metrics.meta.sourceName }} · 采集 {{ fmtTime(metrics.meta.fetchedAt) }} · 近实时快照</div>
        </div>
        <div class="sh-price" :class="pctClass(metrics.changePct)">
          <span class="sh-last num">{{ fmtNum(metrics.price) }}</span>
          <span class="sh-chg num">{{ fmtSign(metrics.change) }} / {{ fmtPct(metrics.changePct) }}</span>
        </div>
        <div class="sh-actions">
          <button class="btn" :class="{ primary: !watched }" @click="toggleWatch">
            {{ watched ? '✓ 已自选' : '☆ 加自选' }}
          </button>
          <button class="btn" @click="pickerOpen = true">问一位大师</button>
          <button class="btn primary" @click="committeeOpen = true">发起大师分析</button>
        </div>
      </div>

      <div class="detail-grid">
        <!-- 左列：图表 + 行情/基本面 -->
        <div class="col-main">
          <div class="card">
            <div class="card-title">
              <span>价格走势 <span class="meta-line" style="display:inline">（东方财富 · 前复权）</span></span>
              <span class="title-actions">
                <button
                  v-for="t in chartTabs"
                  :key="t.key"
                  class="btn small"
                  :class="{ primary: chartMode === t.key }"
                  @click="chartMode = t.key"
                >
                  {{ t.label }}
                </button>
              </span>
            </div>
            <div class="chart-box">
              <EChart :option="priceChartOption" />
              <div v-if="!priceChartOption" class="empty">图表数据加载中…</div>
            </div>
          </div>

          <div class="card">
            <div class="card-title">实时行情快照</div>
            <div class="metric-grid">
              <div class="metric"><span>今开</span><b class="num">{{ fmtNum(metrics.open) }}</b></div>
              <div class="metric"><span>最高</span><b class="num up">{{ fmtNum(metrics.high) }}</b></div>
              <div class="metric"><span>最低</span><b class="num down">{{ fmtNum(metrics.low) }}</b></div>
              <div class="metric"><span>昨收</span><b class="num">{{ fmtNum(metrics.prevClose) }}</b></div>
              <div class="metric"><span>成交额</span><b class="num">{{ fmtAmount(metrics.amount) }}</b></div>
              <div class="metric"><span>换手率</span><b class="num">{{ metrics.turnoverRate == null ? '—' : metrics.turnoverRate.toFixed(2) + '%' }}</b></div>
              <div class="metric"><span>量比</span><b class="num">{{ fmtNum(metrics.volumeRatio) }}</b></div>
              <div class="metric"><span>总市值</span><b class="num">{{ fmtAmount(metrics.marketCap) }}</b></div>
              <div class="metric"><span>流通市值</span><b class="num">{{ fmtAmount(metrics.floatCap) }}</b></div>
            </div>
          </div>

          <div class="card">
            <div class="card-title">
              基本面（财报期数据）
              <span class="meta-line">低频数据 · 与盘中价格时效不同</span>
            </div>
            <div class="metric-grid">
              <div class="metric"><span>PE(TTM)</span><b class="num">{{ metrics.peTtm == null || metrics.peTtm <= 0 ? '—' : metrics.peTtm.toFixed(2) }}</b></div>
              <div class="metric"><span>PE(静)</span><b class="num">{{ metrics.peStatic == null || metrics.peStatic <= 0 ? '—' : metrics.peStatic.toFixed(2) }}</b></div>
              <div class="metric"><span>PB</span><b class="num">{{ fmtNum(metrics.pb) }}</b></div>
              <div class="metric"><span>ROE</span><b class="num">{{ metrics.roe == null ? '—' : metrics.roe.toFixed(2) + '%' }}</b></div>
              <div class="metric"><span>每股收益</span><b class="num">{{ fmtNum(metrics.eps) }}</b></div>
              <div class="metric"><span>每股净资产</span><b class="num">{{ fmtNum(metrics.bvps) }}</b></div>
              <div class="metric"><span>营收</span><b class="num">{{ fmtAmount(metrics.totalRevenue) }}</b></div>
              <div class="metric"><span>营收同比</span><b class="num" :class="pctClass(metrics.revenueYoy)">{{ fmtPct(metrics.revenueYoy) }}</b></div>
              <div class="metric"><span>净利润</span><b class="num">{{ fmtAmount(metrics.netProfit) }}</b></div>
              <div class="metric"><span>净利同比</span><b class="num" :class="pctClass(metrics.netProfitYoy)">{{ fmtPct(metrics.netProfitYoy) }}</b></div>
              <div class="metric"><span>毛利率</span><b class="num">{{ metrics.grossMargin == null ? '—' : metrics.grossMargin.toFixed(2) + '%' }}</b></div>
              <div class="metric"><span>负债率</span><b class="num">{{ metrics.debtRatio == null ? '—' : metrics.debtRatio.toFixed(2) + '%' }}</b></div>
            </div>
          </div>
        </div>

        <!-- 右列：价值大师估值 -->
        <div class="col-side">
          <div class="card valuation-card">
            <div class="card-title">
              价值判断
              <span v-if="valuation" class="tag" :class="valuationTagClass(valuation.valuationRank)">
                {{ valuation.valuationRank != null ? VALUATION_LABELS[valuation.valuationRank] : '—' }}
              </span>
            </div>

            <template v-if="valuation">
              <div class="val-hero">
                <div class="val-item">
                  <span>大师价值</span>
                  <b class="num">{{ fmtNum(valuation.medps) }}</b>
                </div>
                <div class="val-item">
                  <span>现价偏离</span>
                  <b class="num" :class="deviation == null ? '' : deviation > 0 ? 'up' : 'down'">
                    {{ deviation == null ? '—' : fmtPct(deviation) }}
                  </b>
                </div>
                <div class="val-item">
                  <span>GF 评分</span>
                  <b class="num gold-text">{{ valuation.gfScore ?? '—' }}<i v-if="valuation.gfScore != null">/100</i></b>
                </div>
              </div>

              <div class="radar-box">
                <EChart :option="radarOption" />
                <div v-if="!radarOption" class="empty">暂无五维评分</div>
              </div>

              <div class="meta-line" style="margin-top: 4px">
                {{ valuation.meta.sourceName }}
                <br />
                数据日期 {{ valuation.meta.sourceTimestamp ?? '—' }} · 采集 {{ fmtDateTime(valuation.meta.fetchedAt) }}
                <span v-if="valuation.meta.cacheState === 'cached'" class="tag">缓存</span>
                <span v-else-if="valuation.meta.cacheState === 'stale'" class="tag" style="color: var(--warn)">数据已过期</span>
              </div>
            </template>
            <div v-else-if="valuationError" class="empty">
              <div>{{ valuationError }}</div>
              <div style="font-size: 11px">估值为日级数据，不影响行情与讨论功能</div>
            </div>
            <div v-else class="skeleton" style="height: 200px" />
          </div>

          <div class="card">
            <div class="card-title">价值曲线</div>
            <div class="val-chart-box">
              <EChart :option="valuationChartOption" />
              <div v-if="!valuationChartOption" class="empty">暂无估值曲线</div>
            </div>
            <div class="meta-line" style="margin-top: 6px">
              金线为大师价值线，蓝线为股价；红带为高估区（+10% / +30%），绿带为低估区（−10% / −30%）。
              价值线末端为供应商预测，非历史真实点。
            </div>
          </div>
        </div>
      </div>
    </template>

    <div v-else-if="loading" class="page-loading">
      <div class="skeleton" style="height: 84px; margin-bottom: 14px" />
      <div class="skeleton" style="height: 420px" />
    </div>
    <div v-else class="empty" style="padding-top: 120px">
      <div>无法获取该证券的行情数据</div>
      <button class="btn" @click="loadAll">重试</button>
    </div>

    <PersonaPicker v-model:open="pickerOpen" @pick="startChat" />
    <CommitteeLauncher
      v-model:open="committeeOpen"
      :sec-id="secId"
      :stock-name="metrics?.name ?? ''"
    />
  </div>
</template>

<style scoped>
.stock-header {
  display: flex;
  align-items: center;
  gap: 26px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.sh-name-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 3px;
}
.sh-name-row h1 {
  font-size: 21px;
  font-weight: 700;
}
.sh-code {
  color: var(--text-muted);
  font-size: 14px;
}
.sh-price {
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.sh-last {
  font-size: 30px;
  font-weight: 700;
}
.sh-chg {
  font-size: 13.5px;
}
.sh-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
}

.detail-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.65fr) minmax(330px, 1fr);
  gap: 14px;
  align-items: start;
}
.col-main,
.col-side {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.chart-box {
  height: 380px;
  position: relative;
}
.title-actions {
  display: flex;
  gap: 6px;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px 18px;
}
.metric {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 12.5px;
  padding: 4px 0;
  border-bottom: 1px dashed rgba(255, 255, 255, 0.05);
}
.metric span {
  color: var(--text-muted);
}
.metric b {
  font-size: 13px;
  font-weight: 600;
}

.val-hero {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.val-item {
  flex: 1;
  background: var(--bg-raised-2);
  border-radius: var(--radius-m);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.val-item span {
  font-size: 11px;
  color: var(--text-muted);
}
.val-item b {
  font-size: 17px;
}
.gold-text {
  color: var(--accent-strong);
}
.gold-text i {
  font-style: normal;
  font-size: 11px;
  color: var(--text-muted);
}
.radar-box {
  height: 210px;
  position: relative;
}
.val-chart-box {
  height: 260px;
  position: relative;
}
.page-loading {
  padding-top: 8px;
}
</style>
