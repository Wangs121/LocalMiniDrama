const test = require('node:test');
const assert = require('node:assert/strict');

const aiClient = require('../src/services/aiClient');
const storyGenerationService = require('../src/services/storyGenerationService');

const log = { info() {}, warn() {}, error() {} };

function projectDb(metadata) {
  return {
    prepare(sql) {
      return {
        get(id) {
          if (sql.includes('FROM dramas')) {
            assert.equal(Number(id), 7);
            return {
              id: 7,
              metadata: JSON.stringify(metadata),
              genre: null,
              style: 'realistic',
            };
          }
          return undefined;
        },
      };
    },
  };
}

test('story generation reads project settings and composes story skills', async () => {
  let captured;
  const original = aiClient.generateText;
  aiClient.generateText = async (db, logger, serviceType, userPrompt, systemPrompt, options) => {
    captured = { db, logger, serviceType, userPrompt, systemPrompt, options };
    return '[{"episode":1,"title":"空气从哪里来","content":"正文"}]';
  };

  try {
    const result = await storyGenerationService.generateStory(projectDb({
      content_type: 'topic_video',
      topic_purpose: 'science',
      target_episode_duration_sec: 75,
      narrative_style_prompt: '面向初中生，语气平实',
    }), log, {
      drama_id: 7,
      premise: '解释新风系统的基本原理',
      episode_count: 5,
    });

    assert.equal(result.episodes.length, 1);
    assert.match(captured.userPrompt, /原理解释.*适用边界/s);
    assert.match(captured.userPrompt, /面向初中生，语气平实/);
    assert.match(captured.systemPrompt, /75 秒/);
    assert.match(captured.systemPrompt, /包含 1 个对象/);
    assert.equal(captured.options.prompt_skill_stage, 'story');
    assert.equal(captured.options.prompt_skill_insert_before_output, true);
    assert.equal(captured.options.prompt_skill_drama_id, 7);
  } finally {
    aiClient.generateText = original;
  }
});
