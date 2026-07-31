# Storyboard AI Editing and Reply Review Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add conversational AI editing to storyboards in list and canvas modes while keeping the primary review surface limited to local field comparisons and making full AI replies available on demand.

**Architecture:** Keep `AiEditPanel.vue` as the shared conversation/review surface and add a single `StoryboardAiEditDialog.vue` that owns the complete storyboard form. Both list and canvas entry points open that component; all candidate differences remain locally computed, and existing storyboard save APIs remain the only business-data write boundary.

**Tech Stack:** Vue 3 Composition API, Element Plus, Axios, Node.js built-in test runner, Vite, Electron Builder.

---

## File Structure

- Modify `frontweb/src/components/AiEditPanel.vue`: collapse assistant prose and leave the active proposal diff as the primary output.
- Create `frontweb/src/components/StoryboardAiEditDialog.vue`: complete storyboard form, shared AI panel, unsaved-change guard, and media freshness display.
- Modify `frontweb/src/views/FilmCreate.vue`: list-mode storyboard entry and shared dialog host.
- Modify `frontweb/src/components/dramaCanvas/CanvasStoryboardPanel.vue`: canvas-mode entry and shared dialog host.
- Modify `frontweb/src/components/dramaCanvas/CanvasAssetPanel.vue`: asset freshness labels only.
- Modify `frontweb/test/aiEditComponents.test.js`: source contracts for reply disclosure and both storyboard entry points.

### Task 1: Collapse Assistant Replies and Prioritize Field Comparison

**Files:**
- Modify: `frontweb/src/components/AiEditPanel.vue`
- Modify: `frontweb/test/aiEditComponents.test.js`

- [ ] **Step 1: Write the failing reply-disclosure contract test**

Append:

```js
test('AI replies are collapsed while the active proposal keeps only local field comparison', async () => {
  const source = await readFile(new URL('../src/components/AiEditPanel.vue', import.meta.url), 'utf8')
  assert.match(source, /查看 AI 回复/)
  assert.match(source, /收起 AI 回复/)
  assert.match(source, /expandedReplyIds/)
  assert.match(source, /message\.role === 'assistant'/)
  assert.match(source, /latestProposal\.changes/)
  assert.doesNotMatch(source, /<section v-if="latestProposal"[\s\S]*?latestProposal\.content/)
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `cd frontweb && node --test test/aiEditComponents.test.js`

Expected: FAIL because `AiEditPanel.vue` has no reply disclosure state or labels.

- [ ] **Step 3: Implement collapsed assistant history rows**

In `AiEditPanel.vue`, add:

```js
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const expandedReplyIds = ref(new Set())

function messageKey(message, index) {
  return message.id || `${message.role}-${index}`
}

function replyExpanded(message, index) {
  return expandedReplyIds.value.has(messageKey(message, index))
}

