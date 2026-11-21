#!/usr/bin/env node
// 全量测试入口：node tests/run.mjs
//
// 六组：
//   清单      —— package.json / cordis.patch.yml（漏了 main/exports 就靠这组拦）
//   schema    —— 两个工具的 JSON Schema（ajv 会拒不合法的）
//   投影      —— 开关怎么换算成白名单/来源/醒来次数（纯函数）
//   补丁      —— 五条补丁的状态、幂等、还原、往返（真实包副本）
//   素材收口  —— runs fish/turns.js 里那段真实补丁代码
//   工具      —— bili_report / heartbeat_seeds / /state 路由
//   设置页    —— 网页半边的 slots 注册
//
// 全部在临时目录里跑；真实 profile 只读，真实配置不改（FISH_TOOLS_NO_PROJECT=1）。

import { fail, section, summary } from './helpers.mjs'

const SUITES = [
  ['清单', './manifest.test.mjs'],
  ['schema', './schema.test.mjs'],
  ['投影', './projection.test.mjs'],
  ['补丁', './patches.test.mjs'],
  ['素材收口', './ingest.test.mjs'],
  ['工具', './tools.test.mjs'],
  ['设置页', './client.test.mjs'],
]

const started = Date.now()
process.stdout.write('dsh-fish-tools · 全量测试\n')

for (const [name, file] of SUITES) {
  try {
    const mod = await import(file)
    await mod.run()
  } catch (err) {
    // 一个套件崩了不该吞掉后面的：记一条失败，继续跑
    section(`${name}（异常中断）`)
    process.stdout.write(`  ✗ ${String(err?.message ?? err)}\n`)
    const where = String(err?.stack ?? '').split('\n').slice(1, 4).join('\n      ')
    if (where.trim()) process.stdout.write(`      ${where}\n`)
  }
}

const failures = summary()
process.stdout.write(`耗时 ${((Date.now() - started) / 1000).toFixed(1)}s\n`)
process.exit(failures ? 1 : 0)
