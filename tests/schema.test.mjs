// 工具 schema：宿主用 ajv 校验，`{ type: 'json' }` 这种写法会注册失败（我们踩过）。
// 这里把注册出来的 schema 逐层走一遍，按 JSON Schema 的类型集合检查。

import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { REPO, eq, fakeCtx, ok, section, withTemp } from './helpers.mjs'

const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])

function walk(node, at, problems) {
  if (Array.isArray(node)) {
    node.forEach((item, i) => walk(item, `${at}[${i}]`, problems))
    return
  }
  if (!node || typeof node !== 'object') return

  if ('type' in node && !TYPES.has(node.type)) {
    problems.push(`${at}.type=${JSON.stringify(node.type)} 不是合法 JSON Schema 类型`)
  }
  if (node.type === 'array' && !node.items) {
    problems.push(`${at} 是 array 但没有 items`)
  }
  if ('required' in node) {
    if (!Array.isArray(node.required)) problems.push(`${at}.required 不是数组`)
    else {
      const props = node.properties ?? {}
      for (const key of node.required) {
        if (!(key in props)) problems.push(`${at} 的 required 里有 ${key}，但 properties 里没有`)
      }
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties' || key === 'items' || key === 'additionalProperties') {
      walk(value, `${at}.${key}`, problems)
    }
  }
}

export async function run() {
  section('工具 schema：合法性与一致性')

  await withTemp('schema', async (dir) => {
    const home = path.join(dir, 'dsh-home')
    await mkdir(home, { recursive: true })
    process.env.DSH_HOME = home
    process.env.FISH_TOOLS_NO_PROJECT = '1'

    const { apply } = await import(pathToFileURL(path.join(REPO, 'lib', 'index.js')).href + '?s=' + Date.now())
    const { ctx, tools } = fakeCtx()
    apply(ctx)

    const names = Object.keys(tools)
    eq(names.sort(), ['bili_report', 'heartbeat_seeds'], '注册了两个工具')

    for (const name of names) {
      const def = tools[name]
      ok(String(def.description ?? '').length > 30, `${name} 有像样的说明`)

      const problems = []
      walk(def.parameters, `${name}.parameters`, problems)
      ok(problems.length === 0, `${name} 的参数 schema 合法`, problems.join('；'))

      const outProblems = []
      walk(def.output?.schema, `${name}.output`, outProblems)
      ok(outProblems.length === 0, `${name} 的输出 schema 合法`, outProblems.join('；'))

      ok(def.parameters?.type === 'object', `${name} 参数根节点是 object`)
      ok(typeof def.output?.render === 'function', `${name} 有 render（否则界面上看不到结果）`)
    }
  })
}
