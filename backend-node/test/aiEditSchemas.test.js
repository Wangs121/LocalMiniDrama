const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const aiEditSchemas = require('../src/services/aiEditSchemas');
const {
  emptyCandidate,
  normalizeSnapshot,
  validateEnvelope,
  validateCandidate,
  diffSnapshots,
  stableStringify,
  snapshotHash,
  mediaImpactForChanges,
} = aiEditSchemas;

test('exports only the public AI edit schema contract', () => {
  assert.deepEqual(Object.keys(aiEditSchemas).sort(), [
    'diffSnapshots',
    'emptyCandidate',
    'getAdapter',
    'mediaImpactForChanges',
    'normalizeSnapshot',
    'snapshotHash',
    'stableStringify',
    'validateCandidate',
    'validateEnvelope',
  ]);
});

function characterCandidate() {
  return {
    name: '林夏',
    role: 'main',
    appearance: '28岁，黑色短发',
    personality: '冷静',
    description: '调查记者',
    voice_style: '低沉',
    polished_prompt: 'portrait, black short hair',
    negative_prompt: '',
    stages: [],
  };
}

test('candidate must contain exactly every editable field', () => {
  const valid = validateCandidate(null, 'character', { dramaId: 1 }, characterCandidate());
  assert.equal(valid.name, '林夏');
  assert.equal(valid.negative_prompt, null);

  const missing = characterCandidate();
  delete missing.appearance;
  assert.throws(
    () => validateCandidate(null, 'character', { dramaId: 1 }, missing),
    /缺少字段 appearance/
  );
  assert.throws(
    () => validateCandidate(null, 'character', { dramaId: 1 }, { ...characterCandidate(), image_url: 'x' }),
    /未知字段 image_url/
  );
  assert.throws(
    () => validateCandidate(null, 'character', { dramaId: 1 }, { ...characterCandidate(), role: 'hero' }),
    /无效的 role/
  );
});

test('envelope is versioned and rejects model-provided changes', () => {
  assert.equal(validateEnvelope(null, 'character', { dramaId: 1 }, {
    schema_version: 1,
    candidate: characterCandidate(),
    note: '仅调整外观',
  }).note, '仅调整外观');
  assert.throws(
    () => validateEnvelope(null, 'character', { dramaId: 1 }, {
      schema_version: 1,
      candidate: characterCandidate(),
      changes: [],
    }),
    /未知顶层字段 changes/
  );
  assert.throws(
    () => validateEnvelope(null, 'character', { dramaId: 1 }, {
      schema_version: 2,
      candidate: characterCandidate(),
    }),
    /schema_version/
  );
});

test('normalization and local diffs are deterministic', () => {
  const base = normalizeSnapshot('character', {
    ...characterCandidate(),
    appearance: ' 22岁，金色长发\r\n ',
  });
  const candidate = normalizeSnapshot('character', characterCandidate());
  assert.equal(base.appearance, '22岁，金色长发');
  assert.deepEqual(diffSnapshots('character', base, candidate), [{
    field: 'appearance',
    old_value: '22岁，金色长发',
    new_value: '28岁，黑色短发',
  }]);
  assert.equal(snapshotHash(base), snapshotHash({ ...base }));
  assert.equal(stableStringify({ z: 1, a: 2 }), '{"a":2,"z":1}');
  assert.match(
    stableStringify(normalizeSnapshot('character', characterCandidate())),
    /^\{"name":.*,"role":.*,"appearance":/
  );
});

test('character stages are structured and bounded', () => {
  const valid = characterCandidate();
  valid.stages = [{ episode_range: [1, 3], appearance: '短发' }];
  assert.deepEqual(
    validateCandidate(null, 'character', { dramaId: 1 }, valid).stages,
    valid.stages
  );
  const invalid = characterCandidate();
  invalid.stages = [{ episode_range: [3, 1], appearance: '短发' }];
  assert.throws(() => validateCandidate(null, 'character', { dramaId: 1 }, invalid), /stages/);

  const nonIntegerRange = characterCandidate();
  nonIntegerRange.stages = [{ episode_range: [true, '2'], appearance: 'stage' }];
  assert.throws(
    () => validateCandidate(null, 'character', { dramaId: 1 }, nonIntegerRange),
    /stages/
  );
});

test('storyboard relations must belong to the same drama and be active', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE characters (id INTEGER, drama_id INTEGER, deleted_at TEXT);
      CREATE TABLE scenes (id INTEGER, drama_id INTEGER, deleted_at TEXT);
      CREATE TABLE props (id INTEGER, drama_id INTEGER, deleted_at TEXT);
      INSERT INTO characters VALUES (1, 7, NULL), (2, 8, NULL), (3, 7, 'deleted');
      INSERT INTO scenes VALUES (10, 7, NULL);
      INSERT INTO props VALUES (20, 7, NULL);`);
    const candidate = emptyCandidate('storyboard');
    candidate.scene_id = 10;
    candidate.character_ids = ['1', 1];
    candidate.prop_ids = [20];
    assert.deepEqual(
      validateCandidate(db, 'storyboard', { dramaId: 7 }, candidate).character_ids,
      [1]
    );

    for (const invalidId of [2, 3, 999]) {
      const invalid = { ...candidate, character_ids: [invalidId] };
      assert.throws(
        () => validateCandidate(db, 'storyboard', { dramaId: 7 }, invalid),
        /无效的 character_ids/
      );
    }
  } finally {
    db.close();
  }
});

test('media impact is derived only from changed fields', () => {
  assert.deepEqual(mediaImpactForChanges('character', ['voice_style']), []);
  assert.deepEqual(mediaImpactForChanges('character', ['appearance']), ['image']);
  assert.deepEqual(mediaImpactForChanges('storyboard', ['video_prompt']), ['video']);
  assert.deepEqual(mediaImpactForChanges('storyboard', ['image_prompt']), ['image', 'video']);
});
