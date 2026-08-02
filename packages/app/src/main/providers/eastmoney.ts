import { fetchJson } from './http'
import { getKlineTx, getTrendTx } from './tencent'
import type {
  MarketOverview,
  IndexQuote,
  SectorBoard,
  SectorItem,
  StockQuote,
  RankEntry,
  KLineBar,
  TrendPoint,
  StockMetrics,
  ProviderMeta
} from '../../shared/types'

const PROVIDER_ID = 'eastmoney'
const SOURCE_NAME = '东方财富'
const HEADERS = { Referer: 'https://quote.eastmoney.com/' }

// 主机轮换，降低单主机限流影响
let hostSeq = 0
function push2Host(): string {
  hostSeq = (hostSeq + 1) % 50
  return hostSeq === 0 ? 'push2.eastmoney.com' : `${hostSeq}.push2.eastmoney.com`
}

let hisHostSeq = 0
function push2HisHost(): string {
  hisHostSeq = (hisHostSeq + 1) % 20
  return hisHostSeq === 0 ? 'push2his.eastmoney.com' : `${hisHostSeq}.push2his.eastmoney.com`
}

// ---------- 全局限速与分集群降级 ----------
const MIN_INTERVAL_MS = 120 // 全局请求最小间隔
const REALTIME_FAIL_THRESHOLD = 4 // 实时集群连续失败阈值
const REALTIME_COOLDOWN_MS = 5 * 60_000 // 实时集群降级时长（期间直接走延迟集群）
const TOTAL_FAIL_THRESHOLD = 8 // 实时+延迟均失败的熔断阈值
const BREAKER_OPEN_MS = 60_000

let queueTail: Promise<void> = Promise.resolve()
let lastRequestAt = 0
let realtimeFailures = 0
let realtimeBlockedUntil = 0
let totalFailures = 0
let breakerOpenUntil = 0

function throttle(): Promise<void> {
  const prev = queueTail
  let release: () => void
  queueTail = new Promise((r) => {
    release = r
  })
  return prev.then(async () => {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastRequestAt = Date.now()
    release!()
  })
}

function breakerCheck(): void {
  if (Date.now() < breakerOpenUntil) {
    const secs = Math.ceil((breakerOpenUntil - Date.now()) / 1000)
    throw new Error(`行情源限流熔断中，${secs} 秒后自动重试`)
  }
}

function realtimeAvailable(): boolean {
  return Date.now() >= realtimeBlockedUntil
}

function reportRealtime(ok: boolean): void {
  if (ok) {
    realtimeFailures = 0
  } else {
    realtimeFailures += 1
    if (realtimeFailures >= REALTIME_FAIL_THRESHOLD) {
      realtimeBlockedUntil = Date.now() + REALTIME_COOLDOWN_MS
      realtimeFailures = 0
      console.warn('[eastmoney] 实时集群疑似限流，5 分钟内改走延迟集群')
    }
  }
}

function reportTotal(ok: boolean): void {
  if (ok) {
    totalFailures = 0
  } else {
    totalFailures += 1
    if (totalFailures >= TOTAL_FAIL_THRESHOLD) {
      breakerOpenUntil = Date.now() + BREAKER_OPEN_MS
      totalFailures = 0
    }
  }
}

