import { randomUUID } from 'node:crypto'
import { getDb } from './db'
import { getQuotes } from './providers/eastmoney'
import type { WatchGroup, WatchItem } from '../shared/types'

interface ItemRow {
  group_id: string
  sec_id: string
  sort_order: number
  added_at: string | null
  base_price: number | null
}

interface GroupRow {
  id: string
  name: string
  sort_order: number
  is_default: number
}

function ensureDefaultGroup(db: ReturnType<typeof getDb>): GroupRow {
  const marked = db
    .prepare('SELECT id, name, sort_order, is_default FROM watch_groups WHERE is_default = 1 ORDER BY sort_order, id')
    .all() as GroupRow[]
  if (marked.length) {
    if (marked.length > 1) {
      const clearExtra = db.prepare('UPDATE watch_groups SET is_default = 0 WHERE id = ?')
      for (const group of marked.slice(1)) clearExtra.run(group.id)
    }
    return marked[0]
  }

  const candidate = db
    .prepare(
      `SELECT id, name, sort_order, is_default
       FROM watch_groups
       ORDER BY CASE WHEN name = '默认分组' THEN 0 ELSE 1 END, sort_order, id
       LIMIT 1`
    )
    .get() as GroupRow | undefined
  if (candidate) {
    db.prepare('UPDATE watch_groups SET is_default = 1 WHERE id = ?').run(candidate.id)
    return { ...candidate, is_default: 1 }
  }

  const id = randomUUID()
  db.prepare('INSERT INTO watch_groups(id, name, sort_order, is_default) VALUES(?, ?, 0, 1)').run(
    id,
    '默认分组'
  )
  return { id, name: '默认分组', sort_order: 0, is_default: 1 }
}

function normalizeGroupName(name: string): string {
  const normalized = name.trim()
  if (!normalized) throw new Error('分组名称不能为空')
  if (normalized.length > 20) throw new Error('分组名称不能超过 20 个字符')
  return normalized
}

function assertUniqueGroupName(
  db: ReturnType<typeof getDb>,
  name: string,
  excludeId?: string
): void {
  const duplicate = db
    .prepare(
      `SELECT 1 AS found FROM watch_groups
       WHERE lower(name) = lower(?) AND (? IS NULL OR id != ?)
       LIMIT 1`
    )
    .get(name, excludeId ?? null, excludeId ?? null)
  if (duplicate) throw new Error('已存在同名分组')
}

async function backfillLegacyItems(db: ReturnType<typeof getDb>): Promise<void> {
  const legacy = db
    .prepare('SELECT group_id, sec_id, added_at, base_price FROM watch_items WHERE added_at IS NULL OR base_price IS NULL')
    .all() as ItemRow[]
  if (!legacy.length) return

  const missingPriceIds = [...new Set(legacy.filter((i) => i.base_price == null).map((i) => i.sec_id))]
  const priceBySecId = new Map<string, number>()
  if (missingPriceIds.length) {
    try {
      const { quotes } = await getQuotes(missingPriceIds)
      for (const quote of quotes) {
        if (quote.price != null && quote.price > 0) priceBySecId.set(quote.secId, quote.price)
      }
    } catch {
      // 日期可以先补；基准价在下次读取自选时继续尝试补录。
    }
  }

  const now = new Date().toISOString()
  const update = db.prepare(
    `UPDATE watch_items
     SET added_at = COALESCE(added_at, ?), base_price = COALESCE(base_price, ?)
     WHERE group_id = ? AND sec_id = ?`
  )
  for (const item of legacy) {
    update.run(now, priceBySecId.get(item.sec_id) ?? null, item.group_id, item.sec_id)
  }
}

export async function listGroups(): Promise<WatchGroup[]> {
  const db = getDb()
  ensureDefaultGroup(db)
  const groups = db
    .prepare('SELECT id, name, sort_order, is_default FROM watch_groups ORDER BY is_default DESC, sort_order, id')
    .all() as GroupRow[]
  await backfillLegacyItems(db)
  const items = db
    .prepare(
      `SELECT group_id, sec_id, sort_order, added_at, base_price
       FROM watch_items
       ORDER BY CASE WHEN added_at IS NULL THEN 1 ELSE 0 END, added_at DESC, sort_order DESC`
    )
    .all() as ItemRow[]
  return groups.map((g) => {
    const mine = items.filter((i) => i.group_id === g.id)
    return {
      id: g.id,
      name: g.name,
      isDefault: g.is_default === 1,
      secIds: mine.map((i) => i.sec_id),
      items: mine.map(
        (i): WatchItem => ({ secId: i.sec_id, addedAt: i.added_at, basePrice: i.base_price })
      )
    }
  })
}

