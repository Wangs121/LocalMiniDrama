<template>
  <div class="prompt-skills">
    <div class="skills-head">
      <h3>创作 Skill</h3>
      <div class="head-actions">
        <el-button :icon="Upload" @click="zipInput?.click()">导入 ZIP</el-button>
        <el-button :icon="FolderOpened" @click="dirInput?.click()">导入目录</el-button>
        <el-tooltip content="刷新 Skill 列表" placement="top">
          <el-button :icon="Refresh" circle :loading="loading" aria-label="刷新 Skill 列表" @click="loadAll" />
        </el-tooltip>
        <input ref="zipInput" type="file" accept=".zip" hidden @change="importZip" />
        <input ref="dirInput" type="file" webkitdirectory directory multiple hidden @change="importDirectory" />
      </div>
    </div>

    <el-alert
      v-if="errorMessage"
      class="skill-error"
      type="error"
      :title="errorMessage"
      show-icon
      closable
      @close="errorMessage = ''"
    />

    <div v-if="dramaId" v-loading="projectSaving" class="project-config">
      <div class="project-title">当前项目</div>
      <el-segmented v-model="projectMode" :options="projectModeOptions" @change="saveProjectSelection" />
      <el-checkbox-group
        v-if="projectMode === 'custom'"
        v-model="projectSkillIds"
        class="project-checks"
        @change="saveProjectSelection"
      >
        <el-checkbox v-for="skill in validSkills" :key="skill.id" :value="skill.id">{{ skill.name }}</el-checkbox>
      </el-checkbox-group>
    </div>

    <el-empty v-if="!loading && skills.length === 0" description="没有可用的 Skill" />
    <el-table v-else v-loading="loading || importing" :data="skills" stripe row-key="id">
      <el-table-column prop="name" label="名称" min-width="180">
        <template #default="{ row }">
          <div class="skill-name">{{ row.name }}</div>
          <el-tag size="small" :type="row.source === 'bundled' ? 'info' : 'success'">
            {{ row.source === 'bundled' ? '内置' : '用户安装' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="description" label="能力" min-width="260" show-overflow-tooltip />
      <el-table-column label="生成阶段" min-width="220">
        <template #default="{ row }">
          <el-tag v-for="stage in row.stages" :key="stage" size="small" class="stage-tag">
            {{ stageLabels[stage] || stage }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="120">
        <template #default="{ row }">
          <el-tooltip v-if="!row.valid" :content="row.validation_errors.join('; ')" placement="top">
            <el-tag type="danger">校验失败</el-tag>
          </el-tooltip>
          <el-switch
            v-else
            v-model="row.enabled"
            :loading="savingId === row.id"
            @change="(value) => toggleSkill(row, value)"
          />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="104" fixed="right">
        <template #default="{ row }">
          <el-tooltip content="预览" placement="top">
            <el-button link type="primary" :icon="View" aria-label="预览" @click="preview(row)" />
          </el-tooltip>
          <el-tooltip v-if="row.deletable" content="删除" placement="top">
            <el-button link type="danger" :icon="Delete" aria-label="删除" @click="removeSkill(row)" />
          </el-tooltip>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="previewVisible" :title="previewData?.name || 'Skill 预览'" width="min(760px, 92vw)">
      <template v-if="previewData">
        <el-alert
          v-if="!previewData.valid"
          type="error"
          :title="previewData.validation_errors.join('; ')"
          show-icon
          :closable="false"
        />
        <el-descriptions class="preview-meta" :column="previewColumns" border size="small">
          <el-descriptions-item label="ID">{{ previewData.id }}</el-descriptions-item>
          <el-descriptions-item label="版本">{{ previewData.version }}</el-descriptions-item>
          <el-descriptions-item label="来源">{{ previewData.source === 'bundled' ? '内置' : '用户安装' }}</el-descriptions-item>
          <el-descriptions-item label="优先级">{{ previewData.priority }}</el-descriptions-item>
          <el-descriptions-item label="作者">{{ previewData.author || '-' }}</el-descriptions-item>
          <el-descriptions-item label="许可证">{{ previewData.license || '-' }}</el-descriptions-item>
          <el-descriptions-item label="说明" :span="previewColumns">{{ previewData.description || '-' }}</el-descriptions-item>
        </el-descriptions>
        <el-tabs class="preview-tabs">
          <el-tab-pane v-if="previewData.overview" label="概览">
            <div class="preview-section">
              <div class="preview-path">SKILL.md · {{ previewData.overview.length.toLocaleString() }} 字符</div>
              <pre>{{ previewData.overview }}</pre>
            </div>
          </el-tab-pane>
          <el-tab-pane v-for="(sections, stage) in previewData.sections" :key="stage" :label="stageLabels[stage] || stage">
            <div v-for="section in sections" :key="section.path" class="preview-section">
              <div class="preview-path">{{ section.path }} · {{ section.content.length.toLocaleString() }} 字符</div>
              <pre>{{ section.content }}</pre>
            </div>
          </el-tab-pane>
        </el-tabs>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, FolderOpened, Refresh, Upload, View } from '@element-plus/icons-vue'
import { promptSkillsAPI } from '@/api/promptSkills'
import { buildDirectoryFormData, buildZipFormData, usePromptSkills } from '@/composables/usePromptSkills'

const props = defineProps({ dramaId: { type: [Number, String], default: null } })
const zipInput = ref(null)
const dirInput = ref(null)
const previewColumns = ref(2)
const projectModeOptions = [
  { label: '继承全局', value: 'inherit' },
  { label: '自定义', value: 'custom' },
  { label: '全部禁用', value: 'disabled' },
]
const stageLabels = {
  story: '故事', storyboard: '分镜', image_prompt: '图片提示词',
  frame_prompt: '首尾帧', video_prompt: '视频提示词',
}

const {
  loading, importing, projectSaving, savingId, errorMessage, skills,
  previewVisible, previewData, projectMode, projectSkillIds, validSkills,
  loadAll, preview, sendImport, toggleSkill, removeSkill, saveProjectSelection,
} = usePromptSkills({
  api: promptSkillsAPI,
  getDramaId: () => props.dramaId,
  notify: ElMessage,
  confirmDelete: (row) => ElMessageBox.confirm(`删除用户 Skill「${row.name}」？`, '删除 Skill', { type: 'warning' }),
})

async function importZip(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (file) await sendImport(buildZipFormData(file))
}

async function importDirectory(event) {
  const files = Array.from(event.target.files || [])
  event.target.value = ''
  if (files.length) await sendImport(buildDirectoryFormData(files))
}

function updatePreviewColumns() {
  previewColumns.value = window.innerWidth < 640 ? 1 : 2
}

onMounted(() => {
  updatePreviewColumns()
  window.addEventListener('resize', updatePreviewColumns)
  loadAll()
})
onBeforeUnmount(() => window.removeEventListener('resize', updatePreviewColumns))
</script>

<style scoped>
.prompt-skills { padding: 4px 0; }
.skills-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.skills-head h3 { margin: 0; font-size: 16px; }
.head-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.skill-error { margin-bottom: 14px; }
.project-config { min-height: 72px; padding: 14px 0; margin-bottom: 14px; border-top: 1px solid var(--el-border-color-lighter); border-bottom: 1px solid var(--el-border-color-lighter); }
.project-title { margin-bottom: 10px; font-size: 13px; font-weight: 600; }
.project-checks { display: flex; flex-wrap: wrap; gap: 0 16px; margin-top: 12px; }
.skill-name { margin-bottom: 5px; font-weight: 600; }
.stage-tag { margin: 2px 6px 2px 0; }
.preview-meta { margin-top: 8px; }
.preview-tabs { margin-top: 16px; }
.preview-section { margin-bottom: 14px; }
.preview-path { margin-bottom: 6px; color: var(--el-text-color-secondary); font-size: 12px; overflow-wrap: anywhere; }
.preview-section pre { max-height: 320px; margin: 0; padding: 12px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid var(--el-border-color-lighter); background: var(--el-fill-color-light); font: 12px/1.6 ui-monospace, monospace; }

@media (max-width: 720px) {
  .skills-head { align-items: flex-start; flex-direction: column; }
  .head-actions { width: 100%; justify-content: flex-start; }
  .project-config :deep(.el-segmented) { max-width: 100%; }
}
</style>
