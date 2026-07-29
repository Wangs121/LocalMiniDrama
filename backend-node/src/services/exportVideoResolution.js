const PRESET_LONG_EDGES = Object.freeze({
  '360p': 360,
  '480p': 480,
  '540p': 540,
  '720p': 720,
  '1080p': 1080,
  '1440p': 1440,
  '2160p': 2160,
  '4k': 3840,
});

const MAX_LONG_EDGE = 3840;

function parseAspectRatio(value) {
  const match = String(value || '16:9').trim().match(/^(\d+)\s*:\s*(\d+)$/);
  if (!match || Number(match[1]) <= 0 || Number(match[2]) <= 0) {
    throw new Error('无效的视频画幅');
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}

function evenFloor(value) {
  return Math.max(2, Math.floor(Number(value) / 2) * 2);
}

function evenRound(value) {
  return Math.max(2, Math.round(Number(value) / 2) * 2);
}

function resolveExportVideoDimensions({ resolution, customLongEdge, aspectRatio }) {
  const key = String(resolution || '').trim().toLowerCase();
  let longEdge;
  if (key === 'custom') {
    if (!Number.isFinite(Number(customLongEdge)) || Number(customLongEdge) < 2) {
      throw new Error('自定义导出分辨率最长边至少为 2 像素');
    }
    longEdge = evenFloor(customLongEdge);
  } else {
    longEdge = PRESET_LONG_EDGES[key];
  }
  if (!longEdge) throw new Error('不支持的导出分辨率');
  if (longEdge > MAX_LONG_EDGE) throw new Error(`导出分辨率最长边不能超过 ${MAX_LONG_EDGE} 像素`);

  const ratio = parseAspectRatio(aspectRatio);
  if (ratio.width >= ratio.height) {
    return { width: longEdge, height: evenRound((longEdge * ratio.height) / ratio.width) };
  }
  return { width: evenRound((longEdge * ratio.width) / ratio.height), height: longEdge };
}

module.exports = {
  MAX_LONG_EDGE,
  PRESET_LONG_EDGES,
  resolveExportVideoDimensions,
};
