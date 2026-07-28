/**
 * 全能模式 universal_segment_text 统一格式：多子分镜段落（与 generate/polish 接口一致）
 */

const DEFAULT_LINE3 =
  '环境、光影与陈设定性参考 @图片1。若 @图片1 为宫格或多画面拼图，仅提取统一空间与光线语义；每个镜头均须为完整连续单画幅，禁止分屏宫格、字幕、Logo、水印。';

function trim(s) {
  return s != null && String(s).trim() ? String(s).trim() : '';
}

/** 保留多行，仅规范换行 */
function normalizeUniversalSegmentTextNewlines(text) {
  if (!text) return '';
  return String(text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

/** 以叙事事件数量为主、总时长容量为上限选择镜头数（1–8），不做精确分秒。 */
function chooseBeatCount(durationSec, narrativeText = '') {
  const dur = Math.max(1, Math.min(120, Math.round(Number(durationSec) || 5)));
  const eventCount = String(narrativeText || '')
    .split(/[。！？；\n]|然后|随后|紧接着|最终|结果/g)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4).length;
  const capacity = dur <= 5 ? 2 : dur <= 10 ? 3 : dur <= 15 ? 4 : 6;
  return Math.min(8, capacity, Math.max(1, eventCount || 1));
}

/** 将总秒数拆成 M 个正整数且和为 dur */
function splitDurationSeconds(dur, m) {
  const base = Math.floor(dur / m);
  const rem = dur - base * m;
  return Array.from({ length: m }, (_, i) => base + (i < rem ? 1 : 0));
}

/**
 * 分镜批量生成时模型未返回 universal_segment_text 时的多行兜底
 */
function buildFallbackUniversalMultiBeatText(sb, d, styleHint) {
  const dur = Math.max(1, Number(d.durationSec) || 5);
  const narrative = [d.action, d.result, d.dialogue, d.narration].filter(Boolean).join('。');
  const M = chooseBeatCount(dur, narrative);
  const loc = [sb?.location, sb?.time].filter(Boolean).join('，').trim() || '叙事空间';
  const act = trim(d.action).replace(/[。！？；，,]+$/g, '') || '人物在场景内完成本镜戏核动作';
  const res = trim(d.result).replace(/[。！？；，,]+$/g, '');
  const dia = trim(d.dialogue);
  const narr = trim(d.narration);
  const atm = trim(sb?.atmosphere).replace(/[。！？；，,]+$/g, '');
  const styleTail = trim(styleHint) || '电影感叙事';
  const styleLine = `画面风格和类型: 真人写实, 电影风格, 高清画质, ${styleTail}`;

  const lines = [styleLine, `生成一个由以下${M}个镜头组成的视频。`, DEFAULT_LINE3];

  for (let k = 0; k < M; k++) {
    const isFirst = k === 0;
    const isLast = k === M - 1;
    let body = '';
    if (isFirst) {
      body = `从 @图片1 的${loc}建立完整单画幅，固定机位明确主体初态与空间轴线；@图片2 ${act.slice(0, 90)}，${atm ? `${atm}，` : ''}眼神、呼吸与手部动作形成可见触发。`;
    } else if (isLast) {
      body = `镜头仅作一次平稳推近并停在动作结果上；@图片2 ${res || '在惯性衔接后完成本镜动作'}，最终姿态、视线方向与画面位置清晰可见。`;
    } else {
      body = `镜头以一次简洁跟随承接 @图片2 的动作，写清肢体部位、幅度、速度与力度；${act.slice(0, 100)}，动作惯性连续且不改变空间轴线。`;
    }
    if (dia && (isLast || (M <= 2 && k === M - 1))) {
      body += ` @图片2 说："${dia.replace(/"/g, '')}"`;
    } else if (!dia && k === M - 1) {
      body += ' 无对白。';
    } else if (!dia && k < M - 1) {
      body += ' 无对白。';
    }
    if (narr && isLast) {
      body += ` 旁白（画面无声）："${narr.replace(/"/g, '')}"`;
    }
    lines.push(`镜头${k + 1}：${body}`);
  }
  return lines.join('\n');
}

module.exports = {
  DEFAULT_LINE3,
  normalizeUniversalSegmentTextNewlines,
  chooseBeatCount,
  splitDurationSeconds,
  buildFallbackUniversalMultiBeatText,
};
