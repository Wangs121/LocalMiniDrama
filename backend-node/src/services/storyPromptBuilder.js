const SHORT_DRAMA_KEY = 'story_expansion_system';
const TOPIC_VIDEO_KEY = 'topic_video_story_system';
const SKILL_MARKER = '[[PROMPT_SKILLS]]';

const DEFAULT_BODIES_ZH = {
  [SHORT_DRAMA_KEY]: `你是一位专业短剧编剧。请根据用户资料创作 {{episode_count}} 集可直接拆分为分镜的短剧脚本。

要求：
1. 每集对白、动作与场景数量适配约 {{duration_sec}} 秒成片。
2. 开头尽快建立人物、情境或观看兴趣；可使用情绪、视觉、喜剧、疑问、关系、动作或冲突，不预设固定钩子。
3. 使用可见、可拍的动作和状态变化推进内容，避免无效背景铺垫。
4. 结尾可完整收束、留余味、反转或承接下一集，由资料和用户风格决定；不得默认强制悬念或追更钩子。
5. 多集保持人物动机、关系、关键物品和事件状态连续。`,
  [TOPIC_VIDEO_KEY]: `你是一位专业主题视频编剧。请根据用户资料创作一集可直接拆分为分镜的小脚本。

要求：
1. 对白、旁白、动作与场景数量适配约 {{duration_sec}} 秒成片。
2. 使用可见、可拍的演示、动作、例子和状态变化承载信息。
3. 用户资料是事实边界；不得凭空制造产品参数、实验数据、认证、疗效或绝对化承诺。
4. 资料不足时使用克制表述，不得把推测写成事实。
5. 严格遵循当前创作目的，不把科普写成营销口播，也不为讲解或宣传虚构证据。`,
};

const DEFAULT_BODIES_EN = {
  [SHORT_DRAMA_KEY]: `You are a professional short-form drama writer. Create {{episode_count}} episode(s) that can be directly broken into storyboards.

Requirements:
1. Keep dialogue, actions, and scene count suitable for approximately {{duration_sec}} seconds per episode.
2. Establish character, situation, or viewing interest early. The opening may use emotion, imagery, comedy, a question, a relationship, action, or conflict; do not impose one hook formula.
3. Advance the story through visible, filmable actions and state changes instead of unnecessary exposition.
4. Let the material and the user's style determine whether an ending resolves, lingers, reverses, or continues. Never require suspense or a follow-up hook by default.
5. Across episodes, preserve motivations, relationships, important objects, and event continuity.`,
  [TOPIC_VIDEO_KEY]: `You are a professional topic-video writer. Create one concise script that can be directly broken into storyboards.

Requirements:
1. Keep dialogue, narration, actions, and scene count suitable for approximately {{duration_sec}} seconds.
2. Communicate through visible, filmable demonstrations, actions, examples, and state changes.
3. User-provided material is the factual boundary. Never invent specifications, experimental data, certifications, efficacy, or absolute claims.
4. When material is incomplete, use restrained language and never present an inference as fact.
5. Follow the selected purpose. Do not turn science into a sales pitch or fabricate evidence for an explanation or promotion.`,
};

const PURPOSE_RULES = {
  zh: {
    promotion: '受众需求或使用情境 → 对象价值 → 可见证明或应用方式 → 克制的行动引导',
    explanation: '问题提出 → 核心概念 → 过程、结构或演示 → 总结',
    science: '疑问或反常识现象 → 原理解释 → 例子或类比 → 适用边界与结论',
  },
  en: {
    promotion: 'audience need or use context → value → visible evidence or application → restrained call to action',
    explanation: 'question → core concept → process, structure, or demonstration → summary',
    science: 'question or counterintuitive phenomenon → mechanism → example or analogy → limits and conclusion',
  },
};

const STYLE_LABELS = {
  zh: { modern: '现代', ancient: '古风', fantasy: '奇幻', daily: '日常' },
  en: { modern: 'Modern', ancient: 'Period/Ancient', fantasy: 'Fantasy', daily: 'Slice of life' },
};

const TYPE_LABELS = {
  zh: { drama: '剧情', comedy: '喜剧', adventure: '冒险' },
  en: { drama: 'Drama', comedy: 'Comedy', adventure: 'Adventure' },
};

function language(cfg) {
  return String(cfg?.app?.language || 'zh').toLowerCase() === 'en' ? 'en' : 'zh';
}

