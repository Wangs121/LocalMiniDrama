const test = require('node:test');
const assert = require('node:assert/strict');

const builder = require('../src/services/storyPromptBuilder');

const cfg = { app: { language: 'zh' } };

function settings(overrides = {}) {
  return {
    content_type: 'short_drama',
    topic_purpose: null,
    target_episode_duration_sec: 60,
    narrative_style_prompt: '',
    ...overrides,
  };
}

test('neutral short drama prompt is duration driven without mandatory suspense', () => {
  const prompts = builder.buildStoryPrompts(cfg, {
    premise: '两位老人准备一次旧友聚会',
    episodeCount: 2,
    settings: settings(),
  });

  assert.match(prompts.systemPrompt, /60 秒/);
  assert.match(prompts.systemPrompt, /不.*强制.*悬念/);
  assert.doesNotMatch(prompts.systemPrompt, /必须.*悬念|必须.*反转|吸引观众看下一集/);
  assert.match(prompts.systemPrompt, /纯 JSON 数组/);
  assert.match(prompts.systemPrompt, /包含 2 个对象/);
});

test('custom narrative style is injected as a protected preference', () => {
  const prompts = builder.buildStoryPrompts(cfg, {
    premise: '社区早餐店的一天',
    episodeCount: 1,
    settings: settings({
      target_episode_duration_sec: 45,
      narrative_style_prompt: '慢节奏治愈日常，不使用悬念',
    }),
  });

  assert.match(prompts.userPrompt, /慢节奏治愈日常，不使用悬念/);
  assert.match(prompts.userPrompt, /用户创作偏好/);
  assert.match(prompts.userPrompt, /不能覆盖.*事实.*安全.*输出格式/);
});

test('topic purposes use distinct structures and forbid invented claims', () => {
  const outputs = ['promotion', 'explanation', 'science'].map((purpose) => builder.buildStoryPrompts(cfg, {
    premise: '一款室内空气检测仪',
    episodeCount: 1,
    settings: settings({
      content_type: 'topic_video',
      topic_purpose: purpose,
    }),
  }));

  assert.match(outputs[0].userPrompt, /受众需求.*对象价值.*行动引导/s);
  assert.match(outputs[1].userPrompt, /问题提出.*核心概念.*总结/s);
  assert.match(outputs[2].userPrompt, /疑问.*原理解释.*适用边界/s);
  for (const output of outputs) {
    assert.match(output.systemPrompt, /不得凭空制造.*参数.*数据.*认证/s);
    assert.match(output.systemPrompt, /包含 1 个对象/);
  }
});

test('editor bodies and locked suffixes are available for both content types', () => {
  for (const key of [builder.SHORT_DRAMA_KEY, builder.TOPIC_VIDEO_KEY]) {
    assert.ok(builder.getDefaultPromptBody(key).length > 100);
    assert.match(builder.getLockedSuffix(key), /JSON/);
    assert.doesNotMatch(builder.getDefaultPromptBody(key), /约\s*800\s*字/);
  }
});
