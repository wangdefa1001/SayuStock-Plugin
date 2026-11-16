/** 新闻订阅：财经快讯（东财 7x24，指令名兼容原插件「雪球新闻」） */

import plugin from "../../../lib/plugins/plugin.js"
import { guard } from "../components/reply.js"
import { getConfig, addSub, delSub, isSub, getSubs } from "../model/store.js"
import { formatNewsList, loadSeen, pullNews, saveSeen, getCachedNews } from "../model/news.js"

const log = globalThis.logger ?? console

function trimSummary(item, max = 130) {
  const s = item.summary && item.summary !== item.title ? `\n${item.summary.slice(0, max)}${item.summary.length > max ? "…" : ""}` : ""
  return `【${item.time.slice(11, 16)}】${item.title}${s}`
}

export class SayuNews extends plugin {
  constructor() {
    super({
      name: "早柚股票-快讯",
      dsc: "财经快讯推送与查询",
      event: "message",
      priority: 480,
      rule: [
        { reg: "^#?(订阅雪球新闻|订阅财经快讯)$", fnc: "subscribe" },
        { reg: "^#?(取消订阅雪球新闻|取消订阅财经快讯)$", fnc: "unsubscribe" },
        { reg: "^#?(雪球快讯|财经快讯|快讯)(\\s*\\d+)?$", fnc: "latest" },
      ],
    })
    /**
     * TRSS-Yunzai 3.x 的 startTask 是直接 `await i.fnc()`，
     * 所以 fnc 必须传函数而不是方法名字符串（与部分文档写法不同）。
     * 间隔来自配置，cron 在插件加载时生成，改间隔需要重载插件。
     */
    const interval = Math.min(Math.max(Number(getConfig().news?.interval) || 5, 1), 60)
    this.task = [
      {
        name: "早柚股票-快讯推送",
        cron: `0 */${interval} * * * *`,
        fnc: () => this.pollNews(),
        log: false,
      },
    ]
  }

  async subscribe(e) {
    return guard(e, async () => {
      if (!e.isGroup) return e.reply("快讯推送目前只支持群聊，私聊可以用「财经快讯」随时查询")
      const gid = e.group_id
      if (isSub(gid)) return e.reply("本群已经订阅了财经快讯，如需关闭请发送「取消订阅雪球新闻」")
      addSub(gid, e.group_name ?? "", e.self_id)
      await e.reply("✅ 已订阅财经快讯（每 5 分钟推送一次，来源：东方财富 7x24）\n如需关闭请发送「取消订阅雪球新闻」")
    })
  }

  async unsubscribe(e) {
    return guard(e, async () => {
      if (!e.isGroup) return e.reply("私聊无需订阅，直接用「财经快讯」查询即可")
      delSub(e.group_id)
      await e.reply("✅ 已关闭本群的财经快讯推送")
    })
  }

  async latest(e) {
    return guard(e, async () => {
      const n = Number(String(e.msg).match(/(\d+)\s*$/)?.[1] ?? 8)
      const count = Math.min(Math.max(n, 1), 20)
      let items = getCachedNews(count)
      if (items.length < count) {
        await pullNews(1)
        items = getCachedNews(count)
      }
      if (!items.length) return e.reply("❌ 快讯获取失败，稍后再试")
      const text = items.map((i, idx) => `${idx + 1}. ${trimSummary(i)}`).join("\n\n")
      await e.reply(`===== 财经快讯 =====\n\n${text}`)
    })
  }

  /** 定时推送：只推给已订阅的群 */
  async pollNews() {
    const cfg = getConfig()
    if (cfg.news.push === false) return
    const subs = getSubs()
    const gids = Object.keys(subs.groups)
    if (!gids.length) return

    const added = await pullNews(Math.min(Math.max(Number(cfg.news.pages) || 1, 1), 5))
    if (!added.length) return

    const seen = loadSeen()
    const fresh = added.filter(i => !seen.has(i.id)).reverse()
    if (!fresh.length) return
    for (const i of fresh) seen.add(i.id)
    saveSeen(seen)

    const batch = fresh.slice(-8)
    const text = `===== 财经快讯 =====\n\n${batch.map((i, idx) => `${idx + 1}. ${trimSummary(i, 100)}`).join("\n\n")}`

    const Bot = globalThis.Bot
    if (!Bot?.sendGroupMsg) {
      log.warn?.("[SayuStock] 当前框架不支持 Bot.sendGroupMsg，快讯推送已跳过")
      return
    }
    for (const gid of gids) {
      try {
        await Bot.sendGroupMsg(subs.groups[gid]?.bot_id, gid, text)
      } catch (err) {
        log.error?.(`[SayuStock] 快讯推送失败 ${gid}: ${err?.message ?? err}`)
      }
    }
  }
}
