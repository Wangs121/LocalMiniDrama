const {
  getAdapter,
  normalizeSnapshot,
  stableStringify,
  mediaImpactForChanges,
} = require('./aiEditSchemas');

const TABLES = {
  character: 'characters',
  scene: 'scenes',
  prop: 'props',
  storyboard: 'storyboards',
};

function parseArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function sortedIds(values) {
  return [...new Set(parseArray(values)
    .map((value) => Number(value && typeof value === 'object' ? value.id : value))
    .filter((value) => Number.isInteger(value) && value > 0))]
    .sort((left, right) => left - right);
}

function loadRow(db, entityType, entityId) {
  const table = TABLES[entityType];
  if (!table) throw new Error(`不支持的对象类型 ${entityType}`);
  const id = Number(entityId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('无效的对象 ID');
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NULL`).get(id);
  if (!row) return null;
  if (entityType === 'character') row.stages = parseArray(row.stages);
  if (entityType === 'storyboard') {
    row.character_ids = sortedIds(row.characters);
    row.prop_ids = db.prepare(
      'SELECT prop_id FROM storyboard_props WHERE storyboard_id = ? ORDER BY prop_id'
    ).all(id).map((item) => Number(item.prop_id));
  }
  return row;
}

function hasValue(...values) {
  return values.some((value) => value !== null && value !== undefined && String(value).trim() !== '');
}

function hasMedia(entityType, row, mediaType) {
  if (mediaType === 'video') return entityType === 'storyboard' && hasValue(row.video_url);
  if (entityType === 'character') {
    return hasValue(row.image_url, row.local_path, row.four_view_image_url);
  }
  if (entityType === 'scene' || entityType === 'prop') {
    return hasValue(row.image_url, row.local_path);
  }
  return hasValue(
    row.image_url,
    row.local_path,
    row.composed_image,
    row.first_frame_image_id,
    row.last_frame_image_url,
    row.last_frame_local_path,
    row.last_frame_image_id
  );
}

function changedFields(entityType, row, patch) {
  const fields = getAdapter(entityType).fields;
  const applicablePatch = {};
  for (const field of Object.keys(patch || {})) {
    if (!Object.prototype.hasOwnProperty.call(fields, field)) continue;
    applicablePatch[field] = fields[field].kind === 'relations' ? sortedIds(patch[field]) : patch[field];
  }
  const before = normalizeSnapshot(entityType, row);
  const after = normalizeSnapshot(entityType, { ...row, ...applicablePatch });
  return Object.keys(applicablePatch).filter((field) => (
    stableStringify(before[field]) !== stableStringify(after[field])
  ));
}

function markForUpdate(db, entityType, entityId, patch) {
  const row = loadRow(db, entityType, entityId);
  if (!row) return null;
  const fields = changedFields(entityType, row, patch);
  const referenceChanged = Object.prototype.hasOwnProperty.call(patch || {}, 'ref_image')
    && stableStringify(row.ref_image ?? null) !== stableStringify(patch.ref_image ?? null);
  if (fields.length === 0 && !referenceChanged) return getState(db, entityType, entityId);
  const impact = mediaImpactForChanges(entityType, fields);
  if (referenceChanged && !impact.includes('image')) impact.push('image');
  const assignments = [];
  if (impact.includes('image') && hasMedia(entityType, row, 'image')) assignments.push('image_stale = 1');
  if (impact.includes('video') && hasMedia(entityType, row, 'video')) assignments.push('video_stale = 1');
  if (assignments.length > 0) {
    db.prepare(`UPDATE ${TABLES[entityType]} SET ${assignments.join(', ')} WHERE id = ?`).run(Number(entityId));
  }
  return getState(db, entityType, entityId);
}

function clear(db, entityType, entityId, mediaType) {
  if (mediaType !== 'image' && mediaType !== 'video') throw new Error(`不支持的媒体类型 ${mediaType}`);
  if (mediaType === 'video' && entityType !== 'storyboard') return getState(db, entityType, entityId);
  const table = TABLES[entityType];
  if (!table) throw new Error(`不支持的对象类型 ${entityType}`);
  db.prepare(`UPDATE ${table} SET ${mediaType}_stale = 0 WHERE id = ? AND deleted_at IS NULL`)
    .run(Number(entityId));
  return getState(db, entityType, entityId);
}

function getState(db, entityType, entityId) {
  const table = TABLES[entityType];
  if (!table) throw new Error(`不支持的对象类型 ${entityType}`);
  const columns = entityType === 'storyboard' ? 'image_stale, video_stale' : 'image_stale';
  const row = db.prepare(`SELECT ${columns} FROM ${table} WHERE id = ? AND deleted_at IS NULL`)
    .get(Number(entityId));
  if (!row) return null;
  return entityType === 'storyboard'
    ? { image_stale: Boolean(row.image_stale), video_stale: Boolean(row.video_stale) }
    : { image_stale: Boolean(row.image_stale) };
}

module.exports = { markForUpdate, clear, getState };
