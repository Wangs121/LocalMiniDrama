const { createHash } = require('crypto');

const ADAPTERS = {
  character: {
    fields: {
      name: { kind: 'text', max: 200, required: true, media: ['image'] },
      role: { kind: 'enum', values: [null, 'main', 'supporting', 'minor'], media: ['image'] },
      appearance: { kind: 'text', max: 12000, media: ['image'] },
      personality: { kind: 'text', max: 4000, media: ['image'] },
      description: { kind: 'text', max: 12000, media: ['image'] },
      voice_style: { kind: 'text', max: 1000, media: [] },
      polished_prompt: { kind: 'text', max: 30000, media: ['image'] },
      negative_prompt: { kind: 'text', max: 5000, media: ['image'] },
      stages: { kind: 'stages', maxItems: 50, appearanceMax: 12000, media: ['image'] },
    },
  },
  scene: {
    fields: {
      location: { kind: 'text', max: 500, required: true, media: ['image'] },
      time: { kind: 'text', max: 200, media: ['image'] },
      prompt: { kind: 'text', max: 12000, media: ['image'] },
      polished_prompt_single: { kind: 'text', max: 30000, media: ['image'] },
      polished_prompt: { kind: 'text', max: 30000, media: ['image'] },
      negative_prompt: { kind: 'text', max: 5000, media: ['image'] },
    },
  },
  prop: {
    fields: {
      name: { kind: 'text', max: 200, required: true, media: ['image'] },
      type: { kind: 'text', max: 200, media: ['image'] },
      description: { kind: 'text', max: 12000, media: ['image'] },
      prompt: { kind: 'text', max: 30000, media: ['image'] },
      negative_prompt: { kind: 'text', max: 5000, media: ['image'] },
    },
  },
  storyboard: {
    fields: {
      title: { kind: 'text', max: 500, media: ['image', 'video'] },
      description: { kind: 'text', max: 12000, media: ['image', 'video'] },
      layout_description: { kind: 'text', max: 12000, media: ['image', 'video'] },
      location: { kind: 'text', max: 500, media: ['image', 'video'] },
      time: { kind: 'text', max: 200, media: ['image', 'video'] },
      duration: { kind: 'number', min: 1, max: 120, media: ['video'] },
      dialogue: { kind: 'text', max: 12000, media: ['video'] },
      narration: { kind: 'text', max: 12000, media: ['video'] },
      action: { kind: 'text', max: 12000, media: ['image', 'video'] },
      atmosphere: { kind: 'text', max: 4000, media: ['image', 'video'] },
      image_prompt: { kind: 'text', max: 30000, media: ['image', 'video'] },
      polished_prompt: { kind: 'text', max: 30000, media: ['image', 'video'] },
      video_prompt: { kind: 'text', max: 30000, media: ['video'] },
      universal_segment_text: { kind: 'text', max: 30000, media: ['video'] },
      shot_type: { kind: 'text', max: 200, media: ['image', 'video'] },
      angle_h: {
        kind: 'enum',
        values: [null, 'front', 'front_left', 'left', 'back_left', 'back', 'back_right', 'right', 'front_right'],
        media: ['image', 'video'],
      },
      angle_v: { kind: 'enum', values: [null, 'worm', 'low', 'eye_level', 'high'], media: ['image', 'video'] },
      angle_s: { kind: 'enum', values: [null, 'close_up', 'medium', 'wide'], media: ['image', 'video'] },
      movement: { kind: 'text', max: 500, media: ['video'] },
      lighting_style: { kind: 'text', max: 500, media: ['image', 'video'] },
      depth_of_field: { kind: 'text', max: 500, media: ['image', 'video'] },
      scene_id: { kind: 'relation', table: 'scenes', media: ['image', 'video'] },
      character_ids: { kind: 'relations', table: 'characters', maxItems: 20, media: ['image', 'video'] },
      prop_ids: { kind: 'relations', table: 'props', maxItems: 20, media: ['image', 'video'] },
    },
  },
};

