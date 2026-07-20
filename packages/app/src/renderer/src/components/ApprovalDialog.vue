<script setup lang="ts">
import { computed } from 'vue'
import { useAppStore } from '../stores/app'

const app = useAppStore()
const current = computed(() => app.approvals[0] ?? null)

const kindLabel: Record<string, string> = {
  command: '执行命令',
  file: '修改文件',
  permission: '权限升级'
}
</script>

<template>
  <Teleport to="body">
    <div v-if="current" class="overlay">
      <div class="dialog">
        <div class="d-header">
          <span class="tag gold">Agent 审批请求</span>
          <span class="d-kind">{{ kindLabel[current.kind] ?? current.kind }}</span>
        </div>
        <div class="d-summary">{{ current.summary }}</div>
        <pre class="d-detail">{{ current.detail }}</pre>
        <div class="d-note">角色 Agent 请求越出默认沙箱的操作。请确认内容后再放行；拒绝不会中断整个任务。</div>
        <div class="d-actions">
          <button class="btn danger" @click="app.resolveApproval(current.requestId, 'decline')">拒绝</button>
          <button class="btn primary" @click="app.resolveApproval(current.requestId, 'accept')">允许本次</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dialog {
  width: 520px;
  background: #141822;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-l);
  padding: 20px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
}
.d-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.d-kind {
  font-weight: 600;
  font-size: 14px;
}
.d-summary {
  font-size: 13px;
  margin-bottom: 10px;
}
.d-detail {
  background: rgba(0, 0, 0, 0.35);
  border-radius: var(--radius-s);
  padding: 10px;
  font-size: 12px;
  font-family: var(--font-num);
  max-height: 200px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  margin-bottom: 10px;
}
.d-note {
  font-size: 11.5px;
  color: var(--text-muted);
  margin-bottom: 16px;
}
.d-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
