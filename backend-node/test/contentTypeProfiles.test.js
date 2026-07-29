const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeContentSettings,
  mergeContentMetadata,
  effectiveEpisodeCount,
} = require('../src/services/contentTypeProfiles');

test('legacy projects default to short drama with neutral defaults', () => {
  assert.deepEqual(normalizeContentSettings({}), {
    content_type: 'short_drama',
    topic_purpose: null,
    target_episode_duration_sec: 60,
    narrative_style_prompt: '',
  });
});

test('topic video normalizes purpose, duration, style and episode count', () => {
  const settings = normalizeContentSettings({
    content_type: 'topic_video',
    topic_purpose: 'science',
    target_episode_duration_sec: 900,
    narrative_style_prompt: '  专业克制  ',
  });

  assert.equal(settings.topic_purpose, 'science');
  assert.equal(settings.target_episode_duration_sec, 600);
  assert.equal(settings.narrative_style_prompt, '专业克制');
  assert.equal(effectiveEpisodeCount(8, settings), 1);
});

test('explicit invalid writes fail and existing episodes lock content type', () => {
  assert.throws(
    () => mergeContentMetadata({}, { content_type: 'unknown' }, { hasEpisodes: false }),
    /不支持的内容类型/
  );
  assert.throws(
    () => mergeContentMetadata(
      { content_type: 'short_drama' },
      { content_type: 'topic_video' },
      { hasEpisodes: true }
    ),
    /已有分集/
  );
});

test('short drama removes stale topic purpose and clamps low duration', () => {
  const metadata = mergeContentMetadata(
    { content_type: 'topic_video', topic_purpose: 'promotion' },
    { content_type: 'short_drama', target_episode_duration_sec: 1 },
    { hasEpisodes: false }
  );

  assert.equal(metadata.content_type, 'short_drama');
  assert.equal(metadata.target_episode_duration_sec, 10);
  assert.equal('topic_purpose' in metadata, false);
});
