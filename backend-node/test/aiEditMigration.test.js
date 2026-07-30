const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrationsAndEnsure } = require('../src/db/migrate');

function columnDefinitions(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((column) => ({
    name: column.name,
    type: column.type,
    notnull: column.notnull,
    dflt_value: column.dflt_value,
    pk: column.pk,
  }));
}

function assertAiEditSchema(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
  const conversationColumns = columnDefinitions(db, 'ai_edit_conversations');
  const messageColumns = columnDefinitions(db, 'ai_edit_messages');

  assert.ok(tables.includes('ai_edit_conversations'));
  assert.ok(tables.includes('ai_edit_messages'));
  assert.deepEqual(conversationColumns, [
    { name: 'id', type: 'INTEGER', notnull: 0, dflt_value: null, pk: 1 },
    { name: 'entity_type', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
    { name: 'entity_id', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 0 },
    { name: 'drama_id', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 0 },
    { name: 'episode_id', type: 'INTEGER', notnull: 0, dflt_value: null, pk: 0 },
    { name: 'created_at', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
    { name: 'updated_at', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
  ]);
  assert.deepEqual(messageColumns, [
    { name: 'id', type: 'INTEGER', notnull: 0, dflt_value: null, pk: 1 },
    { name: 'conversation_id', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 0 },
    { name: 'reply_to_message_id', type: 'INTEGER', notnull: 0, dflt_value: null, pk: 0 },
    { name: 'client_request_id', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
    { name: 'role', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
    { name: 'content', type: 'TEXT', notnull: 1, dflt_value: "''", pk: 0 },
    { name: 'base_snapshot_hash', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
    { name: 'candidate_json', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
    { name: 'diff_json', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
    { name: 'proposal_status', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
    { name: 'selected_fields_json', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
    { name: 'request_status', type: 'TEXT', notnull: 1, dflt_value: "'completed'", pk: 0 },
    { name: 'error_code', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
    { name: 'created_at', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
  ]);
  for (const table of ['ai_edit_conversations', 'ai_edit_messages']) {
    const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table).sql;
    assert.match(tableSql, /id\s+INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/i);
  }

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

  assert.equal(
    columnDefinitions(db, 'scenes').find((column) => column.name === 'polished_prompt_single').type,
    'TEXT'
  );
  for (const [table, field] of [
    ['characters', 'image_stale'],
    ['scenes', 'image_stale'],
    ['props', 'image_stale'],
    ['storyboards', 'image_stale'],
    ['storyboards', 'video_stale'],
  ]) {
    const column = columnDefinitions(db, table).find((item) => item.name === field);
    assert.deepEqual(
      { type: column.type, notnull: column.notnull, dflt_value: column.dflt_value, pk: column.pk },
      { type: 'INTEGER', notnull: 1, dflt_value: '0', pk: 0 }
    );
  }
}

describe('AI edit persistence migration', () => {
  it('rejects a schema with incorrectly typed media freshness fields', () => {
    const db = new Database(':memory:');
    try {
      db.pragma('foreign_keys = ON');
      db.exec(`CREATE TABLE ai_edit_conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL CHECK (entity_type IN ('character', 'scene', 'prop', 'storyboard')),
        entity_id INTEGER NOT NULL,
        drama_id INTEGER NOT NULL,
        episode_id INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (entity_type, entity_id)
      );
      CREATE TABLE ai_edit_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        reply_to_message_id INTEGER,
        client_request_id TEXT,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL DEFAULT '',
        base_snapshot_hash TEXT,
        candidate_json TEXT,
        diff_json TEXT,
        proposal_status TEXT,
        selected_fields_json TEXT,
        request_status TEXT NOT NULL DEFAULT 'completed' CHECK (request_status IN ('pending', 'completed', 'failed')),
        error_code TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES ai_edit_conversations(id)
      );
      CREATE UNIQUE INDEX idx_ai_edit_message_request
        ON ai_edit_messages (conversation_id, client_request_id)
        WHERE client_request_id IS NOT NULL;
      CREATE INDEX idx_ai_edit_messages_conversation
        ON ai_edit_messages (conversation_id, id);
      CREATE TABLE characters (image_stale TEXT NOT NULL DEFAULT 0);
      CREATE TABLE scenes (polished_prompt_single TEXT, image_stale TEXT NOT NULL DEFAULT 0);
      CREATE TABLE props (image_stale TEXT NOT NULL DEFAULT 0);
      CREATE TABLE storyboards (
        image_stale TEXT NOT NULL DEFAULT 0,
        video_stale TEXT NOT NULL DEFAULT 0
      );`);

      assert.throws(() => assertAiEditSchema(db));
    } finally {
      db.close();
    }
  });

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

  it('fails recovery when the idempotency index cannot be created', () => {
    const db = new Database(':memory:');
    const originalExistsSync = fs.existsSync;
    try {
      db.exec(`CREATE TABLE ai_edit_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        client_request_id TEXT
      );
      INSERT INTO ai_edit_messages (conversation_id, client_request_id) VALUES (1, 'duplicate');
      INSERT INTO ai_edit_messages (conversation_id, client_request_id) VALUES (1, 'duplicate');`);
      fs.existsSync = (candidate) => (
        path.resolve(candidate) === path.resolve(path.join(__dirname, '..', 'migrations'))
          ? false
          : originalExistsSync(candidate)
      );

      assert.throws(
        () => runMigrationsAndEnsure(db),
        /UNIQUE constraint failed/
      );
    } finally {
      fs.existsSync = originalExistsSync;
      db.close();
    }
  });
});
