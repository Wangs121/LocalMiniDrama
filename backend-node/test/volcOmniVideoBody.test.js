const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildVolcOmniImageCandidates } = require('../src/services/videoClient');

describe('buildVolcOmniImageCandidates', () => {
  it('preserves first/last frame roles alongside ordinary references', () => {
    const candidates = buildVolcOmniImageCandidates({
      first_frame_url: 'https://cdn/first.jpg',
      last_frame_url: 'https://cdn/last.jpg',
      reference_urls: ['https://cdn/scene.jpg', 'https://cdn/character.jpg'],
    });

    assert.deepEqual(candidates, [
      { url: 'https://cdn/first.jpg', role: 'first_frame' },
      { url: 'https://cdn/last.jpg', role: 'last_frame' },
      { url: 'https://cdn/scene.jpg', role: 'reference_image' },
      { url: 'https://cdn/character.jpg', role: 'reference_image' },
    ]);
  });

  it('uses image_url as the first frame and removes duplicate references', () => {
    const candidates = buildVolcOmniImageCandidates({
      image_url: 'https://cdn/first.jpg',
      reference_urls: ['https://cdn/first.jpg', 'https://cdn/scene.jpg'],
    });

    assert.deepEqual(candidates, [
      { url: 'https://cdn/first.jpg', role: 'first_frame' },
      { url: 'https://cdn/scene.jpg', role: 'reference_image' },
    ]);
  });

  it('limits all image roles to the Seedance input image budget', () => {
    const candidates = buildVolcOmniImageCandidates({
      first_frame_url: 'first',
      last_frame_url: 'last',
      reference_urls: Array.from({ length: 10 }, (_, index) => `ref-${index}`),
    });

    assert.equal(candidates.length, 9);
    assert.equal(candidates[0].role, 'first_frame');
    assert.equal(candidates[1].role, 'last_frame');
  });
});
