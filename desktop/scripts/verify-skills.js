const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const desktopRoot = path.join(__dirname, '..');
const copiedSkillsRoot = path.join(desktopRoot, 'backend-app', 'prompt-skills');
const expectedIds = [
  'cinematic-camera',
  'creative-strategy',
  'editing-rhythm',
  'long-video-planning',
  'storyboard-planning',
  'visual-aesthetics',
];

const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'localminidrama-userdata-'));
const sentinel = path.join(tempUserData, 'backend', 'data', 'prompt-skills', 'user-persistence-check', 'references', 'guide.md');
fs.mkdirSync(path.dirname(sentinel), { recursive: true });
fs.writeFileSync(sentinel, 'user-installed Skill must survive application resource updates', 'utf8');

try {
  const copy = spawnSync(process.execPath, [path.join(__dirname, 'copy-backend.js')], {
    cwd: desktopRoot,
    encoding: 'utf8',
  });
  assert.equal(copy.status, 0, copy.stderr || copy.stdout);

  const copiedIds = fs.readdirSync(copiedSkillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(copiedSkillsRoot, entry.name, 'skill.json')))
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(copiedIds, expectedIds);
  assert.ok(fs.existsSync(path.join(copiedSkillsRoot, 'NOTICE.md')), 'NOTICE.md was not copied');
  for (const id of expectedIds) {
    const manifest = JSON.parse(fs.readFileSync(path.join(copiedSkillsRoot, id, 'skill.json'), 'utf8'));
    assert.equal(manifest.version, '2.0.0', `${id} is not the expanded 2.0 package`);
    const references = new Set(Object.values(manifest.stage_references).flat());
    assert.ok(references.size >= 2, `${id} did not include expanded references`);
    for (const relative of references) {
      assert.ok(fs.existsSync(path.join(copiedSkillsRoot, id, relative)), `${id}/${relative} was not copied`);
    }
  }

  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'user-installed Skill must survive application resource updates');
  assert.equal(fs.existsSync(path.join(copiedSkillsRoot, 'user-persistence-check')), false);
  console.log(`Verified ${copiedIds.length} bundled Skills and user-data persistence isolation.`);
} finally {
  fs.rmSync(tempUserData, { recursive: true, force: true });
}
