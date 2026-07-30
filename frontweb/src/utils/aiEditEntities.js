export const AI_EDIT_ENTITY_CONFIGS = {
  character: {
    fields: {
      name: { kind: 'text', media: ['image'], label: '名称' },
      role: { kind: 'enum', values: [null, 'main', 'supporting', 'minor'], media: ['image'], label: '角色类型' },
      appearance: { kind: 'text', media: ['image'], label: '外貌' },
      personality: { kind: 'text', media: ['image'], label: '性格' },
      description: { kind: 'text', media: ['image'], label: '描述' },
      voice_style: { kind: 'text', media: [], label: '声音风格' },
      polished_prompt: { kind: 'text', media: ['image'], label: '图片提示词' },
      negative_prompt: { kind: 'text', media: ['image'], label: '负面提示词' },
      stages: { kind: 'stages', media: ['image'], label: '分阶段外观' },
    },
  },
  scene: {
    fields: {
      location: { kind: 'text', media: ['image'], label: '地点' },
      time: { kind: 'text', media: ['image'], label: '时间' },
      prompt: { kind: 'text', media: ['image'], label: '场景描述' },
      polished_prompt_single: { kind: 'text', media: ['image'], label: '单图提示词' },
      polished_prompt: { kind: 'text', media: ['image'], label: '四视图提示词' },
      negative_prompt: { kind: 'text', media: ['image'], label: '负面提示词' },
    },
  },
  prop: {
    fields: {
      name: { kind: 'text', media: ['image'], label: '名称' },
      type: { kind: 'text', media: ['image'], label: '类型' },
      description: { kind: 'text', media: ['image'], label: '描述' },
      prompt: { kind: 'text', media: ['image'], label: '图片提示词' },
      negative_prompt: { kind: 'text', media: ['image'], label: '负面提示词' },
    },
  },
  storyboard: {
    fields: {
      title: { kind: 'text', media: ['image', 'video'], label: '标题' },
      description: { kind: 'text', media: ['image', 'video'], label: '描述' },
      layout_description: { kind: 'text', media: ['image', 'video'], label: '空间布局' },
      location: { kind: 'text', media: ['image', 'video'], label: '地点' },
      time: { kind: 'text', media: ['image', 'video'], label: '时间' },
      duration: { kind: 'number', min: 1, max: 120, media: ['video'], label: '时长' },
      dialogue: { kind: 'text', media: ['video'], label: '对白' },
      narration: { kind: 'text', media: ['video'], label: '旁白' },
      action: { kind: 'text', media: ['image', 'video'], label: '动作' },
      atmosphere: { kind: 'text', media: ['image', 'video'], label: '氛围' },
      image_prompt: { kind: 'text', media: ['image', 'video'], label: '图片提示词' },
      polished_prompt: { kind: 'text', media: ['image', 'video'], label: '润色图片提示词' },
      video_prompt: { kind: 'text', media: ['video'], label: '视频提示词' },
      universal_segment_text: { kind: 'text', media: ['video'], label: '全能片段文本' },
      shot_type: { kind: 'text', media: ['image', 'video'], label: '景别' },
      angle_h: { kind: 'enum', values: [null, 'front', 'front_left', 'left', 'back_left', 'back', 'back_right', 'right', 'front_right'], media: ['image', 'video'], label: '水平机位' },
      angle_v: { kind: 'enum', values: [null, 'worm', 'low', 'eye_level', 'high'], media: ['image', 'video'], label: '垂直机位' },
      angle_s: { kind: 'enum', values: [null, 'close_up', 'medium', 'wide'], media: ['image', 'video'], label: '画面尺度' },
      movement: { kind: 'text', media: ['video'], label: '运镜' },
      lighting_style: { kind: 'text', media: ['image', 'video'], label: '灯光风格' },
      depth_of_field: { kind: 'text', media: ['image', 'video'], label: '景深' },
      scene_id: { kind: 'relation', relation: 'scenes', media: ['image', 'video'], label: '场景' },
      character_ids: { kind: 'relations', relation: 'characters', media: ['image', 'video'], label: '角色' },
      prop_ids: { kind: 'relations', relation: 'props', media: ['image', 'video'], label: '道具' },
    },
  },
}

function configFor(entityType) {
  const config = AI_EDIT_ENTITY_CONFIGS[entityType]
  if (!config) throw new Error(`不支持的对象类型 ${entityType}`)
  return config
}

