// 两个只读工具 + /state 路由：全部在临时 DSH_HOME 里跑，不碰真实配置。
// 投影在测试里被 FISH_TOOLS_NO_PROJECT=1 关掉（否则会写真实 fish / speak-up / heartbeat）。

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { REPO, callRoute, eq, fakeCtx, includes, ok, section, withTemp } from './helpers.mjs'

const REPORT = `# 刷B站 · 2026-11-21

### BV1xx411c7mD
**标题**：字幕工程的三个取舍
**UP**：某某工作室
**链接**：https://www.bilibili.com/video/BV1xx411c7mD
**播放量**：12.3万
**档位**：值得看
**为什么值得**：讲了字幕对齐的实测数据。
**你自己的一句话**：这条讲的是工程细节。

### BV1yy411c7mE
**标题**：一个人怎么维护三个开源项目
**UP**：另一个人
**播放量**：3.1万
**为什么值得**：时间分配讲得很具体。
`

const FAILED_REPORT = `# 刷B站 · 2026-11-20

这一轮没跑成：退出码 1，没生成正常报告。
`

export async function run() {
  section('工具：只读数据面')

  await withTemp('tools', async (dir) => {
    const home = path.join(dir, 'dsh-home')
    await mkdir(path.join(home, 'bili-duty', 'out'), { recursive: true })
    await mkdir(path.join(home, 'heartbeat-data'), { recursive: true })
    await writeFile(path.join(home, 'bili-duty', 'out', '2026-11-21.md'), REPORT, 'utf8')
    await writeFile(path.join(home, 'bili-duty', 'out', '2026-11-20.md'), FAILED_REPORT, 'utf8')
    const seeds = [
      { status: 'active', text: '看到一条讲字幕对齐的视频', at: '2026-11-21T09:00:00Z', source: 'bili' },
      { status: 'active', text: '桌面上开着一个没保存的表格', at: '2026-11-21T10:00:00Z', source: 'screen' },
      { status: 'retired', text: '已经被翻过去的一条', at: '2026-11-20T08:00:00Z', source: 'bili' },
    ].map((s) => JSON.stringify(s)).join('\n') + '\n'
    await writeFile(path.join(home, 'heartbeat-data', 'seeds.jsonl.export.jsonl'), seeds, 'utf8')

    process.env.DSH_HOME = home
    process.env.FISH_TOOLS_NO_PROJECT = '1'

    const { apply } = await import(pathToFileURL(path.join(REPO, 'lib', 'index.js')).href + '?t=' + Date.now())
    const { ctx, tools, routes } = fakeCtx()
    apply(ctx)

    ok(typeof tools.bili_report?.execute === 'function', 'bili_report 已注册')
    ok(typeof tools.heartbeat_seeds?.execute === 'function', 'heartbeat_seeds 已注册')

    section('工具：bili_report')
    const good = JSON.parse((await tools.bili_report.execute({ date: '2026-11-21' })).message)
    eq(good.kind, 'fact', '正常报告 → fact 级素材')
    eq(good.source, 'bili-scroll', '来源登记成 bili-scroll')
    eq(good.facts.length, 2, '两条视频两条可核对项')
    eq(good.quotes.length, 2, '标题原文各算一句原话')
    ok(good.facts.every((f) => String(f.url).includes('bilibili.com/video/')), '每条 fact 都带可核对链接')
    ok(good.quotes.every((q) => !String(q.text).includes('实测数据')), '「为什么值得」这类判断没混进原话')

    const failed = await tools.bili_report.execute({ date: '2026-11-20' })
    ok(failed.ok === true && typeof failed.message === 'string' && failed.message.includes('2026-11-20'), '失败跑的报告退成普通文本')

    const none = await tools.bili_report.execute({ date: '2000-01-01' })
    ok(none.ok === false, '没有报告时返回 ok:false')
    includes(none.message, '还没有报告', '没有报告时给出人话说明')
    includes(none.message, '2026-11-21', '顺带列出最近几份的日期')

    const bad = await tools.bili_report.execute({ date: '2026/11/21' })
    ok(bad.ok === false, '日期格式不对时拒绝')
    includes(bad.message, 'YYYY-MM-DD', '说明正确格式')

    section('工具：heartbeat_seeds')
    const hot = await tools.heartbeat_seeds.execute({ limit: 10 })
    ok(hot.ok, '能读到素材池')
    includes(hot.message, '2 条素材', '只算 active 的（3 条里 2 条）')
    ok(!hot.message.includes('已经被翻过去'), 'retired 的不出现')
    const capped = await tools.heartbeat_seeds.execute({ limit: 1 })
    includes(capped.message, '1 条素材', 'limit 生效')

    section('路由：/state')
    const stateRoute = routes.find((r) => r.path === '/dsh-fish-tools/state')
    ok(Boolean(stateRoute), 'state 路由已挂载')
    const { status, body } = await callRoute(stateRoute)
    eq(status, 200, 'GET /state 返回 200')
    ok(body.ok === true, 'ok:true')
    eq(body.patches.length, 5, '返回五条补丁状态')
    ok(body.patches.every((p) => typeof p.state === 'string' && p.title), '每条都有状态和标题')
    eq(Object.keys(body.config.abilities).sort(), ['isolate', 'memes', 'report', 'seeds', 'speaking'], '返回能力开关')
    ok(typeof body.doctor.reports.hint === 'string', '体检带一句人类可读的结论')
    eq(body.doctor.reports.latest.date, '2026-11-21', '体检挑最新一份报告')

    const notGet = await callRoute(stateRoute, { method: 'POST' })
    eq(notGet.status, 405, '/state 只接受 GET')

    const patchRoute = routes.find((r) => r.path === '/dsh-fish-tools/patch')
    const unknown = await callRoute(patchRoute, { method: 'POST', body: { id: 'nope', action: 'apply' } })
    eq(unknown.status, 404, '未知补丁 id → 404')
    const wrongAction = await callRoute(patchRoute, { method: 'POST', body: { id: 'derive-mat-prefix', action: 'explode' } })
    eq(wrongAction.status, 400, '非法 action → 400')
  })
}
