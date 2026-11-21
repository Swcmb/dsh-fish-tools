# dsh-fish-tools

大肥鱼（@ssamurias/dsh-fish）接入 DSH 的总成插件：把原来散在配置、脚本和手改代码里的
一整套东西收成一个可安装的 DSH 插件，并给它一个设置界面。

装完之后只有一处入口：**设置 → 大肥鱼对接**。

## 安装

在 DSH Web 的**插件管理**里，用本目录打出的 `.tgz` 安装（external bundle），
或者把本目录 `link:` 进 profile 的 `dependencies` 并把 `dsh-fish-tools` 加进
`dsh.profile.bundles`。包清单是 `package.json`，挂载入口是 `cordis.patch.yml`，
浏览器半边是 `exports['./client']`。

前置条件：三个被补丁的包（`@ssamurias/dsh-fish`、`@furongjun1999/dsh-memory`、
`@kanadego/dsh-heartbeat`）必须已装在同一个 profile 里；缺哪个，对应补丁会显示「文件不存在」，
不影响其它功能。

补丁改的是第三方包里的代码，**应用/还原之后必须重启 DSH**。

---

## 一、它管哪些插件

| 插件 | 来源 | 这个插件对它做什么 |
|---|---|---|
| `@ssamurias/dsh-fish` | npm | 写 `~/.dsh-fish/config.json` 的 `tools.allow / tools.sources`；打两处代码补丁（素材收口、索引前缀） |
| `dsh-bili-scroll` | 本机已装（`runtime/dsh/profiles/desktop/node_modules`） | 不碰它的代码。只读它写的 `bili-duty/out/<日期>.md`，转成素材 |
| `@furongjun1999/dsh-memory`（灵枢） | npm | 打一处代码补丁：她（大肥鱼）的会话不写库、不注入记忆块 |
| `@kanadego/dsh-heartbeat` | npm | 打一处代码补丁：素材池多落一份明文镜像；写 `heartbeat-data/settings/policy.json` 把日额度压到 0 |
| `dsh-speak-up` | npm | 写 `~/.dsh/speak-up-config.json` 的「总开关」，保证同一时刻只有一个大脑开口 |

三个第三方包都是**已装在 profile 的 node_modules 里**的包，补丁由本插件在设置页里
显式点「应用」才写盘（不是安装时自动改）。

---

## 二、它给大肥鱼加的两个工具

都是**只读**的，没有写盘、没有网络请求。

### `bili_report`

读 `刷B站` 值班报告（`out/<日期>.md`），返回一条 `dshFishMaterial`（fact 级）JSON：

- `facts`：每条视频的 BV 号、标题、UP、播放量、**链接**（可核对锚）
- `quotes`：**标题原文**（平台字，算真原话，一级）

「为什么值得 / 你自己的一句话」是模型的判断，**故意不进 quotes** —— 那些话不是她说过的，
塞进证据里等于让她引用自己编的话。

没有报告时返回一句说明（并列出最近几份的日期），不抛错。

### `heartbeat_seeds`

读心跳攒下的素材池明文镜像（`heartbeat-data/seeds.jsonl.export.jsonl`），返回最近 N 条
（默认 20，最多 100）。

---

## 三、设置页四张卡

1. **能力** —— 表情包 / B 站报告 / 心跳采集 / 灵枢隔离；「主动开口归谁」二选一
   （大肥鱼 / 都别开口）。改动立刻投影到上面那几家插件的配置里。
2. **白名单与来源** —— 直接编辑 `tools.allow` 与 `tools.sources`（一行一个，来源格式
   `name,kind,tool`），保存后写回 `~/.dsh-fish/config.json`。
3. **补丁** —— 五条补丁各自的状态（已应用 / 未应用 / 版本不匹配 / 文件不存在），
   带「应用」「还原」。应用前备份 `.bak-hub`，打完做一次 import 探测，失败自动回滚。
4. **体检** —— 最近报告日期与条数、**这份报告能不能产出素材**（有没有 BV 号 + 标题原文）、
   素材池条数、账本里 `mat:` 索引行数、profile 路径。

---

## 四、五条补丁

| id | 文件 | 做什么 |
|---|---|---|
| `fish-material-ingest` | fish `lib/turns.js` | 认领 `tools.sources` 里登记的工具结果，写成 `mat:<source>:<key> {t,d,q,f}` 索引行（1.0.6 有解析器却没有调用点） |
| `derive-mat-prefix` | fish `lib/derive.js` | 索引行前缀从写死 `mat:bili:` 放宽到 `mat:<source>:<key>` |
| `recall-mat-prefix` | fish `lib/recall.js` | 同上，让第三方素材能被回翻 |
| `lingshu-isolation` | 灵枢 `lib/hooks.js` | 她的会话不写库、不注入记忆块；取不到判据时不过滤（不误伤你的会话） |
| `heartbeat-seed-mirror` | 心跳 `dist/chunk-*.js` | 加密写入之后再落一份明文 `*.export.jsonl`，供 `heartbeat_seeds` 只读 |

安全性三条：

- **幂等**：marker 已在文件里就跳过，点一百次结果一样
- **可还原**：有 `.bak-hub` 走整文件备份；没有（例如补丁是历史上手动打的）就按 ops
  逆向摘掉我们加的那些行，不动文件其余部分
- **拒绝盲改**：记过 hash 且当前内容对不上（有人在我们之后改过），还原直接拒绝

---

## 五、接口

| 路由 | 方法 | 作用 |
|---|---|---|
| `/dsh-fish-tools/state` | GET | 配置 + 五条补丁状态 + 体检数据 |
| `/dsh-fish-tools/save` | POST | `{abilities}` 或 `{allow, sources}`，写回并投影 |
| `/dsh-fish-tools/patch` | POST | `{id, action:'apply'\|'revert'}` |

配置落在 `~/.dsh/dsh-fish-tools/config.json`（记录补丁 hash 与投影前的原值），
不重复存别人家的配置。

---

## 六、改完要重启

补丁改的是第三方包里**已经被加载进内存**的代码，所以应用 / 还原之后必须重启 DSH 才生效。
设置页会提示这一点。
