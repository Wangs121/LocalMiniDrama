const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { snapshotHash } = require('../src/services/aiEditSchemas');
const { createAiEditService } = require('../src/services/aiEditService');

const silentLog = { info() {}, warn() {}, error() {} };

function characterCandidate(overrides = {}) {
  return {
    name: '林夏',
    role: 'main',
    appearance: '22岁，金色长发',
    personality: '冷静',
    description: '调查记者',
    voice_style: '低沉',
    polished_prompt: 'portrait, long blond hair',
    negative_prompt: null,
    stages: [],
    ...overrides,
  };
}

function requestBody(id, message = '调整角色', overrides = {}) {
  const currentSnapshot = overrides.current_snapshot || characterCandidate();
  return {
    client_request_id: id,
    episode_id: 101,
    message,
    current_snapshot: currentSnapshot,
    base_snapshot_hash: snapshotHash(currentSnapshot),
    ...overrides,
  };
}

function createServiceDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrationsAndEnsure(db);
  db.prepare(`INSERT INTO dramas (id, title, style, metadata, updated_at)
    VALUES (1, '测试项目', '现实主义', '{}', '2026-07-30')`).run();
  db.prepare(`INSERT INTO episodes
    (id, drama_id, episode_number, title, script_content, updated_at)
    VALUES (101, 1, 1, '第一集', '林夏进入旧仓库。', '2026-07-30')`).run();
  db.prepare(`INSERT INTO characters
    (id, drama_id, name, role, appearance, personality, description, voice_style,
     polished_prompt, negative_prompt, stages, image_url, updated_at)
    VALUES (10, 1, '林夏', 'main', '原始外观', '冷静', '调查记者', '低沉',
            'portrait', NULL, '[]', '/old.png', '2026-07-30')`).run();
  db.prepare(`INSERT INTO scenes
    (id, drama_id, episode_id, location, time, prompt, polished_prompt_single,
     polished_prompt, negative_prompt, updated_at)
    VALUES (30, 1, 101, '旧仓库', '夜', 'warehouse', 'single', 'four views', NULL, '2026-07-30')`).run();
  db.prepare(`INSERT INTO props
    (id, drama_id, episode_id, name, type, description, prompt, negative_prompt, updated_at)
    VALUES (50, 1, 101, '怀表', '随身物', '铜制', 'watch', NULL, '2026-07-30')`).run();
  db.prepare(`INSERT INTO storyboards
    (id, episode_id, scene_id, storyboard_number, title, description, duration,
     image_prompt, video_prompt, characters, updated_at)
    VALUES (1001, 101, 30, 1, '进入仓库', '林夏进入', 5,
            'frame', 'video', '[10]', '2026-07-30')`).run();
  db.prepare('INSERT INTO episode_characters (episode_id, character_id) VALUES (101, 10)').run();
  db.prepare('INSERT INTO storyboard_props (storyboard_id, prop_id) VALUES (1001, 50)').run();
  return db;
}

test('sendMessage persists a locally computed proposal without updating entity data', async () => {
  const db = createServiceDb();
  try {
    const before = db.prepare('SELECT appearance FROM characters WHERE id = 10').get().appearance;
    const generateText = async () => JSON.stringify({
      schema_version: 1,
      candidate: characterCandidate({ appearance: '28岁，黑色短发' }),
      note: '保留服装。',
    });
    const service = createAiEditService({ db, log: silentLog, generateText });
    const body = requestBody('req-1', '改成28岁黑色短发');
    const result = await service.sendMessage('character', 10, body);

    assert.deepEqual(result.changes.map((change) => change.field), ['appearance']);
    assert.equal(result.base_snapshot_hash, body.base_snapshot_hash);
    assert.equal(db.prepare('SELECT appearance FROM characters WHERE id = 10').get().appearance, before);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM ai_edit_messages').get().count, 2);
  } finally {
    db.close();
  }
});

