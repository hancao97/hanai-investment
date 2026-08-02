<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useAppStore } from '../stores/app'
import { fmtBytes, fmtDateTime } from '../utils/format'

const app = useAppStore()
const stats = ref<{ total: number; marketCache: number; valuationCache: number; workdir: number; logs: number } | null>(null)
const syncing = ref(false)
const restarting = ref(false)

async function load(): Promise<void> {
  await app.refreshHealth()
  stats.value = await window.hanai.app.storageStats()
}

onMounted(() => void load())

async function syncMaster(): Promise<void> {
  syncing.value = true
  try {
    await window.hanai.master.sync(true)
    await load()
  } finally {
    syncing.value = false
  }
}

async function restartCodex(): Promise<void> {
  restarting.value = true
  try {
    await window.hanai.codex.restart()
  } finally {
    restarting.value = false
  }
}

async function setModel(model: string | null): Promise<void> {
  await window.hanai.codex.setModel(model)
}

async function clearCache(kind: 'market' | 'valuation'): Promise<void> {
  await window.hanai.app.clearCache(kind)
  await load()
}

async function openDataDir(): Promise<void> {
  if (app.health) await window.hanai.app.openPath(app.health.dataDir)
}

const codexStatusText = computed(() => {
  const s = app.codexState
  if (!s) return '检测中…'
  const map: Record<string, string> = {
    ready: '可用',
    connecting: '正在连接',
    'not-installed': '未安装',
    'not-logged-in': '未登录',
    incompatible: '版本不兼容',
    error: '运行错误'
  }
  return map[s.status] ?? s.status
})

