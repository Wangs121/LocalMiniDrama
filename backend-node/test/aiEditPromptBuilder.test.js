const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildGenerationPrompts,
  buildRepairPrompts,
} = require('../src/services/aiEditPromptBuilder');
const { emptyCandidate } = require('../src/services/aiEditSchemas');

const ANGLE_H_VALUES = [
  null,
  'front',
  'front_left',
  'left',
  'back_left',
  'back',
  'back_right',
  'right',
  'front_right',
];

function storyboardContext() {
  return {
    entityType: 'storyboard',
    drama: { id: 1, title: 'Test' },
    episode: { id: 2, title: 'Episode' },
    availableRelations: {},
  };
}

test('storyboard generation prompt exposes exact angle enum values', () => {
  const prompts = buildGenerationPrompts(
    storyboardContext(),
    emptyCandidate('storyboard'),
    null,
    [],
    'Change the camera angle'
  );

  assert.match(prompts.userPrompt, /candidate contract/i);
  assert.match(prompts.userPrompt, /"angle_h"/);
  assert.ok(ANGLE_H_VALUES.every((value) => prompts.userPrompt.includes(JSON.stringify(value))));
});

test('storyboard repair prompt exposes the same angle enum contract', () => {
  const prompts = buildRepairPrompts(
    'storyboard',
    JSON.stringify({ candidate: { angle_h: 'front view' } }),
    'Invalid angle_h',
    emptyCandidate('storyboard')
  );

  assert.match(prompts.userPrompt, /candidate contract/i);
  assert.match(prompts.userPrompt, /"angle_h"/);
  assert.ok(ANGLE_H_VALUES.every((value) => prompts.userPrompt.includes(JSON.stringify(value))));
});