function getDefaultPromptBody(key) {
  return DEFAULT_BODIES_ZH[key] || '';
}

function getLockedSuffix(key) {
  if (![SHORT_DRAMA_KEY, TOPIC_VIDEO_KEY].includes(key)) return null;
  return `【输出格式（锁定）】返回纯 JSON 数组，数组包含 [实际集数] 个对象；每个对象包含 episode、title、content。不要输出 markdown 或说明文字。`;
}

function renderBody(body, episodeCount, durationSec) {
  return String(body || '')
    .replaceAll('{{episode_count}}', String(episodeCount))
    .replaceAll('{{duration_sec}}', String(durationSec));
}

function outputSuffix(lang, episodeCount, durationSec) {
  if (lang === 'en') {
    return `[OUTPUT FORMAT - STRICT]
Return a JSON array containing ${episodeCount} object(s):
[
  {
    "episode": 1,
    "title": "Title",
    "content": "Script body suitable for approximately ${durationSec} seconds"
  }
]
Return only the JSON array. Do not include markdown or explanations. Start with [ and end with ].`;
  }
  return `【输出格式（必须严格遵守）】
返回一个纯 JSON 数组，包含 ${episodeCount} 个对象：
[
  {
    "episode": 1,
    "title": "标题",
    "content": "适配约 ${durationSec} 秒成片的剧本正文"
  }
]
必须只返回纯 JSON 数组，不要 markdown 或说明文字。直接以 [ 开头，以 ] 结尾。`;
}

function buildUserPrompt(lang, context) {
  const { premise, style, type, settings } = context;
  const lines = lang === 'en'
    ? ['[USER MATERIAL]', String(premise || '').trim()]
    : ['【用户资料】', String(premise || '').trim()];

  if (style) {
    const value = STYLE_LABELS[lang][style] || String(style);
    lines.push(lang === 'en' ? `[STORY STYLE] ${value}` : `【故事风格选项】${value}`);
  }
  if (type) {
    const value = TYPE_LABELS[lang][type] || String(type);
    lines.push(lang === 'en' ? `[GENRE] ${value}` : `【题材选项】${value}`);
  }
  if (settings.content_type === 'topic_video') {
    const rule = PURPOSE_RULES[lang][settings.topic_purpose] || PURPOSE_RULES[lang].explanation;
    lines.push(lang === 'en' ? `[PURPOSE STRUCTURE] ${rule}` : `【创作目的结构】${rule}`);
  }
  if (settings.narrative_style_prompt) {
    lines.push(lang === 'en'
      ? `[USER CREATIVE PREFERENCE] ${settings.narrative_style_prompt}`
      : `【用户创作偏好】${settings.narrative_style_prompt}`);
  } else {
    lines.push(lang === 'en'
      ? '[USER CREATIVE PREFERENCE] Not set. Use a neutral style; do not impose suspense, reversals, intense conflict, or sales language.'
      : '【用户创作偏好】未设置，使用中性表达，不强加悬念、反转、强冲突或营销语气。');
  }
  lines.push(lang === 'en'
    ? 'The creative preference cannot override supplied facts, safety requirements, or the output format.'
    : '用户创作偏好不能覆盖资料事实、安全要求和输出格式。');
  return lines.filter(Boolean).join('\n\n');
}

function buildStoryPrompts(cfg, context, overrideBody = '') {
  const lang = language(cfg);
  const settings = context.settings;
  const episodeCount = settings.content_type === 'topic_video'
    ? 1
    : Math.max(1, Math.floor(Number(context.episodeCount) || 1));
  const key = settings.content_type === 'topic_video' ? TOPIC_VIDEO_KEY : SHORT_DRAMA_KEY;
  const defaults = lang === 'en' ? DEFAULT_BODIES_EN : DEFAULT_BODIES_ZH;
  const body = renderBody(
    overrideBody || defaults[key],
    episodeCount,
    settings.target_episode_duration_sec
  );

  return {
    systemPrompt: [
      body,
      SKILL_MARKER,
      outputSuffix(lang, episodeCount, settings.target_episode_duration_sec),
    ].join('\n\n'),
    userPrompt: buildUserPrompt(lang, { ...context, settings }),
  };
}

module.exports = {
  SHORT_DRAMA_KEY,
  TOPIC_VIDEO_KEY,
  getDefaultPromptBody,
  getLockedSuffix,
  buildStoryPrompts,
};
