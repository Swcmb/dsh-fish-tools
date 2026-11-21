/**
 * dsh-fish-tools — 大肥鱼集成的单一入口
 *
 * 它替原先散落的三件东西承担全部职责：
 *   1. 两个只读工具（bili_report / heartbeat_seeds）
 *   2. 三家插件的能力开关投影（fish 白名单、speak-up 总开关、心跳额度）
 *   3. 三处第三方补丁的应用 / 还原（改别人的包，见 lib/patches.js）
 * 外加一套设置界面（lib/client.js）。
 *
 * 设计原则：
 *   - 所有写入都是幂等的：同样的开关点两次，文件内容不变
 *   - 只改自己管的键：改前把原值记进 managed{}，还原时按原值写回
 *   - 补丁绝不静默：状态、失败原因都返回给界面
 */

import { readFile, writeFile, readdir, mkdir, appendFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { allPatches, applyPatch, patchStatus, revertPatch } from './patches.js'

export const name = 'dsh-fish-tools'
// webServer 必须在这里声明：声明之后 apply 会等它可用，然后直接用 ctx.webServer.register
export const inject = ['tools', 'webServer']

const ROUTE = '/dsh-fish-tools'
const BV_RE = /^###\s*(BV[0-9A-Za-z]{10})\s*$/

function dshHome() {
  const explicit = process.env.DSH_HOME
  if (explicit && explicit.trim()) return explicit.trim()
  return path.join(homedir(), '.dsh')
}

function profileDir() {
  const explicit = process.env.DSH_PROFILE_DIR
  if (explicit && explicit.trim()) return explicit.trim()
  return path.join(dshHome(), 'profiles', 'desktop')
}

const configFile = () => path.join(dshHome(), 'dsh-fish-tools', 'config.json')

/** 一行式加载日志：插件没出现在界面上时，先看这里判断是没加载还是没挂上。 */
function markLoad(line) {
  const dir = path.join(dshHome(), 'logs')
  void mkdir(dir, { recursive: true })
    .then(() => appendFile(path.join(dir, 'dsh-fish-tools.log'), `${new Date().toISOString()} ${line}\n`, 'utf8'))
    .catch(() => {})
}

markLoad('module loaded')
const fishConfigFile = () => path.join(homedir(), '.dsh-fish', 'config.json')
const fishHome = () => path.join(homedir(), '.dsh-fish')

const DEFAULTS = {
  abilities: { memes: true, report: true, seeds: true, isolate: true, speaking: 'fish' },
  tools: {
    allow: ['learn_meme', 'meme_list', 'meme_update', 'send_meme', 'bili_report', 'heartbeat_seeds', 'cg', 'mdcg_recall', 'lingshu_cg', 'lingshu_mdcg_recall'],
    sources: [{ name: 'bili-scroll', kind: 'fact', tool: 'bili_report' }],
  },
  managed: {},
  patches: {},
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

async function loadConfig() {
  const saved = await readJson(configFile(), null)
  return {
    ...DEFAULTS,
    ...(saved ?? {}),
    abilities: { ...DEFAULTS.abilities, ...(saved?.abilities ?? {}) },
    tools: { ...DEFAULTS.tools, ...(saved?.tools ?? {}) },
    managed: { ...(saved?.managed ?? {}) },
    patches: { ...(saved?.patches ?? {}) },
  }
}

const saveConfig = (cfg) => writeJson(configFile(), cfg)

// ── 投影：把开关写进三家 ────────────────────────────────────────────────

/**
 * 每个能力对应哪些工具。开关真正生效就靠这张表：
 * 关掉一个能力 = 把它的工具从白名单里摘掉（fish 的 restrict 会拒掉未放行的工具）。
 */
const ABILITY_TOOLS = {
  memes: ['learn_meme', 'meme_list', 'meme_update', 'send_meme'],
  report: ['bili_report'],
  seeds: ['heartbeat_seeds'],
}

/** 按能力开关重算白名单：显式编辑过的其它工具保留，只增删这三组。 */
function applyAbilityTools(cfg) {
  const abilitySet = new Set(Object.values(ABILITY_TOOLS).flat())
  const keep = cfg.tools.allow.filter((t) => !abilitySet.has(t))
  const on = Object.entries(ABILITY_TOOLS)
    .filter(([key]) => cfg.abilities[key])
    .flatMap(([, tools]) => tools)
  const next = [...keep]
  for (const tool of on) if (!next.includes(tool)) next.push(tool)
  cfg.tools.allow = next

  // 来源跟着「B 站报告」走：关掉就不该再登记
  const hasBili = cfg.tools.sources.some((s) => s.name === 'bili-scroll')
  if (cfg.abilities.report && !hasBili) {
    cfg.tools.sources.push({ name: 'bili-scroll', kind: 'fact', tool: 'bili_report' })
  }
  if (!cfg.abilities.report) {
    cfg.tools.sources = cfg.tools.sources.filter((s) => s.name !== 'bili-scroll')
  }
}

async function projectFish(cfg) {
  const file = fishConfigFile()
  const cur = await readJson(file, null)
  if (!cur) return { ok: false, error: `找不到 ${file}` }
  if (cfg.managed.fishTools === undefined) cfg.managed.fishTools = JSON.parse(JSON.stringify(cur.tools ?? {}))
  applyAbilityTools(cfg)
  cur.tools = { ...(cur.tools ?? {}), restrict: true, allow: cfg.tools.allow, sources: cfg.tools.sources }
  await writeJson(file, cur)
  return { ok: true }
}

async function projectSpeakUp(cfg) {
  const file = path.join(dshHome(), 'speak-up-config.json')
  const cur = await readJson(file, null)
  if (!cur) return { ok: false, error: `找不到 ${file}（没装 speak-up？）` }
  if (cfg.managed.speakUp === undefined) cfg.managed.speakUp = cur['总开关']
  // 同一时刻只允许一个大脑开口：这个插件一律闭嘴，开口交给 abilities.speaking
  cur['总开关'] = false
  await writeJson(file, cur)
  return { ok: true }
}

async function projectHeartbeat(cfg) {
  const file = path.join(dshHome(), 'heartbeat-data', 'settings', 'policy.json')
  const cur = await readJson(file, {})
  if (cfg.managed.heartbeatCap === undefined) cfg.managed.heartbeatCap = cur?.gate?.maxDailySend ?? 10
  // 只采集不开口：额度 0。采集与闲逛都在闸门之前，所以素材照攒。
  cur.gate = { ...(cur.gate ?? {}), maxDailySend: cfg.abilities.seeds ? 0 : cfg.managed.heartbeatCap }
  await writeJson(file, cur)
  return { ok: true }
}

async function projectAll(cfg) {
  const results = {
    fish: await projectFish(cfg),
    speakUp: await projectSpeakUp(cfg),
    heartbeat: await projectHeartbeat(cfg),
  }
  await saveConfig(cfg)
  return results
}

// ── 两个只读工具 ────────────────────────────────────────────────────────

function todayKey() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function biliDirs() {
  const list = [path.join(dshHome(), 'bili-duty', 'out')]
  const fallback = path.join(homedir(), '.dsh', 'bili-duty', 'out')
  if (fallback !== list[0]) list.push(fallback)
  return list
}

async function loadReport(date) {
  for (const dir of biliDirs()) {
    const file = path.join(dir, `${date}.md`)
    try {
      const text = await readFile(file, 'utf8')
      if (text.trim()) return { text, file }
    } catch { /* 下一个候选 */ }
  }
  return null
}

async function reportDates(limit = 5) {
  const out = []
  for (const dir of biliDirs()) {
    try {
      for (const n of await readdir(dir)) {
        const m = /^(\d{4}-\d{2}-\d{2})\.md$/.exec(n)
        if (m) out.push(m[1])
      }
    } catch { /* 目录不存在 */ }
  }
  return [...new Set(out)].sort().reverse().slice(0, limit)
}

function toMaterial(date, text) {
  const blocks = []
  let current = null
  for (const line of text.split(/\r?\n/)) {
    const hit = BV_RE.exec(line.trim())
    if (hit) { current = { bvid: hit[1], body: [] }; blocks.push(current); continue }
    if (current) current.body.push(line)
  }
  const field = (block, name) => {
    const re = new RegExp(`\\*\\*${name}\\*\\*\\s*[：:]\\s*(.+)`)
    for (const line of block.body) {
      const hit = re.exec(line.trim())
      if (hit) return hit[1].trim()
    }
    return ''
  }
  const facts = []
  const quotes = []
  for (const b of blocks.slice(0, 20)) {
    const url = `https://www.bilibili.com/video/${b.bvid}`
    const title = field(b, '标题')
    const up = field(b, 'UP')
    const play = field(b, '播放量')
    facts.push({
      label: b.bvid,
      value: [title, up && `UP：${up}`, play && `播放量：${play}`].filter(Boolean).join(' · ').slice(0, 500) || '（报告未写标题）',
      url,
    })
    // 标题是平台原文 → 真原话；「为什么值得」是模型的判断，故意不进 quotes
    if (title) quotes.push({ text: title.slice(0, 500), kind: 'title', by: up ? `UP主：${up}` : 'B站视频标题' })
  }
  if (!facts.length) return null
  return {
    dshFishMaterial: 1,
    source: 'bili-scroll',
    kind: 'fact',
    key: `${date}:${blocks.map((b) => b.bvid).join('+')}`.slice(0, 200),
    at: date,
    title: `B站值班报告 ${date}`,
    body: text.slice(0, 20000),
    facts,
    quotes: quotes.slice(0, 20),
  }
}

async function seedsFile() {
  const list = [path.join(dshHome(), 'heartbeat-data', 'seeds.jsonl.export.jsonl')]
  const fallback = path.join(homedir(), '.dsh', 'heartbeat-data', 'seeds.jsonl.export.jsonl')
  if (fallback !== list[0]) list.push(fallback)
  for (const p of list) if (existsSync(p)) return p
  return null
}

async function loadSeeds(limit) {
  const file = await seedsFile()
  if (!file) return null
  const rows = []
  for (const line of (await readFile(file, 'utf8')).split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    try {
      const ev = JSON.parse(t)
      if (ev && ev.status === 'active' && typeof ev.text === 'string') rows.push(ev)
    } catch { /* 坏行 */ }
  }
  return rows.slice(-limit).reverse()
}

/**
 * 工具的 output 必须是合法 JSON Schema（宿主用 ajv 校验）：
 * `{ type: 'json' }` 会被拒（unsupported JSON schema: schema.type must be one of ...）。
 * 返回体是自由结构，所以用 object + additionalProperties。
 */
const TEXT_OUTPUT = {
  schema: { type: 'object', properties: {}, additionalProperties: true },
  render: (_args, value) => [{
    type: 'text',
    text: typeof value === 'string' ? value : String(value?.message ?? JSON.stringify(value)),
  }],
}

/** 简写参数表 → JSON Schema。带 required: true 的字段进 required 数组。 */
function paramsSchema(fields) {
  const properties = {}
  const required = []
  for (const [key, spec] of Object.entries(fields ?? {})) {
    const { required: isRequired, ...rest } = spec ?? {}
    properties[key] = rest
    if (isRequired) required.push(key)
  }
  const schema = { type: 'object', properties }
  if (required.length) schema.required = required
  return schema
}

function registerTools(ctx) {
  ctx.tools.register({
    name: 'bili_report',
    description:
      '读“刷B站”值班报告（只读）。它每天替你搜、读字幕判过一遍，写一份报告在 out/<日期>.md。' +
      '返回一条 dshFishMaterial(fact) JSON：facts 是每条视频的 BV 号与链接（可核对），quotes 是标题原文。' +
      '想知道今天/某天外面有什么值得看时用；没有报告时返回一句说明，不会报错。',
    parameters: paramsSchema({ date: { type: 'string', description: '日期 YYYY-MM-DD，不填=今天' } }),
    output: TEXT_OUTPUT,
    async execute(args) {
      const date = String(args?.date ?? '').trim() || todayKey()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, message: `日期格式要 YYYY-MM-DD，收到的是 ${date}` }
      const report = await loadReport(date)
      if (!report) {
        const recent = await reportDates(3)
        return { ok: false, message: recent.length ? `${date} 还没有报告。最近几份是：${recent.join('、')}` : `${date} 还没有报告，而且一份都还没生成过。` }
      }
      const material = toMaterial(date, report.text)
      if (!material) return { ok: true, message: report.text.slice(0, 20000) }
      return { ok: true, message: JSON.stringify(material) }
    },
  })

  ctx.tools.register({
    name: 'heartbeat_seeds',
    description:
      '读心跳插件攒下来的素材池（只读，普通文本）。它在你不在时截屏、看绑定会话、刷 B 站，攒成“种子”。' +
      '想参考“你不在的时候我看到什么”时用；它不开口，只有你主动读才看得到。',
    parameters: paramsSchema({ limit: { type: 'number', description: '最多读几条（默认 20，最大 100）' } }),
    output: TEXT_OUTPUT,
    async execute(args) {
      const limit = Math.max(1, Math.min(100, Math.floor(Number(args?.limit) || 20)))
      const rows = await loadSeeds(limit)
      if (!rows) return { ok: false, message: '还没有素材镜像（心跳的 seeds 导出还没生成过）。' }
      if (!rows.length) return { ok: false, message: '素材池现在是空的。' }
      const lines = rows.map((s, i) => {
        const at = String(s.at ?? s.createdAt ?? '').slice(0, 16).replace('T', ' ')
        const src = s.source ?? s.origin ?? '?'
        const cat = s.category ?? s.tag ?? ''
        return `${i + 1}. [${src}${cat ? '/' + cat : ''}] ${at} ${String(s.text).slice(0, 200)}`
      })
      return { ok: true, message: `${rows.length} 条素材：\n${lines.join('\n')}` }
    },
  })
}

// ── 体检 ────────────────────────────────────────────────────────────────

async function doctor(cfg) {
  const dates = await reportDates(5)
  let latest = null
  if (dates.length) {
    const r = await loadReport(dates[0])
    if (r) {
      // 「几条视频」不够：真正决定能不能进素材统计的是「有没有 BV 号 + 标题原文」。
      // 直接拿 toMaterial 试一遍，比让用户猜为什么 mat: 是 0 强。
      const m = toMaterial(dates[0], r.text)
      latest = {
        date: dates[0],
        videos: (r.text.match(/^###\s*BV/gm) ?? []).length,
        bytes: r.text.length,
        materialReady: Boolean(m && m.quotes.length),
        facts: m?.facts.length ?? 0,
        quotes: m?.quotes.length ?? 0,
      }
    }
  }
  const seeds = await loadSeeds(1000)
  let matLines = 0
  try {
    const raw = await readFile(path.join(fishHome(), 'events.jsonl'), 'utf8')
    for (const line of raw.split(/\r?\n/)) if (line.includes('"mat:')) matLines++
  } catch { /* 没有账本 */ }
  const materialHint = !latest
    ? '还没有报告，bili_report 现在只会回一句说明'
    : latest.materialReady
      ? `能产出事实级素材：${latest.facts} 条可核对项、${latest.quotes} 句原话`
      : '这份报告没有 BV 号或标题，只能当普通文本读（不会写 mat: 行）'
  return {
    reports: { dates, latest, hint: materialHint },
    seeds: { count: seeds?.length ?? 0, file: await seedsFile() },
    matLines,
    allow: cfg.tools.allow,
    dshHome: dshHome(),
    profileDir: profileDir(),
  }
}

// ── 路由 ────────────────────────────────────────────────────────────────

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

function registerRoutes(ctx) {
  const dir = profileDir()
  const patches = allPatches()

  const routes = [
    {
      kind: 'exact',
      path: `${ROUTE}/state`,
      handler: async (req, res) => {
        if (req.method !== 'GET') return json(res, 405, { error: 'GET only' })
        const cfg = await loadConfig()
        json(res, 200, {
          ok: true,
          config: cfg,
          patches: patches.map((p) => ({ ...patchStatus(dir, p), title: p.title, why: p.why })),
          doctor: await doctor(cfg),
        })
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE}/save`,
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' })
        const body = await readBody(req)
        const cfg = await loadConfig()
        if (body?.abilities) cfg.abilities = { ...cfg.abilities, ...body.abilities }
        if (Array.isArray(body?.allow)) cfg.tools.allow = body.allow.map(String).map((s) => s.trim()).filter(Boolean)
        if (Array.isArray(body?.sources)) {
          cfg.tools.sources = body.sources
            .filter((s) => s && s.name && s.tool)
            .map((s) => ({
              name: String(s.name),
              kind: ['fact', 'opinion', 'fiction'].includes(s.kind) ? s.kind : 'opinion',
              tool: String(s.tool),
            }))
        }
        const wantIsolate = body?.abilities?.isolate
        const projected = await projectAll(cfg)

        // 「灵枢隔离」不只是个开关：它对应 lingshu-isolation 这条补丁。
        // 打开就补上、关掉就还原；改过文件就提示重启。
        const isolatePatch = patches.find((p) => p.id === 'lingshu-isolation')
        if (typeof wantIsolate === 'boolean' && isolatePatch) {
          const state = patchStatus(dir, isolatePatch).state
          if (wantIsolate && state === 'clean') {
            const r = applyPatch(dir, isolatePatch)
            if (r.ok && r.hash) { cfg.patches[isolatePatch.id] = r.hash; await saveConfig(cfg) }
            projected.isolate = r
          } else if (!wantIsolate && state === 'applied') {
            const r = revertPatch(dir, isolatePatch, cfg.patches[isolatePatch.id])
            if (r.ok) { delete cfg.patches[isolatePatch.id]; await saveConfig(cfg) }
            projected.isolate = r
          } else {
            projected.isolate = { ok: true, changed: false }
          }
        }

        json(res, 200, { ok: true, projected, restart: Boolean(projected.isolate?.changed) })
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE}/patch`,
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' })
        const body = await readBody(req)
        const patch = patches.find((p) => p.id === body?.id)
        if (!patch) return json(res, 404, { ok: false, error: `未知补丁：${body?.id}` })
        const cfg = await loadConfig()
        if (body?.action === 'apply') {
          const r = applyPatch(dir, patch)
          if (r.ok && r.hash) {
            cfg.patches[patch.id] = r.hash
            await saveConfig(cfg)
          }
          return json(res, r.ok ? 200 : 500, { ...r, status: patchStatus(dir, patch), restart: Boolean(r.ok && r.changed) })
        }
        if (body?.action === 'revert') {
          const r = revertPatch(dir, patch, cfg.patches[patch.id])
          if (r.ok) {
            delete cfg.patches[patch.id]
            await saveConfig(cfg)
          }
          return json(res, r.ok ? 200 : 500, { ...r, status: patchStatus(dir, patch), restart: Boolean(r.ok && r.changed) })
        }
        return json(res, 400, { ok: false, error: 'action 只能是 apply / revert' })
      },
    },
  ]

  for (const route of routes) ctx.webServer.register(route)
  markLoad(`routes mounted: ${routes.length}`)
}

export function apply(ctx) {
  markLoad('apply called')
  try {
    registerTools(ctx)
    markLoad('tools registered: 2')
  } catch (e) {
    markLoad(`tools register failed: ${String(e?.message ?? e).slice(0, 300)}`)
  }
  try {
    registerRoutes(ctx)
  } catch (e) {
    markLoad(`routes mount failed: ${String(e?.message ?? e).slice(0, 300)}`)
  }
  // 启动时做一次幂等投影：把开关同步到三家（不碰补丁）
  void loadConfig()
    .then((cfg) => projectAll(cfg))
    .then((r) => markLoad(`projected: ${JSON.stringify(r).slice(0, 300)}`))
    .catch((e) => markLoad(`project failed: ${String(e?.message ?? e).slice(0, 300)}`))
}