function meta(sourceTimestamp: string | null = null): ProviderMeta {
  return {
    providerId: PROVIDER_ID,
    sourceName: SOURCE_NAME,
    sourceTimestamp,
    fetchedAt: new Date().toISOString(),
    cacheState: 'fresh'
  }
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

interface EmEnvelope<T> {
  rc: number
  data: T | null
}

async function emGet<T>(
  path: string,
  params: Record<string, string>,
  opts: { his?: boolean } = {}
): Promise<T | null> {
  breakerCheck()
  const qs = new URLSearchParams(params).toString()
  // 实时集群偶发限流；push2delay 为官方延迟集群，作为兜底保证可用性
  const realtimeHost = opts.his ? push2HisHost() : push2Host()
  const hosts: { host: string; realtime: boolean }[] = []
  if (realtimeAvailable()) {
    hosts.push({ host: realtimeHost, realtime: true })
    // 历史集群没有可用的 delay 备源；首节点失败后再换一个节点重试。
    if (opts.his) hosts.push({ host: push2HisHost(), realtime: true })
  }
  hosts.push({ host: 'push2delay.eastmoney.com', realtime: false })

  for (const { host, realtime } of hosts) {
    await throttle()
    const url = `https://${host}/${path}?${qs}`
    const res = await fetchJson<EmEnvelope<T>>(url, { timeoutMs: 8000, headers: HEADERS })
    const ok = res.ok && res.data != null && res.data.data != null
    if (realtime) reportRealtime(ok)
    if (ok) {
      reportTotal(true)
      return (res.data as EmEnvelope<T>).data
    }
  }
  reportTotal(false)
  return null
}

// ---------- 市场概览 ----------
const CORE_INDICES: { secId: string; name: string }[] = [
  { secId: '1.000001', name: '上证指数' },
  { secId: '0.399001', name: '深证成指' },
  { secId: '0.399006', name: '创业板指' },
  { secId: '1.000300', name: '沪深300' },
  { secId: '1.000688', name: '科创50' },
  { secId: '0.899050', name: '北证50' }
]

interface IndexRaw {
  f43: number // 最新
  f47: number // 成交量
  f48: number // 成交额
  f57: string
  f58: string
  f169: number // 涨跌额
  f170: number // 涨跌幅
}

async function fetchIndex(secId: string): Promise<IndexQuote | null> {
  const data = await emGet<IndexRaw>('api/qt/stock/get', {
    secid: secId,
    fltt: '2',
    invt: '2',
    fields: 'f43,f47,f48,f57,f58,f169,f170'
  })
  if (!data) return null
  return {
    code: data.f57,
    name: data.f58,
    price: num(data.f43),
    change: num(data.f169),
    changePct: num(data.f170),
    amount: num(data.f48),
    upCount: null,
    downCount: null,
    flatCount: null
  }
}

interface FenBuRaw {
  qdate: number
  fenbu: Record<string, number>[]
}

async function fetchBreadth(): Promise<{
  up: number | null
  down: number | null
  flat: number | null
  limitUp: number | null
  limitDown: number | null
  qdate: string | null
}> {
  const url = 'https://push2ex.eastmoney.com/getTopicZDFenBu?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt'
  const res = await fetchJson<{ data: FenBuRaw | null }>(url, { timeoutMs: 8000, headers: HEADERS })
  const raw = res.ok ? res.data?.data : null
  if (!raw?.fenbu) return { up: null, down: null, flat: null, limitUp: null, limitDown: null, qdate: null }
  let up = 0
  let down = 0
  let flat = 0
  let limitUp = 0
  let limitDown = 0
  for (const bucket of raw.fenbu) {
    for (const [k, v] of Object.entries(bucket)) {
      const key = Number(k)
      if (key > 0) up += v
      else if (key < 0) down += v
      else flat += v
      if (key === 11) limitUp = v
      if (key === -11) limitDown = v
    }
  }
  const q = String(raw.qdate)
  const qdate = `${q.slice(0, 4)}-${q.slice(4, 6)}-${q.slice(6, 8)}`
  return { up, down, flat, limitUp, limitDown, qdate }
}

function computeMarketStatus(qdate: string | null): MarketOverview['marketStatus'] {
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  if (qdate && qdate !== today) return 'closed'
  const mins = now.getHours() * 60 + now.getMinutes()
  if (mins < 9 * 60 + 15) return 'pre'
  if (mins <= 11 * 60 + 30) return 'trading'
  if (mins < 13 * 60) return 'break'
  if (mins <= 15 * 60) return 'trading'
  return 'closed'
}

export async function getMarketOverview(): Promise<MarketOverview> {
  const [indices, breadth] = await Promise.all([
    Promise.all(CORE_INDICES.map((i) => fetchIndex(i.secId))),
    fetchBreadth()
  ])
  const valid = indices.filter((i): i is IndexQuote => i !== null)
  const sh = valid.find((i) => i.code === '000001')
  const sz = valid.find((i) => i.code === '399001')
  const totalAmount = sh?.amount != null && sz?.amount != null ? sh.amount + sz.amount : null
  return {
    indices: valid,
    breadth: {
      up: breadth.up,
      down: breadth.down,
      flat: breadth.flat,
      limitUp: breadth.limitUp,
      limitDown: breadth.limitDown,
      totalAmount
    },
    marketStatus: computeMarketStatus(breadth.qdate),
    meta: meta(breadth.qdate)
  }
}

// ---------- 板块 ----------
interface ClistRaw {
  total: number
  diff: Record<string, unknown>[]
}

async function clist(params: Record<string, string>, maxItems = 100): Promise<Record<string, unknown>[]> {
  // 服务端单页上限 100 条，超出部分分页拉取
  const out: Record<string, unknown>[] = []
  const pages = Math.ceil(maxItems / 100)
  for (let pn = 1; pn <= pages; pn++) {
    const data = await emGet<ClistRaw>('api/qt/clist/get', {
      pn: String(pn),
      pz: '100',
      po: '1',
      np: '1',
      fltt: '2',
      invt: '2',
      ...params
    })
    if (!data?.diff?.length) break
    out.push(...data.diff)
    if (out.length >= data.total || out.length >= maxItems) break
  }
  return out
}

export async function getSectorBoard(type: 'industry' | 'concept'): Promise<SectorBoard> {
  const fs = type === 'industry' ? 'm:90+t:2+f:!50' : 'm:90+t:3+f:!50'
  const diff = await clist(
    {
      fs,
      fid: 'f3',
      fields: 'f2,f3,f4,f6,f8,f12,f14,f104,f105,f128,f140,f136'
    },
    type === 'industry' ? 500 : 600
  )
  const sectors: SectorItem[] = diff.map((d) => ({
    code: String(d.f12 ?? ''),
    name: String(d.f14 ?? ''),
    changePct: num(d.f3),
    amount: num(d.f6),
    upCount: num(d.f104),
    downCount: num(d.f105),
    leaderName: typeof d.f128 === 'string' ? d.f128 : null,
    leaderCode: typeof d.f140 === 'string' ? d.f140 : null,
    leaderChangePct: num(d.f136)
  }))
  return { type, sectors, meta: meta() }
}

const STOCK_FIELDS = 'f2,f3,f4,f5,f6,f8,f9,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23'

function rowToQuote(d: Record<string, unknown>): StockQuote {
  const code = String(d.f12 ?? '')
  const market = num(d.f13)
  return {
    secId: `${market ?? 0}.${code}`,
    code,
    name: String(d.f14 ?? ''),
    price: num(d.f2),
    change: num(d.f4),
    changePct: num(d.f3),
    amount: num(d.f6),
    volume: num(d.f5),
    turnoverRate: num(d.f8),
    marketCap: num(d.f20),
    floatCap: num(d.f21),
    pe: num(d.f9),
    pb: num(d.f23),
    high: num(d.f15),
    low: num(d.f16),
    open: num(d.f17),
    prevClose: num(d.f18)
  }
}

export async function getSectorStocks(sectorCode: string): Promise<{ stocks: StockQuote[]; meta: ProviderMeta }> {
  const diff = await clist({ fs: `b:${sectorCode}+f:!50`, fid: 'f3', fields: STOCK_FIELDS }, 300)
  return { stocks: diff.map(rowToQuote), meta: meta() }
}

// ---------- 榜单 ----------
const A_SHARE_FS = 'm:0+t:6+f:!2,m:0+t:80+f:!2,m:1+t:2+f:!2,m:1+t:23+f:!2,m:0+t:81+s:2048+f:!2'

export async function getRankList(
  kind: 'gainers' | 'losers' | 'amount' | 'turnover'
): Promise<{ entries: RankEntry[]; meta: ProviderMeta }> {
  const fid = kind === 'amount' ? 'f6' : kind === 'turnover' ? 'f8' : 'f3'
  const po = kind === 'losers' ? '0' : '1'
  const diff = (await clist({ fs: A_SHARE_FS, fid, po, fields: STOCK_FIELDS }, 100)).slice(0, 20)
  const entries: RankEntry[] = diff.map((d) => {
    const q = rowToQuote(d)
    return {
      secId: q.secId,
      code: q.code,
      name: q.name,
      price: q.price,
      changePct: q.changePct,
      amount: q.amount,
      turnoverRate: q.turnoverRate
    }
  })
  return { entries, meta: meta() }
}

// ---------- 全市场主数据（用于本地搜索索引） ----------
/** 拉取全市场证券列表；不完整时返回空数组（调用方保留旧数据） */
export async function getAllSecurities(): Promise<{ code: string; name: string; market: number }[]> {
  // 注意：clist 单页服务端上限 100 条
  const out: { code: string; name: string; market: number }[] = []
  let expectedTotal = 0
  for (let pn = 1; pn <= 80; pn++) {
    let data: ClistRaw | null = null
    for (let attempt = 0; attempt < 3 && !data?.diff?.length; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 800 * attempt))
      data = await emGet<ClistRaw>('api/qt/clist/get', {
        pn: String(pn),
        pz: '100',
        po: '1',
        np: '1',
        fltt: '2',
        invt: '2',
        fid: 'f12',
        fs: A_SHARE_FS,
        fields: 'f12,f13,f14'
      })
    }
    if (!data?.diff?.length) break
    expectedTotal = data.total
    for (const d of data.diff) {
      const code = String(d.f12 ?? '')
      const name = String(d.f14 ?? '')
      const market = Number(d.f13 ?? 0)
      if (code && name) out.push({ code, name, market })
    }
    if (out.length >= expectedTotal) break
  }
  // 完整性校验：不足预期的 95% 视为同步失败
  if (!expectedTotal || out.length < expectedTotal * 0.95) return []
  return out
}