function getAdapter(entityType) {
  const adapter = ADAPTERS[entityType];
  if (!adapter) throw new Error(`不支持的对象类型 ${entityType}`);
  return adapter;
}

function normalizeText(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  const normalized = value.replace(/\r\n?/g, '\n').trim();
  return normalized || null;
}

function normalizeRelationId(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const normalized = Number(value);
    if (Number.isSafeInteger(normalized) && normalized > 0) return normalized;
  }
  return value;
}

function normalizeStages(value) {
  if (!Array.isArray(value)) return value;
  return value.map((stage) => {
    if (!stage || typeof stage !== 'object' || Array.isArray(stage)) return stage;
    return {
      ...stage,
      appearance: normalizeText(stage.appearance),
    };
  });
}

function normalizeField(definition, value) {
  switch (definition.kind) {
    case 'text':
      return normalizeText(value);
    case 'relation':
      return normalizeRelationId(value);
    case 'relations': {
      if (!Array.isArray(value)) return value;
      return [...new Set(value.map(normalizeRelationId))];
    }
    case 'stages':
      return normalizeStages(value);
    default:
      return value === undefined ? null : value;
  }
}

function emptyCandidate(entityType) {
  const { fields } = getAdapter(entityType);
  const candidate = {};
  for (const [field, definition] of Object.entries(fields)) {
    if (field === 'duration') candidate[field] = 5;
    else if (definition.kind === 'relations' || definition.kind === 'stages') candidate[field] = [];
    else candidate[field] = null;
  }
  return candidate;
}

function normalizeSnapshot(entityType, input = {}) {
  const { fields } = getAdapter(entityType);
  const normalized = {};
  for (const [field, definition] of Object.entries(fields)) {
    normalized[field] = normalizeField(definition, input[field]);
  }
  return normalized;
}

function validateText(field, definition, value) {
  if (value !== null && typeof value !== 'string') throw new Error(`无效的 ${field}`);
  if (definition.required && value === null) throw new Error(`字段 ${field} 不能为空`);
  if (value !== null && definition.max && value.length > definition.max) {
    throw new Error(`字段 ${field} 超过最大长度 ${definition.max}`);
  }
}

function validateStages(field, definition, value) {
  if (!Array.isArray(value) || value.length > definition.maxItems) throw new Error(`无效的 ${field}`);
  for (const stage of value) {
    if (!stage || typeof stage !== 'object' || Array.isArray(stage)) throw new Error(`无效的 ${field}`);
    const keys = Object.keys(stage);
    if (keys.length !== 2 || !keys.includes('episode_range') || !keys.includes('appearance')) {
      throw new Error(`无效的 ${field}`);
    }
    const range = stage.episode_range;
    if (!Array.isArray(range) || range.length !== 2
      || !range.every((item) => Number.isInteger(item) && item > 0)
      || range[0] > range[1]
      || typeof stage.appearance !== 'string'
      || !stage.appearance
      || stage.appearance.length > definition.appearanceMax) {
      throw new Error(`无效的 ${field}`);
    }
  }
}

function validateRelationIds(db, field, definition, meta, values) {
  const ids = definition.kind === 'relation' ? (values === null ? [] : [values]) : values;
  if (!ids.every((id) => Number.isSafeInteger(id) && id > 0)) throw new Error(`无效的 ${field}`);
  if (definition.maxItems && ids.length > definition.maxItems) throw new Error(`无效的 ${field}`);
  if (!db || ids.length === 0) return;
  const dramaId = Number(meta && meta.dramaId);
  if (!Number.isSafeInteger(dramaId) || dramaId <= 0) throw new Error('无效的 dramaId');
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db.prepare(
    `SELECT id FROM ${definition.table}
     WHERE drama_id = ? AND deleted_at IS NULL AND id IN (${placeholders})`
  ).all(dramaId, ...ids);
  if (rows.length !== ids.length) throw new Error(`无效的 ${field}`);
}