test('sendMessage preserves the detailed creator-facing AI reply in history', async () => {
  const db = createServiceDb();
  try {
    const detailedReply = '我已按你的要求将角色调整为 28 岁黑色短发，并保留原有服装、性格和声音设定。提示词同步强调了短发轮廓与写实肖像质感。';
    const service = createAiEditService({
      db,
      log: silentLog,
      generateText: async () => JSON.stringify({
        schema_version: 1,
        candidate: characterCandidate({ appearance: '28岁，黑色短发' }),
        reply: detailedReply,
      }),
    });

    const result = await service.sendMessage('character', 10, requestBody('detailed-reply'));
    const assistant = service.getConversation('character', 10).messages.find((message) => message.role === 'assistant');

    assert.equal(result.reply, detailedReply);
    assert.equal(result.content, detailedReply);
    assert.equal(assistant.content, detailedReply);
  } finally {
    db.close();
  }
});

test('a previous pending candidate is passed as the next working draft', async () => {
  const db = createServiceDb();
  try {
    const prompts = [];
    const generateText = async (_db, _log, _type, userPrompt) => {
      prompts.push(userPrompt);
      const appearance = prompts.length === 1 ? '28岁，黑色短发' : '28岁，黑色短发，黑色风衣';
      return JSON.stringify({ schema_version: 1, candidate: characterCandidate({ appearance }), note: null });
    };
    const service = createAiEditService({ db, log: silentLog, generateText });
    const first = await service.sendMessage('character', 10, requestBody('draft-1'));
    await service.sendMessage('character', 10, requestBody('draft-2', '再加黑色风衣', {
      previous_candidate_message_id: first.message_id,
    }));
    assert.match(prompts[1], /28岁，黑色短发/);
  } finally {
    db.close();
  }
});

test('an invalid response gets one repair attempt', async () => {
  const db = createServiceDb();
  try {
    const calls = [];
    const generateText = async (_db, _log, _type, userPrompt) => {
      calls.push(userPrompt);
      if (calls.length === 1) return 'not-json';
      return JSON.stringify({ schema_version: 1, candidate: characterCandidate(), note: '' });
    };
    const service = createAiEditService({ db, log: silentLog, generateText });
    await service.sendMessage('character', 10, requestBody('req-repair'));
    assert.equal(calls.length, 2);
    assert.match(calls[1], /待修复输出/);
  } finally {
    db.close();
  }
});

test('unsupported JSON mode retries generation with redacted logging still enabled', async () => {
  const db = createServiceDb();
  try {
    const optionsSeen = [];
    const generateText = async (_db, _log, _type, _userPrompt, _systemPrompt, options) => {
      optionsSeen.push(options);
      if (optionsSeen.length === 1) throw new Error('response_format json_object is unsupported');
      return JSON.stringify({ schema_version: 1, candidate: characterCandidate(), note: null });
    };
    const service = createAiEditService({ db, log: silentLog, generateText });
    await service.sendMessage('character', 10, requestBody('json-fallback'));
    assert.deepEqual(optionsSeen.map((options) => options.json_mode), [true, false]);
    assert.ok(optionsSeen.every((options) => options.redact_content_log === true));
  } finally {
    db.close();
  }
});

test('a failed repair leaves an auditable failure without a candidate or entity update', async () => {
  const db = createServiceDb();
  try {
    let calls = 0;
    const service = createAiEditService({
      db,
      log: silentLog,
      generateText: async () => {
        calls += 1;
        return 'still not json';
      },
    });
    const before = db.prepare('SELECT appearance FROM characters WHERE id = 10').get().appearance;
    await assert.rejects(
      () => service.sendMessage('character', 10, requestBody('invalid-twice')),
      (error) => error.code === 'INVALID_AI_RESPONSE'
    );
    assert.equal(calls, 2);
    const messages = service.getConversation('character', 10).messages;
    assert.deepEqual(messages.map((message) => message.request_status), ['failed', 'failed']);
    assert.ok(messages.every((message) => message.candidate === null));
    assert.equal(db.prepare('SELECT appearance FROM characters WHERE id = 10').get().appearance, before);
  } finally {
    db.close();
  }
});

