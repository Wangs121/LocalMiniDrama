const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveExportVideoDimensions } = require('../src/services/exportVideoResolution');

test('resolves a portrait export preset from its long edge', () => {
  assert.deepEqual(
    resolveExportVideoDimensions({ resolution: '1080p', aspectRatio: '9:16' }),
    { width: 608, height: 1080 }
  );
});

test('resolves a landscape 4K export preset from its long edge', () => {
  assert.deepEqual(
    resolveExportVideoDimensions({ resolution: '4k', aspectRatio: '16:9' }),
    { width: 3840, height: 2160 }
  );
});

test('rounds a custom export dimension to even pixels', () => {
  assert.deepEqual(
    resolveExportVideoDimensions({ resolution: 'custom', customLongEdge: 1001, aspectRatio: '9:16' }),
    { width: 562, height: 1000 }
  );
});

test('rejects export dimensions above 3840 pixels', () => {
  assert.throws(
    () => resolveExportVideoDimensions({ resolution: 'custom', customLongEdge: 3842, aspectRatio: '1:1' }),
    /3840/
  );
});

test('rejects custom export dimensions below two pixels', () => {
  assert.throws(
    () => resolveExportVideoDimensions({ resolution: 'custom', customLongEdge: 1, aspectRatio: '1:1' }),
    /至少/
  );
});

test('rejects unsupported export resolutions', () => {
  assert.throws(
    () => resolveExportVideoDimensions({ resolution: '900p', aspectRatio: '16:9' }),
    /不支持/
  );
});
