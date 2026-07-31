<template>
  <el-dialog
    :model-value="modelValue"
    class="storyboard-ai-dialog"
    width="min(1180px, 96vw)"
    destroy-on-close
    :before-close="dialogGuard.beforeClose"
    @open="onOpen"
    @update:model-value="onVisibilityChange"
  >
    <template #header>
      <div class="dialog-title">
        <span>分镜 {{ storyboard?.storyboard_number ?? storyboard?.id }} · AI 修改</span>
        <div class="stale-tags">
          <el-tag v-if="imageStale" type="warning" effect="plain">图片可能过期</el-tag>
          <el-tag v-if="videoStale" type="warning" effect="plain">视频可能过期</el-tag>
        </div>
      </div>
    </template>

    <div v-if="storyboard" class="storyboard-ai-layout">
      <div class="storyboard-form-pane">
        <el-tabs v-model="activeTab">
          <el-tab-pane label="内容与关联" name="content">
            <el-form label-position="top" size="small" class="storyboard-form">
              <div class="form-grid two-columns">
                <el-form-item label="标题"><el-input v-model="form.title" /></el-form-item>
                <el-form-item label="时长（秒）">
                  <el-input-number v-model="form.duration" :min="1" :max="120" controls-position="right" />
                </el-form-item>
                <el-form-item label="地点"><el-input v-model="form.location" /></el-form-item>
                <el-form-item label="时间"><el-input v-model="form.time" /></el-form-item>
              </div>
              <el-form-item label="描述"><el-input v-model="form.description" type="textarea" :rows="3" /></el-form-item>
              <el-form-item label="空间布局"><el-input v-model="form.layout_description" type="textarea" :rows="3" /></el-form-item>
              <div class="form-grid two-columns">
                <el-form-item label="对白"><el-input v-model="form.dialogue" type="textarea" :rows="3" /></el-form-item>
                <el-form-item label="旁白"><el-input v-model="form.narration" type="textarea" :rows="3" /></el-form-item>
                <el-form-item label="动作"><el-input v-model="form.action" type="textarea" :rows="3" /></el-form-item>
                <el-form-item label="氛围"><el-input v-model="form.atmosphere" type="textarea" :rows="3" /></el-form-item>
              </div>
              <div class="form-grid three-columns">
                <el-form-item label="场景">
                  <el-select v-model="form.scene_id" clearable filterable>
                    <el-option v-for="item in scenes" :key="item.id" :label="item.location || item.name || `场景 ${item.id}`" :value="Number(item.id)" />
                  </el-select>
                </el-form-item>
                <el-form-item label="角色">
                  <el-select v-model="form.character_ids" multiple collapse-tags collapse-tags-tooltip filterable>
                    <el-option v-for="item in characters" :key="item.id" :label="item.name || `角色 ${item.id}`" :value="Number(item.id)" />
                  </el-select>
                </el-form-item>
                <el-form-item label="道具">
                  <el-select v-model="form.prop_ids" multiple collapse-tags collapse-tags-tooltip filterable>
                    <el-option v-for="item in propsList" :key="item.id" :label="item.name || `道具 ${item.id}`" :value="Number(item.id)" />
                  </el-select>
                </el-form-item>
              </div>
            </el-form>
          </el-tab-pane>

          <el-tab-pane label="镜头与画面" name="camera">
            <el-form label-position="top" size="small" class="storyboard-form">
              <div class="form-grid two-columns">
                <el-form-item label="景别"><el-input v-model="form.shot_type" /></el-form-item>
                <el-form-item label="运镜"><el-input v-model="form.movement" /></el-form-item>
                <el-form-item label="水平机位">
                  <el-select v-model="form.angle_h" clearable>
                    <el-option v-for="item in horizontalAngles" :key="item.value" :label="item.label" :value="item.value" />
                  </el-select>
                </el-form-item>
                <el-form-item label="垂直机位">
                  <el-select v-model="form.angle_v" clearable>
                    <el-option v-for="item in verticalAngles" :key="item.value" :label="item.label" :value="item.value" />
                  </el-select>
                </el-form-item>
                <el-form-item label="画面尺度">
                  <el-select v-model="form.angle_s" clearable>
                    <el-option v-for="item in scaleAngles" :key="item.value" :label="item.label" :value="item.value" />
                  </el-select>
                </el-form-item>
                <el-form-item label="景深"><el-input v-model="form.depth_of_field" /></el-form-item>
              </div>
              <el-form-item label="灯光风格"><el-input v-model="form.lighting_style" type="textarea" :rows="3" /></el-form-item>
            </el-form>
          </el-tab-pane>

          <el-tab-pane label="提示词" name="prompts">
            <el-form label-position="top" size="small" class="storyboard-form">
              <el-form-item label="图片提示词"><el-input v-model="form.image_prompt" type="textarea" :rows="5" /></el-form-item>
              <el-form-item label="润色图片提示词"><el-input v-model="form.polished_prompt" type="textarea" :rows="5" /></el-form-item>
              <el-form-item label="视频提示词"><el-input v-model="form.video_prompt" type="textarea" :rows="6" /></el-form-item>
              <el-form-item label="全能片段文本"><el-input v-model="form.universal_segment_text" type="textarea" :rows="6" /></el-form-item>
            </el-form>
          </el-tab-pane>
        </el-tabs>
      </div>

      <AiEditPanel
        class="storyboard-ai-pane"
        entity-type="storyboard"
        :entity-id="storyboard.id"
        :episode-id="episodeId"
        :get-snapshot="getSnapshot"
        :apply-fields="applyFields"
        :relation-options="relationOptions"
      />
    </div>

    <template #footer>
      <el-button @click="dialogGuard.requestClose()">取消</el-button>
      <el-button type="primary" :loading="saving" @click="saveAndClose">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { storyboardsAPI } from '@/api/storyboards'
