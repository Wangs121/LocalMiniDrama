<template>
  <section class="ai-edit-panel" aria-label="AI 修改">
    <header class="ai-edit-header">
      <div>
        <h3>AI 修改</h3>
        <span v-if="remotePending" class="ai-edit-status">AI 正在处理</span>
      </div>
      <div class="ai-edit-tools">
        <el-button
          v-if="remotePending"
          :icon="Refresh"
          circle
          title="刷新处理状态"
          aria-label="刷新处理状态"
          :loading="loading"
          @click="load"
        />
        <el-dropdown trigger="click" @command="handleMenuCommand">
          <el-button :icon="MoreFilled" circle title="更多操作" aria-label="更多操作" />
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="clear" :disabled="!canClear">清空对话</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </header>

    <div class="ai-edit-history" aria-live="polite">
      <div v-if="loading && messages.length === 0" class="ai-edit-empty">正在加载...</div>
      <div v-else-if="messages.length === 0" class="ai-edit-empty">暂无对话</div>
      <article
        v-for="(message, index) in messages"
        :key="messageKey(message, index)"
        class="ai-edit-message"
        :class="`is-${message.role}`"
      >
        <span class="ai-edit-message-role">{{ message.role === 'user' ? '你' : 'AI' }}</span>
        <p v-if="message.role === 'user'">{{ message.content }}</p>
        <template v-else-if="message.role === 'assistant'">
          <div class="ai-edit-reply-summary">
            <span>{{ message.request_status === 'failed' ? 'AI 回复失败' : 'AI 已回复' }}</span>
            <el-button text type="primary" @click="toggleReply(message, index)">
              {{ replyExpanded(message, index) ? '收起 AI 回复' : '查看 AI 回复' }}
            </el-button>
          </div>
          <div v-if="replyExpanded(message, index)" class="ai-edit-reply-content">
            <p>{{ message.content }}</p>
            <div v-if="message.request_status === 'completed' && message.changes?.length" class="ai-edit-reply-changes">
              <strong>AI 修改结果</strong>
              <div v-for="change in message.changes" :key="change.field" class="ai-edit-reply-change">
                <span>{{ fieldLabel(entityType, change.field) }}</span>
                <p>{{ displayValue(change.field, change.new_value) }}</p>
              </div>
            </div>
          </div>
        </template>
      </article>

      <div v-if="error" class="ai-edit-error" role="alert">{{ error }}</div>

      <section v-if="latestProposal" class="ai-edit-proposal">
        <div v-if="latestProposal.stale" class="ai-edit-stale">
          <span>表单已变化，这条建议需要重新生成</span>
          <el-button :icon="Refresh" :loading="sending" @click="retryLatest">重新生成</el-button>
        </div>
        <template v-else-if="latestProposal.changes?.length">
          <h4>字段变更</h4>
          <el-checkbox-group v-model="selectedFields" class="ai-edit-diffs">
            <label
              v-for="change in latestProposal.changes"
              :key="change.field"
              class="ai-edit-diff-row"
            >
              <el-checkbox :value="change.field">
                {{ fieldLabel(entityType, change.field) }}
              </el-checkbox>
              <span class="ai-edit-value is-old">原值：{{ displayValue(change.field, change.old_value) }}</span>
              <span class="ai-edit-value is-new">新值：{{ displayValue(change.field, change.new_value) }}</span>
              <span class="ai-edit-inline-diff" aria-label="文本差异">
                <span
                  v-for="(part, index) in changeParts(change)"
                  :key="`${change.field}-${index}`"
                  :class="`is-${part.type}`"
                >{{ part.text }}</span>
              </span>
            </label>
          </el-checkbox-group>
        </template>
        <div v-else class="ai-edit-empty">这次建议没有字段变化</div>
        <div class="ai-edit-proposal-actions">
          <el-button
            v-if="!latestProposal.stale"
            :disabled="!canApply"
            type="primary"
            @click="applySelection"
          >应用所选</el-button>
          <el-button :disabled="sending" @click="discardProposal">放弃建议</el-button>
        </div>
      </section>
    </div>

    <footer class="ai-edit-composer">
      <el-input
        v-model="draftMessage"
        type="textarea"
        :rows="3"
        resize="vertical"
        placeholder="告诉 AI 需要怎样修改"
        :disabled="!canSend"
      />
      <div class="ai-edit-actions">
        <el-button
          type="primary"
          :icon="Promotion"
          circle
          title="发送"
          aria-label="发送"
          :loading="sending"
          :disabled="!canSend || !draftMessage.trim()"
          @click="send()"
        />
      </div>
    </footer>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { MoreFilled, Promotion, Refresh } from '@element-plus/icons-vue'
import { aiEditsAPI } from '@/api/aiEdits.js'
import { useAiEditConversation } from '@/composables/useAiEditConversation.js'
import {
  fieldLabel,
  formatFieldValue,
  mediaImpactBetween,
  normalizeAiEditSnapshot,
} from '@/utils/aiEditEntities.js'
import { diffText } from '@/utils/textDiff.js'

const props = defineProps({
  entityType: { type: String, required: true },
  entityId: { type: [Number, String], required: true },
  episodeId: { type: [Number, String], default: null },
  getSnapshot: { type: Function, required: true },
  applyFields: { type: Function, required: true },
  relationOptions: { type: Object, default: () => ({}) },
})

