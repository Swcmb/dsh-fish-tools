// dsh-fish-tools · 设置页（网页半边）
//
// 只做四件事：把开关写回宿主、把白名单存回 fish、显示三处补丁状态、显示体检数字。
// 所有读写都走宿主那几条 /dsh-fish-tools/* 路由 —— 逻辑只有一份，留在 lib/index.js。
//
// 槽位名 'settings.section' 与 dsh-speak-up / dsh-auto-continue 用的是同一个。

window.__ModuleLoader__.load({
  id: 'dsh-fish-tools',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    const React = require('react')
    const inject = ['slots']
    const h = React.createElement
    const { useCallback, useEffect, useState } = React

    const B = '/dsh-fish-tools'

    const get = (p) => fetch(B + p, { cache: 'no-store' }).then((r) => r.json())
    const post = (p, body) =>
      fetch(B + p, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      }).then(async (r) => {
        const data = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`)
        return data
      })

    const STATE_LABEL = {
      applied: '已应用',
      clean: '未应用',
      missing: '文件不存在',
      drift: '版本不匹配',
    }

    const CARD = {
      border: '1px solid var(--border, #d8d8d8)',
      borderRadius: 10,
      padding: '14px 16px',
      marginBottom: 12,
    }
    const ROW = { display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0', flexWrap: 'wrap' }
    const MUTED = { opacity: 0.65, fontSize: 12, lineHeight: 1.5 }
    const BTN = { padding: '3px 10px', borderRadius: 6, cursor: 'pointer' }

    function Card({ title, hint, children }) {
      return h('div', { style: CARD },
        h('div', { style: { fontWeight: 600, marginBottom: 6 } }, title),
        hint ? h('div', { style: MUTED }, hint) : null,
        children)
    }

    function Toggle({ label, checked, onChange, note }) {
      return h('label', { style: { ...ROW, cursor: 'pointer' } },
        h('input', { type: 'checkbox', checked: Boolean(checked), onChange: (e) => onChange(e.target.checked) }),
        h('span', null, label),
        note ? h('span', { style: MUTED }, note) : null)
    }

    function Section() {
      const [state, setState] = useState(null)
      const [err, setErr] = useState('')
      const [msg, setMsg] = useState('')
      const [busy, setBusy] = useState('')
      const [allowText, setAllowText] = useState('')
      const [sourcesText, setSourcesText] = useState('')

      const load = useCallback(async () => {
        try {
          const s = await get('/state')
          setState(s)
          setErr('')
          setAllowText((prev) => (prev === '' ? (s.config.tools.allow || []).join(', ') : prev))
          setSourcesText((prev) =>
            prev === '' ? (s.config.tools.sources || []).map((x) => `${x.name},${x.kind},${x.tool}`).join('\n') : prev)
        } catch (e) {
          setErr(String(e?.message ?? e))
        }
      }, [])

      useEffect(() => {
        load()
        const t = setInterval(load, 4000)
        return () => clearInterval(t)
      }, [load])

      const flash = (text) => {
        setMsg(text)
        setTimeout(() => setMsg(''), 4000)
      }

      const saveAbilities = async (next) => {
        setBusy('abilities')
        try {
          const r = await post('/save', { abilities: next })
          // 清空两段文本，让 load() 用新配置重新填（否则开关改了、下面白名单还是旧的）
          setAllowText('')
          setSourcesText('')
          await load()
          flash(r?.restart ? '已保存；补丁改过文件，**重启 DSH** 后生效' : '已保存并写入三家插件')
        } catch (e) {
          setErr(String(e?.message ?? e))
        } finally {
          setBusy('')
        }
      }

      const saveLists = async () => {
        setBusy('lists')
        try {
          const allow = allowText.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
          const sources = sourcesText.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
            const [name, kind, tool] = l.split(',').map((s) => (s ?? '').trim())
            return { name, kind: kind || 'opinion', tool }
          }).filter((s) => s.name && s.tool)
          await post('/save', { allow, sources })
          await load()
          flash('白名单与来源已写回大肥鱼的配置')
        } catch (e) {
          setErr(String(e?.message ?? e))
        } finally {
          setBusy('')
        }
      }

      const patchAction = async (id, action) => {
        setBusy(id + action)
        try {
          const r = await post('/patch', { id, action })
          await load()
          flash(r.changed ? '已改文件，**重启 DSH** 后生效' : '无需改动')
        } catch (e) {
          setErr(String(e?.message ?? e))
        } finally {
          setBusy('')
        }
      }

      if (!state) {
        return h('div', { style: CARD }, err ? `读取失败：${err}` : '读取中…')
      }

      const ab = state.config.abilities
      const doc = state.doctor

      return h('div', null,
        err ? h('div', { style: { ...CARD, borderColor: '#c0392b' } }, `出错了：${err}`) : null,
        msg ? h('div', { style: MUTED }, msg) : null,

        h(Card, { title: '能力', hint: '开关只影响“谁看得见、谁能开口”，不改动任何插件的代码。' },
          h(Toggle, {
            label: '表情包',
            checked: ab.memes,
            note: '放行 learn_meme / meme_list / meme_update / send_meme',
            onChange: (v) => saveAbilities({ memes: v }),
          }),
          h(Toggle, {
            label: 'B 站值班报告',
            checked: ab.report,
            note: '放行 bili_report，并把 bili-scroll 登记成 fact 来源',
            onChange: (v) => saveAbilities({ report: v }),
          }),
          h(Toggle, {
            label: '心跳素材可读',
            checked: ab.seeds,
            note: '心跳一直只采集不开口（发送额度恒为 0）；这个开关只决定能否用 heartbeat_seeds 读那份明文镜像',
            onChange: (v) => saveAbilities({ seeds: v }),
          }),
          h(Toggle, {
            label: '灵枢隔离',
            checked: ab.isolate,
            note: '由补丁实现：她的会话不写进灵枢、不注入灵枢',
            onChange: (v) => saveAbilities({ isolate: v }),
          }),
          h('div', { style: ROW },
            h('span', null, '主动开口归谁：'),
            h('select', {
              value: ab.speaking,
              onChange: (e) => saveAbilities({ speaking: e.target.value }),
              style: { padding: '2px 6px' },
            },
              h('option', { value: 'fish' }, '大肥鱼（推荐）'),
              h('option', { value: 'none' }, '都别开口')),
            h('span', { style: MUTED }, busy === 'abilities' ? '保存中…' : ''))),

        h(Card, { title: '白名单与来源', hint: '一行一个工具名；来源格式 name,kind,tool（kind 只能是 fact / opinion / fiction）。' },
          h('div', { style: MUTED }, '工具白名单'),
          h('textarea', {
            value: allowText,
            onChange: (e) => setAllowText(e.target.value),
            rows: 4,
            style: { width: '100%', fontFamily: 'monospace', fontSize: 12 },
          }),
          h('div', { style: { ...MUTED, marginTop: 8 } }, '来源登记（写进 dsh-fish 的 tools.sources）'),
          h('textarea', {
            value: sourcesText,
            onChange: (e) => setSourcesText(e.target.value),
            rows: 3,
            style: { width: '100%', fontFamily: 'monospace', fontSize: 12 },
          }),
          h('div', { style: { ...ROW, marginTop: 8 } },
            h('button', { style: BTN, disabled: busy === 'lists', onClick: saveLists }, busy === 'lists' ? '保存中…' : '保存')),
          h('div', { style: MUTED }, `当前放行 ${doc.allow.length} 项`)),

        h(Card, {
          title: '补丁',
          hint: '这三处改的是别人包里的文件，插件运行时够不到，只能改文件；改完要重启 DSH。应用前会自动备份（.bak-hub），失败自动回滚。',
        },
          state.patches.map((p) =>
            h('div', { key: p.id, style: { ...ROW, borderTop: '1px solid var(--border, #eee)', paddingTop: 8 } },
              h('div', { style: { flex: 1, minWidth: 240 } },
                h('div', null, `${p.title}  `, h('span', { style: MUTED }, `[${STATE_LABEL[p.state] || p.state}]`)),
                h('div', { style: MUTED }, p.why)),
              h('button', {
                style: BTN,
                disabled: Boolean(busy) || p.state === 'applied' || p.state === 'missing',
                onClick: () => patchAction(p.id, 'apply'),
              }, busy === p.id + 'apply' ? '应用中…' : '应用'),
              h('button', {
                style: BTN,
                disabled: Boolean(busy) || p.state === 'clean' || p.state === 'missing',
                onClick: () => patchAction(p.id, 'revert'),
              }, busy === p.id + 'revert' ? '还原中…' : '还原')))),

        h(Card, { title: '体检', hint: '只读数字，用来判断链路是不是真的在跑。' },
          h('div', { style: ROW }, `最近报告：${doc.reports.latest ? `${doc.reports.latest.date}（${doc.reports.latest.videos} 条视频，${doc.reports.latest.bytes} 字节）` : '还没有'}`),
          h('div', { style: MUTED }, doc.reports.hint || ''),
          h('div', { style: ROW }, `报告日期：${doc.reports.dates.length ? doc.reports.dates.join('、') : '无'}`),
          h('div', { style: ROW }, `心跳素材：${doc.seeds.count} 条${doc.seeds.file ? '' : '（还没有明文镜像）'}`),
          h('div', { style: ROW }, `素材索引行（mat:）：${doc.matLines} 条`),
          h('div', { style: MUTED }, `profile：${doc.profileDir}`)))
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('settings.section', () =>
        slots.register(
          { name: 'settings.section', id: 'fish-tools', order: 55, label: () => '大肥鱼对接' },
          Section,
        ))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