function textValue(value) {
  if (value === null || value === undefined) return null
  const normalized = String(value).replace(/\r\n?/g, '\n').trim()
  return normalized || null
}

function relationId(value) {
  if (value === null || value === undefined || value === '') return null
  if (Number.isInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const number = Number(value)
    if (Number.isSafeInteger(number) && number > 0) return number
  }
  return value
}

function parseStages(value) {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch (_) {
    return []
  }
}

function normalizeField(definition, value, field) {
  if (field === 'duration') {
    if (value === undefined || value === null || value === '') return 5
    const number = Number(value)
    return Number.isFinite(number) ? number : value
  }
  if (definition.kind === 'text') return textValue(value)
  if (definition.kind === 'relation') return relationId(value)
  if (definition.kind === 'relations') {
    if (!Array.isArray(value)) return []
    return [...new Set(value.map(relationId).filter((id) => Number.isInteger(id) && id > 0))]
  }
  if (definition.kind === 'stages') {
    return parseStages(value).map((stage) => ({
      episode_range: Array.isArray(stage?.episode_range) ? [...stage.episode_range] : stage?.episode_range,
      appearance: textValue(stage?.appearance),
    }))
  }
  return value === undefined || value === '' ? null : value
}

export function normalizeAiEditSnapshot(entityType, source = {}) {
  const normalized = {}
  for (const [field, definition] of Object.entries(configFor(entityType).fields)) {
    normalized[field] = normalizeField(definition, source?.[field], field)
  }
  return normalized
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const actualKeys = Object.keys(value)
  const matchingConfig = Object.values(AI_EDIT_ENTITY_CONFIGS).find(({ fields }) => {
    const names = Object.keys(fields)
    return names.length === actualKeys.length && names.every((name) => Object.hasOwn(value, name))
  })
  const keys = matchingConfig ? Object.keys(matchingConfig.fields) : actualKeys.sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

export async function hashAiEditSnapshot(value) {
  const data = new TextEncoder().encode(stableStringify(value))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function applyCandidateFields(entityType, target, candidate, selectedFields) {
  const fields = configFor(entityType).fields
  const applied = []
  for (const field of Array.isArray(selectedFields) ? selectedFields : []) {
    const definition = fields[field]
    if (!definition || !Object.hasOwn(candidate || {}, field)) continue
    const value = candidate[field]
    if (definition.kind === 'stages') target[field] = JSON.stringify(value || [], null, 2)
    else if (definition.kind === 'relations') target[field] = Array.isArray(value) ? [...value] : []
    else if (definition.kind === 'relation') target[field] = value ?? null
    else if ((definition.kind === 'text' || definition.kind === 'enum') && value === null) target[field] = ''
    else target[field] = value
    applied.push(field)
  }
  return { applied }
}

export function mediaImpactBetween(entityType, before, after) {
  const fields = configFor(entityType).fields
  const oldSnapshot = normalizeAiEditSnapshot(entityType, before)
  const newSnapshot = normalizeAiEditSnapshot(entityType, after)
  const impact = { image: false, video: false }
  for (const [field, definition] of Object.entries(fields)) {
    if (stableStringify(oldSnapshot[field]) === stableStringify(newSnapshot[field])) continue
    for (const mediaType of definition.media) impact[mediaType] = true
  }
  return impact
}

export function fieldLabel(entityType, field) {
  return configFor(entityType).fields[field]?.label || field
}

function relationLabel(options, id) {
  const item = (Array.isArray(options) ? options : []).find((row) => Number(row.id) === Number(id))
  return item?.label || item?.name || item?.location || String(id)
}

export function formatFieldValue(entityType, field, value, relationOptions = {}) {
  const definition = configFor(entityType).fields[field]
  if (value === null || value === undefined || value === '') return '未设置'
  if (definition?.kind === 'relation') return relationLabel(relationOptions[definition.relation], value)
  if (definition?.kind === 'relations') {
    return (Array.isArray(value) ? value : []).map((id) => relationLabel(relationOptions[definition.relation], id)).join('、') || '未设置'
  }
  if (definition?.kind === 'stages') {
    return (Array.isArray(value) ? value : []).map((stage) => (
      `第${stage.episode_range?.[0]}-${stage.episode_range?.[1]}集：${stage.appearance || ''}`
    )).join('\n') || '未设置'
  }
  return String(value)
}
