'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyStyleOverrideToCfg,
  promptUsesCurrentStyle,
} = require('../src/services/characterLibraryService');

test('character style override expands a preset value', () => {
  const cfg = applyStyleOverrideToCfg({ style: {} }, 'gufeng 3d');

  assert.match(cfg.style.default_style_en, /3D realistic/);
  assert.notEqual(cfg.style.default_style_en, 'gufeng 3d');
  assert.ok(cfg.style.default_style_zh);
});

test('cached character prompt is rejected after the project style changes', () => {
  const oldCfg = applyStyleOverrideToCfg({ style: {} }, 'realistic');
  const newCfg = applyStyleOverrideToCfg({ style: {} }, 'gufeng 3d');
  const cachedPrompt = `MANDATORY ART STYLE: ${oldCfg.style.default_style_en}.`;

  assert.equal(promptUsesCurrentStyle(cachedPrompt, oldCfg), true);
  assert.equal(promptUsesCurrentStyle(cachedPrompt, newCfg), false);
});
