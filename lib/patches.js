/**
 * 三处第三方补丁的定义。
 *
 * 为什么需要：这三件事都发生在别人的包内部（灵枢的 hook、心跳的落盘、大肥鱼的
 * 事件监听），插件在运行时够不到那里，只能改文件。所以这里把改动写成数据：
 *   apply   —— 一组 find/replace，加上可选的 append（要插入新代码块时用）
 *   marker  —— 打完补丁后文件里必然出现的一小段唯一样本
 *   verify  —— 打完必须仍能被 Node 加载，否则整条回滚
 *
 * 安全性靠三条：
 *   1. marker 已存在 → 视为已应用，直接跳过（幂等，跑一百次也一样）
 *   2. 应用前把原文件存成 .bak-hub；应用后记下写入内容的 sha256
 *   3. 还原只在「当前内容 sha256 === 我们写入的那份」时执行 —— 用户后来手改过
 *      就拒绝覆盖，宁可让他自己处理，也不悄悄冲掉别人的修改
 */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const PATCHES = [
  {
    id: 'lingshu-isolation',
    title: '灵枢：隔离大肥鱼的会话',
    why: '她的会话既不写进灵枢的库，也不注入灵枢的记忆块。取不到判据时不过滤，避免误伤你的会话。',
    file: ['@furongjun1999', 'dsh-memory', 'lib', 'hooks.js'],
    marker: '__isFishSession',
    ops: [
      {
        find: "import { HookAuditRecorder, kindOf } from './lib/hook_audit.js';",
        replace:
          "import { HookAuditRecorder, kindOf } from './lib/hook_audit.js';\n" +
          "// fish-tools 补丁：隔离判据需要读 home.json\n" +
          "import fs from 'node:fs';\nimport os from 'node:os';\nimport pathMod from 'node:path';",
      },
      {
        find: "            audit.filtered('subagent');\n            return;\n        }\n",
        replace:
          "            audit.filtered('subagent');\n            return;\n        }\n" +
          "        // fish-tools 补丁：与大肥鱼的人格记忆完全隔离（不写库）\n" +
          "        if (__isFishSession(session)) {\n" +
          "            ctx.logger.info('dsh-memory: 大肥鱼的会话被隔离（不写库）');\n" +
          "            audit.filtered('session_excluded');\n" +
          "            return;\n        }\n",
      },
      {
        find: "        ctx.on('system-prompt/assemble', async (assembly, _ctx, next) => {\n            try {\n",
        replace:
          "        ctx.on('system-prompt/assemble', async (assembly, _ctx, next) => {\n            try {\n" +
          "                // fish-tools 补丁：她的会话不注入灵枢的记忆块（waterfall 必须 next）\n" +
          "                if (__isFishSession(_ctx?.agent?.session)) return next();\n",
      },
    ],
    append: String.raw`

// ---------------------------------------------------------------------------
// fish-tools 补丁：与大肥鱼（@ssamurias/dsh-fish）完全隔离
// 判据：会话工作目录在 .dsh-fish 下，或会话 id 等于 ~/.dsh-fish/home.json 的 sessionId
// ---------------------------------------------------------------------------
function __isFishSession(session) {
  try {
    const cwd = String(session?.header?.cwd ?? session?.cwd ?? '');
    if (cwd) {
      const norm = cwd.replace(/\\/g, '/').toLowerCase();
      if (norm.includes('/.dsh-fish/') || norm.endsWith('/.dsh-fish')) return true;
    }
    const id = String(session?.header?.id ?? session?.id ?? '');
    if (!id) return false;
    const home = pathMod.join(os.homedir(), '.dsh-fish', 'home.json');
    const parsed = JSON.parse(fs.readFileSync(home, 'utf8'));
    return Boolean(parsed && String(parsed.sessionId) === id);
  } catch {
    return false;
  }
}
`,
  },
  {
    id: 'heartbeat-seed-mirror',
    title: '心跳：素材池明文镜像',
    why: '它采到的东西原本只落在加密库里，外面读不到。这里在加密写入之后多落一份明文，供 heartbeat_seeds 只读消费。',
    file: ['@kanadego', 'dsh-heartbeat', 'dist', 'chunk-QOLKUYQ3.js'],
    marker: '.export.jsonl',
    ops: [
      {
        find: 'import path from "path";',
        replace: 'import path from "path";\n// fish-tools 补丁：seeds 明文镜像需要写盘\nimport fs from "node:fs";',
      },
      {
        find: '  saveEncryptedText(guard, file, body ? body + "\\n" : "");\n}',
        replace:
          '  saveEncryptedText(guard, file, body ? body + "\\n" : "");\n' +
          '  // fish-tools 补丁：额外落一份明文镜像（写失败不影响心跳本身）\n' +
          '  try { fs.writeFileSync(file + ".export.jsonl", body ? body + "\\n" : ""); } catch {}\n}',
      },
    ],
  },
  {
    id: 'fish-material-ingest',
    title: '大肥鱼：第三方素材收口',
    why: '1.0.6 有解析器却没有调用点。这里认领 tools.sources 里登记的工具结果，写成 mat:<source>:<key> 索引行；顺带放宽 derive/recall 两处只认 mat:bili: 的判定。',
    file: ['@ssamurias', 'dsh-fish', 'lib', 'turns.js'],
    marker: 'ingestThirdPartyMaterial',
    ops: [
      {
        find: "import { HER_TYPES, normalizeScene } from './schema.js'",
        replace:
          "import { HER_TYPES, normalizeScene } from './schema.js'\n" +
          "// fish-tools 补丁：第三方素材收口\n" +
          "import { allSources, sourceMaterial } from './sources.js'",
      },
      {
        find: "      const type = String(event?.type ?? '')\n",
        replace:
          "      const type = String(event?.type ?? '')\n" +
          "      // fish-tools 补丁：把登记过的第三方工具结果认领成素材\n" +
          "      if (type === 'tool/call' || type === 'tool/result') {\n" +
          "        // 监听器是同步的：这个函数是 async，必须自己吞掉 rejection\n" +
          "        void ingestThirdPartyMaterial(event, type).catch(() => {})\n" +
          "      }\n",
      },
    ],
    append: String.raw`

// ---------------------------------------------------------------------------
// fish-tools 补丁：第三方素材收口
// 索引行形状照 material.js：mat:<source>:<key> {t,d,q,f}
// ---------------------------------------------------------------------------
const __matCallNames = new Map()
const __matKeys = new Set()
let __matKeysLoaded = false

async function __matKnownKeys() {
  if (__matKeysLoaded) return
  __matKeysLoaded = true
  try {
    const { events } = await readEvents(rootDir())
    for (const ev of events) {
      const text = typeof ev?.text === 'string' ? ev.text : ''
      if (ev?.type === 'meta' && text.startsWith('mat:')) __matKeys.add(text)
    }
  } catch { /* 读不到就当没有 */ }
}

async function ingestThirdPartyMaterial(event, type) {
  const data = event?.data
  if (type === 'tool/call') {
    if (data?.callId && data?.name) {
      __matCallNames.set(String(data.callId), String(data.name))
      if (__matCallNames.size > 500) __matCallNames.delete(__matCallNames.keys().next().value)
    }
    return
  }
  const msg = data?.message
  if (!msg || msg.isError) return
  const toolName = __matCallNames.get(String(msg.toolCallId ?? msg.source?.callId ?? ''))
  if (!toolName) return
  // 两处容易写错，都踩过：
  //   ① loadConfig 的签名是 loadConfig(root)，而且是 async —— 不 await 拿到的是 Promise，
  //      allSources(Promise) 会退成只剩内置的 bili（tool 为空），于是永远匹配不上。
  //   ② 来源登记的匹配键是 tool 字段（{name:'bili-scroll',tool:'bili_report'}），
  //      不是 name。findSource(sources, name) 按 name 找，用它找工具名必然失败。
  let entry = null
  try {
    const { config } = await loadConfig(rootDir())
    entry = allSources(config).find((s) => String(s?.tool ?? '') === toolName) ?? null
  } catch {
    return
  }
  if (!entry) return
  const text = (Array.isArray(msg.content) ? msg.content : [])
    .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n')
  if (!text.trim()) return
  const material = sourceMaterial(text, { name: entry.name, kind: entry.kind })
  if (!material) return
  const payload = {
    t: String(material.title ?? '').slice(0, 120),
    d: String(material.at ?? '').slice(0, 10),
    q: (Array.isArray(material.quotes) ? material.quotes : [])
      .filter((q) => String(q?.text ?? '').trim()).slice(0, 3)
      .map((q) => ({ b: String(q.by ?? ''), x: String(q.text).slice(0, 120) })),
    f: (Array.isArray(material.facts) ? material.facts : []).slice(0, 20)
      .map((f) => ({ l: String(f.label ?? ''), v: String(f.value ?? '').slice(0, 200), u: String(f.url ?? '') })),
  }
  if (!payload.q.length) return
  // 用拼接而不是模板字符串：这段代码本身装在 String.raw 模板里，反引号会把外层截断
  const line = ('mat:' + entry.name + ':' + material.key + ' ' + JSON.stringify(payload)).slice(0, 2000)
  await __matKnownKeys()
  if (__matKeys.has(line)) return
  __matKeys.add(line)
  await appendEvent({ type: 'meta', text: line }, { day: 0, stage: 1, source: 'system' })
}
`,
  },
]

