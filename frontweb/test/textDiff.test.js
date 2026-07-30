import test from 'node:test'
import assert from 'node:assert/strict'
import { diffText, tokenizeText } from '../src/utils/textDiff.js'

test('text diff exposes additions and removals without HTML', () => {
  const parts = diffText('金色长发', '黑色短发')
  assert.ok(parts.some((part) => part.type === 'remove' && part.text.includes('金')))
  assert.ok(parts.some((part) => part.type === 'add' && part.text.includes('黑')))
  assert.equal(parts.some((part) => Object.hasOwn(part, 'html')), false)
})

test('tokenizer preserves CJK punctuation words and whitespace', () => {
  assert.deepEqual(tokenizeText('林夏, AI 28'), ['林', '夏', ',', ' ', 'AI', ' ', '28'])
})

test('large asymmetric diffs fall back to whole text replacement', () => {
  const oldText = 'a '.repeat(6001)
  const parts = diffText(oldText, 'new')
  assert.deepEqual(parts, [
    { type: 'remove', text: oldText },
    { type: 'add', text: 'new' },
  ])
})
