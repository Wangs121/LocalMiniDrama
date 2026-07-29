const test = require('node:test');
const assert = require('node:assert/strict');

const promptI18n = require('../src/services/promptI18n');
const { getPromptDefinitions } = require('../src/routes/promptOverrides');

test('editor exposes separate short drama and topic video prompts', () => {
  const defs = getPromptDefinitions();
  assert.ok(defs.some((item) => item.key === 'story_expansion_system' && item.label.includes('短剧')));
  assert.ok(defs.some((item) => item.key === 'topic_video_story_system' && item.label.includes('主题视频')));

  for (const key of ['story_expansion_system', 'topic_video_story_system']) {
    const item = defs.find((entry) => entry.key === key);
    assert.match(item.locked_suffix, /JSON/);
    assert.doesNotMatch(item.default_body, /约\s*800\s*字/);
  }
});

test('storyboard editor default matches narrative-beat runtime rules', () => {
  const body = promptI18n.getDefaultPromptBody('storyboard_system');
  const suffix = promptI18n.getLockedSuffix('storyboard_system');
  assert.match(body, /叙事节拍/);
  assert.match(body, /内部切镜|连续动作/);
  assert.doesNotMatch(body + suffix, /一个动作\s*=\s*一个镜头|禁止合并多个动作|不允许合并或减少/);
});
