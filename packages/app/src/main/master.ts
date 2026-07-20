import { pinyin } from 'pinyin-pro'
import { getDb, kvGet, kvSet } from './db'
import { getAllSecurities, getQuotes } from './providers/eastmoney'
import type { SecurityMaster, SearchResult } from '../shared/types'

const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000

function exchangeOf(market: number, code: string): 'SH' | 'SZ' | 'BJ' {
  if (market === 1) return 'SH'
  if (code.startsWith('4') || code.startsWith('8') || code.startsWith('9')) return 'BJ'
  return 'SZ'
}

export async function syncMasterIfNeeded(force = false): Promise<{ count: number; updatedAt: string | null }> {
  const last = kvGet('master_synced_at')
  const count = masterCount()
  if (!force && last && count > 0 && Date.now() - Date.parse(last) < SYNC_INTERVAL_MS) {
    return { count, updatedAt: last }
  }
  const list = await getAllSecurities()
  if (list.length < 1000) {
    // 拉取异常时保留旧数据
    if (count > 0) return { count, updatedAt: last }
    throw new Error(`主数据拉取不完整（${list.length} 条），保留现状待重试`)
  }
  const db = getDb()
  const now = new Date().toISOString()
  const insert = db.prepare(
    `INSERT INTO security_master(sec_id, code, name, exchange, pinyin_full, pinyin_initial, updated_at)
     VALUES(?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(sec_id) DO UPDATE SET name = excluded.name, pinyin_full = excluded.pinyin_full,
       pinyin_initial = excluded.pinyin_initial, updated_at = excluded.updated_at`
  )
  db.exec('BEGIN')
  try {
    for (const s of list) {
      const secId = `${s.market}.${s.code}`
      const full = pinyin(s.name, { toneType: 'none', type: 'array' }).join('')
      const initial = pinyin(s.name, { pattern: 'first', toneType: 'none', type: 'array' }).join('')
      insert.run(secId, s.code, s.name, exchangeOf(s.market, s.code), full.toLowerCase(), initial.toLowerCase(), now)
    }
    // 清理已退市（本次快照中不存在的代码）
    const ids = new Set(list.map((s) => `${s.market}.${s.code}`))
    const rows = db.prepare('SELECT sec_id FROM security_master').all() as { sec_id: string }[]
    const del = db.prepare('DELETE FROM security_master WHERE sec_id = ?')
    for (const r of rows) {
      if (!ids.has(r.sec_id)) del.run(r.sec_id)
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  kvSet('master_synced_at', now)
  return { count: masterCount(), updatedAt: now }
}

export function masterCount(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS c FROM security_master').get() as { c: number }
  return row.c
}

export function masterUpdatedAt(): string | null {
  return kvGet('master_synced_at')
}

interface MasterRow {
  sec_id: string
  code: string
  name: string
  exchange: string
  pinyin_full: string
  pinyin_initial: string
}

function rowToMaster(r: MasterRow): SecurityMaster {
  return {
    secId: r.sec_id,
    code: r.code,
    name: r.name,
    exchange: r.exchange as SecurityMaster['exchange'],
    pinyinFull: r.pinyin_full,
    pinyinInitial: r.pinyin_initial
  }
}

export function getMaster(secId: string): SecurityMaster | null {
  const row = getDb().prepare('SELECT * FROM security_master WHERE sec_id = ?').get(secId) as MasterRow | undefined
  return row ? rowToMaster(row) : null
}

export function searchLocal(query: string, limit = 20): SecurityMaster[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const db = getDb()
  const like = `%${q}%`
  const prefix = `${q}%`
  // 优先级：代码前缀 > 名称包含 > 拼音首字母前缀 > 全拼包含
  const rows = db
    .prepare(
      `SELECT *,
        CASE
          WHEN code LIKE ? THEN 0
          WHEN name LIKE ? THEN 1
          WHEN pinyin_initial LIKE ? THEN 2
          ELSE 3
        END AS rank
       FROM security_master
       WHERE code LIKE ? OR name LIKE ? OR pinyin_initial LIKE ? OR pinyin_full LIKE ?
       ORDER BY rank, code
       LIMIT ?`
    )
    .all(prefix, like, prefix, prefix, like, prefix, like, limit) as MasterRow[]
  return rows.map(rowToMaster)
}

export async function searchWithQuotes(query: string): Promise<SearchResult[]> {
  const matched = searchLocal(query)
  if (!matched.length) return []
  const results: SearchResult[] = matched.map((m) => ({ ...m, price: null, changePct: null }))
  try {
    const { quotes } = await getQuotes(matched.map((m) => m.secId))
    const byId = new Map(quotes.map((q) => [q.secId, q]))
    for (const r of results) {
      const q = byId.get(r.secId)
      if (q) {
        r.price = q.price
        r.changePct = q.changePct
      }
    }
  } catch {
    // 无行情时仍返回本地主数据
  }
  return results
}
