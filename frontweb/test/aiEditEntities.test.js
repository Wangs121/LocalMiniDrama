import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  normalizeAiEditSnapshot,
  applyCandidateFields,
  mediaImpactBetween,
  stableStringify,
  hashAiEditSnapshot,
  fieldLabel,
  formatFieldValue,
  AI_EDIT_ENTITY_CONFIGS,
} from '../src/utils/aiEditEntities.js'

test('frontend character normalization matches the API candidate contract', () => {
  const snapshot = normalizeAiEditSnapshot('character', {
    name: ' 林夏 ',
    role: '',
    stages: '[{"episode_range":[1,2],"appearance":"白衣"}]',
  })
  assert.equal(snapshot.name, '林夏')
  assert.equal(snapshot.role, null)
  assert.deepEqual(snapshot.stages, [{ episode_range: [1, 2], appearance: '白衣' }])
  assert.equal(stableStringify(snapshot), stableStringify({ ...snapshot }))
})

test('only selected candidate fields are applied and structured fields serialize for forms', () => {
  const target = { name: '林夏', appearance: '长发', stages: '' }
  const result = applyCandidateFields('character', target, {
    name: '林夏',
    appearance: '短发',
    stages: [{ episode_range: [1, 2], appearance: '白衣' }],
  }, ['appearance'])
  assert.equal(target.appearance, '短发')
  assert.equal(target.stages, '')
  assert.deepEqual(result.applied, ['appearance'])
})

test('structured and nullable fields are converted for form targets', () => {
  const target = { role: 'main', stages: '', scene_id: 3, prop_ids: [] }
  const result = applyCandidateFields('storyboard', target, {
    scene_id: null,
    prop_ids: [4, 5],
  }, ['scene_id', 'prop_ids'])
  assert.equal(target.scene_id, null)
  assert.deepEqual(target.prop_ids, [4, 5])
  assert.deepEqual(result.applied, ['scene_id', 'prop_ids'])

  applyCandidateFields('character', target, { role: null, stages: [{ episode_range: [1, 2], appearance: '白衣' }] }, ['role', 'stages'])
  assert.equal(target.role, '')
  assert.equal(target.stages, '[\n  {\n    "episode_range": [\n      1,\n      2\n    ],\n    "appearance": "白衣"\n  }\n]')
})

test('media impact and labels are deterministic', () => {
  assert.deepEqual(
    mediaImpactBetween('storyboard', { video_prompt: 'a' }, { video_prompt: 'b' }),
    { image: false, video: true }
  )
  assert.equal(fieldLabel('character', 'appearance'), '外貌')
  assert.equal(formatFieldValue('storyboard', 'scene_id', 3, { scenes: [{ id: 3, label: '旧仓库' }] }), '旧仓库')
})

test('browser snapshot hash matches the backend sha256 contract', async () => {
  const snapshot = normalizeAiEditSnapshot('character', { name: '林夏' })
  const expected = createHash('sha256').update(stableStringify(snapshot)).digest('hex')
  assert.equal(await hashAiEditSnapshot(snapshot), expected)
})

test('frontend enum and numeric metadata matches the backend contract', () => {
  assert.deepEqual(AI_EDIT_ENTITY_CONFIGS.character.fields.role.values, [null, 'main', 'supporting', 'minor'])
  assert.deepEqual(AI_EDIT_ENTITY_CONFIGS.storyboard.fields.angle_v.values, [null, 'worm', 'low', 'eye_level', 'high'])
  assert.deepEqual(
    [AI_EDIT_ENTITY_CONFIGS.storyboard.fields.duration.min, AI_EDIT_ENTITY_CONFIGS.storyboard.fields.duration.max],
    [1, 120]
  )
})
