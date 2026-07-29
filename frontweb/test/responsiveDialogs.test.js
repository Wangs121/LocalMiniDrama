import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('new project dialog is constrained to the mobile viewport', async () => {
  const source = await readFile(new URL('../src/views/FilmList.vue', import.meta.url), 'utf8')
  assert.match(source, /title="新建项目"[\s\S]*?width="min\(480px, calc\(100vw - 24px\)\)"/)
})
