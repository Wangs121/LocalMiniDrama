import { computed, ref } from 'vue'

export function buildZipFormData(file, FormDataCtor = FormData) {
  const form = new FormDataCtor()
  form.append('archive', file)
  return form
}

export function buildDirectoryFormData(files, FormDataCtor = FormData) {
  const form = new FormDataCtor()
  const paths = []
  for (const file of Array.from(files || [])) {
    form.append('files', file, file.name)
    paths.push(file.webkitRelativePath || file.name)
  }
  form.append('relative_paths', JSON.stringify(paths))
  return form
}

export function usePromptSkills({ api, getDramaId, notify, confirmDelete }) {
  const loading = ref(false)
  const importing = ref(false)
  const projectSaving = ref(false)
  const savingId = ref('')
  const errorMessage = ref('')
  const skills = ref([])
  const previewVisible = ref(false)
  const previewData = ref(null)
  const projectMode = ref('inherit')
  const projectSkillIds = ref([])
  const savedProjectMode = ref('inherit')
  const savedProjectSkillIds = ref([])
  const validSkills = computed(() => skills.value.filter((skill) => skill.valid))

  function setError(error) {
    errorMessage.value = error?.message || '请求失败，请稍后重试'
  }

  function applyProject(data) {
    projectMode.value = data?.mode || 'inherit'
    projectSkillIds.value = [...(data?.skill_ids || [])]
    savedProjectMode.value = projectMode.value
    savedProjectSkillIds.value = [...projectSkillIds.value]
  }

  async function loadAll() {
    loading.value = true
    errorMessage.value = ''
    try {
      const data = await api.list()
      skills.value = data?.skills || []
      const dramaId = getDramaId()
      if (dramaId) applyProject(await api.getProject(dramaId))
      return true
    } catch (error) {
      setError(error)
      return false
    } finally {
      loading.value = false
    }
  }

  async function preview(row) {
    errorMessage.value = ''
    try {
      const data = await api.get(row.id)
      previewData.value = data?.skill || null
      previewVisible.value = Boolean(previewData.value)
      return previewData.value
    } catch (error) {
      setError(error)
      return null
    }
  }

  async function sendImport(formData) {
    importing.value = true
    errorMessage.value = ''
    try {
      const data = await api.import(formData)
      skills.value = data?.skills || skills.value
      notify.success('Skill 已安装，请预览确认后再启用')
      if (data?.skill) await preview(data.skill)
      return data?.skill || null
    } catch (error) {
      setError(error)
      return null
    } finally {
      importing.value = false
    }
  }

  async function toggleSkill(row, enabled) {
    savingId.value = row.id
    errorMessage.value = ''
    try {
      const data = await api.setEnabled(row.id, enabled)
      skills.value = data?.skills || skills.value
      return true
    } catch (error) {
      row.enabled = !enabled
      setError(error)
      return false
    } finally {
      savingId.value = ''
    }
  }

  async function removeSkill(row) {
    try {
      await confirmDelete(row)
    } catch (_) {
      return false
    }
    errorMessage.value = ''
    try {
      const data = await api.remove(row.id)
      skills.value = data?.skills || []
      projectSkillIds.value = projectSkillIds.value.filter((id) => id !== row.id)
      savedProjectSkillIds.value = savedProjectSkillIds.value.filter((id) => id !== row.id)
      if (previewData.value?.id === row.id) previewVisible.value = false
      return true
    } catch (error) {
      setError(error)
      return false
    }
  }

  async function saveProjectSelection() {
    const dramaId = getDramaId()
    if (!dramaId) return false
    const previousMode = savedProjectMode.value
    const previousIds = [...savedProjectSkillIds.value]
    const body = { mode: projectMode.value }
    if (projectMode.value === 'custom') body.skill_ids = [...projectSkillIds.value]
    projectSaving.value = true
    errorMessage.value = ''
    try {
      const data = await api.updateProject(dramaId, body)
      applyProject(data)
      notify.success('项目 Skill 设置已保存')
      return true
    } catch (error) {
      projectMode.value = previousMode
      projectSkillIds.value = previousIds
      setError(error)
      return false
    } finally {
      projectSaving.value = false
    }
  }

  return {
    loading, importing, projectSaving, savingId, errorMessage, skills,
    previewVisible, previewData, projectMode, projectSkillIds, validSkills,
    loadAll, preview, sendImport, toggleSkill, removeSkill, saveProjectSelection,
  }
}
