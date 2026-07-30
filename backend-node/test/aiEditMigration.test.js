const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrationsAndEnsure } = require('../src/db/migrate');

function columnNames(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
}

function assertAiEditSchema(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
  const conversationColumns = db.prepare('PRAGMA table_info(ai_edit_conversations)').all();
  const messageColumns = db.prepare('PRAGMA table_info(ai_edit_messages)').all();
  const column = (columns, name) => columns.find((item) => item.name === name);

  assert.ok(tables.includes('ai_edit_conversations'));
  assert.ok(tables.includes('ai_edit_messages'));
  assert.deepEqual(conversationColumns.map((item) => item.name), [
    'id', 'entity_type', 'entity_id', 'drama_id', 'episode_id', 'created_at', 'updated_at',
  ]);
  assert.deepEqual(messageColumns.map((item) => item.name), [
    'id', 'conversation_id', 'reply_to_message_id', 'client_request_id', 'role', 'content',
    'base_snapshot_hash', 'candidate_json', 'diff_json', 'proposal_status',
    'selected_fields_json', 'request_status', 'error_code', 'created_at',
  ]);
  assert.equal(column(conversationColumns, 'created_at').notnull, 1);
  assert.equal(column(conversationColumns, 'updated_at').notnull, 1);
  assert.equal(column(messageColumns, 'created_at').notnull, 1);
  assert.equal(column(messageColumns, 'content').dflt_value, "''");
  assert.equal(column(messageColumns, 'request_status').dflt_value, "'completed'");

  const conversationIndexes = db.prepare('PRAGMA index_list(ai_edit_conversations)').all();
  const entityIndex = conversationIndexes.find((item) => item.unique === 1);
  assert.ok(entityIndex);
  assert.deepEqual(
    db.prepare(`PRAGMA index_info(${entityIndex.name})`).all().map((item) => item.name),
    ['entity_type', 'entity_id']
  );

  const requestIndex = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_ai_edit_message_request'"
  ).get();
  assert.match(requestIndex.sql, /UNIQUE INDEX/i);
  assert.match(requestIndex.sql, /WHERE client_request_id IS NOT NULL/i);
  assert.deepEqual(
    db.prepare('PRAGMA index_info(idx_ai_edit_message_request)').all().map((item) => item.name),
    ['conversation_id', 'client_request_id']
  );
  assert.deepEqual(
    db.prepare('PRAGMA index_info(idx_ai_edit_messages_conversation)').all().map((item) => item.name),
    ['conversation_id', 'id']
  );
  assert.deepEqual(db.prepare('PRAGMA foreign_key_list(ai_edit_messages)').all().map((item) => ({
    table: item.table,
    from: item.from,
    to: item.to,
  })), [{ table: 'ai_edit_conversations', from: 'conversation_id', to: 'id' }]);

  const insertConversation = db.prepare(
    `INSERT INTO ai_edit_conversations
       (entity_type, entity_id, drama_id, created_at, updated_at)
     VALUES (?, ?, 1, 'now', 'now')`
  );
  const conversationId = Number(insertConversation.run('character', 99).lastInsertRowid);
  assert.throws(() => insertConversation.run('invalid', 100), /CHECK constraint failed/);
  assert.throws(() => insertConversation.run('character', 99), /UNIQUE constraint failed/);

  const insertMessage = db.prepare(
    `INSERT INTO ai_edit_messages
       (conversation_id, client_request_id, role, request_status, created_at)
     VALUES (?, ?, ?, ?, 'now')`
  );
  insertMessage.run(conversationId, 'request-1', 'user', 'pending');
  assert.throws(
    () => insertMessage.run(conversationId, 'request-1', 'user', 'completed'),
    /UNIQUE constraint failed/
  );
  assert.throws(
    () => insertMessage.run(conversationId, 'request-2', 'system', 'completed'),
    /CHECK constraint failed/
  );
  assert.throws(
    () => insertMessage.run(conversationId, 'request-3', 'assistant', 'invalid'),
    /CHECK constraint failed/
  );
  assert.throws(
    () => insertMessage.run(999999, 'request-4', 'user', 'completed'),
    /FOREIGN KEY constraint failed/
  );
  db.prepare('DELETE FROM ai_edit_messages WHERE conversation_id = ?').run(conversationId);
  db.prepare('DELETE FROM ai_edit_conversations WHERE id = ?').run(conversationId);

  assert.ok(columnNames(db, 'scenes').includes('polished_prompt_single'));
  assert.ok(columnNames(db, 'characters').includes('image_stale'));
  assert.ok(columnNames(db, 'scenes').includes('image_stale'));
  assert.ok(columnNames(db, 'props').includes('image_stale'));
  assert.ok(columnNames(db, 'storyboards').includes('image_stale'));
  assert.ok(columnNames(db, 'storyboards').includes('video_stale'));
}

describe('AI edit persistence migration', () => {
  it('creates conversation tables and media freshness columns on a new database', () => {
    const db = new Database(':memory:');
    try {
      db.pragma('foreign_keys = ON');
      runMigrationsAndEnsure(db);
      assertAiEditSchema(db);
    } finally {
      db.close();
    }
  });

  it('upgrades an 01_init database idempotently', () => {
    const db = new Database(':memory:');
    try {
      db.pragma('foreign_keys = ON');
      const initSql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '01_init.sql'), 'utf8');
      db.exec(initSql);

      runMigrationsAndEnsure(db);
      assertAiEditSchema(db);
      assert.doesNotThrow(() => runMigrationsAndEnsure(db));
      assertAiEditSchema(db);
    } finally {
      db.close();
    }
  });

  it('creates the recovery schema when the migrations directory is unavailable', () => {
    const db = new Database(':memory:');
    const originalExistsSync = fs.existsSync;
    try {
      db.pragma('foreign_keys = ON');
      const initSql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '01_init.sql'), 'utf8');
      db.exec(initSql);
      fs.existsSync = (candidate) => (
        path.resolve(candidate) === path.resolve(path.join(__dirname, '..', 'migrations'))
          ? false
          : originalExistsSync(candidate)
      );

      runMigrationsAndEnsure(db);
      assertAiEditSchema(db);
    } finally {
      fs.existsSync = originalExistsSync;
      db.close();
    }
  });
});
