const { normalizeSnapshot } = require('./aiEditSchemas');

const ENTITY_TABLES = {
  character: 'characters',
  scene: 'scenes',
  prop: 'props',
};

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function normalizeIds(values) {
  return [...new Set(values.map((value) => Number(value && typeof value === 'object' ? value.id : value))
    .filter((value) => Number.isInteger(value) && value > 0))];
}

function loadEntity(db, entityType, entityId) {
  const id = Number(entityId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('无效的对象 ID');
  if (entityType === 'storyboard') {
    return db.prepare(
      `SELECT s.*, e.drama_id
       FROM storyboards s
       JOIN episodes e ON e.id = s.episode_id AND e.deleted_at IS NULL
       WHERE s.id = ? AND s.deleted_at IS NULL`
    ).get(id);
  }
  const table = ENTITY_TABLES[entityType];
  if (!table) throw new Error(`不支持的对象类型 ${entityType}`);
  return db.prepare(`SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NULL`).get(id);
}

function loadEpisode(db, id, dramaId) {
  if (id === null || id === undefined || id === '') return null;
  return db.prepare(
    `SELECT id, drama_id, episode_number, title, script_content, updated_at
     FROM episodes WHERE id = ? AND drama_id = ? AND deleted_at IS NULL`
  ).get(Number(id), dramaId) || null;
}

function resolveEpisode(db, entityType, entity, dramaId, requestedEpisodeId) {
  const requested = loadEpisode(db, requestedEpisodeId, dramaId);
  if (requested) return requested;

  if (entityType === 'scene' || entityType === 'prop' || entityType === 'storyboard') {
    const owned = loadEpisode(db, entity.episode_id, dramaId);
    if (owned) return owned;
  }

  if (entityType === 'character') {
    const linked = db.prepare(
      `SELECT e.id, e.drama_id, e.episode_number, e.title, e.script_content, e.updated_at
       FROM episode_characters ec
       JOIN episodes e ON e.id = ec.episode_id
       WHERE ec.character_id = ? AND e.drama_id = ? AND e.deleted_at IS NULL
       ORDER BY e.updated_at DESC, e.id DESC LIMIT 1`
    ).get(entity.id, dramaId);
    if (linked) return linked;
  }

  return db.prepare(
    `SELECT id, drama_id, episode_number, title, script_content, updated_at
     FROM episodes WHERE drama_id = ? AND deleted_at IS NULL
     ORDER BY updated_at DESC, id DESC LIMIT 1`
  ).get(dramaId) || null;
}

function storyboardPropIds(db, storyboardId) {
  return db.prepare(
    `SELECT sp.prop_id
     FROM storyboard_props sp
     JOIN props p ON p.id = sp.prop_id AND p.deleted_at IS NULL
     WHERE sp.storyboard_id = ?`
  ).all(storyboardId).map((row) => Number(row.prop_id));
}

function snapshotForEntity(db, entityType, entity) {
  if (entityType === 'character') {
    return normalizeSnapshot(entityType, {
      ...entity,
      stages: parseJsonArray(entity.stages),
    });
  }
  if (entityType === 'storyboard') {
    return normalizeSnapshot(entityType, {
      ...entity,
      character_ids: normalizeIds(parseJsonArray(entity.characters)),
      prop_ids: normalizeIds(storyboardPropIds(db, entity.id)),
    });
  }
  return normalizeSnapshot(entityType, entity);
}

function listEpisodeStoryboards(db, episodeId) {
  if (!episodeId) return [];
  return db.prepare(
    `SELECT id, episode_id, scene_id, storyboard_number, title, description, location, time,
            dialogue, narration, action, atmosphere, characters
     FROM storyboards
     WHERE episode_id = ? AND deleted_at IS NULL
     ORDER BY storyboard_number ASC, id ASC`
  ).all(episodeId);
}

function relatedStoryboards(db, entityType, entity, episode) {
  if (!episode || entityType === 'storyboard') return [];
  const rows = listEpisodeStoryboards(db, episode.id);
  if (entityType === 'character') {
    return rows.filter((row) => normalizeIds(parseJsonArray(row.characters)).includes(Number(entity.id)));
  }
  if (entityType === 'scene') {
    return rows.filter((row) => Number(row.scene_id) === Number(entity.id));
  }
  const linkedIds = new Set(db.prepare(
    `SELECT sp.storyboard_id
     FROM storyboard_props sp
     JOIN storyboards s ON s.id = sp.storyboard_id
     JOIN episodes e ON e.id = s.episode_id
     WHERE sp.prop_id = ? AND s.episode_id = ?
       AND s.deleted_at IS NULL AND e.drama_id = ? AND e.deleted_at IS NULL`
  ).all(entity.id, episode.id, entity.drama_id).map((row) => Number(row.storyboard_id)));
  return rows.filter((row) => linkedIds.has(Number(row.id)));
}

function storyboardNeighbors(db, entityType, entity) {
  if (entityType !== 'storyboard') return { previousStoryboard: null, nextStoryboard: null };
  const rows = listEpisodeStoryboards(db, entity.episode_id);
  const index = rows.findIndex((row) => Number(row.id) === Number(entity.id));
  return {
    previousStoryboard: index > 0 ? rows[index - 1] : null,
    nextStoryboard: index >= 0 && index < rows.length - 1 ? rows[index + 1] : null,
  };
}

function availableRelations(db, dramaId) {
  return {
    characters: db.prepare(
      'SELECT id, name FROM characters WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id'
    ).all(dramaId),
    scenes: db.prepare(
      'SELECT id, location, time FROM scenes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id'
    ).all(dramaId),
    props: db.prepare(
      'SELECT id, name, type FROM props WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id'
    ).all(dramaId),
  };
}

function loadEntityContext(db, entityType, entityId, requestedEpisodeId) {
  const entity = loadEntity(db, entityType, entityId);
  if (!entity) throw new Error('对象不存在');
  const dramaId = Number(entity.drama_id);
  const drama = db.prepare(
    'SELECT id, title, style, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL'
  ).get(dramaId);
  if (!drama) throw new Error('项目不存在');
  const episode = resolveEpisode(db, entityType, entity, dramaId, requestedEpisodeId);
  const neighbors = storyboardNeighbors(db, entityType, entity);

  return {
    entityType,
    entityId: Number(entity.id),
    drama,
    episode: episode ? {
      id: episode.id,
      episode_number: episode.episode_number,
      title: episode.title,
    } : null,
    script: episode ? (episode.script_content || '') : '',
    persistedSnapshot: snapshotForEntity(db, entityType, entity),
    relatedStoryboards: relatedStoryboards(db, entityType, entity, episode),
    ...neighbors,
    availableRelations: availableRelations(db, dramaId),
  };
}

module.exports = { loadEntityContext };
