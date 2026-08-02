<script setup lang="ts">
import { useAppStore } from '../stores/app'

const app = useAppStore()
</script>

<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h1>专家中心</h1>
        <p>了解每位专家的分析框架、适用场景与核心方法</p>
      </div>
    </div>

    <div class="persona-grid">
      <article v-for="p in app.personas" :key="p.id" class="card persona-card">
        <div class="pc-head">
          <span class="avatar" :style="{ borderColor: p.color, color: p.color }">{{ p.shortName }}</span>
          <div class="pc-title">
            <b>{{ p.name }}</b>
            <div class="pc-badges">
              <span v-if="p.roleTag === '游资大佬'" class="tag" style="color: #e08a4c; border-color: rgba(224,138,76,0.4)">游资大佬</span>
              <span v-else-if="p.roleTag" class="tag gold">{{ p.roleTag }}</span>
            </div>
          </div>
        </div>
        <div class="pc-body">
          <div class="section-label">专家介绍</div>
          <p class="pc-desc">{{ p.description || '暂无介绍' }}</p>
        </div>
        <div v-if="p.tags.length" class="pc-methods">
          <div class="section-label">核心方法</div>
          <div class="pc-tags">
            <span v-for="t in p.tags" :key="t" class="tag">{{ t }}</span>
          </div>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.page-header { align-items: flex-start; margin-bottom: 18px; }
.page-header p { margin-top: 4px; color: var(--text-muted); font-size: 11px; }
.persona-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  align-items: stretch;
}
.persona-card {
  display: flex;
  min-width: 0;
  min-height: 210px;
  flex-direction: column;
  padding: 18px;
}
.pc-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 15px;
  padding-bottom: 13px;
  border-bottom: 1px solid var(--border-subtle);
}
.avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 2px solid;
  background: var(--bg-raised-2);
  font-size: 16px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.pc-title {
  flex: 1;
}
.pc-title b {
  font-size: 14px;
}
.pc-badges {
  display: flex;
  gap: 5px;
  margin-top: 3px;
}
.pc-body { flex: 1; }
.section-label {
  margin-bottom: 6px;
  color: var(--text-muted);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: .1em;
}
.pc-desc {
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.75;
  text-wrap: pretty;
}
.pc-methods {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--border-subtle);
}
.pc-tags {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}
@media (max-width: 1100px) {
  .persona-grid { grid-template-columns: 1fr; }
  .persona-card { min-height: 0; }
}
</style>
