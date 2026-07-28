const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const promptSkillService = require('../src/services/promptSkillService');
const promptI18n = require('../src/services/promptI18n');

function settingsDb(enabled = null) {
  return {
    prepare() {
      return {
        get() { return enabled == null ? undefined : { value: JSON.stringify(enabled) }; },
      };
    },
  };
}

function compose(db, base, stage, ids) {
  const marked = promptSkillService.insertSkillMarkerBeforeOutput(base);
  return promptSkillService.enhanceSystemPrompt(db, marked, stage, { skill_ids: ids });
}

describe('prompt Skill composition', () => {
  it('places Skill knowledge after task facts and before output format', () => {
    const base = 'PROJECT FACTS: first frame and continuity are locked.\n\nORIGINAL TASK: write an executable camera plan.\n\nOUTPUT FORMAT:\nReturn JSON only.';
    const result = compose(settingsDb(), base, 'video_prompt', ['cinematic-camera']);
    assert.ok(result.prompt.indexOf('PROJECT FACTS') < result.prompt.indexOf('ENABLED PROFESSIONAL SKILLS'));
    assert.ok(result.prompt.indexOf('ENABLED PROFESSIONAL SKILLS') < result.prompt.indexOf('OUTPUT FORMAT'));
    assert.match(result.prompt, /first frame and continuity are locked/);
    assert.match(result.prompt, /Return JSON only/);
    assert.equal(result.audit.selection_source, 'request');
    assert.deepEqual(result.audit.requested_ids, ['cinematic-camera']);
  });

  it('removes the marker without changing protected rules when skills are disabled', () => {
    const base = 'ORIGINAL TASK\n\nOUTPUT FORMAT:\nJSON only.';
    const result = compose(settingsDb(), base, 'video_prompt', []);
    assert.doesNotMatch(result.prompt, /PROMPT_SKILLS/);
    assert.doesNotMatch(result.prompt, /ENABLED PROFESSIONAL SKILLS/);
    assert.match(result.prompt, /ORIGINAL TASK/);
    assert.match(result.prompt, /JSON only/);
  });

  it('supports storyboard, frame, classic video, and omni video system prompts', () => {
    const cfg = { app: { language: 'en' }, style: { default_image_ratio: '16:9' } };
    const cases = [
      ['storyboard', promptI18n.getStoryboardSystemPrompt(cfg), ['storyboard-planning']],
      ['frame_prompt', promptI18n.getFirstFramePrompt(cfg), ['visual-aesthetics']],
      ['video_prompt', promptI18n.getClassicVideoPromptPolishPrompt(), ['cinematic-camera']],
      ['video_prompt', promptI18n.getUniversalOmniSegmentPrompt(), ['editing-rhythm']],
    ];
    for (const [stage, base, ids] of cases) {
      const result = compose(settingsDb(), base, stage, ids);
      assert.match(result.prompt, /ENABLED PROFESSIONAL SKILLS/, `${stage} should inject Skill context`);
      assert.doesNotMatch(result.prompt, /\[\[PROMPT_SKILLS\]\]/);
      assert.equal(result.audit.skills.length, 1);
      assert.ok(result.audit.hash);
    }
  });

  it('keeps bundled knowledge files free of provider syntax and limits', () => {
    const root = promptSkillService.bundledRoot();
    const forbidden = [
      /seedance/i, /volcengine/i, /doubao/i, /kling/i,
      /@图片\s*\d*/i, /@视频\s*\d*/i, /@image\s*\d+/i,
      /单次生成上限/i, /素材上限/i, /image\s+limit/i,
      /command\s+line/i, /\bCLI\b/, /multimodal2video/i, /image2video/i,
    ];
    for (const skill of promptSkillService.loadSkills().filter((item) => item.source === 'bundled')) {
      const files = [path.join(root, skill.id, 'SKILL.md')];
      const referencesRoot = path.join(root, skill.id, 'references');
      for (const entry of fs.readdirSync(referencesRoot)) files.push(path.join(referencesRoot, entry));
      for (const file of files) {
        const content = fs.readFileSync(file, 'utf8');
        for (const pattern of forbidden) assert.doesNotMatch(content, pattern, `${skill.id}/${path.basename(file)} contains ${pattern}`);
      }
    }
  });

  it('loads the full 2.0 knowledge set without truncating normal stages', () => {
    const storyboard = promptSkillService.compileSkillContext(settingsDb(), 'storyboard');
    const frame = promptSkillService.compileSkillContext(settingsDb(), 'frame_prompt');
    const video = promptSkillService.compileSkillContext(settingsDb(), 'video_prompt');
    assert.ok(storyboard.context.length >= 65000);
    assert.ok(frame.context.length >= 40000);
    assert.ok(video.context.length >= 50000);
    assert.deepEqual(storyboard.audit.truncated, []);
    assert.deepEqual(frame.audit.truncated, []);
    assert.deepEqual(video.audit.truncated, []);
    assert.ok(storyboard.audit.skills.every((skill) => skill.version === '2.0.0'));
  });
});