const codexHint = computed(() => {
  if (app.codexState?.modelCatalogError) return app.codexState.modelCatalogError
  const s = app.codexState?.status
  if (s === 'not-installed')
    return '未找到 codex 可执行文件。请安装 Codex CLI（npm install -g @openai/codex 或 brew install codex），然后点击重新检测。'
  if (s === 'not-logged-in') return '本机 Codex 未登录。请在终端运行 codex 并完成登录，然后点击重新检测。'
  if (s === 'error') return app.codexState?.lastError ?? '未知错误'
  return ''
})
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1>设置与诊断</h1>
    </div>

    <div class="settings-grid">
      <!-- Codex -->
      <div class="card">
        <div class="card-title">
          Codex Agent
          <span class="dot" :class="app.codexState?.status === 'ready' ? 'ok' : app.codexState?.status === 'connecting' ? 'warn' : 'error'" />
        </div>
        <div class="kv"><span>状态</span><b>{{ codexStatusText }}</b></div>
        <div class="kv"><span>路径</span><b class="num">{{ app.codexState?.path ?? '—' }}</b></div>
        <div class="kv"><span>版本</span><b class="num">{{ app.codexState?.version ?? '—' }}</b></div>
        <div class="kv">
          <span>账号</span>
          <b>{{ app.codexState?.account ? `${app.codexState.account.email ?? app.codexState.account.type}（${app.codexState.account.plan ?? '—'}）` : '—' }}</b>
        </div>
        <div class="kv">
          <span>模型</span>
          <select
            v-if="app.codexState?.models.length"
            class="field"
            :value="app.codexState.selectedModel ?? ''"
            @change="setModel(($event.target as HTMLSelectElement).value || null)"
          >
            <option v-for="m in app.codexState.models" :key="m.id" :value="m.id">{{ m.displayName }}</option>
          </select>
          <b v-else>—</b>
        </div>
        <div v-if="codexHint" class="hint-box">{{ codexHint }}</div>
        <div v-if="app.codexState?.modelCatalogError" class="meta-line model-fix">
          修复命令：<code class="num">npm install -g @openai/codex@latest</code>，完成后点击“重启 / 重新检测”。
        </div>
        <div class="actions">
          <button class="btn" :disabled="restarting" @click="restartCodex">
            {{ restarting ? '正在重启…' : '重启 / 重新检测' }}
          </button>
        </div>
        <div class="meta-line" style="margin-top: 10px">
          研判任务默认使用完全访问权限自动执行，不弹出命令或文件审批。
        </div>
      </div>

      <!-- 数据源 -->
      <div class="card">
        <div class="card-title">数据源</div>
        <div class="source-row">
          <span class="dot" :class="app.health?.market.ok ? 'ok' : 'error'" />
          <div>
            <b>行情 · 东方财富</b>
            <div class="meta-line">近实时快照 · 最近成功 {{ fmtDateTime(app.health?.market.lastSuccess) }}</div>
          </div>
        </div>
        <div class="source-row">
          <span class="dot" :class="app.health?.valuation.ok ? 'ok' : 'error'" />
          <div>
            <b>估值 · 价值大师网</b>
            <div class="meta-line">日级缓存 90 天 · 未获再分发授权，仅限个人研究使用</div>
          </div>
        </div>
        <div class="kv" style="margin-top: 8px">
          <span>证券主数据</span>
          <b><span class="num">{{ app.health?.masterCount ?? 0 }}</span> 只 · 更新于 {{ fmtDateTime(app.health?.masterUpdatedAt) }}</b>
        </div>
        <div class="actions">
          <button class="btn" :disabled="syncing" @click="syncMaster">{{ syncing ? '同步中…' : '立即同步主数据' }}</button>
        </div>
      </div>

      <!-- 存储 -->
      <div class="card">
        <div class="card-title">本地存储</div>
        <div class="kv"><span>数据目录</span><b class="num">{{ app.health?.dataDir }}</b></div>
        <div class="kv"><span>Codex 工作目录</span><b class="num">{{ app.health?.workDir }}</b></div>
        <template v-if="stats">
          <div class="kv"><span>总占用</span><b class="num">{{ fmtBytes(stats.total) }}</b></div>
          <div class="kv"><span>行情缓存</span><b class="num">{{ fmtBytes(stats.marketCache) }}</b></div>
          <div class="kv"><span>估值缓存</span><b class="num">{{ fmtBytes(stats.valuationCache) }}</b></div>
          <div class="kv"><span>研判归档</span><b class="num">{{ fmtBytes(stats.workdir) }}</b></div>
        </template>
        <div class="actions">
          <button class="btn" @click="openDataDir">打开数据目录</button>
          <button class="btn" @click="clearCache('market')">清理行情缓存</button>
          <button class="btn" @click="clearCache('valuation')">清理估值缓存</button>
        </div>
        <div class="meta-line" style="margin-top: 10px">清理缓存不会删除自选、专家与研判报告。</div>
      </div>

      <!-- 关于 -->
      <div class="card">
        <div class="card-title">关于与声明</div>
        <div class="about">
          <p><b>Hanai Investment</b> v0.1 · 本地优先 A 股价值研究工作台</p>
          <p>本产品是研究辅助工具，不是券商、投顾或资产管理服务：不执行交易、不承诺收益、不提供确定性买卖建议。</p>
          <p>行情与估值数据可能延迟、不完整或有误，请以交易所与官方披露为准；数据接口仅限个人研究，未获再分发授权，不得用于公开发行。</p>
          <p>遥测默认关闭；全部用户数据保存在本机 <code class="num">~/.hanai-investment</code>。</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
  max-width: 1100px;
}
.kv {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 6px 0;
  font-size: 12.5px;
  border-bottom: 1px dashed rgba(255, 255, 255, 0.05);
}
.kv span {
  color: var(--text-muted);
  flex-shrink: 0;
}
.kv b {
  text-align: right;
  word-break: break-all;
  font-weight: 500;
}
.actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.hint-box {
  margin-top: 10px;
  background: rgba(224, 179, 76, 0.08);
  border: 1px solid rgba(224, 179, 76, 0.3);
  border-radius: var(--radius-s);
  padding: 9px 12px;
  font-size: 12px;
}
.source-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 7px 0;
}
.source-row .dot {
  margin-top: 5px;
}
.source-row b {
  font-size: 12.5px;
}
.about {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.8;
}
.about p {
  margin-bottom: 6px;
}
.about code {
  background: rgba(0, 0, 0, 0.3);
  padding: 1px 5px;
  border-radius: 4px;
}
</style>
