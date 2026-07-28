const { after, before, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const AdmZip = require('adm-zip');
const promptSkillRoutes = require('../src/routes/promptSkills');

function responseCapture() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function skillZip(id) {
  const zip = new AdmZip();
  zip.addFile(`${id}/skill.json`, Buffer.from(JSON.stringify({
    id,
    name: id,
    version: '1.0.0',
    stages: ['video_prompt'],
    priority: 10,
    stage_references: { video_prompt: ['references/guide.md'] },
  })));
  zip.addFile(`${id}/references/guide.md`, Buffer.from('Use one motivated camera move.'));
  return zip.toBuffer();
}

describe('prompt Skill route contracts', { concurrency: 1 }, () => {
  let db;
  let routes;
  let originalCwd;
  let tempDir;

  before(() => {
    originalCwd = process.cwd();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-skill-routes-'));
    process.chdir(tempDir);
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE global_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
      CREATE TABLE dramas (id INTEGER PRIMARY KEY, metadata TEXT, updated_at TEXT, deleted_at TEXT);
      INSERT INTO dramas (id, metadata, updated_at, deleted_at) VALUES (1, '{}', '', NULL);
    `);
    routes = promptSkillRoutes(db);
  });

  after(() => {
    db.close();
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns 400 for an invalid package and 409 for a duplicate ID', () => {
    const invalidRes = responseCapture();
    routes.import[1]({ files: [{ fieldname: 'archive', originalname: 'bad.zip', buffer: Buffer.from('bad') }], body: {} }, invalidRes);
    assert.equal(invalidRes.statusCode, 400);

    const request = { files: [{ fieldname: 'archive', originalname: 'route-skill.zip', buffer: skillZip('route-skill') }], body: {} };
    const firstRes = responseCapture();
    routes.import[1](request, firstRes);
    assert.equal(firstRes.statusCode, 200);
    assert.equal(firstRes.body.data.skill.enabled, false);

    const duplicateRes = responseCapture();
    routes.import[1](request, duplicateRes);
    assert.equal(duplicateRes.statusCode, 409);
    assert.equal(duplicateRes.body.error.code, 'CONFLICT');
  });

  it('returns 403 for bundled deletion and 404 for unknown skills', () => {
    const bundledRes = responseCapture();
    routes.delete({ params: { id: 'cinematic-camera' } }, bundledRes);
    assert.equal(bundledRes.statusCode, 403);

    const missingRes = responseCapture();
    routes.get({ params: { id: 'missing-skill' } }, missingRes);
    assert.equal(missingRes.statusCode, 404);
  });

  it('filters project selections and removes deleted user IDs from project metadata', () => {
    const updateRes = responseCapture();
    routes.projectUpdate({
      params: { drama_id: '1' },
      body: { mode: 'custom', skill_ids: ['route-skill', 'missing-skill', 'route-skill'] },
    }, updateRes);
    assert.equal(updateRes.statusCode, 200);
    assert.deepEqual(updateRes.body.data.skill_ids, ['route-skill']);

    const deleteRes = responseCapture();
    routes.delete({ params: { id: 'route-skill' } }, deleteRes);
    assert.equal(deleteRes.statusCode, 200);
    const metadata = JSON.parse(db.prepare('SELECT metadata FROM dramas WHERE id = 1').get().metadata);
    assert.deepEqual(metadata.prompt_skill_ids, []);
  });
});
