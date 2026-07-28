import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDirectoryFormData,
  buildZipFormData,
  usePromptSkills,
} from '../src/composables/usePromptSkills.js'

class FakeFormData {
  constructor() { this.entries = [] }
  append(...args) { this.entries.push(args) }
}

function createApi(overrides = {}) {
  return {
    async list() { return { skills: [{ id: 'camera', name: 'Camera', valid: true, enabled: false }] } },
    async get(id) { return { skill: { id, name: 'Camera', valid: true, sections: {} } } },
    async import() { return { skill: { id: 'imported' }, skills: [{ id: 'imported', valid: true, enabled: false }] } },
    async setEnabled(id, enabled) { return { skills: [{ id, valid: true, enabled }] } },
    async remove() { return { skills: [] } },
    async getProject() { return { mode: 'inherit', skill_ids: null } },
    async updateProject(_id, body) { return { mode: body.mode, skill_ids: body.skill_ids || null } },
    ...overrides,
  }
}

function managerFor(api, options = {}) {
  const messages = []
  const manager = usePromptSkills({
    api,
    getDramaId: () => options.dramaId ?? 1,
    notify: { success: (message) => messages.push(message) },
    confirmDelete: options.confirmDelete || (async () => true),
  })
  return { manager, messages }
}

describe('prompt Skill component state', () => {
  it('builds ZIP and directory multipart payloads with browser-relative paths', () => {
    const zip = { name: 'skill.zip' }
    const zipForm = buildZipFormData(zip, FakeFormData)
    assert.deepEqual(zipForm.entries, [['archive', zip]])

    const files = [
      { name: 'skill.json', webkitRelativePath: 'camera/skill.json' },
      { name: 'guide.md', webkitRelativePath: 'camera/references/guide.md' },
    ]
    const dirForm = buildDirectoryFormData(files, FakeFormData)
    assert.deepEqual(dirForm.entries.slice(0, 2), [
      ['files', files[0], 'skill.json'],
      ['files', files[1], 'guide.md'],
    ])
    assert.deepEqual(JSON.parse(dirForm.entries[2][1]), files.map((file) => file.webkitRelativePath))
  })

  it('loads project state and automatically previews a newly imported disabled Skill', async () => {
    const { manager, messages } = managerFor(createApi())
    assert.equal(await manager.loadAll(), true)
    const imported = await manager.sendImport(new FakeFormData())
    assert.equal(imported.id, 'imported')
    assert.equal(manager.previewVisible.value, true)
    assert.equal(manager.previewData.value.id, 'imported')
    assert.equal(manager.skills.value[0].enabled, false)
    assert.equal(messages.length, 1)
  })

  it('shows import errors and leaves the existing list usable', async () => {
    const api = createApi({ async import() { throw new Error('Skill package exceeds 2MB') } })
    const { manager } = managerFor(api)
    await manager.loadAll()
    const before = [...manager.skills.value]
    assert.equal(await manager.sendImport(new FakeFormData()), null)
    assert.equal(manager.errorMessage.value, 'Skill package exceeds 2MB')
    assert.deepEqual(manager.skills.value, before)
    assert.equal(manager.importing.value, false)
  })

  it('rolls back switches and project selection when saving fails', async () => {
    const api = createApi({
      async setEnabled() { throw new Error('network unavailable') },
      async updateProject() { throw new Error('save failed') },
    })
    const { manager } = managerFor(api)
    await manager.loadAll()
    const row = manager.skills.value[0]
    row.enabled = true
    assert.equal(await manager.toggleSkill(row, true), false)
    assert.equal(row.enabled, false)

    manager.projectMode.value = 'custom'
    manager.projectSkillIds.value = ['camera']
    assert.equal(await manager.saveProjectSelection(), false)
    assert.equal(manager.projectMode.value, 'inherit')
    assert.deepEqual(manager.projectSkillIds.value, [])
    assert.equal(manager.projectSaving.value, false)
  })

  it('honors delete confirmation and removes a confirmed user Skill', async () => {
    let removeCalls = 0
    const api = createApi({ async remove() { removeCalls += 1; return { skills: [] } } })
    const cancelled = managerFor(api, { confirmDelete: async () => { throw new Error('cancel') } }).manager
    assert.equal(await cancelled.removeSkill({ id: 'camera' }), false)
    assert.equal(removeCalls, 0)

    const confirmed = managerFor(api).manager
    confirmed.skills.value = [{ id: 'camera' }]
    assert.equal(await confirmed.removeSkill({ id: 'camera' }), true)
    assert.equal(removeCalls, 1)
    assert.deepEqual(confirmed.skills.value, [])
  })
});