function validateCandidate(db, entityType, meta, candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('candidate 必须是对象');
  }
  const { fields } = getAdapter(entityType);
  const expected = Object.keys(fields);
  const actual = Object.keys(candidate);
  for (const field of expected) {
    if (!Object.prototype.hasOwnProperty.call(candidate, field)) throw new Error(`缺少字段 ${field}`);
  }
  for (const field of actual) {
    if (!Object.prototype.hasOwnProperty.call(fields, field)) throw new Error(`未知字段 ${field}`);
  }

  const normalized = normalizeSnapshot(entityType, candidate);
  for (const [field, definition] of Object.entries(fields)) {
    const value = normalized[field];
    switch (definition.kind) {
      case 'text':
        validateText(field, definition, value);
        break;
      case 'enum':
        if (!definition.values.includes(value)) throw new Error(`无效的 ${field}`);
        break;
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)
          || value < definition.min || value > definition.max) throw new Error(`无效的 ${field}`);
        break;
      case 'stages':
        validateStages(field, definition, value);
        break;
      case 'relation':
      case 'relations':
        if (definition.kind === 'relations' && !Array.isArray(value)) throw new Error(`无效的 ${field}`);
        validateRelationIds(db, field, definition, meta, value);
        break;
      default:
        throw new Error(`未知字段类型 ${definition.kind}`);
    }
  }
  return normalized;
}

function validateEnvelope(db, entityType, meta, envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error('AI 返回必须是对象');
  }
  const allowed = new Set(['schema_version', 'candidate', 'reply', 'note']);
  for (const field of Object.keys(envelope)) {
    if (!allowed.has(field)) throw new Error(`未知顶层字段 ${field}`);
  }
  if (envelope.schema_version !== 1) throw new Error('schema_version 必须为 1');
  if (!Object.prototype.hasOwnProperty.call(envelope, 'candidate')) throw new Error('缺少顶层字段 candidate');
  const reply = normalizeText(envelope.reply);
  if (reply !== null && (typeof reply !== 'string' || reply.length > 8000)) throw new Error('无效的 reply');
  const note = normalizeText(envelope.note);
  if (note !== null && (typeof note !== 'string' || note.length > 1000)) throw new Error('无效的 note');
  return {
    schema_version: 1,
    candidate: validateCandidate(db, entityType, meta, envelope.candidate),
    reply,
    note,
  };
}

function valuesEqual(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function diffSnapshots(entityType, base, candidate) {
  const fields = Object.keys(getAdapter(entityType).fields);
  const normalizedBase = normalizeSnapshot(entityType, base);
  const normalizedCandidate = normalizeSnapshot(entityType, candidate);
  const changes = [];
  for (const field of fields) {
    if (!valuesEqual(normalizedBase[field], normalizedCandidate[field])) {
      changes.push({
        field,
        old_value: normalizedBase[field],
        new_value: normalizedCandidate[field],
      });
    }
  }
  return changes;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const actualKeys = Object.keys(value);
  const matchingAdapter = Object.values(ADAPTERS).find(({ fields }) => {
    const fieldNames = Object.keys(fields);
    return fieldNames.length === actualKeys.length
      && fieldNames.every((field) => Object.prototype.hasOwnProperty.call(value, field));
  });
  const keys = matchingAdapter ? Object.keys(matchingAdapter.fields) : actualKeys.sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function snapshotHash(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function mediaImpactForChanges(entityType, fieldNames) {
  const { fields } = getAdapter(entityType);
  const impact = new Set();
  for (const field of fieldNames) {
    const definition = fields[field];
    if (!definition) throw new Error(`未知字段 ${field}`);
    for (const media of definition.media) impact.add(media);
  }
  return ['image', 'video'].filter((media) => impact.has(media));
}

module.exports = {
  getAdapter,
  emptyCandidate,
  normalizeSnapshot,
  validateEnvelope,
  validateCandidate,
  diffSnapshots,
  stableStringify,
  snapshotHash,
  mediaImpactForChanges,
};
