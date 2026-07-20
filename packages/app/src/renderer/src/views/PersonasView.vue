<script setup lang="ts">
import { useAppStore } from '../stores/app'

const app = useAppStore()

async function toggle(id: string, enabled: boolean): Promise<void> {
  await window.hanai.persona.setEnabled(id, enabled)
  await app.refreshPersonas()
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h1>角色中心</h1>
      <span class="sub">所有名人角色均为基于公开资料构建的 AI 模拟视角，并非本人或本人背书</span>
    </div>

    <div class="persona-grid">
      <div v-for="p in app.personas" :key="p.id" class="card persona-card" :class="{ disabled: !p.enabled }">
        <div class="pc-head">
          <span class="avatar" :style="{ borderColor: p.color, color: p.color }">{{ p.shortName }}</span>
          <div class="pc-title">
            <b>{{ p.name }}</b>
            <div class="pc-badges">
              <span v-if="p.builtin" class="tag">内置</span>
              <span v-if="p.roleTag === '游资大佬'" class="tag" style="color: #e08a4c; border-color: rgba(224,138,76,0.4)">游资大佬</span>
              <span v-else-if="p.roleTag" class="tag gold">{{ p.roleTag }}</span>
            </div>
          </div>
          <label class="switch">
            <input type="checkbox" :checked="p.enabled" @change="toggle(p.id, ($event.target as HTMLInputElement).checked)" />
            <span class="slider" />
          </label>
        </div>
        <div class="pc-desc">{{ p.description || '（无描述）' }}</div>
        <div class="pc-tags">
          <span v-for="t in p.tags" :key="t" class="tag">{{ t }}</span>
        </div>
        <div class="meta-line" style="margin-top: 10px">
          <template v-if="p.skillPath">角色包 v1 · {{ p.skillPath.includes('personas') ? '已导入数据目录' : p.skillPath }}</template>
          <template v-else>应用内置逻辑，无外部角色包</template>
        </div>
      </div>
    </div>

    <div class="card notice">
      <div class="card-title">导入更多角色</div>
      <div style="font-size: 12.5px; color: var(--text-secondary); line-height: 1.8">
        将 Nuwa 风格人物包（含 YAML frontmatter 的 SKILL.md，可附带 references/ 研究资料）放入
        <code>~/.hanai-investment/personas/&lt;persona-id&gt;/v1/</code>
        后重启应用即可识别。导入包中的脚本不会被执行。
      </div>
    </div>
  </div>
</template>

<style scoped>
.persona-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}
.persona-card.disabled {
  opacity: 0.55;
}
.pc-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.avatar {
  width: 42px;
  height: 42px;
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
.pc-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-bottom: 8px;
}
.pc-tags {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}

.switch {
  position: relative;
  width: 36px;
  height: 20px;
  flex-shrink: 0;
}
.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}
.slider {
  position: absolute;
  inset: 0;
  background: var(--bg-raised-2);
  border: 1px solid var(--border-strong);
  border-radius: 99px;
  cursor: pointer;
  transition: background 0.2s;
}
.slider::before {
  content: '';
  position: absolute;
  width: 14px;
  height: 14px;
  left: 2px;
  top: 2px;
  border-radius: 50%;
  background: var(--text-secondary);
  transition: transform 0.2s, background 0.2s;
}
.switch input:checked + .slider {
  background: var(--accent-dim);
  border-color: var(--accent);
}
.switch input:checked + .slider::before {
  transform: translateX(16px);
  background: var(--accent-strong);
}
.notice code {
  background: rgba(0, 0, 0, 0.3);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11.5px;
}
</style>
