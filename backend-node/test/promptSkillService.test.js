const { after, before, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const promptSkillService = require('../src/services/promptSkillService');

function testDb(initialValue = null, projectSkillIds = undefined) {
  let value = initialValue;
  return {
    prepare(sql) {
      return {
        get() {
          if (sql.includes('FROM dramas')) {
            const metadata = projectSkillIds === undefined ? {} : { prompt_skill_ids: projectSkillIds };
            return { metadata: JSON.stringify(metadata) };
          }
          return value == null ? undefined : { value: JSON.stringify(value) };
        },
        run(_key, next) {
          if (sql.includes('INSERT INTO global_settings')) value = JSON.parse(next);
        },
      };
    },
  };
}

function packageFiles(id, content = 'camera guidance') {
  const manifest = {
    id,
    name: id,
    version: '1.0.0',
    description: 'test skill',
    stages: ['video_prompt'],
    priority: 10,
    stage_references: { video_prompt: ['references/guide.md'] },
  };
  return new Map([
    ['skill.json', Buffer.from(JSON.stringify(manifest))],
    ['references/guide.md', Buffer.from(content)],
  ]);
}

describe('promptSkillService', { concurrency: 1 }, () => {
  let originalCwd;
  let tempDir;

  before(() => {
    originalCwd = process.cwd();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-skills-'));
    process.chdir(tempDir);
  });

  after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads the six valid bundled generic skills and enables them by default', () => {
    const skills = promptSkillService.listSkills(testDb());
    const ids = skills.filter((skill) => skill.source === 'bundled').map((skill) => skill.id);
    assert.deepEqual(new Set(ids), new Set([
      'cinematic-camera', 'visual-aesthetics', 'creative-strategy',
      'editing-rhythm', 'storyboard-planning', 'long-video-planning',
    ]));
    assert.ok(skills.every((skill) => skill.valid && skill.enabled));
  });

  it('loads only references routed to the requested stage', () => {
    const frame = promptSkillService.compileSkillContext(testDb(), 'frame_prompt');
    const video = promptSkillService.compileSkillContext(testDb(), 'video_prompt');
    assert.ok(frame.audit.skills.length > 0);
    assert.ok(video.audit.skills.length > 0);
    assert.ok(frame.audit.skills.every((skill) => !skill.references.some((ref) => ref.includes('video'))));
    assert.notEqual(frame.audit.hash, video.audit.hash);
  });

  it('uses explicit selection before project selection before global settings', () => {
    const db = testDb(['visual-aesthetics'], ['editing-rhythm']);
    const project = promptSkillService.compileSkillContext(db, 'video_prompt', { drama_id: 1 });
    const request = promptSkillService.compileSkillContext(db, 'video_prompt', { drama_id: 1, skill_ids: ['cinematic-camera'] });
    const global = promptSkillService.compileSkillContext(testDb(['visual-aesthetics']), 'video_prompt');
    assert.deepEqual(project.audit.skills.map((x) => x.id), ['editing-rhythm']);
    assert.deepEqual(request.audit.skills.map((x) => x.id), ['cinematic-camera']);
    assert.deepEqual(global.audit.skills.map((x) => x.id), ['visual-aesthetics']);
    assert.equal(project.audit.selection_source, 'project');
    assert.equal(request.audit.selection_source, 'request');
    assert.equal(global.audit.selection_source, 'global');
  });

  it('treats an empty project or explicit list as disable all', () => {
    assert.equal(promptSkillService.compileSkillContext(testDb(null, []), 'video_prompt', { drama_id: 1 }).context, '');
    assert.equal(promptSkillService.compileSkillContext(testDb(), 'video_prompt', { skill_ids: [] }).context, '');
  });

  it('imports a ZIP package and leaves it disabled', () => {
    const zip = new AdmZip();
    for (const [name, content] of packageFiles('zip-skill')) zip.addFile(`zip-skill/${name}`, content);
    const files = promptSkillService.packageFromZip(zip.toBuffer());
    const result = promptSkillService.importSkill(testDb(), files);
    assert.equal(result.ok, true);
    assert.equal(result.skill.source, 'user');
    assert.equal(result.skill.enabled, false);
  });

  it('reconstructs browser directory uploads and rejects duplicate IDs', () => {
    const source = packageFiles('directory-skill');
    const uploads = Array.from(source.values()).map((buffer) => ({ buffer }));
    const paths = Array.from(source.keys()).map((name) => `directory-skill/${name}`);
    const files = promptSkillService.packageFromUploads(uploads, paths);
    assert.equal(promptSkillService.importSkill(testDb(), files).ok, true);
    assert.equal(promptSkillService.importSkill(testDb(), files).code, 'conflict');
  });

  it('rejects invalid manifests, traversal, executable files, binary text, and oversized files', () => {
    const badManifest = packageFiles('bad-manifest');
    const manifest = JSON.parse(badManifest.get('skill.json'));
    manifest.version = 'latest';
    badManifest.set('skill.json', Buffer.from(JSON.stringify(manifest)));
    assert.ok(promptSkillService.parsePackage(badManifest).errors.some((error) => error.includes('版本号')));

    assert.equal(promptSkillService.normalizeRelativePath('../escape.md'), null);
    assert.ok(promptSkillService.validatePackageFiles(new Map([['run.js', Buffer.from('x')]])).length > 0);
    assert.ok(promptSkillService.validatePackageFiles(new Map([['guide.md', Buffer.from([0, 1, 2])]])).some((error) => error.includes('纯文本')));
    assert.ok(promptSkillService.validatePackageFiles(new Map([['guide.md', Buffer.alloc(101 * 1024, 65)]])).some((error) => error.includes('100KB')));

    const zip = new AdmZip();
    for (const [name, content] of packageFiles('hidden-script')) zip.addFile(`hidden-script/${name}`, content);
    zip.addFile('run.js', Buffer.from('process.exit()'));
    assert.throws(() => promptSkillService.packageFromZip(zip.toBuffer()), /文件类型/);
  });

  it('allows deleting user skills but not bundled skills', () => {
    const db = testDb();
    assert.equal(promptSkillService.importSkill(db, packageFiles('delete-me')).ok, true);
    assert.equal(promptSkillService.deleteSkill(db, 'delete-me').ok, true);
    assert.equal(promptSkillService.deleteSkill(db, 'cinematic-camera').code, 'forbidden');
  });

  it('enforces deterministic ordering, per-reference and total budgets, and emits audit hashes', () => {
    const huge = 'A'.repeat(70000);
    assert.equal(promptSkillService.importSkill(testDb(), packageFiles('budget-skill', huge)).ok, true);
    const result = promptSkillService.compileSkillContext(testDb(), 'video_prompt', { skill_ids: ['budget-skill'] });
    assert.ok(result.context.length <= 128000);
    assert.ok(result.audit.truncated.includes('budget-skill:references/guide.md'));
    assert.equal(result.audit.skills[0].references[0], 'references/guide.md');
    assert.match(result.audit.hash, /^[a-f0-9]{16}$/);
    assert.equal(result.audit.chars, result.context.length);
  });
});
