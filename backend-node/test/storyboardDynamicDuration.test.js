const test = require('node:test');
const assert = require('node:assert/strict');

const promptI18n = require('../src/services/promptI18n');
const {
  normalizeGeneratedStoryboardDuration,
  sumStoryboardDurations,
} = require('../src/services/episodeStoryboardService');

test('generated storyboard durations stay dynamic within the Seedance 2 range', () => {
  assert.equal(normalizeGeneratedStoryboardDuration(4), 4);
  assert.equal(normalizeGeneratedStoryboardDuration(12), 12);
  assert.equal(normalizeGeneratedStoryboardDuration(2), 4);
  assert.equal(normalizeGeneratedStoryboardDuration(0), 4);
  assert.equal(normalizeGeneratedStoryboardDuration(-3), 4);
  assert.equal(normalizeGeneratedStoryboardDuration(30), 15);
  assert.equal(normalizeGeneratedStoryboardDuration('invalid'), 5);
  assert.equal(normalizeGeneratedStoryboardDuration(null), 5);
});

test('storyboard total duration is calculated from normalized saved rows', () => {
  assert.equal(sumStoryboardDurations([{ duration: 4 }, { duration: 15 }]), 19);
  assert.equal(sumStoryboardDurations([{ duration: 'invalid' }, { duration: null }]), 0);
});

test('storyboard prompt asks AI to choose 4-15 seconds from content instead of project clip length', () => {
  const suffix = promptI18n.getStoryboardUserPromptSuffix({ app: { language: 'zh' } }, 5);

  assert.match(suffix, /4[–-]15\s*秒/);
  assert.match(suffix, /对白|动作复杂度|情绪/);
  assert.doesNotMatch(suffix, /每镜头约\s*5\s*秒/);
  assert.doesNotMatch(suffix, /±\s*1\s*秒/);
});
