<script setup lang="ts">
import { onMounted, computed, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAppStore } from './stores/app'
import GlobalSearch from './components/GlobalSearch.vue'
import PersonaRail from './components/PersonaRail.vue'
import ApprovalDialog from './components/ApprovalDialog.vue'
import { fmtTime } from './utils/format'

const app = useAppStore()
const router = useRouter()
const route = useRoute()

onMounted(() => {
  app.init()
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      searchOpen.value = true
    }
  })
})

const searchOpen = ref(false)

const navs = [
  { path: '/dashboard', label: '今日市场', icon: '◈' },
  { path: '/watch', label: '自选与发现', icon: '☆' },
  { path: '/chat', label: '大师对话', icon: '✉' },
  { path: '/committee', label: '分析讨论', icon: '⚖' },
  { path: '/personas', label: '角色中心', icon: '◉' },
  { path: '/settings', label: '设置与诊断', icon: '⚙' }
]

const codexDot = computed(() => {
  const s = app.codexState?.status
  if (s === 'ready') return 'ok'
  if (s === 'connecting') return 'warn'
  if (!s || s === 'not-installed' || s === 'not-logged-in') return 'off'
  return 'error'
})

const codexLabel = computed(() => {
  const map: Record<string, string> = {
    ready: 'Codex 就绪',
    connecting: 'Codex 连接中',
    'not-installed': 'Codex 未安装',
    'not-logged-in': 'Codex 未登录',
    incompatible: 'Codex 版本不兼容',
    error: 'Codex 异常'
  }
  return map[app.codexState?.status ?? ''] ?? 'Codex 未知'
})

const marketDot = computed(() => (app.health?.market.ok ? 'ok' : 'error'))
</script>

<template>
  <div class="shell">
    <aside class="nav">
      <div class="brand" @dblclick="router.push('/dashboard')">
        <div class="brand-mark">H</div>
        <div class="brand-text">
          <div class="brand-name">Hanai</div>
          <div class="brand-sub">Investment</div>
        </div>
      </div>
      <nav class="nav-list">
        <button
          v-for="n in navs"
          :key="n.path"
          class="nav-item"
          :class="{ active: route.path.startsWith(n.path) }"
          @click="router.push(n.path)"
        >
          <span class="nav-icon">{{ n.icon }}</span>
          <span>{{ n.label }}</span>
        </button>
      </nav>
      <div class="nav-footer">
        <div class="status-row" :title="app.health?.market.message">
          <span class="dot" :class="marketDot" />
          <span>行情源</span>
          <span class="status-time num">{{ fmtTime(app.health?.market.lastSuccess) }}</span>
        </div>
        <div class="status-row" :title="app.codexState?.lastError ?? ''">
          <span class="dot" :class="codexDot" />
          <span>{{ codexLabel }}</span>
        </div>
      </div>
    </aside>

    <div class="body">
      <header class="topbar">
        <button class="search-trigger" @click="searchOpen = true">
          <span class="search-icon">⌕</span>
          <span>搜索股票 · 代码 / 名称 / 拼音</span>
          <span class="kbd">⌘K</span>
        </button>
        <div class="topbar-right">
          <span v-if="app.approvals.length" class="tag gold">{{ app.approvals.length }} 个待审批</span>
        </div>
      </header>
      <main class="content">
        <router-view v-slot="{ Component }">
          <component :is="Component" />
        </router-view>
      </main>
    </div>

    <PersonaRail />
    <GlobalSearch v-model:open="searchOpen" />
    <ApprovalDialog />
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  height: 100vh;
}

.nav {
  width: 176px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-subtle);
  background: rgba(0, 0, 0, 0.18);
  padding: 14px 10px 12px;
  -webkit-app-region: drag;
}
.nav button {
  -webkit-app-region: no-drag;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 28px 8px 22px;
}
.brand-mark {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: linear-gradient(135deg, var(--accent) 0%, #a97c1f 100%);
  color: #16130a;
  font-weight: 800;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: Georgia, serif;
}
.brand-name {
  font-weight: 700;
  font-size: 15px;
  letter-spacing: 0.02em;
}
.brand-sub {
  font-size: 10px;
  color: var(--text-muted);
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.nav-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  border-radius: var(--radius-s);
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: left;
}
.nav-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.nav-item.active {
  background: var(--bg-active);
  color: var(--accent-strong);
  font-weight: 600;
}
.nav-icon {
  font-size: 14px;
  width: 18px;
  text-align: center;
}

.nav-footer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 8px 4px;
  border-top: 1px solid var(--border-subtle);
}
.status-row {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  color: var(--text-muted);
}
.status-time {
  margin-left: auto;
  font-size: 10px;
}

.body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.topbar {
  height: 46px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 18px;
  border-bottom: 1px solid var(--border-subtle);
  -webkit-app-region: drag;
}
.topbar button,
.topbar .topbar-right {
  -webkit-app-region: no-drag;
}

.search-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 340px;
  padding: 6px 12px;
  background: var(--bg-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-m);
  color: var(--text-muted);
  font-size: 12.5px;
  cursor: pointer;
  transition: border-color 0.15s ease;
}
.search-trigger:hover {
  border-color: var(--border-strong);
}
.search-icon {
  font-size: 14px;
}
.kbd {
  margin-left: auto;
  font-size: 10.5px;
  padding: 1px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  font-family: var(--font-num);
}

.topbar-right {
  margin-left: auto;
  display: flex;
  gap: 8px;
  align-items: center;
}

.content {
  flex: 1;
  min-height: 0;
  position: relative;
}
</style>
