// 测试脚手架：断言、分节、临时目录。
// 不引第三方测试框架 —— 这个仓库只跑 Node 自带能力，`node tests/run.mjs` 即全量。

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 被测插件所在的 profile（补丁要改的是这个 profile 里 node_modules 的包）。 */
export const PROFILE = process.env.DSH_PROFILE_DIR || 'D:/ai-configs/runtime/dsh/profiles/desktop'

const state = { pass: 0, fail: 0, section: '' }

export function section(title) {
  state.section = title
  process.stdout.write(`\n── ${title}\n`)
}

function record(okay, label, extra) {
  if (okay) {
    state.pass++
    process.stdout.write(`  ✓ ${label}\n`)
  } else {
    state.fail++
    process.stdout.write(`  ✗ ${label}${extra ? `\n      ${extra}` : ''}\n`)
  }
  return okay
}

export function ok(cond, label, extra = '') {
  return record(Boolean(cond), label, extra)
}

/** 记一条失败（异常中断这类没法用断言表达的情况）。 */
export function fail(label, extra = '') {
  return record(false, label, extra)
}

export function eq(actual, expected, label) {
  const same = JSON.stringify(actual) === JSON.stringify(expected)
  return record(same, label, same ? '' : `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
}

export function includes(haystack, needle, label) {
  return record(String(haystack ?? '').includes(needle), label, `「${needle}」不在结果里：${String(haystack ?? '').slice(0, 120)}`)
}

export function skip(label, why) {
  process.stdout.write(`  – ${label}（跳过：${why}）\n`)
}

export function summary() {
  process.stdout.write(`\n${state.fail ? '✗' : '✓'} ${state.pass} 通过 / ${state.fail} 失败\n`)
  return state.fail
}

/** 临时目录，跑完自动删。 */
export async function withTemp(label, fn) {
  const dir = await mkdtemp(path.join(tmpdir(), `fish-tools-${label}-`))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** 假 ctx：捕获工具与路由，不连真宿主。 */
export function fakeCtx() {
  const tools = {}
  const routes = []
  const ctx = {
    tools: { register: (def) => { tools[def.name] = def; return def } },
    webServer: { register: (route) => routes.push(route) },
    logger: { info() {}, warn() {}, error() {} },
  }
  return { ctx, tools, routes }
}

/** 调一条路由的 handler，拿回 {status, body}。 */
export async function callRoute(route, { method = 'GET', body } = {}) {
  const req = {
    method,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body), 'utf8')
    },
  }
  let resolveRes
  const done = new Promise((r) => { resolveRes = r })
  const res = {
    status: 0,
    writeHead(code) { this.status = code },
    end(raw) { resolveRes(raw ? JSON.parse(raw) : null) },
  }
  await route.handler(req, res)
  return { status: res.status, body: await done }
}
