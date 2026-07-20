import { createHash, randomUUID } from 'node:crypto'
import { getDb } from './db'
import { getMaster } from './master'
import { getStockMetrics } from './providers/eastmoney'
import { getValuation, VALUATION_RANK_LABELS } from './providers/gurufocus'
import type { EvidenceSnapshot } from '../shared/types'

/** 生成不可变证据快照：行情 + 基本面 + 估值，逐字段带证据 ID 与数据时间 */
export async function createEvidenceSnapshot(secId: string): Promise<EvidenceSnapshot> {
  const master = getMaster(secId)
  const [metrics, valuation] = await Promise.all([
    getStockMetrics(secId),
    (async () => {
      const m = master ?? { exchange: secId.startsWith('1.') ? 'SH' : 'SZ', code: secId.split('.')[1] }
      try {
        return await getValuation(m.exchange as 'SH' | 'SZ' | 'BJ', m.code)
      } catch {
        return null
      }
    })()
  ])

  const code = master?.code ?? secId.split('.')[1] ?? secId
  const name = metrics?.name ?? master?.name ?? code
  const now = new Date().toISOString()

  const facts: Record<string, unknown> = {
    identity: {
      evidenceFieldId: 'EV-ID',
      secId,
      code,
      name,
      exchange: master?.exchange ?? null,
      industry: metrics?.industry ?? null,
      listingDate: metrics?.listingDate ?? null
    },
    quote: metrics
      ? {
          evidenceFieldId: 'EV-QUOTE',
          source: metrics.meta.sourceName,
          dataTime: metrics.meta.fetchedAt,
          note: '近实时快照，非交易所级实时行情',
          price: metrics.price,
          change: metrics.change,
          changePct: metrics.changePct,
          open: metrics.open,
          high: metrics.high,
          low: metrics.low,
          prevClose: metrics.prevClose,
          volume: metrics.volume,
          amount: metrics.amount,
          turnoverRate: metrics.turnoverRate,
          marketCap: metrics.marketCap,
          floatCap: metrics.floatCap
        }
      : { evidenceFieldId: 'EV-QUOTE', error: '行情获取失败' },
    fundamentals: metrics
      ? {
          evidenceFieldId: 'EV-FUND',
          source: metrics.meta.sourceName,
          dataTime: metrics.meta.fetchedAt,
          note: '低频基本面（财报期数据），与盘中价格时效不同',
          peTtm: metrics.peTtm,
          peStatic: metrics.peStatic,
          pb: metrics.pb,
          roe: metrics.roe,
          eps: metrics.eps,
          bvps: metrics.bvps,
          totalRevenue: metrics.totalRevenue,
          revenueYoy: metrics.revenueYoy,
          netProfit: metrics.netProfit,
          netProfitYoy: metrics.netProfitYoy,
          grossMargin: metrics.grossMargin,
          netMargin: metrics.netMargin,
          debtRatio: metrics.debtRatio
        }
      : { evidenceFieldId: 'EV-FUND', error: '基本面获取失败' },
    valuation: valuation
      ? {
          evidenceFieldId: 'EV-VAL',
          source: valuation.meta.sourceName,
          dataTime: valuation.meta.sourceTimestamp,
          fetchedAt: valuation.meta.fetchedAt,
          cacheState: valuation.meta.cacheState,
          note: '日级估值数据，供应商口径，非实时',
          fairValue: valuation.medps,
          intrinsicValueDcf: valuation.ivDcf,
          gfScore: valuation.gfScore,
          valuationRank: valuation.valuationRank,
          valuationLabel:
            valuation.valuationRank != null ? VALUATION_RANK_LABELS[valuation.valuationRank] ?? null : null,
          priceToFairValue:
            metrics?.price != null && valuation.medps != null && valuation.medps > 0
              ? Number((metrics.price / valuation.medps).toFixed(3))
              : null,
          dimensions: valuation.dimensions
        }
      : { evidenceFieldId: 'EV-VAL', error: '暂无估值数据（供应商不可用且无缓存）' }
  }

  const body = JSON.stringify(facts)
  const hash = createHash('sha256').update(body).digest('hex')
  const snapshot: EvidenceSnapshot = {
    id: randomUUID(),
    secId,
    code,
    name,
    createdAt: now,
    hash,
    facts
  }
  getDb()
    .prepare('INSERT INTO evidence_snapshots(id, sec_id, hash, payload, created_at) VALUES(?, ?, ?, ?, ?)')
    .run(snapshot.id, secId, hash, JSON.stringify(snapshot), now)
  return snapshot
}

export function getEvidenceSnapshot(id: string): EvidenceSnapshot | null {
  const row = getDb().prepare('SELECT payload FROM evidence_snapshots WHERE id = ?').get(id) as
    | { payload: string }
    | undefined
  return row ? (JSON.parse(row.payload) as EvidenceSnapshot) : null
}

export function evidenceToPromptBlock(ev: EvidenceSnapshot): string {
  return [
    `<证据快照 id="${ev.id}" hash="${ev.hash}" 生成时间="${ev.createdAt}">`,
    `股票：${ev.name}（${ev.code}）`,
    '以下 JSON 为唯一可引用的数字事实来源。引用具体数字时注明证据字段 ID（如 EV-QUOTE）与数据时间。',
    '不得自行联网抓取或编造新的价格、财务数字；证据中缺失的数据明确说明"证据不足"。',
    JSON.stringify(ev.facts, null, 2),
    '</证据快照>'
  ].join('\n')
}
