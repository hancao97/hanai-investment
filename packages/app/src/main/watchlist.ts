import { randomUUID } from 'node:crypto'
import { getDb } from './db'
import { getQuotes } from './providers/eastmoney'
import type { WatchGroup, WatchItem } from '../shared/types'

interface ItemRow {
  group_id: string
  sec_id: string
  added_at: string | null
  base_price: number | null
}

export function listGroups(): WatchGroup[] {
  const db = getDb()
  const groups = db.prepare('SELECT * FROM watch_groups ORDER BY sort_order').all() as {
    id: string
    name: string
    sort_order: number
  }[]
  if (!groups.length) {
    const id = randomUUID()
    db.prepare('INSERT INTO watch_groups(id, name, sort_order) VALUES(?, ?, 0)').run(id, '默认分组')
    return [{ id, name: '默认分组', secIds: [], items: [] }]
  }
  const items = db.prepare('SELECT * FROM watch_items ORDER BY sort_order').all() as ItemRow[]
  return groups.map((g) => {
    const mine = items.filter((i) => i.group_id === g.id)
    return {
      id: g.id,
      name: g.name,
      secIds: mine.map((i) => i.sec_id),
      items: mine.map(
        (i): WatchItem => ({ secId: i.sec_id, addedAt: i.added_at, basePrice: i.base_price })
      )
    }
  })
}

export function addGroup(name: string): WatchGroup {
  const db = getDb()
  const row = db.prepare('SELECT MAX(sort_order) AS m FROM watch_groups').get() as { m: number | null }
  const id = randomUUID()
  db.prepare('INSERT INTO watch_groups(id, name, sort_order) VALUES(?, ?, ?)').run(id, name, (row.m ?? 0) + 1)
  return { id, name, secIds: [], items: [] }
}

export function renameGroup(id: string, name: string): void {
  getDb().prepare('UPDATE watch_groups SET name = ? WHERE id = ?').run(name, id)
}

export function removeGroup(id: string): void {
  const db = getDb()
  db.prepare('DELETE FROM watch_items WHERE group_id = ?').run(id)
  db.prepare('DELETE FROM watch_groups WHERE id = ?').run(id)
}

export async function addItem(groupId: string, secId: string): Promise<void> {
  const db = getDb()
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

export function isWatched(secId: string): boolean {
  const row = getDb().prepare('SELECT 1 AS x FROM watch_items WHERE sec_id = ? LIMIT 1').get(secId)
  return !!row
}
