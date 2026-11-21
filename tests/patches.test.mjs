// 五条补丁：状态判定、幂等、还原、往返一致。
// 在三个真实包的临时副本上跑 —— 补丁改的是真文件，测试不能动真文件。

import { cp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { allPatches, applyPatch, patchStatus, revertPatch, resolveFile, sha256 } from '../lib/patches.js'
import { PROFILE, eq, includes, ok, section, skip, withTemp } from './helpers.mjs'

const PKGS = ['@ssamurias/dsh-fish', '@furongjun1999/dsh-memory', '@kanadego/dsh-heartbeat']

async function copyProfile(dir) {
  const missing = PKGS.filter((pkg) => !existsSync(path.join(PROFILE, 'node_modules', pkg)))
  if (missing.length) return missing
  for (const pkg of PKGS) {
    await cp(path.join(PROFILE, 'node_modules', pkg), path.join(dir, 'node_modules', pkg), { recursive: true })
  }
  return []
}

export async function run() {
  section('补丁：真实 profile 的状态（只读）')
  const patches = allPatches()
  eq(patches.length, 5, '补丁定义 5 条')
  for (const p of patches) {
    const st = patchStatus(PROFILE, p)
    ok(st.state === 'applied', `${p.id} 在真实 profile 上是 applied`, `实际 ${st.state}（${st.file}）`)
  }

  await withTemp('patches', async (dir) => {
    section('补丁：在副本上往返')
    const absent = await copyProfile(dir)
    if (absent.length) {
      skip('补丁副本用例', `profile 里没装 ${absent.join(' / ')}`)
      return
    }

    for (const p of patches) {
      const file = resolveFile(dir, p)
      if (!existsSync(file)) { ok(false, `${p.id} 副本缺文件`); continue }

      const before = await readFile(file, 'utf8')
      ok(before.includes(p.marker), `${p.id} 副本已含标记`)

      const twice = applyPatch(dir, p)
      ok(twice.ok && twice.changed === false, `${p.id} 重复 apply 是空操作（幂等）`, JSON.stringify(twice))

      const rev = revertPatch(dir, p, sha256(before))
      ok(rev.ok, `${p.id} 带 hash 还原成功`, rev.error ?? '')
      eq(patchStatus(dir, p).state, 'clean', `${p.id} 还原后状态 clean`)

      const again = applyPatch(dir, p)
      ok(again.ok && again.changed, `${p.id} 再打一次成功`, again.error ?? '')
      const after = await readFile(file, 'utf8')
      ok(after === before, `${p.id} 再打后与原来逐字节一致`)
    }

    section('补丁：不带 hash 的还原（走备份或逆向）')
    for (const p of patches) {
      const rev = revertPatch(dir, p, undefined)
      ok(rev.ok, `${p.id} 无 hash 也能还原`, rev.error ?? '')
      ok(!(await readFile(resolveFile(dir, p), 'utf8')).includes(p.marker), `${p.id} 还原后标记消失`)
      const re = applyPatch(dir, p)
      ok(re.ok, `${p.id} 还原后再打回来`, re.error ?? '')
    }

    section('补丁：异常输入')
    const missing = patchStatus(dir, { ...patches[0], file: ['nope', 'missing.js'] })
    eq(missing.state, 'missing', '文件不存在 → missing')

    // 造一个「既没标记、锚点也对不上」的文件 → drift（版本变了，不该让用户点应用）
    const driftFile = path.join(dir, 'drift.js')
    await writeFile(driftFile, 'export const x = 1\n', 'utf8')
    const driftPatch = { ...patches[2], file: ['..', 'drift.js'], marker: 'SOMETHING_ABSENT' }
    const st = patchStatus(dir, driftPatch)
    eq(st.state, 'drift', '锚点缺失且无标记 → drift')

    const badApply = applyPatch(dir, driftPatch)
    ok(!badApply.ok, '锚点对不上时拒绝应用')
    includes(badApply.error, '锚点', '错误信息说明是锚点问题')
    eq(await readFile(driftFile, 'utf8'), 'export const x = 1\n', '拒绝应用时文件没被改')
  })
}
