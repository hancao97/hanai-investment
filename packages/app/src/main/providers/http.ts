import { net } from 'electron'

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

export interface FetchResult<T> {
  ok: boolean
  data: T | null
  error: string | null
}

/**
 * 统一走 Electron 的 Chromium 网络栈（net.fetch）。
 * 行情源会对非浏览器 TLS 指纹（Node/BoringSSL 直连）做拦截，Chromium 栈与真实浏览器一致，最稳妥。
 */
async function rawFetch(
  url: string,
  opts: {
    method?: string
    timeoutMs?: number
    headers?: Record<string, string>
    body?: string
  } = {}
): Promise<{ status: number; body: string }> {
  const { method = 'GET', timeoutMs = 10000, headers = {}, body } = opts
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await net.fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        Accept: 'application/json, text/plain, */*',
        ...headers
      },
      body
    })
    return { status: res.status, body: await res.text() }
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchJson<T = unknown>(
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string> } = {}
): Promise<FetchResult<T>> {
  try {
    const res = await rawFetch(url, opts)
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, data: null, error: `HTTP ${res.status}` }
    }
    return { ok: true, data: JSON.parse(res.body) as T, error: null }
  } catch (e) {
    return { ok: false, data: null, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function postJson<T = unknown>(
  url: string,
  body: unknown,
  opts: { timeoutMs?: number; headers?: Record<string, string> } = {}
): Promise<FetchResult<T>> {
  try {
    const res = await rawFetch(url, {
      method: 'POST',
      timeoutMs: opts.timeoutMs ?? 15000,
      headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
      body: JSON.stringify(body)
    })
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, data: null, error: `HTTP ${res.status}` }
    }
    return { ok: true, data: JSON.parse(res.body) as T, error: null }
  } catch (e) {
    return { ok: false, data: null, error: e instanceof Error ? e.message : String(e) }
  }
}