// ---------- 批量行情 ----------
// 最近成功值缓存：限流/熔断窗口内退回旧数据，避免自选列表整体拿不到
const quoteCache = new Map<string, StockQuote>()

function cachedQuotes(secIds: string[]): { quotes: StockQuote[]; meta: ProviderMeta } {
  const quotes = secIds.map((id) => quoteCache.get(id)).filter((q): q is StockQuote => q != null)
  return { quotes, meta: { ...meta(), cacheState: 'stale' } }
}

export async function getQuotes(secIds: string[]): Promise<{ quotes: StockQuote[]; meta: ProviderMeta }> {
  if (!secIds.length) return { quotes: [], meta: meta() }
  try {
    const data = await emGet<ClistRaw>('api/qt/ulist.np/get', {
      fltt: '2',
      invt: '2',
      secids: secIds.join(','),
      fields: STOCK_FIELDS,
      pn: '1',
      pz: String(secIds.length),
      po: '1',
      np: '1'
    })
    if (data?.diff?.length) {
      const quotes = data.diff.map(rowToQuote)
      for (const q of quotes) quoteCache.set(q.secId, q)
      return { quotes, meta: meta() }
    }
    // 回退：逐个获取（限并发）
    const quotes: StockQuote[] = []
    const chunk = 6
    for (let i = 0; i < secIds.length; i += chunk) {
      const batch = await Promise.all(secIds.slice(i, i + chunk).map((id) => getMetricsRaw(id)))
      for (const m of batch) {
        if (m) quotes.push(metricsToQuote(m))
      }
    }
    if (quotes.length) {
      for (const q of quotes) quoteCache.set(q.secId, q)
      return { quotes, meta: meta() }
    }
  } catch (err) {
    // 熔断中：有缓存则退回缓存，否则继续抛出让 UI 提示
    if (!secIds.some((id) => quoteCache.has(id))) throw err
  }
  return cachedQuotes(secIds)
}

