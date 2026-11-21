// 清单与挂载：这几条正是「插件安静不生效」的根因，必须由测试盯住。
// 缺 main/exports 时宿主能列出 bundle 但不 import —— 没有测试就只能靠自觉。

import { readFile, access } from 'node:fs/promises'
import path from 'node:path'
import { REPO, eq, includes, ok, section } from './helpers.mjs'

export async function run() {
  section('清单：package.json / cordis.patch.yml')

  const pkg = JSON.parse(await readFile(path.join(REPO, 'package.json'), 'utf8'))
  eq(pkg.name, 'dsh-fish-tools', '包名')
  eq(pkg.type, 'module', '是 ESM 包')
  ok(Boolean(pkg.main), '有 main（缺了宿主不会 import）')
  ok(pkg.exports?.['.'], '有 exports["."]')
  ok(pkg.exports?.['./client'], '有 exports["./client"]（网页半边的入口）')
  ok(pkg.exports?.['./cordis.patch.yml'], '有 exports["./cordis.patch.yml"]')
  eq(pkg.dsh?.bundle?.patch, './cordis.patch.yml', 'dsh.bundle.patch 指向挂载文件')
  eq(pkg.dsh?.client?.platform, 'web', '客户端平台是 web')
  eq(pkg.dsh?.client?.inject, ['slots'], '客户端声明依赖 slots')
  ok((pkg.dsh?.client?.external ?? []).includes('react'), 'react 由宿主提供（external）')
  ok(String(pkg.engines?.dsh ?? '').includes('0.2'), '声明了 dsh 版本范围')

  for (const rel of [pkg.main, pkg.exports['.'], pkg.exports['./client'], pkg.exports['./cordis.patch.yml']]) {
    let found = true
    await access(path.join(REPO, rel)).catch(() => { found = false })
    ok(found, `入口文件存在：${rel}`)
  }

  section('清单：bundle 挂载行')
  const yml = await readFile(path.join(REPO, 'cordis.patch.yml'), 'utf8')
  includes(yml, 'insert:', 'cordis.patch.yml 是 insert 形式')
  includes(yml, "id: dsh-fish-tools", '插入行 id 与包名一致')
  includes(yml, "name: 'dsh-fish-tools'", '插入行 name 与包名一致')
  ok(!yml.includes('config: {}'), 'insert 行不带多余的 config（宿主只认 id/name）')

  section('清单：文件清单与忽略规则')
  ok(Array.isArray(pkg.files) && pkg.files.includes('lib/'), 'files 含 lib/')
  ok(pkg.files.includes('cordis.patch.yml'), 'files 含 cordis.patch.yml')
  eq(pkg.license, 'MIT', 'license 是 MIT')

  const ignore = await readFile(path.join(REPO, '.gitignore'), 'utf8')
  includes(ignore, 'node_modules/', '.gitignore 排除 node_modules')
}
