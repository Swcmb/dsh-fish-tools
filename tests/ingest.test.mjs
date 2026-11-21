// 素材收口：直接跑 turns.js 里那段真实补丁代码。
// 做法是把文件尾部那段抽出来当模块导入 —— 测的是磁盘上的代码，不是复制品。

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { PROFILE, eq, includes, ok, section, withTemp } from './helpers.mjs'

const FISH_LIB = path.join(PROFILE, 'node_modules', '@ssamurias', 'dsh-fish', 'lib')
const TURNS = path.join(FISH_LIB, 'turns.js')

const MATERIAL = {
  dshFishMaterial: 1,
  source: 'bili-scroll',
  kind: 'fact',
  key: '2026-11-21:BV1xx411c7mD',
  at: '2026-11-21',
  title: 'B站值班报告 2026-11-21',
  facts: [{ label: 'BV1xx411c7mD', value: '字幕工程的三个取舍', url: 'https://www.bilibili.com/video/BV1xx411c7mD' }],
  quotes: [{ text: '字幕工程的三个取舍', kind: 'title', by: 'UP主：某某工作室' }],
}

const lib = (name) => pathToFileURL(path.join(FISH_LIB, name)).href

async function loadIngest(dir) {
  const src = await readFile(TURNS, 'utf8')
  const lines = src.split(/\r?\n/)
  const start = lines.findIndex((l) => l.startsWith('const __matCallNames'))
  ok(start > 0, 'turns.js 里能找到补丁追加段', start > 0 ? '' : '找不到 __matCallNames')

  const harness = [
    `import { rootDir, readEvents, appendEvent } from ${JSON.stringify(lib('store.js'))}`,
    `import { loadConfig } from ${JSON.stringify(lib('settings.js'))}`,
    `import { allSources, sourceMaterial } from ${JSON.stringify(lib('sources.js'))}`,
    '',
    ...lines.slice(start),
    'export { ingestThirdPartyMaterial }',
  ].join('\n')

  const file = path.join(dir, 'turns-tail.mjs')
  await writeFile(file, harness, 'utf8')
  return import(pathToFileURL(file).href)
}

const call = (callId, name) => ({ data: { callId, name } })
const result = (callId, text) => ({ data: { message: { toolCallId: callId, content: [{ type: 'text', text }] } } })

export async function run() {
  section('素材收口：真实补丁段')

  await withTemp('ingest', async (dir) => {
    const home = path.join(dir, 'fishhome')
    await mkdir(home, { recursive: true })
    await writeFile(path.join(home, 'config.json'), JSON.stringify({
      tools: { sources: [{ name: 'bili-scroll', kind: 'fact', tool: 'bili_report' }] },
    }), 'utf8')
    process.env.DSH_FISH_HOME = home

    const mod = await loadIngest(dir)
    const ledger = path.join(home, 'events.jsonl')
    const matLines = async () => {
      if (!existsSync(ledger)) return []
      const rows = (await readFile(ledger, 'utf8')).split(/\r?\n/).filter(Boolean)
      return rows.map((l) => JSON.parse(l)).filter((e) => e.type === 'meta' && String(e.text).startsWith('mat:'))
    }

    await mod.ingestThirdPartyMaterial(call('c1', 'bili_report'), 'tool/call')
    await mod.ingestThirdPartyMaterial(result('c1', JSON.stringify(MATERIAL)), 'tool/result')
    const wrote = await matLines()
    eq(wrote.length, 1, '登记过的工具结果写出 1 条 mat: 行')
    if (wrote[0]) {
      includes(wrote[0].text, 'mat:bili-scroll:2026-11-21:BV1xx411c7mD', '索引行形状 mat:<source>:<key>')
      const payload = JSON.parse(wrote[0].text.slice(wrote[0].text.indexOf('{')))
      ok(payload.q?.length === 1 && payload.q[0].x === '字幕工程的三个取舍', '载荷里带原话（q）')
      ok(payload.f?.[0]?.u?.includes('bilibili.com'), '载荷里带可核对链接（f.u）')
    }

    await mod.ingestThirdPartyMaterial(result('c1', JSON.stringify(MATERIAL)), 'tool/result')
    eq((await matLines()).length, 1, '同一条结果重放不重复写（去重）')

    await mod.ingestThirdPartyMaterial(call('c2', 'some_other_tool'), 'tool/call')
    await mod.ingestThirdPartyMaterial(result('c2', JSON.stringify(MATERIAL)), 'tool/result')
    eq((await matLines()).length, 1, '未登记的工具不产生素材')

    await mod.ingestThirdPartyMaterial(call('c3', 'bili_report'), 'tool/call')
    await mod.ingestThirdPartyMaterial(result('c3', '只是一段普通文本'), 'tool/result')
    eq((await matLines()).length, 1, '没有原话的普通文本不产生素材')

    await mod.ingestThirdPartyMaterial(result('c-unknown', JSON.stringify(MATERIAL)), 'tool/result')
    eq((await matLines()).length, 1, '没有对应 tool/call 的孤结果被忽略')
  })
}