function toggleReply(message, index) {
  const next = new Set(expandedReplyIds.value)
  const key = messageKey(message, index)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedReplyIds.value = next
}
```

Render user content normally. For assistant rows, render only a compact status row and a text button labelled `查看 AI 回复`; when expanded, show the escaped `message.content` in a bounded `<p>`, and change the label to `收起 AI 回复`. Do not use `v-html`. Keep the active `latestProposal` area limited to `changes`, stale state, and apply/discard actions.

- [ ] **Step 4: Run focused tests and build**

Run: `cd frontweb && node --test test/aiEditComponents.test.js test/aiEditConversation.test.js && npm run build`

Expected: all tests PASS and Vite exits 0.

- [ ] **Step 5: Commit**

```bash
git add -- frontweb/src/components/AiEditPanel.vue frontweb/test/aiEditComponents.test.js
git commit -m "fix: prioritize AI field comparisons"
```

### Task 2: Build the Shared Storyboard AI Edit Dialog

**Files:**
- Create: `frontweb/src/components/StoryboardAiEditDialog.vue`
- Modify: `frontweb/test/aiEditComponents.test.js`

- [ ] **Step 1: Write failing shared-dialog contract tests**

Append:

```js
test('storyboard AI dialog owns the complete form and shared review panel', async () => {
  const source = await readFile(new URL('../src/components/StoryboardAiEditDialog.vue', import.meta.url), 'utf8')
  assert.match(source, /AiEditPanel/)
  assert.match(source, /entity-type="storyboard"/)
  assert.match(source, /storyboardsAPI\.update/)
  assert.match(source, /useUnsavedDialogGuard/)
  for (const field of [
    'character_ids', 'scene_id', 'prop_ids', 'image_prompt', 'polished_prompt',
    'video_prompt', 'universal_segment_text', 'lighting_style', 'depth_of_field',
  ]) assert.match(source, new RegExp(field))
  assert.match(source, /图片可能过期/)
  assert.match(source, /视频可能过期/)
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `cd frontweb && node --test test/aiEditComponents.test.js`

Expected: FAIL with `ENOENT` for `StoryboardAiEditDialog.vue`.

- [ ] **Step 3: Implement the dialog state contract**

Define props and emits exactly:

```js
const props = defineProps({
  modelValue: Boolean,
  storyboard: { type: Object, default: null },
  episodeId: { type: [Number, String], default: null },
  characters: { type: Array, default: () => [] },
  scenes: { type: Array, default: () => [] },
  propsList: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:modelValue', 'saved'])
```

Use one reactive form containing every storyboard adapter field. Organize controls under Element Plus tabs `内容与关联`, `镜头与画面`, and `提示词`. Use ID-based selects for `scene_id`, `character_ids`, and `prop_ids`.

- [ ] **Step 4: Implement AI application, save, and close behavior**

Use:

```js
function getSnapshot() {
  return normalizeAiEditSnapshot('storyboard', form)
}

function applyFields(candidate, fields) {
  return applyCandidateFields('storyboard', form, candidate, fields)
}

async function save() {
  await storyboardsAPI.update(props.storyboard.id, getSnapshot())
  captureCleanSnapshot()
  emit('saved')
  emit('update:modelValue', false)
}
```

Embed `AiEditPanel` with relation options. Use `useUnsavedDialogGuard` for X, mask, Escape, and footer cancel. Do not call prompt rebuild APIs after save. Show persistent `image_stale`/`video_stale` plus local `mediaImpactBetween()` results.

- [ ] **Step 5: Run focused tests and compile**

Run: `cd frontweb && node --test test/aiEditComponents.test.js test/aiEditEntities.test.js test/aiEditConversation.test.js && npm run build`

Expected: all tests PASS and Vite compiles the new SFC.

- [ ] **Step 6: Commit**

```bash
git add -- frontweb/src/components/StoryboardAiEditDialog.vue frontweb/test/aiEditComponents.test.js
git commit -m "feat: build storyboard AI edit dialog"
```

### Task 3: Connect List and Canvas Storyboard Entry Points

**Files:**
- Modify: `frontweb/src/views/FilmCreate.vue`
- Modify: `frontweb/src/components/dramaCanvas/CanvasStoryboardPanel.vue`
- Modify: `frontweb/src/components/dramaCanvas/CanvasAssetPanel.vue`
- Modify: `frontweb/test/aiEditComponents.test.js`

- [ ] **Step 1: Write failing entry-point tests**

Append:

```js
test('list and canvas storyboard editors open the shared AI dialog', async () => {
  const list = await readFile(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
  const canvas = await readFile(new URL('../src/components/dramaCanvas/CanvasStoryboardPanel.vue', import.meta.url), 'utf8')
  assert.match(list, /StoryboardAiEditDialog/)
  assert.match(list, /ChatDotRound/)
  assert.match(canvas, /StoryboardAiEditDialog/)
  assert.match(canvas, /ChatDotRound/)
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `cd frontweb && node --test test/aiEditComponents.test.js`

Expected: FAIL because neither entry point imports the shared dialog.

- [ ] **Step 3: Connect list mode**

In `FilmCreate.vue`, add one target ref and one dialog instance:

```js
const storyboardAiTarget = ref(null)
const showStoryboardAiEdit = ref(false)

function openStoryboardAiEdit(storyboard) {
  storyboardAiTarget.value = storyboard
  showStoryboardAiEdit.value = true
}
```

Add an `AI 修改` button with `ChatDotRound` to every storyboard control row. On `saved`, call `loadDrama()`. Show `图片可能过期` and `视频可能过期` tags from the storyboard flags.

- [ ] **Step 4: Connect canvas mode and asset freshness**

In `CanvasStoryboardPanel.vue`, host the same dialog, pass `ctx.drama` resources, and call `ctx.refreshDrama(true)` on save. Add the same two freshness labels to the header.

In `CanvasAssetPanel.vue`, show `媒体可能过期` when an asset has `image_stale`; do not duplicate the full asset editor.

- [ ] **Step 5: Run full verification**

Run:

```powershell
cd backend-node
node --test test/*.test.js
cd ../frontweb
node --test test/*.test.js
npm run build
```

Expected: backend and frontend tests have zero failures; Vite exits 0.

- [ ] **Step 6: Build and smoke-test the review EXE**

Run:

```powershell
cd desktop
npm run dist
```

Expected: `desktop/release/LocalMiniDrama 1.2.8.exe` exists, contains the current frontend bundle and AI edit backend files, and the unpacked app reaches `window ready-to-show` during a short launch check.

- [ ] **Step 7: Commit source changes**

```bash
git add -- frontweb/src/views/FilmCreate.vue frontweb/src/components/dramaCanvas/CanvasStoryboardPanel.vue frontweb/src/components/dramaCanvas/CanvasAssetPanel.vue frontweb/test/aiEditComponents.test.js
git commit -m "feat: add storyboard conversational editing"
```
