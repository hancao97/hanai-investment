<script setup lang="ts">
import { computed } from 'vue'
import { useAppStore } from '../stores/app'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [boolean]; pick: [personaId: string] }>()

const app = useAppStore()
const candidates = computed(() => app.personas.filter((p) => p.enabled && !p.builtin))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="overlay" @click.self="emit('update:open', false)">
      <div class="panel">
        <div class="p-title">选择一位大师</div>
        <div class="p-sub">角色为基于公开资料的 AI 模拟视角，并非本人。对话将绑定当前股票的证据快照。</div>
        <div class="persona-list">
          <button v-for="p in candidates" :key="p.id" class="persona-item" @click="emit('pick', p.id)">
            <span class="avatar" :style="{ borderColor: p.color, color: p.color }">{{ p.shortName }}</span>
            <span class="p-info">
              <b>{{ p.name }}</b>
              <span class="p-tags">
                <span v-for="t in p.tags" :key="t" class="tag">{{ t }}</span>
                <span v-if="!p.verified" class="tag" style="color: var(--warn)">未验证</span>
              </span>
            </span>
            <span class="arrow">→</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(3px);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
}
.panel {
  width: 460px;
  background: #141822;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-l);
  padding: 20px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
}
.p-title {
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 4px;
}
.p-sub {
  font-size: 11.5px;
  color: var(--text-muted);
  margin-bottom: 14px;
}
.persona-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.persona-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: var(--bg-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-m);
  cursor: pointer;
  color: var(--text-primary);
  text-align: left;
  transition: all 0.15s ease;
}
.persona-item:hover {
  border-color: rgba(224, 179, 76, 0.4);
  background: var(--bg-active);
}
.avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 1.5px solid;
  background: var(--bg-raised-2);
  font-size: 15px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.p-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
}
.p-info b {
  font-size: 13.5px;
}
.p-tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.arrow {
  color: var(--text-muted);
}
</style>
