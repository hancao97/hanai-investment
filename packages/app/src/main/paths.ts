import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, existsSync } from 'node:fs'

export const DATA_ROOT = join(homedir(), '.hanai-investment')
export const CACHE_DIR = join(DATA_ROOT, 'cache')
export const MARKET_CACHE_DIR = join(CACHE_DIR, 'market')
export const VALUATION_CACHE_DIR = join(CACHE_DIR, 'valuation')
export const PERSONAS_DIR = join(DATA_ROOT, 'personas')
export const RUNTIME_DIR = join(DATA_ROOT, 'runtime')
export const WORKDIR = join(RUNTIME_DIR, 'workdir')
export const JUDGEMENTS_DIR = join(WORKDIR, 'judgements')
export const STATE_DIR = join(RUNTIME_DIR, 'state')
export const EXPORTS_DIR = join(DATA_ROOT, 'exports')
export const LOGS_DIR = join(DATA_ROOT, 'logs')
export const DB_PATH = join(DATA_ROOT, 'hanai.db')

export function ensureDataDirs(): void {
  for (const dir of [
    DATA_ROOT,
    CACHE_DIR,
    MARKET_CACHE_DIR,
    VALUATION_CACHE_DIR,
    PERSONAS_DIR,
    RUNTIME_DIR,
    WORKDIR,
    JUDGEMENTS_DIR,
    STATE_DIR,
    EXPORTS_DIR,
    LOGS_DIR
  ]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
}
