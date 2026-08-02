<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import type { SearchResult } from '@shared/types'
import WatchGroupDialog from './WatchGroupDialog.vue'
import { fmtNum, fmtPct, pctClass } from '../utils/format'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const router = useRouter()
const query = ref('')
const results = ref<SearchResult[]>([])
const activeIdx = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)
const watchTarget = ref<SearchResult | null>(null)
const watchDialogOpen = ref(false)
let seq = 0

watch(
  () => props.open,
  async (v) => {
    if (v) {
      query.value = ''
      results.value = []
      activeIdx.value = 0
      await nextTick()
      inputEl.value?.focus()
    }
  }
)

watch(query, async (q) => {
  const mySeq = ++seq
  if (!q.trim()) {
    results.value = []
    return
  }
  const r = await window.hanai.master.search(q.trim())
  if (mySeq === seq) {
    results.value = r
    activeIdx.value = 0
  }
})

function close(): void {
  emit('update:open', false)
}

function pick(r: SearchResult): void {
  close()
  void router.push(`/stock/${r.secId}`)
}

function openWatchDialog(result: SearchResult): void {
  watchTarget.value = result
  watchDialogOpen.value = true
}

function afterWatchAdded(): void {
  watchDialogOpen.value = false
  close()
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') close()
  else if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIdx.value = Math.min(activeIdx.value + 1, results.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIdx.value = Math.max(activeIdx.value - 1, 0)
  } else if (e.key === 'Enter' && results.value[activeIdx.value]) {
    pick(results.value[activeIdx.value])
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="overlay" @click.self="close">
      <div class="panel" @keydown="onKeydown">
        <input
          ref="inputEl"
          v-model="query"
          class="search-input"
          placeholder="输入代码、名称、拼音全拼或首字母…"
          spellcheck="false"
        />
        <div v-if="results.length" class="results">
          <div
            v-for="(r, i) in results"
            :key="r.secId"
            class="result"
            :class="{ active: i === activeIdx }"
            @mouseenter="activeIdx = i"
            @click="pick(r)"
          >
            <span class="r-code num">{{ r.code }}</span>
            <span class="r-name">{{ r.name }}</span>
            <span class="tag">{{ r.exchange }}</span>
            <span class="r-price num">{{ fmtNum(r.price) }}</span>
            <span class="r-pct num" :class="pctClass(r.changePct)">{{ fmtPct(r.changePct) }}</span>
            <button class="watch-add" @click.stop="openWatchDialog(r)">＋ 加入自选</button>
          </div>
        </div>
        <div v-else-if="query.trim()" class="empty">未找到匹配的证券（本地主数据）</div>
        <div v-else class="hint">支持：600519 · 贵州茅台 · guizhoumaotai · gzmt</div>
      </div>
    </div>
  </Teleport>
  <WatchGroupDialog
    v-if="watchTarget"
    v-model:open="watchDialogOpen"
    :sec-id="watchTarget.secId"
    :stock-name="watchTarget.name"
    mode="add"
    @changed="afterWatchAdded"
  />
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(3px);
  z-index: 100;
  display: flex;
  justify-content: center;
  padding-top: 14vh;
}
.panel {
  width: 700px;
  max-height: 60vh;
  background: #12161f;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-l);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  height: fit-content;
}
.search-input {
  background: transparent;
  border: none;
  outline: none;
  padding: 16px 18px;
  font-size: 15px;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-subtle);
}
.results {
  overflow-y: auto;
  padding: 6px;
}
.result {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 12px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-s);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}
.result.active {
  background: var(--bg-active);
}
.result:hover {
  border-color: var(--border-subtle);
}
.r-code {
  color: var(--text-secondary);
  width: 62px;
}
.r-name {
  flex: 1;
  font-weight: 500;
}
.r-price {
  width: 72px;
  text-align: right;
}
.r-pct {
  width: 72px;
  text-align: right;
}
.watch-add {
  flex: 0 0 auto;
  padding: 6px 9px;
  border: 1px solid rgba(224, 179, 76, .32);
  border-radius: var(--radius-s);
  background: rgba(224, 179, 76, .08);
  color: var(--accent-strong);
  cursor: pointer;
  font-size: 10.5px;
  white-space: nowrap;
}
.watch-add:hover {
  border-color: rgba(224, 179, 76, .55);
  background: rgba(224, 179, 76, .14);
}
@media (max-width: 760px) {
  .panel { width: calc(100vw - 32px); }
  .r-price,
  .r-pct { display: none; }
}
.hint,
.empty {
  padding: 18px;
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
}
</style>