export function addGroup(name: string): WatchGroup {
  const db = getDb()
  ensureDefaultGroup(db)
  const normalized = normalizeGroupName(name)
  assertUniqueGroupName(db, normalized)
  const row = db.prepare('SELECT MAX(sort_order) AS m FROM watch_groups').get() as { m: number | null }
  const id = randomUUID()
  db.prepare('INSERT INTO watch_groups(id, name, sort_order, is_default) VALUES(?, ?, ?, 0)').run(
    id,
    normalized,
    (row.m ?? 0) + 1
  )
  return { id, name: normalized, isDefault: false, secIds: [], items: [] }
}

export function renameGroup(id: string, name: string): void {
  const db = getDb()
  const normalized = normalizeGroupName(name)
  assertUniqueGroupName(db, normalized, id)
  const result = db.prepare('UPDATE watch_groups SET name = ? WHERE id = ?').run(normalized, id)
  if (!result.changes) throw new Error('分组不存在')
}

export function removeGroup(id: string): void {
  const db = getDb()
  const defaultGroup = ensureDefaultGroup(db)
  if (id === defaultGroup.id) throw new Error('默认分组不能删除')
  const target = db.prepare('SELECT id FROM watch_groups WHERE id = ?').get(id)
  if (!target) throw new Error('分组不存在')

  const sourceItems = db
    .prepare(
      `SELECT group_id, sec_id, sort_order, added_at, base_price
       FROM watch_items WHERE group_id = ? ORDER BY sort_order`
    )
    .all(id) as ItemRow[]
  const maxRow = db
    .prepare('SELECT MAX(sort_order) AS value FROM watch_items WHERE group_id = ?')
    .get(defaultGroup.id) as { value: number | null }
  const insert = db.prepare(
    `INSERT INTO watch_items(group_id, sec_id, sort_order, added_at, base_price)
     VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(group_id, sec_id) DO NOTHING`
  )

  db.exec('BEGIN IMMEDIATE')
  try {
    let order = maxRow.value ?? 0
    for (const item of sourceItems) {
      insert.run(defaultGroup.id, item.sec_id, ++order, item.added_at, item.base_price)
    }
    db.prepare('DELETE FROM watch_items WHERE group_id = ?').run(id)
    db.prepare('DELETE FROM watch_groups WHERE id = ?').run(id)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export async function addItem(groupId: string, secId: string): Promise<void> {
  const db = getDb()
  if (!db.prepare('SELECT 1 AS found FROM watch_groups WHERE id = ?').get(groupId)) {
    throw new Error('分组不存在')
  }
  const row = db
    .prepare('SELECT MAX(sort_order) AS m FROM watch_items WHERE group_id = ?')
    .get(groupId) as { m: number | null }
  // 记录加入时价格，用于展示「加入以来涨跌」；行情不可用时留空
  let basePrice: number | null = null
  try {
    const { quotes } = await getQuotes([secId])
    basePrice = quotes[0]?.price ?? null
  } catch {
    basePrice = null
  }
  db.prepare(
    `INSERT INTO watch_items(group_id, sec_id, sort_order, added_at, base_price) VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(group_id, sec_id) DO NOTHING`
  ).run(groupId, secId, (row.m ?? 0) + 1, new Date().toISOString(), basePrice)
}

export function removeItem(groupId: string, secId: string): void {
  getDb().prepare('DELETE FROM watch_items WHERE group_id = ? AND sec_id = ?').run(groupId, secId)
}

export function moveItem(fromGroupId: string, toGroupId: string, secId: string): void {
  if (fromGroupId === toGroupId) return
  const db = getDb()
  const source = db
    .prepare(
      `SELECT group_id, sec_id, sort_order, added_at, base_price
       FROM watch_items WHERE group_id = ? AND sec_id = ?`
    )
    .get(fromGroupId, secId) as ItemRow | undefined
  if (!source) throw new Error('当前分组中不存在该自选')
  if (!db.prepare('SELECT 1 AS found FROM watch_groups WHERE id = ?').get(toGroupId)) {
    throw new Error('目标分组不存在')
  }
  const maxRow = db
    .prepare('SELECT MAX(sort_order) AS value FROM watch_items WHERE group_id = ?')
    .get(toGroupId) as { value: number | null }

  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(
      `INSERT INTO watch_items(group_id, sec_id, sort_order, added_at, base_price)
       VALUES(?, ?, ?, ?, ?)
       ON CONFLICT(group_id, sec_id) DO NOTHING`
    ).run(toGroupId, secId, (maxRow.value ?? 0) + 1, source.added_at, source.base_price)
    db.prepare('DELETE FROM watch_items WHERE group_id = ? AND sec_id = ?').run(fromGroupId, secId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function isWatched(secId: string): boolean {
  const row = getDb().prepare('SELECT 1 AS x FROM watch_items WHERE sec_id = ? LIMIT 1').get(secId)
  return !!row
}
