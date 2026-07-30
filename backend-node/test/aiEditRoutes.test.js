const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const aiEditRoutes = require('../src/routes/aiEdits');

const silentLog = { info() {}, warn() {}, error() {} };

function capture() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('AI edit routes validate entity type and map service errors', async () => {
  const handlers = aiEditRoutes(null, null, silentLog, {
    getConversation() { return { messages: [] }; },
    async sendMessage() {
      const error = new Error('快照已变化');
      error.code = 'STALE_SNAPSHOT';
      throw error;
    },
  });

  const invalid = capture();
  handlers.get({ params: { entity_type: 'drama', entity_id: '1' } }, invalid);
  assert.equal(invalid.statusCode, 400);

  const stale = capture();
  await handlers.send({
    params: { entity_type: 'character', entity_id: '10' },
    body: { message: '调整', client_request_id: 'r1', current_snapshot: {} },
  }, stale);
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.body.error.code, 'STALE_SNAPSHOT');
});

test('AI edit routes expose GET POST PATCH and DELETE success contracts', async () => {
  const calls = [];
  const handlers = aiEditRoutes(null, null, silentLog, {
    getConversation(type, id) {
      calls.push(['get', type, id]);
      return { messages: [{ message_id: 1 }] };
    },
    async sendMessage(type, id, body) {
      calls.push(['send', type, id, body]);
      return { message_id: 2, candidate: { name: '林夏' }, changes: [] };
    },
    updateProposal(type, id, messageId, body) {
      calls.push(['update', type, id, messageId, body]);
      return { message_id: messageId, proposal_status: 'discarded' };
    },
    clearMessages(type, id) {
      calls.push(['clear', type, id]);
      return { cleared: 2 };
    },
  });

  const getRes = capture();
  handlers.get({ params: { entity_type: 'character', entity_id: '10' } }, getRes);
  assert.equal(getRes.body.data.messages[0].message_id, 1);

  const sendRes = capture();
  await handlers.send({
    params: { entity_type: 'character', entity_id: '10' },
    body: { message: '调整' },
  }, sendRes);
  assert.equal(sendRes.body.data.message_id, 2);

  const patchRes = capture();
  handlers.updateProposal({
    params: { entity_type: 'character', entity_id: '10', message_id: '2' },
    body: { selected_fields: [] },
  }, patchRes);
  assert.equal(patchRes.body.data.proposal_status, 'discarded');

  const deleteRes = capture();
  handlers.clear({ params: { entity_type: 'character', entity_id: '10' } }, deleteRes);
  assert.equal(deleteRes.body.data.cleared, 2);
  assert.deepEqual(calls.map((call) => call[0]), ['get', 'send', 'update', 'clear']);
});

test('route errors do not echo prompt or candidate payloads', async () => {
  const handlers = aiEditRoutes(null, null, silentLog, {
    async sendMessage() { throw new Error('provider timeout'); },
  });
  const res = capture();
  await handlers.send({
    params: { entity_type: 'character', entity_id: '10' },
    body: {
      message: 'secret prompt',
      current_snapshot: { description: 'secret candidate' },
    },
  }, res);
  assert.equal(res.statusCode, 500);
  const serialized = JSON.stringify(res.body);
  assert.doesNotMatch(serialized, /secret prompt|secret candidate|current_snapshot/);
});

test('route status mapping covers missing models, not found, and pending requests', async () => {
  for (const [error, expectedStatus] of [
    [Object.assign(new Error('对象不存在'), { code: 'NOT_FOUND' }), 404],
    [Object.assign(new Error('正在处理'), { code: 'REQUEST_PENDING' }), 409],
    [new Error('未配置文本模型，请先配置'), 400],
  ]) {
    const handlers = aiEditRoutes(null, null, silentLog, {
      getConversation() { throw error; },
    });
    const res = capture();
    handlers.get({ params: { entity_type: 'scene', entity_id: '30' } }, res);
    assert.equal(res.statusCode, expectedStatus);
  }
});

test('router registers AI edit endpoints', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'index.js'), 'utf8');
  assert.match(source, /require\(['"]\.\/aiEdits['"]\)/);
  assert.match(source, /r\.get\(['"]\/ai-edits\/:entity_type\/:entity_id['"]/);
  assert.match(source, /r\.post\(['"]\/ai-edits\/:entity_type\/:entity_id\/messages['"]/);
  assert.match(source, /r\.patch\(['"]\/ai-edits\/:entity_type\/:entity_id\/proposals\/:message_id['"]/);
  assert.match(source, /r\.delete\(['"]\/ai-edits\/:entity_type\/:entity_id\/messages['"]/);
});