/** 追加补丁：derive.js / recall.js 只认 mat:bili: 的两处判定 */
export const PREFIX_PATCHES = [
  {
    id: 'derive-mat-prefix',
    title: '派生：放宽素材索引前缀',
    why: 'derive.js 原本写死 mat:bili:，第三方来源的索引行永远进不了素材统计。',
    file: ['@ssamurias', 'dsh-fish', 'lib', 'derive.js'],
    marker: 'mat:<source>:<key>',
    ops: [
      {
        find:
          "    if (!text.startsWith('mat:bili:')) continue\n" +
          '    const rest = text.slice(9).trim()\n' +
          "    const sp = rest.indexOf(' ')\n" +
          '    if (sp <= 0) continue\n' +
          '    const key = rest.slice(0, sp)\n' +
          '    let payload = null\n' +
          "    try { payload = JSON.parse(rest.slice(sp + 1)) } catch { continue }",
        replace:
          '    // fish-tools 补丁：接受 mat:<source>:<key>（第三方来源）\n' +
          "    const head = /^mat:([a-z0-9-]+):(\\S+)\\s+(\\{[\\s\\S]*\\})$/.exec(text)\n" +
          '    if (!head) continue\n' +
          '    const key = `${head[1]}:${head[2]}`\n' +
          '    let payload = null\n' +
          '    try { payload = JSON.parse(head[3]) } catch { continue }',
      },
    ],
  },
  {
    id: 'recall-mat-prefix',
    title: '回翻：放宽素材索引前缀',
    why: 'recall.js 的正则同样写死 mat:bili:，导致第三方素材回翻不到。',
    file: ['@ssamurias', 'dsh-fish', 'lib', 'recall.js'],
    // marker 必须是补丁真正写进文件的东西：这里用放宽后的正则首段，而不是一句注释
    marker: 'MAT_LINE = /^mat:([a-z0-9-]+):',
    ops: [
      {
        find: "export const MAT_LINE = /^mat:bili:(\\S+)\\s+(\\{[\\s\\S]*\\}$)/",
        replace:
          "// fish-tools 补丁：key 带来源前缀，第三方来源也能回翻\n" +
          'export const MAT_LINE = /^mat:([a-z0-9-]+):(\\S+)\\s+(\\{[\\s\\S]*\\}$)/',
      },
      {
        find: '    const payload = JSON.parse(m[2])',
        replace: '    const payload = JSON.parse(m[3])',
      },
      {
        find: '      bvid: m[1],',
        replace: '      bvid: `${m[1]}:${m[2]}`,',
      },
    ],
  },
]

