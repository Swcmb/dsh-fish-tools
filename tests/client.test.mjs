// 设置页（网页半边）：不启浏览器，用 __ModuleLoader__ + 假 slots 验注册；
// 再用 React 校验组件能构造出来（不渲染，避免依赖 react-dom）。

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { PROFILE, REPO, eq, ok, section, skip } from './helpers.mjs'

export async function run() {
  section('设置页：注册与渲染')

  let React = null
  try {
    React = createRequire(path.join(PROFILE, 'package.json'))('react')
  } catch {
    skip('设置页全部用例', `profile 里取不到 react（${PROFILE}）`)
    return
  }

  const code = await readFile(path.join(REPO, 'lib', 'client.js'), 'utf8')
  let captured = null
  globalThis.window = {
    __ModuleLoader__: { load: (def) => { captured = def } },
  }
  // data: URL 里跑源码，避免它被当成 ESM 文件去做静态导入分析
  await import('data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64'))

  ok(Boolean(captured), '调用了 window.__ModuleLoader__.load')
  eq(captured?.id, 'dsh-fish-tools', '模块 id 正确')

  const mod = captured.factory((name) => {
    if (name === 'react') return React
    throw new Error(`未预期的依赖：${name}`)
  })
  eq(mod.inject, ['slots'], '声明依赖 slots')
  ok(typeof mod.apply === 'function', '导出 apply')

  let registered = null
  let injectedInto = null
  const slots = {
    inject: (name, cb) => { injectedInto = name; cb() },
    register: (meta, Component) => { registered = { meta, Component } },
  }
  mod.apply({ get: (key) => (key === 'slots' ? slots : undefined) })

  eq(injectedInto, 'settings.section', '注入到 settings.section 槽位')
  eq(registered?.meta?.name, 'settings.section', '注册项名字正确')
  eq(registered?.meta?.id, 'fish-tools', '注册项 id 正确')
  eq(registered?.meta?.label(), '大肥鱼对接', '设置页显示名是「大肥鱼对接」')
  ok(typeof registered?.Component === 'function', '注册的是一个 React 组件')

  const el = React.createElement(registered.Component)
  ok(el.type === registered.Component, '组件能构造出 element')

  // 没有 slots 服务时不能炸（别的 profile 里可能没这个槽位）
  let threw = false
  try { mod.apply({ get: () => undefined }) } catch { threw = true }
  ok(!threw, '拿不到 slots 时安静返回，不抛')
}
