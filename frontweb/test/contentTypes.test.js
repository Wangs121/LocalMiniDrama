import test from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeContentForm,
  buildContentMetadata,
  buildStoryGenerationInput,
  contentTypeLabel,
} from '../src/utils/contentTypes.js'

test('legacy project defaults to short drama and locks when episodes exist', () => {
  const form = normalizeContentForm({}, 2)
  assert.equal(form.contentType, 'short_drama')
  assert.equal(form.typeLocked, true)
  assert.equal(contentTypeLabel(), '短剧')
})

test('topic video request is one episode with content metadata', () => {
  const input = buildStoryGenerationInput({
    contentType: 'topic_video',
    topicPurpose: 'science',
    targetDurationSec: 75,
    narrativeStylePrompt: '面向儿童',
    episodeCount: 8,
  })
  assert.equal(input.episode_count, 1)
  assert.deepEqual(input.metadata, {
    content_type: 'topic_video',
    topic_purpose: 'science',
    target_episode_duration_sec: 75,
    narrative_style_prompt: '面向儿童',
  })
})

test('metadata normalizes invalid values consistently', () => {
  assert.deepEqual(buildContentMetadata({
    contentType: 'unknown',
    targetDurationSec: 900,
    narrativeStylePrompt: `  ${'风'.repeat(1005)}  `,
  }), {
    content_type: 'short_drama',
    target_episode_duration_sec: 600,
    narrative_style_prompt: '风'.repeat(1000),
  })
})