export function allPatches() {
  return [...PATCHES, ...PREFIX_PATCHES]
}

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function resolveFile(profileDir, patch) {
  return path.join(profileDir, 'node_modules', ...patch.file)
}

/** 读当前状态：missing / applied / clean / drift（标记不在且锚点也缺 → 版本变了） */
export function patchStatus(profileDir, patch) {
  const file = resolveFile(profileDir, patch)
  if (!existsSync(file)) return { id: patch.id, state: 'missing', file }
  const text = readFileSync(file, 'utf8')

  // 判定只看 marker：我们所有的 replace 都是「锚点原文 + 追加」，打完锚点仍然在文件里，
  // 所以「锚点还在」不能当作「没打」。marker 是补丁独有的样本，只有它有判定力。
  if (text.includes(patch.marker)) return { id: patch.id, state: 'applied', file }

  // 没打：锚点缺任何一条，说明这个包的版本变了，我们的 find 不可信，别让用户点应用。
  const anchors = (patch.ops ?? []).filter((op) => !op.skipIfMissing)
  const missing = anchors.filter((op) => !text.includes(op.find)).length
  return { id: patch.id, state: missing ? 'drift' : 'clean', file, total: anchors.length, missing }
}

function verifyLoadable(file) {
  execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    `import(${JSON.stringify(pathToFileURL(file).href)}).then(()=>process.exit(0)).catch((e)=>{console.error(e.message);process.exit(1)})`,
  ], { stdio: 'pipe', timeout: 30_000 })
}

