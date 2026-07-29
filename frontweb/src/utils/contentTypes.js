export const CONTENT_TYPE_OPTIONS = [
  { value: 'short_drama', label: '短剧' },
  { value: 'topic_video', label: '主题视频' },
]

export const TOPIC_PURPOSE_OPTIONS = [
  { value: 'promotion', label: '宣传' },
  { value: 'explanation', label: '讲解' },
  { value: 'science', label: '科普' },
]

const CONTENT_TYPES = new Set(CONTENT_TYPE_OPTIONS.map((item) => item.value))
const TOPIC_PURPOSES = new Set(TOPIC_PURPOSE_OPTIONS.map((item) => item.value))

function normalizeDuration(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 60
  return Math.min(600, Math.max(10, Math.round(number)))
}

function normalizeStyle(value) {
  return String(value || '').trim().slice(0, 1000)
}

export function normalizeContentForm(metadata = {}, episodeCount = 0) {
  const contentType = CONTENT_TYPES.has(metadata?.content_type)
    ? metadata.content_type
    : 'short_drama'
  return {
    contentType,
    topicPurpose: contentType === 'topic_video' && TOPIC_PURPOSES.has(metadata?.topic_purpose)
      ? metadata.topic_purpose
      : 'explanation',
    targetDurationSec: normalizeDuration(metadata?.target_episode_duration_sec),
    narrativeStylePrompt: normalizeStyle(metadata?.narrative_style_prompt),
    typeLocked: Number(episodeCount) > 0,
  }
}

export function buildContentMetadata(form = {}) {
  const contentType = CONTENT_TYPES.has(form.contentType) ? form.contentType : 'short_drama'
  const metadata = {
    content_type: contentType,
    target_episode_duration_sec: normalizeDuration(form.targetDurationSec),
    narrative_style_prompt: normalizeStyle(form.narrativeStylePrompt),
  }
  if (contentType === 'topic_video') {
    metadata.topic_purpose = TOPIC_PURPOSES.has(form.topicPurpose)
      ? form.topicPurpose
      : 'explanation'
  }
  return metadata
}

export function buildStoryGenerationInput(form = {}) {
  const metadata = buildContentMetadata(form)
  const input = {
    episode_count: metadata.content_type === 'topic_video'
      ? 1
      : Math.max(1, Math.floor(Number(form.episodeCount) || 1)),
    metadata,
  }
  if (metadata.content_type === 'short_drama') {
    if (form.storyStyle) input.style = form.storyStyle
    if (form.storyType) input.type = form.storyType
  }
  return input
}

export function contentTypeLabel(value = 'short_drama') {
  return CONTENT_TYPE_OPTIONS.find((item) => item.value === value)?.label || '短剧'
}
