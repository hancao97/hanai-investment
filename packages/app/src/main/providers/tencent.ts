import { fetchJson } from './http'
import type { KLineBar, TrendPoint, ProviderMeta } from '../../shared/types'

const SOURCE_NAME = '腾讯行情（备源）'
const HEADERS = { Referer: 'https://gu.qq.com/' }

function meta(sourceTimestamp: string | null = null): ProviderMeta {
  return {
    providerId: 'tencent-fallback',
    sourceName: SOURCE_NAME,
    sourceTimestamp,
    fetchedAt: new Date().toISOString(),
    cacheState: 'fresh'
  }
}

/** 东财 secId（1.600519）转腾讯 symbol（sh600519） */
function txSymbol(secId: string): string {
  const [market, code] = secId.split('.')
  if (market === '1') return `sh${code}`
  if (code.startsWith('4') || code.startsWith('8') || code.startsWith('9')) return `bj${code}`
  return `sz${code}`
}

interface TxKlineResp {
  code: number
  data: Record<string, Record<string, unknown>>
}

export async function getKlineTx(
  secId: string,
  klt: '101' | '102' | '103'
): Promise<{ bars: KLineBar[]; meta: ProviderMeta } | null> {
  const symbol = txSymbol(secId)
  const period = klt === '101' ? 'day' : klt === '102' ? 'week' : 'month'
  const count = klt === '101' ? 800 : klt === '102' ? 420 : 240
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},${period},,,${count},qfq`
  const res = await fetchJson<TxKlineResp>(url, { timeoutMs: 10000, headers: HEADERS })
  if (!res.ok || res.data?.code !== 0) return null
  const stock = res.data.data?.[symbol]
  if (!stock) return null
  const rows = (stock[`qfq${period}`] ?? stock[period]) as unknown[] | undefined
  if (!Array.isArray(rows) || !rows.length) return null
  const bars: KLineBar[] = []
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) continue
    const [date, open, close, high, low, volume] = row as string[]
    bars.push({
      date,
      open: Number(open),
      close: Number(close),
      high: Number(high),
      low: Number(low),
      volume: Number(volume) * 100, // 手 -> 股
      amount: 0
    })
  }
  if (!bars.length) return null
  return { bars, meta: meta(bars[bars.length - 1].date) }
}

interface TxMinuteResp {
  code: number
  data: Record<
    string,
    {
      data?: { data?: string[]; date?: string }
      qt?: Record<string, string[]>
    }
  >
}

export async function getTrendTx(
  secId: string
): Promise<{ points: TrendPoint[]; prevClose: number | null; meta: ProviderMeta } | null> {
  const symbol = txSymbol(secId)
  const url = `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${symbol}`
  const res = await fetchJson<TxMinuteResp>(url, { timeoutMs: 10000, headers: HEADERS })
  if (!res.ok || res.data?.code !== 0) return null
  const entry = res.data.data?.[symbol]
  const rows = entry?.data?.data
  if (!Array.isArray(rows) || !rows.length) return null
  const prevClose = entry?.qt?.[symbol]?.[4] != null ? Number(entry.qt[symbol][4]) : null

  const points: TrendPoint[] = []
  let lastCumVol = 0
  let cumAmount = 0
  for (const row of rows) {
    // 格式: "0930 1269.01 557 70683857.00"（时间 价格 累计量[手] 累计额）
    const parts = row.split(' ')
    if (parts.length < 3) continue
    const time = `${parts[0].slice(0, 2)}:${parts[0].slice(2, 4)}`
    const price = Number(parts[1])
    const cumVol = Number(parts[2])
    if (parts.length >= 4) cumAmount = Number(parts[3])
    const avgPrice = cumVol > 0 && cumAmount > 0 ? cumAmount / (cumVol * 100) : null
    points.push({
      time,
      price,
      avgPrice: avgPrice != null && Number.isFinite(avgPrice) ? Number(avgPrice.toFixed(3)) : null,
      volume: Math.max(0, (cumVol - lastCumVol) * 100)
    })
    lastCumVol = cumVol
  }
  return { points, prevClose, meta: meta() }
}