test('client request id is idempotent and failed requests do not call the provider again', async () => {
  const db = createServiceDb();
  try {
    let calls = 0;
    const generateText = async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({ schema_version: 1, candidate: characterCandidate(), note: '' });
      }
      throw new Error('provider timeout');
    };
    const service = createAiEditService({ db, log: silentLog, generateText });
    const first = await service.sendMessage('character', 10, requestBody('same-id'));
    const repeated = await service.sendMessage('character', 10, requestBody('same-id'));
    assert.equal(repeated.message_id, first.message_id);
    assert.equal(calls, 1);
    await assert.rejects(() => service.sendMessage('character', 10, requestBody('failed-id')), /provider timeout/);
    assert.equal(service.getConversation('character', 10).latest_candidate.message_id, first.message_id);
    await assert.rejects(() => service.sendMessage('character', 10, requestBody('failed-id')), /provider timeout/);
    assert.equal(calls, 2);
  } finally {
    db.close();
  }
});

test('pending requests block clear and a second send while applied proposals become history', async () => {
  const db = createServiceDb();
  try {
    let release;
    const generateText = () => new Promise((resolve) => { release = resolve; });
    const service = createAiEditService({ db, log: silentLog, generateText });
    const pending = service.sendMessage('character', 10, requestBody('pending-1'));
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(
      () => service.sendMessage('character', 10, requestBody('pending-2')),
      (error) => error.code === 'REQUEST_PENDING'
    );
    assert.throws(
      () => service.clearMessages('character', 10),
      (error) => error.code === 'REQUEST_PENDING'
    );
    release(JSON.stringify({ schema_version: 1, candidate: characterCandidate(), note: '' }));
    const proposal = await pending;
    service.updateProposal('character', 10, proposal.message_id, { selected_fields: [] });
    assert.equal(service.getConversation('character', 10).latest_candidate, null);
  } finally {
    db.close();
  }
});

test('recent completed messages are included but deleted entities stay inaccessible', async () => {
  const db = createServiceDb();
  try {
    const prompts = [];
    const generateText = async (_db, _log, _type, userPrompt) => {
      prompts.push(userPrompt);
      return JSON.stringify({ schema_version: 1, candidate: characterCandidate(), note: '' });
    };
    const service = createAiEditService({ db, log: silentLog, generateText });
    await service.sendMessage('character', 10, requestBody('history-1', '保留黑色风衣'));
    await service.sendMessage('character', 10, requestBody('history-2', '只修改发型'));
    assert.match(prompts[1], /保留黑色风衣/);

    db.prepare("UPDATE characters SET deleted_at = '2026-07-30T00:00:00.000Z' WHERE id = 10").run();
    assert.throws(
      () => service.getConversation('character', 10),
      (error) => error.code === 'NOT_FOUND'
    );
  } finally {
    db.close();
  }
});

test('stale hashes and invalid proposal fields are rejected locally', async () => {
  const db = createServiceDb();
  try {
    const service = createAiEditService({
      db,
      log: silentLog,
      generateText: async () => JSON.stringify({
        schema_version: 1,
        candidate: characterCandidate({ appearance: '黑色短发' }),
      }),
    });
    await assert.rejects(
      () => service.sendMessage('character', 10, requestBody('stale', '修改', { base_snapshot_hash: 'bad' })),
      (error) => error.code === 'STALE_SNAPSHOT'
    );
    const proposal = await service.sendMessage('character', 10, requestBody('valid'));
    assert.throws(
      () => service.updateProposal('character', 10, proposal.message_id, { selected_fields: ['name'] }),
      /选择字段/
    );
  } finally {
    db.close();
  }
});

test('AI client supports redacted response preview logging', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'aiClient.js'), 'utf8');
  assert.match(source, /redact_content_log\s*=\s*false/);
  assert.match(source, /redact_content_log\s*\?\s*['"]\[redacted\]['"]\s*:\s*content\.slice\(0,\s*200\)/);
});