export function applyPatch(profileDir, patch) {
  const file = resolveFile(profileDir, patch)
  if (!existsSync(file)) return { ok: false, error: `文件不存在：${file}` }
  const before = readFileSync(file, 'utf8')
  if (before.includes(patch.marker)) return { ok: true, changed: false }

  let next = before
  const applied = []
  for (const op of patch.ops ?? []) {
    if (!next.includes(op.find)) {
      if (op.skipIfMissing) continue
      return { ok: false, error: `锚点没匹配上（可能版本变了）：${patch.id}` }
    }
    next = next.replace(op.find, op.replace)
    applied.push(op.find.slice(0, 40))
  }
  if (patch.append) next += patch.append

  copyFileSync(file, `${file}.bak-hub`)
  writeFileSync(file, next, 'utf8')
  try {
    verifyLoadable(file)
  } catch (err) {
    writeFileSync(file, before, 'utf8')
    return { ok: false, error: `打完无法加载，已回滚：${String(err.message ?? err).slice(0, 200)}` }
  }
  return { ok: true, changed: true, hash: sha256(next), ops: applied.length }
}

export function revertPatch(profileDir, patch, expectedHash) {
  const file = resolveFile(profileDir, patch)
  if (!existsSync(file)) return { ok: false, error: `文件不存在：${file}` }
  const current = readFileSync(file, 'utf8')
  if (!current.includes(patch.marker)) return { ok: true, changed: false }

  // 记过 hash 且当前内容对不上 → 打完补丁之后有人改过这个文件，宁可不解，也不冲掉别人的修改
  if (expectedHash && sha256(current) !== expectedHash) {
    return { ok: false, error: '这个文件在我们打完补丁之后又被改过，拒绝覆盖。请手动处理或重装该插件。' }
  }

  // 两条还原路径：
  //   ① 有 .bak-hub：整文件回到备份（逐字节原文，最可靠）
  //   ② 没备份（例如补丁是手动打的）：按 ops 逆向摘掉我们加的那些行，别动文件其余部分
  let next = null
  const bak = `${file}.bak-hub`
  if (existsSync(bak)) {
    next = readFileSync(bak, 'utf8')
  } else {
    next = current
    for (const op of [...(patch.ops ?? [])].reverse()) {
      if (!next.includes(op.replace)) {
        return { ok: false, error: `还原锚点没匹配上（这个文件被改过？）：${patch.id}` }
      }
      next = next.replace(op.replace, op.find)
    }
    if (patch.append && next.includes(patch.append)) next = next.split(patch.append).join('')
    if (next.includes(patch.marker)) {
      return { ok: false, error: `逆向还原后标记仍在（${patch.marker}），不敢再动。请手动处理。` }
    }
  }

  writeFileSync(file, next, 'utf8')
  try {
    verifyLoadable(file)
  } catch (err) {
    writeFileSync(file, current, 'utf8')
    return { ok: false, error: `还原后无法加载，已回滚：${String(err.message ?? err).slice(0, 200)}` }
  }
  return { ok: true, changed: true }
}
