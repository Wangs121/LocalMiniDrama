import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('AI edit panel renders safe selectable field diffs', async () => {
  const source = await readFile(new URL('../src/components/AiEditPanel.vue', import.meta.url), 'utf8')
  assert.match(source, /v-for="change in latestProposal\.changes"/)
  assert.match(source, /type="checkbox"|el-checkbox/)
  assert.match(source, /应用所选/)
  assert.match(source, /放弃建议/)
  assert.match(source, /diffText/)
  assert.doesNotMatch(source, /v-html/)
})

test('AI edit panel has bounded message and composer dimensions', async () => {
  const source = await readFile(new URL('../src/components/AiEditPanel.vue', import.meta.url), 'utf8')
  assert.match(source, /min-height:/)
  assert.match(source, /max-height:/)
  assert.match(source, /overflow-y:\s*auto/)
  assert.match(source, /word-break:\s*break-word/)
})

test('AI edit panel collapses assistant replies and prioritizes proposal field changes', async () => {
  const source = await readFile(new URL('../src/components/AiEditPanel.vue', import.meta.url), 'utf8')
  const proposal = source.match(/<section v-if="latestProposal"[\s\S]*?<\/section>/)?.[0] || ''

  assert.match(source, /expandedReplyIds/)
  assert.match(source, /message\.role === 'assistant'/)
  assert.match(source, /message\.role === 'user'/)
  assert.match(source, /查看 AI 回复/)
  assert.match(source, /收起 AI 回复/)
  assert.match(source, /replyExpanded\(message/)
  assert.match(source, /toggleReply\(message/)
  assert.match(proposal, /latestProposal\.changes/)
  assert.match(proposal, /应用所选/)
  assert.match(proposal, /放弃建议/)
  assert.doesNotMatch(proposal, /latestProposal\.content/)
  assert.doesNotMatch(source, /v-html/)
})

test('saved asset dialogs share the AI edit panel while add mode does not create a conversation', async () => {
  const source = await readFile(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
  assert.match(source, /import AiEditPanel/)
  assert.match(source, /entity-type="character"[\s\S]*?editCharacterForm\.id/)
  assert.match(source, /entity-type="scene"[\s\S]*?editSceneForm\.id/)
  assert.match(source, /entity-type="prop"[\s\S]*?editPropForm\.id/)
  assert.match(source, /asset-edit-layout/)
  assert.match(source, /asset-edit-tabs/)
})

test('every AI editable asset field has a visible form control', async () => {
  const source = await readFile(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
  for (const field of ['personality', 'voice_style', 'negative_prompt', 'polished_prompt_single']) {
    assert.match(source, new RegExp('edit(?:Character|Scene|Prop)Form\\.' + field))
  }
})

test('storyboard AI dialog owns the complete form and shared review panel', async () => {
  const source = await readFile(new URL('../src/components/StoryboardAiEditDialog.vue', import.meta.url), 'utf8')
  assert.match(source, /AiEditPanel/)
  assert.match(source, /entity-type="storyboard"/)
  assert.match(source, /storyboardsAPI\.update/)
  assert.match(source, /useUnsavedDialogGuard/)
  for (const field of [
    'title', 'description', 'layout_description', 'location', 'time', 'duration',
    'dialogue', 'narration', 'action', 'atmosphere', 'image_prompt', 'polished_prompt',
    'video_prompt', 'universal_segment_text', 'shot_type', 'angle_h', 'angle_v',
    'angle_s', 'movement', 'lighting_style', 'depth_of_field', 'scene_id',
    'character_ids', 'prop_ids',
  ]) assert.match(source, new RegExp(`form\\.${field}`))
  assert.match(source, /图片可能过期/)
  assert.match(source, /视频可能过期/)
  assert.doesNotMatch(source, /rebuildVideoPrompt/)
})

test('list and canvas storyboard editors open the shared AI dialog', async () => {
  const list = await readFile(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')
  const canvas = await readFile(new URL('../src/components/dramaCanvas/CanvasStoryboardPanel.vue', import.meta.url), 'utf8')
  const assets = await readFile(new URL('../src/components/dramaCanvas/CanvasAssetPanel.vue', import.meta.url), 'utf8')
  assert.match(list, /StoryboardAiEditDialog/)
  assert.match(list, /ChatDotRound/)
  assert.match(list, /图片可能过期/)
  assert.match(list, /视频可能过期/)
  assert.match(canvas, /StoryboardAiEditDialog/)
  assert.match(canvas, /ChatDotRound/)
  assert.match(canvas, /ctx\?\.refreshDrama\?\.\(true\)/)
  assert.match(assets, /媒体可能过期/)
})

test('storyboard AI dialog lets both panes shrink and scroll inside short viewports', async () => {
  const source = await readFile(new URL('../src/components/StoryboardAiEditDialog.vue', import.meta.url), 'utf8')
  assert.match(source, /\.storyboard-ai-layout\s*\{[\s\S]*?height:\s*min\([^;]+calc\(100vh - 260px\)\)/)
  assert.match(source, /\.storyboard-form-pane\s*\{[\s\S]*?min-height:\s*0/)
  assert.match(source, /\.storyboard-ai-pane\s*\{[\s\S]*?min-height:\s*0/)
  assert.match(source, /:global\(\.storyboard-ai-dialog\)[\s\S]*?margin-top:/)
})
