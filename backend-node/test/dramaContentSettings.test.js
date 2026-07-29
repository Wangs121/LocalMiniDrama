const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const dramaService = require('../src/services/dramaService');

const log = { info() {}, warn() {}, error() {} };

function testDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '',
      description TEXT,
      genre TEXT,
      style TEXT DEFAULT 'realistic',
      tags TEXT,
      thumbnail TEXT,
      total_episodes INTEGER DEFAULT 1,
      total_duration INTEGER DEFAULT 0,
      status TEXT DEFAULT 'draft',
      metadata TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER NOT NULL,
      episode_number INTEGER DEFAULT 0,
      title TEXT DEFAULT '',
      script_content TEXT,
      description TEXT,
      duration INTEGER DEFAULT 0,
      status TEXT DEFAULT 'draft',
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
  `);
  return db;
}

test('create stores normalized content settings', () => {
  const db = testDb();
  const drama = dramaService.createDrama(db, log, {
    title: '科普测试',
    metadata: {
      content_type: 'topic_video',
      topic_purpose: 'science',
      target_episode_duration_sec: 75,
    },
  });

  assert.equal(drama.metadata.content_type, 'topic_video');
  assert.equal(drama.metadata.topic_purpose, 'science');
  assert.equal(drama.metadata.target_episode_duration_sec, 75);
  assert.equal(drama.metadata.narrative_style_prompt, '');
  db.close();
});

test('outline rejects type changes after an episode exists', () => {
  const db = testDb();
  const drama = dramaService.createDrama(db, log, {
    title: '短剧',
    metadata: { content_type: 'short_drama' },
  });
  db.prepare('INSERT INTO episodes (drama_id, episode_number, title) VALUES (?, 1, ?)')
    .run(drama.id, '第一集');

  assert.throws(
    () => dramaService.saveOutline(db, log, drama.id, {
      metadata: { content_type: 'topic_video' },
    }),
    /已有分集/
  );
  db.close();
});

test('topic video rejects multiple saved episodes', () => {
  const db = testDb();
  const drama = dramaService.createDrama(db, log, {
    title: '讲解视频',
    metadata: { content_type: 'topic_video', topic_purpose: 'explanation' },
  });

  assert.throws(
    () => dramaService.saveEpisodes(db, log, drama.id, {
      episodes: [
        { episode_number: 1, title: '第一集' },
        { episode_number: 2, title: '第二集' },
      ],
    }),
    /只能包含一集/
  );
  db.close();
});
