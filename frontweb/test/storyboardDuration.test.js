import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('project clip duration selector is labeled as a storyboard-count estimate', async () => {
  const source = await readFile(new URL('../src/views/FilmCreate.vue', import.meta.url), 'utf8')

  for (const seconds of [4, 5, 8, 10, 12, 15]) {
    assert.match(source, new RegExp(`按${seconds}秒估算镜数`))
  }
})
