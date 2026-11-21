// 开关 → 配置的换算规则（纯函数，不写盘）。
// 「开关是不是摆设」全靠这组兜住：之前表情包开关不影响白名单、开口归属不影响 fish。

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { REPO, eq, ok, section, withTemp } from './helpers.mjs'

const baseCfg = () => ({
  abilities: { memes: true, report: true, seeds: true, isolate: true, speaking: 'fish' },
  tools: {
    allow: ['cg', 'mdcg_recall', 'lingshu_cg', 'lingshu_mdcg_recall', 'learn_meme', 'meme_list', 'meme_update', 'send_meme', 'bili_report', 'heartbeat_seeds'],
    sources: [{ name: 'bili-scroll', kind: 'fact', tool: 'bili_report' }],
  },
  managed: {},
})

export async function run() {
  section('投影：开关换算（纯函数）')

  await withTemp('proj', async (dir) => {
    const home = path.join(dir, 'dsh-home')
    await mkdir(home, { recursive: true })
    process.env.DSH_HOME = home
    process.env.FISH_TOOLS_NO_PROJECT = '1'

    const mod = await import(pathToFileURL(path.join(REPO, 'lib', 'index.js')).href + '?p=' + Date.now())
    ok(typeof mod.applyAbilityTools === 'function', '导出 applyAbilityTools（可测）')
    ok(typeof mod.fishWake === 'function', '导出 fishWake（可测）')
    ok(typeof mod.projectHeartbeat === 'function', '导出 projectHeartbeat（可测）')

    const memesOff = baseCfg()
    memesOff.abilities.memes = false
    mod.applyAbilityTools(memesOff)
    eq(memesOff.tools.allow, ['cg', 'mdcg_recall', 'lingshu_cg', 'lingshu_mdcg_recall', 'bili_report', 'heartbeat_seeds'], '关表情包 → 四个 meme 工具被摘掉，其余保留')

    const back = baseCfg()
    mod.applyAbilityTools(back)
    eq(back.tools.allow.length, 10, '全开 → 白名单 10 项')
    ok(back.tools.sources.some((s) => s.name === 'bili-scroll'), '全开 → bili-scroll 已登记')

    const reportOff = baseCfg()
    reportOff.abilities.report = false
    mod.applyAbilityTools(reportOff)
    ok(!reportOff.tools.allow.includes('bili_report'), '关报告 → bili_report 被摘掉')
    eq(reportOff.tools.sources, [], '关报告 → 来源登记一并撤掉')

    const seedsOff = baseCfg()
    seedsOff.abilities.seeds = false
    mod.applyAbilityTools(seedsOff)
    ok(!seedsOff.tools.allow.includes('heartbeat_seeds'), '关心跳采集 → heartbeat_seeds 被摘掉')

    const custom = baseCfg()
    custom.tools.allow.push('my_custom_tool')
    custom.abilities.memes = false
    mod.applyAbilityTools(custom)
    ok(custom.tools.allow.includes('my_custom_tool'), '用户自己加的工具不会被开关误删')

    section('投影：主动开口归属')
    const managed = { wakesPerDay: 1, proactiveEnabled: true }

    const fishSpeaks = baseCfg()
    eq(mod.fishWake(fishSpeaks, managed), { wakesPerDay: 1, proactiveEnabled: true }, '选大肥鱼 → 用她原来的醒来次数与主动闸')

    const none = baseCfg()
    none.abilities.speaking = 'none'
    eq(mod.fishWake(none, managed), { wakesPerDay: 0, proactiveEnabled: false }, '选都别开口 → 0 次 + 关闸')

    const noBaseline = baseCfg()
    eq(mod.fishWake(noBaseline, {}), null, '没记录过原值且不是「都别开口」→ 不动配置')

    section('投影：心跳发送闸门')
    const hbDir = path.join(home, 'heartbeat-data', 'settings')
    await mkdir(hbDir, { recursive: true })
    const policy = path.join(hbDir, 'policy.json')
    await writeFile(policy, JSON.stringify({ gate: { maxDailySend: 7 } }), 'utf8')

    const hbOn = baseCfg()
    await mod.projectHeartbeat(hbOn)
    eq(JSON.parse(await readFile(policy, 'utf8')).gate.maxDailySend, 0, '开关开着 → 发送额度 0（只采集不开口）')
    eq(hbOn.managed.heartbeatCap, 7, '第一次投影记下原额度，便于追溯')

    const hbOff = baseCfg()
    hbOff.abilities.seeds = false
    await mod.projectHeartbeat(hbOff)
    eq(JSON.parse(await readFile(policy, 'utf8')).gate.maxDailySend, 0, '开关关掉也不放开额度（心跳没有停止采集的开关）')
  })
}
