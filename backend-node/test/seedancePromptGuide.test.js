const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const promptI18n = require('../src/services/promptI18n');
const {
  DEFAULT_LINE3,
  buildFallbackUniversalMultiBeatText,
  normalizeUniversalSegmentTextNewlines,
} = require('../src/services/universalOmniMultiBeatFormat');
const {
  buildUniversalSegmentUserPromptBundle,
  compactStableSubjectTraits,
} = require('../src/services/universalSegmentPromptBundle');

describe('Seedance 2.0 official prompt guidance', () => {
  it('uses natural pacing, stable subjects, causal action, and one primary camera move', () => {
    const format = promptI18n.getUniversalOmniMultiBeatFormatSpec({ app: { language: 'zh' } });
    const omni = promptI18n.getUniversalOmniSegmentPrompt();
    const classic = promptI18n.getClassicVideoPromptPolishPrompt();

    for (const prompt of [format, omni]) {
      assert.doesNotMatch(prompt, /Tk秒|严格等于|至少两步运镜|≥2 moves|T1\+T2/);
      assert.match(prompt, /镜头1|镜头k/);
    }
    assert.match(format, /自然分配节奏/);
    assert.match(format, /2–3 个稳定静态特征/);
    assert.match(format, /每个镜头最多一个主要运镜/);
    assert.match(omni, /initial state → trigger/);
    assert.match(omni, /at most ONE primary camera movement/);
    assert.match(classic, /complexity ceiling/);
    assert.match(classic, /amplitude, speed, and force/);
    assert.match(classic, /无字幕、无Logo、无水印/);
  });

  it('builds a timestamp-free ordered-shot fallback and preserves its line structure', () => {
    const output = buildFallbackUniversalMultiBeatText(
      { location: '旧书店', time: '雨夜', atmosphere: '窗外雨水映出冷色反光' },
      {
        durationSec: 10,
        action: '林薇先按住账本，随后猛然抬眼看向门口。',
        result: '手指停在账本夹层，目光锁住来人。',
        dialogue: '你终于来了。',
      },
      '悬疑短剧'
    );

    assert.match(output, /^画面风格和类型:/);
    assert.match(output, /生成一个由以下\d+个镜头组成的视频。/);
    assert.match(output, /\n镜头1：/);
    assert.doesNotMatch(output, /镜头\d+：\s*[\d.]+秒/);
    assert.doesNotMatch(output, /运镜链|推拉摇移/);
    assert.match(output, /字幕、Logo、水印/);
    assert.equal(normalizeUniversalSegmentTextNewlines(`\r\n${output}\r\n`), output);
    assert.match(DEFAULT_LINE3, /完整连续单画幅/);
  });

  it('reduces identity metadata to two or three stable static traits', () => {
    const traits = compactStableSubjectTraits(JSON.stringify({
      face_shape: '清晰的鹅蛋脸与窄下颌线',
      facial_features: '细长眼型，鼻梁笔直',
      hair_style: '齐肩黑色直发',
      unique_marks: '左眼下方一颗小痣',
      skin_texture: '自然细腻肤质',
    }), '身穿红色风衣');

    assert.equal(traits.split('；').length, 3);
    assert.match(traits, /鹅蛋脸/);
    assert.match(traits, /齐肩黑色直发/);
    assert.doesNotMatch(traits, /红色风衣/);
  });

  it('front-loads image roles and injects the character identity contract', () => {
    const storyboard = {
      id: 17,
      episode_id: 9,
      storyboard_number: 1,
      scene_id: 5,
      title: '门口的影子',
      description: '林薇察觉门外有人。',
      location: '旧书店',
      time: '雨夜',
      action: '林薇按住账本后抬眼。',
      dialogue: '你终于来了。',
      narration: '',
      result: '视线锁住门口。',
      atmosphere: '克制紧张',
      characters: JSON.stringify([{ id: 7, name: '林薇' }]),
      duration: 10,
      segment_index: 0,
      segment_title: '相遇',
    };
    const character = {
      name: '林薇',
      appearance: '身穿红色风衣，齐肩黑发，左眼下方有一颗小痣',
      identity_anchors: JSON.stringify({
        face_shape: '鹅蛋脸与窄下颌线',
        facial_features: '细长眼型，鼻梁笔直',
        hair_style: '齐肩黑色直发',
      }),
      local_path: 'characters/linwei.png',
      image_url: null,
    };
    const db = {
      prepare(sql) {
        return {
          get() {
            if (sql.includes('FROM storyboards WHERE id = ?')) return storyboard;
            if (sql.includes('SELECT drama_id FROM episodes')) return { drama_id: 3 };
            if (sql.includes('FROM dramas WHERE id = ?')) return { title: '雨夜来客', genre: '悬疑', metadata: '{}' };
            if (sql.includes('FROM scenes WHERE id = ?')) return { location: '旧书店', time: '雨夜', prompt: '木质书架', local_path: 'scenes/shop.png' };
            if (sql.includes('FROM characters WHERE id = ?')) return character;
            if (sql.includes('SELECT script_content, title FROM episodes')) return { title: '第一集', script_content: '林薇在雨夜等待来客。' };
            return undefined;
          },
          all() {
            if (sql.includes('SELECT id, storyboard_number, segment_index, segment_title FROM storyboards')) {
              return [{ id: 17, storyboard_number: 1, segment_index: 0, segment_title: '相遇' }];
            }
            return [];
          },
        };
      },
    };

    const built = buildUniversalSegmentUserPromptBundle(db, 17, {}, {});
    assert.equal(built.ok, true);
    assert.match(built.userPrompt, /SUBJECT_IDENTITY_CONTRACT/);
    assert.match(built.userPrompt, /林薇.*@图片2/);
    assert.match(built.userPrompt, /鹅蛋脸与窄下颌线/);
    assert.match(built.userPrompt, /MATERIAL_ROLE_CONTRACT/);
    assert.ok(built.userPrompt.indexOf('IMAGE_SLOT_MAP') < built.userPrompt.indexOf('EPISODE_SCRIPT'));
    assert.doesNotMatch(built.userPrompt, /T1\+T2|Tk秒|严格等于/);
    assert.match(built.userPrompt, /无 Logo、无水印/);
  });
});
