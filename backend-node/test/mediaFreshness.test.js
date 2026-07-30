const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const freshness = require('../src/services/mediaFreshnessService');

const silentLog = { info() {}, warn() {}, error() {} };

function createFreshnessDb() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  db.prepare(`INSERT INTO dramas (id, title, style, metadata, updated_at)
    VALUES (1, '测试项目', '现实主义', '{}', '2026-07-30')`).run();
  db.prepare(`INSERT INTO episodes
    (id, drama_id, episode_number, title, script_content, updated_at)
    VALUES (1, 1, 1, '第一集', '测试剧本', '2026-07-30')`).run();
  db.prepare(`INSERT INTO characters
    (id, drama_id, name, appearance, voice_style, polished_prompt, image_url, updated_at)
    VALUES (1, 1, '林夏', '旧外貌', '低沉', 'old portrait', '/character.png', '2026-07-30')`).run();
  db.prepare(`INSERT INTO scenes
    (id, drama_id, episode_id, location, prompt, polished_prompt_single, negative_prompt,
     image_url, updated_at)
    VALUES (2, 1, 1, '旧仓库', 'old scene', 'old single', 'avoid blur',
            '/scene.png', '2026-07-30')`).run();
  db.prepare(`INSERT INTO props
    (id, drama_id, episode_id, name, description, prompt, updated_at)
    VALUES (3, 1, 1, '怀表', '旧描述', 'old watch', '2026-07-30')`).run();
  db.prepare(`INSERT INTO storyboards
    (id, episode_id, storyboard_number, title, image_prompt, video_prompt,
     image_url, video_url, updated_at)
    VALUES (4, 1, 1, '发现怀表', 'old frame', 'old video',
            '/frame.png', '/clip.mp4', '2026-07-30')`).run();
  return db;
}

test('semantic changes mark only existing affected media stale', () => {
  const db = createFreshnessDb();
  try {
    freshness.markForUpdate(db, 'character', 1, { appearance: '新外貌' });
    assert.equal(db.prepare('SELECT image_stale FROM characters WHERE id = 1').get().image_stale, 1);

    freshness.markForUpdate(db, 'storyboard', 4, { video_prompt: '新视频词' });
    const sb = db.prepare('SELECT image_stale, video_stale FROM storyboards WHERE id = 4').get();
    assert.equal(sb.image_stale, 0);
    assert.equal(sb.video_stale, 1);

    freshness.markForUpdate(db, 'prop', 3, { description: '新描述' });
    assert.equal(db.prepare('SELECT image_stale FROM props WHERE id = 3').get().image_stale, 0);
  } finally {
    db.close();
  }
});

test('same-value updates do not mark media and successful replacement clears only matching flag', () => {
  const db = createFreshnessDb();
  try {
    freshness.markForUpdate(db, 'character', 1, { appearance: '旧外貌' });
    assert.equal(db.prepare('SELECT image_stale FROM characters WHERE id = 1').get().image_stale, 0);

    db.prepare("UPDATE storyboards SET characters = '[1,2]' WHERE id = 4").run();
    freshness.markForUpdate(db, 'storyboard', 4, { character_ids: [2, 1] });
    assert.deepEqual(
      db.prepare('SELECT image_stale, video_stale FROM storyboards WHERE id = 4').get(),
      { image_stale: 0, video_stale: 0 }
    );

    db.prepare('UPDATE storyboards SET image_stale = 1, video_stale = 1 WHERE id = 4').run();
    require('../src/services/storyboardFrameBinding').bindStoryboardFrameImage(
      db,
      4,
      'storyboard_first',
      99,
      '/static/new-frame.png',
      'storyboards/new-frame.png'
    );
    const row = db.prepare('SELECT image_stale, video_stale FROM storyboards WHERE id = 4').get();
    assert.deepEqual(row, { image_stale: 0, video_stale: 1 });
  } finally {
    db.close();
  }
});

test('asset update services persist explicit null for optional AI fields', () => {
  const db = createFreshnessDb();
  try {
    require('../src/services/characterLibraryService').updateCharacter(db, silentLog, 1, {
      voice_style: null,
      polished_prompt: null,
    });
    require('../src/services/sceneService').updateScene(db, silentLog, 2, {
      negative_prompt: null,
      polished_prompt_single: null,
    });
    require('../src/services/propService').update(db, silentLog, 3, {
      description: null,
      prompt: null,
    });
    assert.equal(db.prepare('SELECT voice_style FROM characters WHERE id = 1').get().voice_style, null);
    assert.equal(db.prepare('SELECT polished_prompt FROM characters WHERE id = 1').get().polished_prompt, null);
    assert.equal(db.prepare('SELECT negative_prompt FROM scenes WHERE id = 2').get().negative_prompt, null);
    assert.equal(db.prepare('SELECT polished_prompt_single FROM scenes WHERE id = 2').get().polished_prompt_single, null);
    assert.equal(db.prepare('SELECT description FROM props WHERE id = 3').get().description, null);
    assert.equal(db.prepare('SELECT prompt FROM props WHERE id = 3').get().prompt, null);
  } finally {
    db.close();
  }
});

test('freshness state is returned as booleans and media flags clear independently', () => {
  const db = createFreshnessDb();
  try {
    db.prepare('UPDATE storyboards SET image_stale = 1, video_stale = 1 WHERE id = 4').run();
    assert.deepEqual(freshness.getState(db, 'storyboard', 4), {
      image_stale: true,
      video_stale: true,
    });
    freshness.clear(db, 'storyboard', 4, 'video');
    assert.deepEqual(freshness.getState(db, 'storyboard', 4), {
      image_stale: true,
      video_stale: false,
    });
  } finally {
    db.close();
  }
});

test('storyboard updates include relations and camera fields in freshness and persistence', () => {
  const db = createFreshnessDb();
  try {
    const service = require('../src/services/storyboardService');
    service.updateStoryboard(db, silentLog, 4, {
      character_ids: [1],
      prop_ids: [3],
      lighting_style: 'low key',
      depth_of_field: 'shallow',
    });
    const row = service.getStoryboardById(db, 4);
    assert.equal(row.lighting_style, 'low key');
    assert.equal(row.depth_of_field, 'shallow');
    assert.equal(row.image_stale, true);
    assert.equal(row.video_stale, true);
  } finally {
    db.close();
  }
});

test('asset read models expose boolean freshness state and optional AI fields', () => {
  const db = createFreshnessDb();
  try {
    db.prepare('UPDATE scenes SET image_stale = 1 WHERE id = 2').run();
    db.prepare('UPDATE props SET image_stale = 1 WHERE id = 3').run();
    const scene = require('../src/services/sceneService').getSceneById(db, 2);
    const prop = require('../src/services/propService').getById(db, 3);
    assert.equal(scene.image_stale, true);
    assert.equal(scene.episode_id, 1);
    assert.equal(scene.negative_prompt, 'avoid blur');
    assert.equal(prop.image_stale, true);
  } finally {
    db.close();
  }
});
