import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('AI edit panel renders safe selectable field diffs', async () => {
  const source = await readFile(new URL('../src/components/AiEditPanel.vue', import.meta.url), 'utf8')
  assert.match(source, /v-for="change in latestProposal\.changes"/)
  assert.match(source, /type="checkbox"|el-checkbox/)
  assert.match(source, /应用所选/)
  assert.match(source, /放弃建议/)
  assert.match(source, /diffText/)
  assert.doesNotMatch(source, /v-html/)
})

test('AI edit panel has bounded message and composer dimensions', async () => {
  const source = await readFile(new URL('../src/components/AiEditPanel.vue', import.meta.url), 'utf8')
  assert.match(source, /min-height:/)
  assert.match(source, /max-height:/)
  assert.match(source, /overflow-y:\s*auto/)
  assert.match(source, /word-break:\s*break-word/)
})