// ---------- 个股详情指标 ----------
interface StockGetRaw {
  [k: string]: unknown
}

async function getMetricsRaw(secId: string): Promise<(StockGetRaw & { __secId: string }) | null> {
  const data = await emGet<StockGetRaw>('api/qt/stock/get', {
    secid: secId,
    fltt: '2',
    invt: '2',
    fields:
      'f43,f44,f45,f46,f47,f48,f50,f55,f57,f58,f60,f71,f84,f85,f92,f105,f116,f117,f126,f127,f137,f162,f163,f164,f165,f167,f168,f169,f170,f171,f173,f183,f184,f185,f186,f187,f188,f189'
  })
  if (!data || data.f57 == null) return null
  return { ...data, __secId: secId }
}

function metricsToQuote(d: StockGetRaw & { __secId: string }): StockQuote {
  return {
    secId: d.__secId,
    code: String(d.f57 ?? ''),
    name: String(d.f58 ?? ''),
    price: num(d.f43),
    change: num(d.f169),
    changePct: num(d.f170),
    amount: num(d.f48),
    volume: num(d.f47),
    turnoverRate: num(d.f168),
    marketCap: num(d.f116),
    floatCap: num(d.f117),
    pe: num(d.f162),
    pb: num(d.f167),
    high: num(d.f44),
    low: num(d.f45),
    open: num(d.f46),
    prevClose: num(d.f60)
  }
}

