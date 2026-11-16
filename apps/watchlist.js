/** 自选管理 */

import plugin from "../../../lib/plugins/plugin.js"
import { args, guard, replyImage, tokenize } from "../components/reply.js"
import { watchlistCard } from "../components/cards.js"
import { fetchWatchRows, resolveWatchItems } from "../model/market.js"
import { addWatch, clearWatch, delWatch, getWatch } from "../model/store.js"
import { resolve } from "../model/symbol.js"

/** 清空自选的二次确认（60 秒有效） */
const pending = new Map()
const TTL = 60 * 1000

export class SayuWatchlist extends plugin {
  constructor() {
    super({
      name: "早柚股票-自选",
      dsc: "添加/删除/清空自选，查看自选行情",
      event: "message",
      priority: 480,
      rule: [
        { reg: "^#?添加自选(.*)$", fnc: "add" },
        { reg: "^#?删除自选(.*)$", fnc: "del" },
        { reg: "^#?清空自选$", fnc: "clear" },
        { reg: "^#?确认清空自选$", fnc: "confirmClear" },
        { reg: "^#?我的自选$", fnc: "list" },
      ],
    })
  }

  async add(e) {
    return guard(e, async () => {
      const tokens = tokenize(args(e, "添加自选"))
      if (!tokens.length) return e.reply("用法：添加自选 600519 贵州茅台 白酒ETF\n支持股票/ETF/指数/板块/场外基金，多个用空格分隔")
      const { items, failed } = await resolveWatchItems(tokens)
      if (!items.length) return e.reply(`❌ 一个都没识别出来：${failed.join("、")}`)
      const res = addWatch(e.user_id ?? e.sender?.user_id, items)
      const lines = []
      if (res.added.length) lines.push(`✅ 已添加：${items.filter(i => res.added.includes(i.secid)).map(i => i.name).join("、")}`)
      if (res.dup.length) lines.push(`⚪ 已存在：${[...new Set(res.dup)].join("、")}`)
      if (res.overflow.length) lines.push(`⚠️ 超出上限（${res.overflow.length} 个未添加），请先删除部分自选`)
      if (failed.length) lines.push(`❌ 未识别：${failed.join("、")}`)
      lines.push(`当前自选 ${res.total} 只，发送「我的自选」查看`)
      await e.reply(lines.join("\n"))
    })
  }

  async del(e) {
    return guard(e, async () => {
      const tokens = tokenize(args(e, "删除自选"))
      if (!tokens.length) return e.reply("用法：删除自选 600519 贵州茅台")
      const uid = e.user_id ?? e.sender?.user_id
      const cur = getWatch(uid)
      if (!cur.length) return e.reply("你的自选列表是空的")

      const secids = []
      const failed = []
      for (const t of tokens) {
        const target = await resolve(t).catch(() => null)
        if (target && cur.includes(target.secid)) secids.push(target.secid)
        else if (cur.includes(t)) secids.push(t)
        else failed.push(t)
      }
      if (!secids.length) return e.reply(`❌ 这些标的不在你的自选里：${failed.join("、")}`)

      const names = []
      for (const s of secids) {
        const m = await resolve(s).catch(() => null)
        names.push(m?.name ?? s)
      }
      delWatch(uid, secids)
      await e.reply(`✅ 已删除：${names.join("、")}${failed.length ? `\n❌ 不在自选：${failed.join("、")}` : ""}`)
    })
  }

  async clear(e) {
    return guard(e, async () => {
      const uid = e.user_id ?? e.sender?.user_id
      const cur = getWatch(uid)
      if (!cur.length) return e.reply("你的自选列表已经是空的")
      pending.set(String(uid), Date.now())
      await e.reply(`⚠️ 即将清空 ${cur.length} 只自选，60 秒内发送「确认清空自选」以执行`)
    })
  }

  async confirmClear(e) {
    return guard(e, async () => {
      const uid = String(e.user_id ?? e.sender?.user_id)
      const t = pending.get(uid)
      if (!t || Date.now() - t > TTL) return e.reply("没有待确认的清空操作，请重新发送「清空自选」")
      pending.delete(uid)
      const count = getWatch(uid).length
      clearWatch(uid)
      await e.reply(`✅ 已清空 ${count} 只自选`)
    })
  }

  async list(e) {
    return guard(e, async () => {
      const uid = e.user_id ?? e.sender?.user_id
      const rows = await fetchWatchRows(uid)
      if (!rows.length) {
        return e.reply("你还没有添加自选\n发送「添加自选 600519 贵州茅台」即可添加")
      }
      const ok = await replyImage(e, watchlistCard(rows))
      if (!ok) {
        const txt = rows
          .map(r => `${r.name} ${r.price} ${r.chgPct > 0 ? "+" : ""}${Number(r.chgPct).toFixed(2)}%`)
          .join("\n")
        await e.reply(`【我的自选】\n${txt}`)
      }
    })
  }
}
