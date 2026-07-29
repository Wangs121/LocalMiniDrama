const CONTENT_TYPES = Object.freeze(['short_drama', 'topic_video']);
const TOPIC_PURPOSES = Object.freeze(['promotion', 'explanation', 'science']);
const DEFAULT_DURATION_SEC = 60;
const MAX_STYLE_CHARS = 1000;

function badRequest(message) {
  const error = new Error(message);
  error.code = 'BAD_REQUEST';
  return error;
}

function normalizeDuration(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_DURATION_SEC;
  return Math.min(600, Math.max(10, Math.round(number)));
}

function normalizeStyle(value) {
  return String(value || '').trim().slice(0, MAX_STYLE_CHARS);
}

function normalizeContentSettings(metadata = {}) {
  const rawType = String(metadata?.content_type || '').trim();
  const contentType = CONTENT_TYPES.includes(rawType) ? rawType : 'short_drama';
  const rawPurpose = String(metadata?.topic_purpose || '').trim();

  return {
    content_type: contentType,
    topic_purpose: contentType === 'topic_video'
      ? (TOPIC_PURPOSES.includes(rawPurpose) ? rawPurpose : 'explanation')
      : null,
    target_episode_duration_sec: normalizeDuration(metadata?.target_episode_duration_sec),
    narrative_style_prompt: normalizeStyle(metadata?.narrative_style_prompt),
  };
}

function mergeContentMetadata(current = {}, incoming = {}, { hasEpisodes = false } = {}) {
  const next = { ...current, ...incoming };
  const currentSettings = normalizeContentSettings(current);

  if (Object.prototype.hasOwnProperty.call(incoming, 'content_type')) {
    const requested = String(incoming.content_type || '').trim();
    if (!CONTENT_TYPES.includes(requested)) {
      throw badRequest(`不支持的内容类型: ${requested}`);
    }
    if (hasEpisodes && requested !== currentSettings.content_type) {
      throw badRequest('项目已有分集，不能修改内容类型');
    }
  }

  if (next.content_type === 'topic_video' && Object.prototype.hasOwnProperty.call(incoming, 'topic_purpose')) {
    const purpose = String(incoming.topic_purpose || '').trim();
    if (!TOPIC_PURPOSES.includes(purpose)) {
      throw badRequest(`不支持的主题视频目的: ${purpose}`);
    }
  }

  const normalized = normalizeContentSettings(next);
  next.content_type = normalized.content_type;
  next.target_episode_duration_sec = normalized.target_episode_duration_sec;
  next.narrative_style_prompt = normalized.narrative_style_prompt;
  if (normalized.topic_purpose) next.topic_purpose = normalized.topic_purpose;
  else delete next.topic_purpose;
  return next;
}

function effectiveEpisodeCount(requested, settings) {
  if (settings.content_type === 'topic_video') return 1;
  return Math.max(1, Math.floor(Number(requested) || 1));
}

module.exports = {
  CONTENT_TYPES,
  TOPIC_PURPOSES,
  DEFAULT_DURATION_SEC,
  normalizeContentSettings,
  mergeContentMetadata,
  effectiveEpisodeCount,
};
