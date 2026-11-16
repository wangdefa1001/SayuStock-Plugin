/** 新闻订阅：财经快讯（东财 7x24，指令名兼容原插件「雪球新闻」） */

import plugin from "../../../lib/plugins/plugin.js"
import { guard } from "../components/reply.js"
import { getConfig, addSub, delSub, isSub, getSubs } from "../model/store.js"
import { formatNewsList, loadSeen, pullNews, saveSeen, getCachedNews, formatNews } from "../model/news.js"

const log = globalThis.logger ?? console

/** 推送模式：与原版 SayuStock 的分级对齐 */
export const MODE_TEXT = {
  important: "只要闻（实时）",
  all: "全部快讯（实时）",
  hourly: "每小时汇总",
  daily: "每日 08:00 汇总",
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

function modeOf(cfg) {
  const m = cfg?.news?.mode
  return MODE_TEXT[m] ? m : "important"
}

/** 不同模式的 cron；改模式需要重载插件（cron 在加载时生成） */
function cronOf(mode, interval) {
  if (mode === "hourly") return "0 0 * * * *"
  if (mode === "daily") return "0 0 8 * * *"
  const n = Math.min(Math.max(Number(interval) || 5, 1), 60)
  return `0 */${n} * * * *`
}

function trimSummary(item, max = 130) {
  const body =
    item.summary && item.summary !== item.title
      ? `\n${item.summary.slice(0, max)}${item.summary.length > max ? "…" : ""}`
      : ""
  return `【${item.time.slice(11, 16)}】${item.important ? "🔴 " : ""}${item.title}${body}`
}

export class SayuNews extends plugin {
  constructor() {
    super({
      name: "早柚股票-快讯",
      dsc: "财经快讯推送与查询",
      event: "message",
      priority: 480,
      rule: [
        { reg: "^#?(订阅雪球新闻|订阅财经快讯|订阅雪球热点)$", fnc: "subscribe" },
        { reg: "^#?(取消订阅雪球新闻|取消订阅财经快讯|取消订阅雪球热点)$", fnc: "unsubscribe" },
        { reg: "^#?(雪球快讯|财经快讯|快讯)(\\s*\\d+)?$", fnc: "latest" },
      ],
    })

    const cfg = getConfig()
    const mode = modeOf(cfg)
    /**
     * TRSS-Yunzai 3.x 的 startTask 是直接 `await i.fnc()`，
     * 所以 fnc 必须传函数而不是方法名字符串（与部分文档写法不同）。
     */
    this.task = [
      {
        name: `早柚股票-快讯推送(${mode})`,
        cron: cronOf(mode, cfg.news?.interval),
        fnc: () => this.pollNews(),
        log: false,
      },
    ]
  }

  async subscribe(e) {
    return guard(e, async () => {
      if (!e.isGroup) return e.reply("快讯推送目前只支持群聊，私聊可以用「#财经快讯」随时查询")
      const gid = e.group_id
      if (isSub(gid)) return e.reply("本群已经订阅了财经快讯，如需关闭请发送「#取消订阅雪球新闻」")

      // 订阅时先把现有快讯标记为已读，避免刚订阅就被历史消息刷屏
      await pullNews(1)
      const seen = loadSeen()
      for (const i of getCachedNews(200)) seen.add(i.id)
      saveSeen(seen)

      addSub(gid, e.group_name ?? "", e.self_id)
      const mode = modeOf(getConfig())
      await e.reply(
        `✅ 已订阅财经快讯\n📢 推送模式：${MODE_TEXT[mode]}\n` +
          `📚 数据来源：东方财富 7x24\n如需关闭请发送「#取消订阅雪球新闻」`,
      )
    })
  }

  async unsubscribe(e) {
    return guard(e, async () => {
      if (!e.isGroup) return e.reply("私聊无需订阅，直接用「#财经快讯」查询即可")
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
      await e.reply(`===== 财经快讯（🔴 = 要闻）=====\n\n${text}`)
    })
  }

  /** 定时推送：只推给已订阅的群 */
  async pollNews() {
    const cfg = getConfig()
    if (cfg.news.push === false) return
    const subs = getSubs()
    const gids = Object.keys(subs.groups)
    if (!gids.length) return

    const mode = modeOf(cfg)
    const isDigest = mode === "hourly" || mode === "daily"
    // 汇总模式要覆盖整段窗口，多翻几页；实时模式按配置页数
    const pages = isDigest ? 3 : Math.min(Math.max(Number(cfg.news.pages) || 1, 1), 5)

    const added = await pullNews(pages)
    if (!added.length) return

    const seen = loadSeen()
    const unseen = added.filter(i => !seen.has(i.id)).reverse() // 旧 → 新
    if (!unseen.length) return

    // 无论推不推都记入游标，避免同一批反复参与判定
    for (const i of unseen) seen.add(i.id)
    saveSeen(seen)

    // 除「全部快讯」外，其余模式只要闻（东财 titleColor>0）
    const fresh = mode === "all" ? unseen : unseen.filter(i => i.important)
    if (!fresh.length) {
      log.debug?.(`[SayuStock] 本轮 ${unseen.length} 条快讯无要闻，跳过推送`)
      return
    }

    const max = Math.min(Math.max(Number(cfg.news.maxPerPush) || 6, 1), 20)
    const chunks = []
    for (let i = 0; i < fresh.length; i += max) chunks.push(fresh.slice(i, i + max))

    const Bot = globalThis.Bot
    if (!Bot?.sendGroupMsg) {
      log.warn?.("[SayuStock] 当前框架不支持 Bot.sendGroupMsg，快讯推送已跳过")
      return
    }

    const label = isDigest ? MODE_TEXT[mode] : mode === "all" ? "财经快讯" : "财经要闻"

    for (const gid of gids) {
      for (const [idx, batch] of chunks.entries()) {
        const head = `===== ${label}${isDigest ? `（共 ${fresh.length} 条）` : ""}${
          chunks.length > 1 ? ` ${idx + 1}/${chunks.length}` : ""
        } =====`
        const text = `${head}\n\n${batch.map(i => trimSummary(i, isDigest ? 150 : 100)).join("\n\n")}`
        try {
          await Bot.sendGroupMsg(subs.groups[gid]?.bot_id, gid, text)
        } catch (err) {
          log.error?.(`[SayuStock] 快讯推送失败 ${gid}: ${err?.message ?? err}`)
        }
        // 多群/多条之间留间隔，避免触发风控
        await sleep(2000 + Math.random() * 2000)
      }
    }
  }
}

export { formatNews, formatNewsList }