import { useUnsavedDialogGuard } from '@/composables/useUnsavedDialogGuard.js'
import {
  applyCandidateFields,
  mediaImpactBetween,
  normalizeAiEditSnapshot,
} from '@/utils/aiEditEntities.js'
import AiEditPanel from '@/components/AiEditPanel.vue'

const props = defineProps({
  modelValue: Boolean,
  storyboard: { type: Object, default: null },
  episodeId: { type: [Number, String], default: null },
  characters: { type: Array, default: () => [] },
  scenes: { type: Array, default: () => [] },
  propsList: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:modelValue', 'saved'])

const activeTab = ref('content')
const saving = ref(false)
const initialSnapshot = ref(null)
const form = reactive(normalizeAiEditSnapshot('storyboard', {}))

const horizontalAngles = [
  ['front', '正面'], ['front_left', '左前方'], ['left', '左侧'], ['back_left', '左后方'],
  ['back', '背面'], ['back_right', '右后方'], ['right', '右侧'], ['front_right', '右前方'],
].map(([value, label]) => ({ value, label }))
const verticalAngles = [
  ['worm', '虫视'], ['low', '低机位'], ['eye_level', '平视'], ['high', '高机位'],
].map(([value, label]) => ({ value, label }))
const scaleAngles = [
  ['close_up', '近景'], ['medium', '中景'], ['wide', '远景'],
].map(([value, label]) => ({ value, label }))

const relationOptions = computed(() => ({
  characters: props.characters,
  scenes: props.scenes,
  props: props.propsList,
}))
const localMediaImpact = computed(() => mediaImpactBetween(
  'storyboard',
  initialSnapshot.value || getSnapshot(),
  getSnapshot(),
))
const imageStale = computed(() => Boolean(props.storyboard?.image_stale) || localMediaImpact.value.image)
const videoStale = computed(() => Boolean(props.storyboard?.video_stale) || localMediaImpact.value.video)

function getSnapshot() {
  return normalizeAiEditSnapshot('storyboard', form)
}

function applyFields(candidate, fields) {
  return applyCandidateFields('storyboard', form, candidate, fields)
}

function syncForm() {
  const snapshot = normalizeAiEditSnapshot('storyboard', props.storyboard || {})
  Object.assign(form, snapshot)
  initialSnapshot.value = snapshot
  activeTab.value = 'content'
}

function closeDialog() {
  emit('update:modelValue', false)
}

async function persist() {
  if (!props.storyboard?.id || saving.value) return false
  saving.value = true
  try {
    await storyboardsAPI.update(props.storyboard.id, getSnapshot())
    initialSnapshot.value = getSnapshot()
    dialogGuard.captureCleanSnapshot()
    emit('saved')
    ElMessage.success('分镜已保存')
    return true
  } catch (error) {
    ElMessage.error(error?.message || '分镜保存失败')
    throw error
  } finally {
    saving.value = false
  }
}

async function saveAndClose() {
  if (await persist()) closeDialog()
}

const dialogGuard = useUnsavedDialogGuard({
  getSnapshot,
  save: persist,
  discard: async () => syncForm(),
  close: closeDialog,
})

function onOpen() {
  syncForm()
  nextTick(dialogGuard.captureCleanSnapshot)
}

function onVisibilityChange(open) {
  if (!open) dialogGuard.requestClose()
}

watch(() => props.storyboard?.id, () => {
  if (props.modelValue) onOpen()
})
</script>

<style scoped>
.dialog-title,
.stale-tags {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dialog-title {
  justify-content: space-between;
  padding-right: 32px;
  font-weight: 600;
}

.storyboard-ai-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(360px, 0.85fr);
  min-height: 560px;
  max-height: calc(100vh - 180px);
  overflow: hidden;
}

.storyboard-form-pane {
  min-width: 0;
  overflow-y: auto;
  padding-right: 16px;
}

.storyboard-ai-pane {
  min-height: 560px;
}

.storyboard-form :deep(.el-form-item) {
  margin-bottom: 14px;
}

.form-grid {
  display: grid;
  gap: 0 12px;
}

.two-columns {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.three-columns {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.form-grid :deep(.el-select),
.form-grid :deep(.el-input-number) {
  width: 100%;
}

@media (max-width: 820px) {
  .storyboard-ai-layout {
    display: block;
    max-height: calc(100vh - 150px);
    overflow-y: auto;
  }

  .storyboard-form-pane {
    overflow: visible;
    padding-right: 0;
  }

  .storyboard-ai-pane {
    min-height: 520px;
    margin-top: 16px;
    border-top: 1px solid var(--el-border-color-light);
  }

  .two-columns,
  .three-columns {
    grid-template-columns: 1fr;
  }
}
</style>