const emit = defineEmits(['applied', 'discarded', 'media-impact'])

async function confirmClear() {
  try {
    await ElMessageBox.confirm('确定清空这次对象的 AI 对话历史吗？', '清空对话', {
      confirmButtonText: '清空',
      cancelButtonText: '取消',
      type: 'warning',
    })
    return true
  } catch (_) {
    return false
  }
}

const conversation = useAiEditConversation({
  api: aiEditsAPI,
  entityType: () => props.entityType,
  entityId: () => props.entityId,
  episodeId: () => props.episodeId,
  getSnapshot: props.getSnapshot,
  applyFields: props.applyFields,
  confirmClear,
  notify: (message) => ElMessage.error(message),
})

const {
  messages,
  latestProposal,
  selectedFields,
  draftMessage,
  loading,
  sending,
  remotePending,
  error,
  canApply,
  canSend,
  load,
  send,
  retryLatest,
  applySelected,
  discardLatest,
  clearHistory,
  reset,
} = conversation

const canClear = computed(() => !sending.value && !remotePending.value && messages.value.length > 0)
const expandedReplyIds = ref(new Set())

function messageKey(message, index) {
  return message.id != null
    ? `message-${message.id}`
    : `message-${message.client_request_id || message.created_at || `${message.role}-${index}`}`
}

function replyExpanded(message, index) {
  return expandedReplyIds.value.has(messageKey(message, index))
}

function toggleReply(message, index) {
  const key = messageKey(message, index)
  const next = new Set(expandedReplyIds.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedReplyIds.value = next
}

function displayValue(field, value) {
  return formatFieldValue(props.entityType, field, value, props.relationOptions)
}

function changeParts(change) {
  return diffText(displayValue(change.field, change.old_value), displayValue(change.field, change.new_value))
}

async function applySelection() {
  const fields = [...selectedFields.value]
  const before = normalizeAiEditSnapshot(props.entityType, props.getSnapshot())
  if (!await applySelected(fields)) return
  const impact = mediaImpactBetween(props.entityType, before, props.getSnapshot())
  emit('applied', fields)
  emit('media-impact', impact)
}

async function discardProposal() {
  if (await discardLatest()) emit('discarded')
}

function handleMenuCommand(command) {
  if (command === 'clear') clearHistory()
}

onMounted(load)
onBeforeUnmount(reset)
defineExpose({ load, reset })
</script>

<style scoped>
.ai-edit-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 360px;
  min-height: 520px;
  max-height: min(720px, calc(100vh - 140px));
  border-left: 1px solid var(--el-border-color-light);
  color: var(--el-text-color-primary);
}

.ai-edit-header,
.ai-edit-actions,
.ai-edit-tools,
.ai-edit-stale {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.ai-edit-header {
  min-height: 48px;
  padding: 0 12px;
  border-bottom: 1px solid var(--el-border-color-light);
}

.ai-edit-header h3,
.ai-edit-proposal h4,
.ai-edit-message p {
  margin: 0;
}

.ai-edit-header h3,
.ai-edit-proposal h4 {
  font-size: 14px;
}

.ai-edit-status {
  color: var(--el-color-primary);
  font-size: 12px;
}

.ai-edit-history {
  flex: 1 1 auto;
  min-height: 280px;
  max-height: 520px;
  overflow-y: auto;
  padding: 0 12px;
}

.ai-edit-message,
.ai-edit-proposal,
.ai-edit-error,
.ai-edit-empty {
  padding: 12px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
  word-break: break-word;
}

.ai-edit-message-role {
  display: block;
  margin-bottom: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.ai-edit-message p,
.ai-edit-value,
.ai-edit-inline-diff {
  white-space: pre-wrap;
  line-height: 1.6;
}

.ai-edit-reply-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.ai-edit-reply-content {
  margin-top: 8px !important;
  padding: 8px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
}

.ai-edit-reply-changes {
  display: grid;
  gap: 8px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed var(--el-border-color-lighter);
}

.ai-edit-reply-change span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.ai-edit-reply-change p {
  margin-top: 2px;
}

.ai-edit-error,
.ai-edit-stale {
  color: var(--el-color-danger);
}

.ai-edit-diffs {
  display: grid;
  gap: 0;
}

.ai-edit-diff-row {
  display: grid;
  gap: 6px;
  padding: 10px 0;
  border-bottom: 1px dashed var(--el-border-color-lighter);
  cursor: pointer;
  word-break: break-word;
}

.ai-edit-value {
  color: var(--el-text-color-regular);
  font-size: 13px;
}

.ai-edit-inline-diff {
  padding: 8px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  font-size: 13px;
}

.ai-edit-inline-diff .is-remove {
  color: var(--el-color-danger);
  text-decoration: line-through;
  background: var(--el-color-danger-light-9);
}

.ai-edit-inline-diff .is-add {
  color: var(--el-color-success);
  background: var(--el-color-success-light-9);
}

.ai-edit-empty {
  color: var(--el-text-color-secondary);
  text-align: center;
}

.ai-edit-composer {
  flex: 0 0 auto;
  padding: 12px;
  border-top: 1px solid var(--el-border-color-light);
}

.ai-edit-actions {
  justify-content: flex-end;
  margin-top: 8px;
}

.ai-edit-proposal-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
}

@media (max-width: 760px) {
  .ai-edit-panel {
    min-width: 0;
    width: 100%;
    border-left: 0;
  }
}
</style>
