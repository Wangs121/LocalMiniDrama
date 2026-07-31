import { computed, ref } from 'vue'
import { hashAiEditSnapshot, normalizeAiEditSnapshot, stableStringify } from '../utils/aiEditEntities.js'

function valueOf(source) {
  return typeof source === 'function' ? source() : source
}

function isCanceled(error) {
  return error?.name === 'AbortError' || error?.name === 'CanceledError' || error?.code === 'ERR_CANCELED'
}

function cloneSnapshot(value) {
  return JSON.parse(stableStringify(value))
}

export function useAiEditConversation({
  api,
  entityType,
  entityId,
  episodeId,
  getSnapshot,
  applyFields,
  confirmClear = async () => true,
  notify = () => {},
}) {
  const messages = ref([])
  const latestProposal = ref(null)
  const selectedFields = ref([])
  const draftMessage = ref('')
  const loading = ref(false)
  const sending = ref(false)
  const remotePending = ref(false)
  const error = ref(null)
  let controller = null
  let generation = 0

  const canApply = computed(() => Boolean(
    latestProposal.value && !latestProposal.value.stale && !sending.value && selectedFields.value.length > 0
  ))
  const canSend = computed(() => !sending.value && !remotePending.value)

  function normalizedCurrentSnapshot() {
    return normalizeAiEditSnapshot(valueOf(entityType), getSnapshot?.() || {})
  }

  async function proposalWithStale(proposal) {
    if (!proposal) return null
    const currentHash = await hashAiEditSnapshot(normalizedCurrentSnapshot())
    return { ...proposal, stale: currentHash !== proposal.base_snapshot_hash }
  }

  async function load() {
    loading.value = true
    error.value = null
    try {
      const result = await api.get(valueOf(entityType), valueOf(entityId))
      messages.value = Array.isArray(result?.messages) ? result.messages : []
      remotePending.value = Boolean(result?.has_pending_request)
      latestProposal.value = await proposalWithStale(result?.latest_candidate || null)
      selectedFields.value = latestProposal.value?.stale
        ? []
        : (latestProposal.value?.changes || []).map((change) => change.field)
      return result
    } catch (cause) {
      error.value = cause?.message || '加载会话失败'
      notify(error.value)
      return null
    } finally {
      loading.value = false
    }
  }

  async function send(message = draftMessage.value) {
    const text = String(message ?? '').trim()
    draftMessage.value = message == null ? '' : String(message)
    if (!text || !canSend.value) return null
    const requestGeneration = generation
    const requestSnapshot = cloneSnapshot(normalizedCurrentSnapshot())
    const requestStableJson = stableStringify(requestSnapshot)
    const baseSnapshotHash = await hashAiEditSnapshot(requestSnapshot)
    if (requestGeneration !== generation) return null
    const requestController = new AbortController()
    controller = requestController
    sending.value = true
    error.value = null
    try {
      const result = await api.send(valueOf(entityType), valueOf(entityId), {
        client_request_id: globalThis.crypto.randomUUID(),
        episode_id: valueOf(episodeId) ?? null,
        message: text,
        current_snapshot: requestSnapshot,
        base_snapshot_hash: baseSnapshotHash,
        previous_candidate_message_id: latestProposal.value?.message_id ?? null,
      }, { signal: requestController.signal })
      if (requestGeneration !== generation) return null
      const stale = stableStringify(normalizedCurrentSnapshot()) !== requestStableJson
      latestProposal.value = { ...result, stale }
      selectedFields.value = stale ? [] : (result?.changes || []).map((change) => change.field)
      messages.value = [
        ...messages.value,
        { role: 'user', content: text, request_status: 'completed' },
        {
          id: result?.message_id,
          role: 'assistant',
          content: result?.content || result?.reply || '',
          candidate: result?.candidate || null,
          changes: result?.changes || [],
          proposal_status: result?.proposal_status || 'pending',
          request_status: 'completed',
        },
      ]
      remotePending.value = false
      draftMessage.value = ''
      return result
    } catch (cause) {
      if (isCanceled(cause) || requestGeneration !== generation) return null
      error.value = cause?.message || '发送失败'
      notify(error.value)
      return null
    } finally {
      if (controller === requestController) controller = null
      if (requestGeneration === generation) sending.value = false
    }
  }

  function retryLatest() {
    const lastUserMessage = [...messages.value].reverse().find((message) => message?.role === 'user')
    return send(draftMessage.value || lastUserMessage?.content || '')
  }

  async function syncProposalStatus(fields) {
    const proposal = latestProposal.value
    if (!proposal) return
    try {
      await api.updateProposal(valueOf(entityType), valueOf(entityId), proposal.message_id, {
        selected_fields: fields,
      })
    } catch (_) {
      notify('历史状态未同步')
    }
  }

  async function applySelected(fields = selectedFields.value) {
    const proposal = latestProposal.value
    const chosen = Array.isArray(fields) ? [...fields] : []
    if (!proposal || proposal.stale || chosen.length === 0) return false
    applyFields(proposal.candidate, chosen)
    await syncProposalStatus(chosen)
    latestProposal.value = null
    selectedFields.value = []
    return true
  }

  async function discardLatest() {
    if (!latestProposal.value) return false
    await syncProposalStatus([])
    latestProposal.value = null
    selectedFields.value = []
    return true
  }

  async function clearHistory() {
    if (sending.value || remotePending.value) return false
    let confirmed = false
    try {
      confirmed = await confirmClear()
    } catch (_) {
      return false
    }
    if (!confirmed) return false
    try {
      await api.clear(valueOf(entityType), valueOf(entityId))
      messages.value = []
      latestProposal.value = null
      selectedFields.value = []
      return true
    } catch (cause) {
      error.value = cause?.message || '清空失败'
      notify(error.value)
      return false
    }
  }

  function cancelPending() {
    controller?.abort()
    controller = null
  }

  function reset() {
    generation += 1
    cancelPending()
    messages.value = []
    latestProposal.value = null
    selectedFields.value = []
    draftMessage.value = ''
    loading.value = false
    sending.value = false
    remotePending.value = false
    error.value = null
  }

  return {
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
    cancelPending,
    reset,
  }
}