export async function getStockMetrics(secId: string): Promise<StockMetrics | null> {
  const d = await getMetricsRaw(secId)
  if (!d) return null
  const listingRaw = num(d.f189)
  let listingDate: string | null = null
  if (listingRaw && listingRaw > 19000000) {
    const s = String(listingRaw)
    listingDate = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  }
  return {
    secId,
    code: String(d.f57 ?? ''),
    name: String(d.f58 ?? ''),
    price: num(d.f43),
    change: num(d.f169),
    changePct: num(d.f170),
    open: num(d.f46),
    high: num(d.f44),
    low: num(d.f45),
    prevClose: num(d.f60),
    volume: num(d.f47),
    amount: num(d.f48),
    averagePrice: num(d.f71),
    amplitude: num(d.f171),
    mainNetInflow: num(d.f137),
    turnoverRate: num(d.f168),
    volumeRatio: num(d.f50),
    marketCap: num(d.f116),
    floatCap: num(d.f117),
    totalShares: num(d.f84),
    floatShares: num(d.f85),
    // 东方财富盘口字段：f162=PE(动)、f163=PE(静)、f164=PE(TTM)
    peDynamic: num(d.f162),
    peTtm: num(d.f164),
    peStatic: num(d.f163),
    psTtm: num(d.f165),
    pb: num(d.f167),
    roe: num(d.f173),
    totalRevenue: num(d.f183),
    revenueYoy: num(d.f184),
    netProfit: num(d.f105),
    netProfitYoy: num(d.f185),
    grossMargin: num(d.f186),
    netMargin: num(d.f187),
    debtRatio: num(d.f188),
    dividendYield: num(d.f126),
    eps: num(d.f55),
    bvps: num(d.f92),
    listingDate,
    industry: typeof d.f127 === 'string' ? d.f127 : null,
    meta: meta()
  }
}

// ---------- K线与分时 ----------
interface KlineRaw {
  code: string
  name: string
  klines: string[]
}

export async function getKline(
  secId: string,
  klt: '101' | '102' | '103' = '101'
): Promise<{ bars: KLineBar[]; meta: ProviderMeta }> {
  // 日K取3年，周K取8年，月K取20年
  const years = klt === '101' ? 3 : klt === '102' ? 8 : 20
  const beg = new Date()
  beg.setFullYear(beg.getFullYear() - years)
  const begStr = `${beg.getFullYear()}${String(beg.getMonth() + 1).padStart(2, '0')}${String(beg.getDate()).padStart(2, '0')}`
  const data = await emGet<KlineRaw>(
    'api/qt/stock/kline/get',
    {
      secid: secId,
      klt,
      fqt: '1',
      beg: begStr,
      end: '20500101',
      fields1: 'f1,f2,f3,f4,f5,f6',
      fields2: 'f51,f52,f53,f54,f55,f56,f57'
    },
    { his: true }
  )
  const bars: KLineBar[] = (data?.klines ?? []).map((line) => {
    const [date, open, close, high, low, volume, amount] = line.split(',')
    return {
      date,
      open: Number(open),
      close: Number(close),
      high: Number(high),
      low: Number(low),
      volume: Number(volume),
      amount: Number(amount)
    }
  })
  if (!bars.length) {
    // 东财历史集群不可用时切换腾讯备源
    const tx = await getKlineTx(secId, klt)
    if (tx) return tx
  }
  return { bars, meta: meta(bars.length ? bars[bars.length - 1].date : null) }
}

interface TrendRaw {
  code: string
  trends: string[]
  preClose: number
}

export async function getTrend(secId: string): Promise<{ points: TrendPoint[]; prevClose: number | null; meta: ProviderMeta }> {
  const data = await emGet<TrendRaw>('api/qt/stock/trends2/get', {
    secid: secId,
    ndays: '1',
    iscr: '0',
    fields1: 'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13',
    fields2: 'f51,f53,f56,f58'
  })
  const points: TrendPoint[] = (data?.trends ?? []).map((line) => {
    const [time, price, volume, avgPrice] = line.split(',')
    return {
      time: time.split(' ')[1] ?? time,
      price: Number(price),
      avgPrice: avgPrice != null ? Number(avgPrice) : null,
      volume: Number(volume)
    }
  })
  if (!points.length) {
    const tx = await getTrendTx(secId)
    if (tx) return tx
  }
  return { points, prevClose: num(data?.preClose), meta: meta() }
}
