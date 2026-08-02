import { join } from 'node:path'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fetchJson, postJson } from './http'
import { VALUATION_CACHE_DIR } from '../paths'
import type { ValuationSummary, ProviderMeta } from '../../shared/types'

const PROVIDER_ID = 'gurufocus-cn-prototype'
const SOURCE_NAME = '价值大师网（个人研究接口，未获再分发授权）'
const BASE = 'https://www.gurufocus.cn'
const HEADERS = {
  Referer: 'https://www.gurufocus.cn/',
  'Content-Type': 'application/json'
}
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 估值为日级数据

export const VALUATION_RANK_LABELS: Record<number, string> = {
  0: '数据不足',
  1: '数据陈旧',
  2: '价值陷阱嫌疑',
  3: '严重低估',
  4: '低估',
  5: '合理范围',
  6: '高估',
  7: '严重高估'
}

function meta(sourceTimestamp: string | null, cacheState: ProviderMeta['cacheState']): ProviderMeta {
  return {
    providerId: PROVIDER_ID,
    sourceName: SOURCE_NAME,
    sourceTimestamp,
    fetchedAt: new Date().toISOString(),
    cacheState
  }
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v.replace(/[,¥$]/g, ''))
    return Number.isFinite(n) ? n : null
  }
  return null
}

// gurufocus 评级字段可能是数字，也可能是 { value } 对象
function rankNum(v: unknown): number | null {
  if (v && typeof v === 'object' && 'value' in (v as Record<string, unknown>)) {
    return num((v as Record<string, unknown>).value)
  }
  return num(v)
}

function gfSymbol(exchange: 'SH' | 'SZ' | 'BJ', code: string): string {
  const prefix = exchange === 'SH' ? 'SHSE' : exchange === 'SZ' ? 'SZSE' : 'BJSE'
  return `${prefix}:${code}`
}

interface CacheEntry {
  fetchedAt: string
  summary: ValuationSummary
}

function cachePath(code: string): string {
  return join(VALUATION_CACHE_DIR, `${code}.json`)
}

function readCache(code: string): CacheEntry | null {
  try {
    const p = cachePath(code)
    if (!existsSync(p)) return null
    return JSON.parse(readFileSync(p, 'utf-8')) as CacheEntry
  } catch {
    return null
  }
}

function writeCache(code: string, summary: ValuationSummary): void {
  try {
    writeFileSync(cachePath(code), JSON.stringify({ fetchedAt: new Date().toISOString(), summary }))
  } catch {
    // 缓存失败不影响主流程
  }
}

interface ScreenerRow {
  symbol?: string
  stockid?: string
  gf_score?: unknown
  gf_valuation?: unknown
  gf_value?: unknown
  rank_balancesheet?: unknown
  rank_profitability?: unknown
  rank_growth?: unknown
  rank_gf_value?: unknown
  rank_momentum?: unknown
  yield?: unknown
  total_free_cash_flow?: unknown
}

async function fetchScreenerRow(code: string): Promise<ScreenerRow | null> {
  const body = {
    exchanges: ['SZSE', 'SHSE'],
    fields: [
      'symbol',
      'company',
      'stockid',
      'gf_value',
      'rank_gf_value',
      'gf_score',
      'rank_balancesheet',
      'rank_profitability',
      'rank_growth',
      'rank_momentum',
      'gf_valuation',
      'yield',
      'total_free_cash_flow'
    ],
    filters: [{ left: 'symbol', operator: '=', right: code }],
    guru_filters: [],
    inst_holding_filters: [],
    insider_filters: [],
    insider_trading_filters: [],
    sorts: 'mktcap_norm|DESC',
    rank_by: '',
    use_in_screener: true,
    page: 1,
    per_page: 3
  }
  const res = await postJson<{ total: number; data: ScreenerRow[] }>(
    `${BASE}/_api/screener?locale=zh-hans`,
    body,
    { headers: HEADERS }
  )
  if (!res.ok || !res.data?.data?.length) return null
  const rows = res.data.data
  return rows.find((r) => r.symbol === code) ?? rows[0]
}

interface ValuationChartRaw {
  iv?: unknown
  medps?: [string, number][]
  price?: [string, number][]
}

export async function getValuation(
  exchange: 'SH' | 'SZ' | 'BJ',
  code: string
): Promise<ValuationSummary | null> {
  // 1. 有效缓存直接返回
  const cached = readCache(code)
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < CACHE_TTL_MS) {
    return { ...cached.summary, meta: { ...cached.summary.meta, cacheState: 'cached' } }
  }

  // 2. 拉取估值曲线与评分
  const symbol = gfSymbol(exchange, code)
  const [chartRes, row] = await Promise.all([
    fetchJson<ValuationChartRaw>(`${BASE}/_api/chart/${encodeURIComponent(symbol)}/valuation?locale=zh-hans`, {
      timeoutMs: 15000,
      headers: HEADERS
    }),
    fetchScreenerRow(code)
  ])

  const chart = chartRes.ok ? chartRes.data : null
  if (!chart && !row) {
    // 3. 拉取失败：退回过期缓存
    if (cached) {
      return { ...cached.summary, meta: { ...cached.summary.meta, cacheState: 'stale' } }
    }
    return null
  }

  const medps = Array.isArray(chart?.medps) ? chart.medps : []
  const price = Array.isArray(chart?.price) ? chart.price : []
  // 序列末端为供应商预测点（未来日期），当前价值取不晚于今天的最后一个节点
  const today = new Date().toISOString().slice(0, 10)
  const pastMedps = medps.filter((p) => Array.isArray(p) && p[0] <= today)
  const lastMedps = pastMedps.length ? pastMedps[pastMedps.length - 1] : null
  const summary: ValuationSummary = {
    stockId: String(row?.stockid ?? symbol),
    ivDcf: num(chart?.iv),
    medps: lastMedps ? num(lastMedps[1]) : null,
    gfScore: rankNum(row?.gf_score),
    valuationRank: rankNum(row?.gf_valuation),
    dimensions: {
      financialStrength: rankNum(row?.rank_balancesheet),
      profitability: rankNum(row?.rank_profitability),
      growth: rankNum(row?.rank_growth),
      gfValue: rankNum(row?.rank_gf_value),
      momentum: rankNum(row?.rank_momentum)
    },
    series: {
      price: price.filter((p) => Array.isArray(p) && p.length === 2),
      medps: medps.filter((p) => Array.isArray(p) && p.length === 2)
    },
    meta: meta(lastMedps ? lastMedps[0] : null, 'fresh')
  }
  writeCache(code, summary)
  return summary
}
