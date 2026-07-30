import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { useAiEditConversation } from '../src/composables/useAiEditConversation.js'
import { useUnsavedDialogGuard } from '../src/composables/useUnsavedDialogGuard.js'
import { hashAiEditSnapshot, normalizeAiEditSnapshot } from '../src/utils/aiEditEntities.js'

function successResponse(overrides = {}) {
  return {
    message_id: 1,
    content: '已调整',
    candidate: normalizeAiEditSnapshot('character', { name: '林夏', appearance: '短发' }),
    changes: [{ field: 'appearance', old_value: '长发', new_value: '短发' }],
    base_snapshot_hash: '',
    ...overrides,
  }
}

function fakeApi(overrides = {}) {
  return {
    async get() { return { messages: [], latest_candidate: null, has_pending_request: false } },
    async send() { return successResponse() },
    async updateProposal() {},
    async clear() {},
    ...overrides,
  }
}

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

test('conversation iterates from the latest candidate and applies selected fields only', async () => {
  const calls = []
  const target = { name: '林夏', appearance: '长发', polished_prompt: 'long hair' }
  const api = fakeApi({
    async send(_type, _id, body) {
      calls.push(body)
      return {
        message_id: calls.length,
        content: '已调整',
        candidate: { ...body.current_snapshot, appearance: '短发', polished_prompt: 'short hair' },
        changes: [
          { field: 'appearance', old_value: '长发', new_value: '短发' },
          { field: 'polished_prompt', old_value: 'long hair', new_value: 'short hair' },
        ],
        base_snapshot_hash: body.base_snapshot_hash,
      }
    },
  })
  const state = useAiEditConversation({
    api,
    entityType: () => 'character',
    entityId: () => 10,
    episodeId: () => 101,
    getSnapshot: () => target,
    applyFields: (candidate, fields) => {
      for (const field of fields) target[field] = candidate[field]
    },
  })

  await state.load()
  await state.send('改短发')
  await state.send('提示词也同步')
  assert.equal(calls[1].previous_candidate_message_id, 1)
  await state.applySelected(['appearance'])
  assert.equal(target.appearance, '短发')
  assert.equal(target.polished_prompt, 'long hair')
  assert.equal(calls[0].previous_candidate_message_id, null)
  assert.equal(state.latestProposal.value, null)
})

test('response is stale when the form changes during a request', async () => {
  const target = { name: '林夏', appearance: '长发' }
  const enteredSend = deferred()
  const response = deferred()
  const api = fakeApi({
    send() {
      enteredSend.resolve()
      return response.promise
    },
  })
  const state = useAiEditConversation({
    api,
    entityType: () => 'character',
    entityId: () => 10,
    getSnapshot: () => target,
    applyFields() {},
  })
  const pending = state.send('改短发')
  await enteredSend.promise
  target.appearance = '卷发'
  response.resolve(successResponse())
  await pending
  assert.equal(state.latestProposal.value.stale, true)
  assert.equal(state.canApply.value, false)
})

test('reset before hashing completes prevents the API request and settles send', async () => {
  let sendCalls = 0
  const api = fakeApi({
    async send() {
      sendCalls += 1
      throw new Error('send should not be called after reset')
    },
  })
  const state = useAiEditConversation({
    api,
    entityType: () => 'character',
    entityId: () => 10,
    getSnapshot: () => ({ name: '林夏' }),
    applyFields() {},
  })
  const pending = state.send('调整')
  state.reset()
  const result = await pending
  assert.equal(result, null)
  assert.equal(sendCalls, 0)
  assert.equal(state.sending.value, false)
  assert.equal(state.error.value, null)
})

test('reset aborts an active frontend wait without surfacing an error', async () => {
  const enteredSend = deferred()
  const api = fakeApi({
    send(_type, _id, _body, { signal }) {
      enteredSend.resolve()
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        }, { once: true })
      })
    },
  })
  const state = useAiEditConversation({
    api,
    entityType: () => 'character',
    entityId: () => 10,
    getSnapshot: () => ({ name: '林夏' }),
    applyFields() {},
  })
  const pending = state.send('调整')
  await enteredSend.promise
  state.reset()
  assert.equal(await pending, null)
  assert.equal(state.sending.value, false)
  assert.equal(state.error.value, null)
})

test('load restores pending state and marks a mismatched proposal stale', async () => {
  const target = { name: '林夏', appearance: '卷发' }
  const oldSnapshot = normalizeAiEditSnapshot('character', { name: '林夏', appearance: '长发' })
  const api = fakeApi({
    async get() {
      return {
        messages: [{ id: 1, role: 'assistant', content: '已调整' }],
        has_pending_request: true,
        latest_candidate: {
          message_id: 1,
          candidate: normalizeAiEditSnapshot('character', { name: '林夏', appearance: '短发' }),
          changes: [{ field: 'appearance', old_value: '长发', new_value: '短发' }],
          base_snapshot_hash: await hashAiEditSnapshot(oldSnapshot),
        },
      }
    },
  })
  const state = useAiEditConversation({ api, entityType: () => 'character', entityId: () => 10, getSnapshot: () => target, applyFields() {} })
  await state.load()
  assert.equal(state.remotePending.value, true)
  assert.equal(state.canSend.value, false)
  assert.equal(state.latestProposal.value.stale, true)
})

test('failed send preserves input and proposal while clear requires confirmation', async () => {
  let clearCalls = 0
  let sendCalls = 0
  const notices = []
  const api = fakeApi({
    async send() {
      sendCalls += 1
      if (sendCalls === 1) return successResponse({ message_id: 9 })
      throw new Error('provider failed')
    },
    async clear() { clearCalls += 1 },
  })
  const state = useAiEditConversation({
    api,
    entityType: () => 'character',
    entityId: () => 10,
    getSnapshot: () => ({ name: '林夏' }),
    applyFields() {},
    confirmClear: async () => false,
    notify: (message) => notices.push(message),
  })
  await state.send('先生成建议')
  const proposal = state.latestProposal.value
  await state.send('保留输入')
  assert.equal(state.draftMessage.value, '保留输入')
  assert.equal(state.error.value, 'provider failed')
  assert.equal(state.latestProposal.value, proposal)
  await state.clearHistory()
  assert.equal(clearCalls, 0)
  assert.ok(notices.length > 0)
})

test('unsaved dialog guard supports save discard and keep-editing branches', async () => {
  const target = { name: '林夏' }
  const events = []
  let action = 'confirm'
  const guard = useUnsavedDialogGuard({
    getSnapshot: () => target,
    save: async () => events.push('save'),
    discard: async () => events.push('discard'),
    close: () => events.push('close'),
    confirm: async () => {
      if (action === 'confirm') return 'confirm'
      throw action
    },
  })
  guard.captureCleanSnapshot()
  target.name = '林秋'
  await guard.requestClose()
  assert.deepEqual(events, ['save', 'close'])

  target.name = '林冬'
  action = 'cancel'
  await guard.requestClose()
  assert.deepEqual(events, ['save', 'close', 'discard', 'close'])

  target.name = '林春'
  action = 'close'
  await guard.requestClose()
  assert.deepEqual(events, ['save', 'close', 'discard', 'close'])
})

test('axios cancellation bypasses the global error toast', async () => {
  const source = await readFile(new URL('../src/utils/request.js', import.meta.url), 'utf8')
  assert.match(source, /ERR_CANCELED/)
  assert.match(source, /CanceledError/)
})
