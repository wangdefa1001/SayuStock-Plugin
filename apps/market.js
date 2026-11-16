/** 大盘：概览、云图、全天候 */

import plugin from "../../../lib/plugins/plugin.js"
import { args, guard, replyImage } from "../components/reply.js"
import { overviewCard, cloudmapCard, allWeatherCard } from "../components/cards.js"
import { fetchOverview, fetchCloudmap, fetchAllWeather } from "../model/market.js"
import { getConfig } from "../model/store.js"

export class SayuMarket extends plugin {
  constructor() {
    super({
      name: "早柚股票-大盘",
      dsc: "大盘概览 / 大盘云图 / 行业云图 / 概念云图 / 全天候",
      event: "message",
      priority: 500,
      rule: [
        { reg: "^#?(大盘概览|大盘概况|大盘)$", fnc: "overview" },
        { reg: "^#?(全天候|全天候板块)$", fnc: "allWeather" },
        { reg: "^#?(大盘云图|云图)(\\s+\\S+)?$", fnc: "marketCloudMap" },
        { reg: "^#?(行业云图|板块云图)(\\s+\\S+)?$", fnc: "industryCloudMap" },
        { reg: "^#?(概念云图)(\\s+\\S+)?$", fnc: "conceptCloudMap" },
      ],
    })
  }

  async overview(e) {
    return guard(e, async () => {
      const data = await fetchOverview()
      const ok = await replyImage(e, overviewCard(data))
      if (!ok) {
        const main = data.indexes[0]
        await e.reply(
          `【大盘概览】${main.name} ${main.price}（${main.chgPct > 0 ? "+" : ""}${main.chgPct}%）\n上涨 ${data.breadth.up} / 下跌 ${data.breadth.down} / 平 ${data.breadth.flat}`,
        )
      }
    })
  }

  async allWeather(e) {
    return guard(e, async () => {
      const groups = await fetchAllWeather()
      const ok = await replyImage(e, allWeatherCard(groups))
      if (!ok) {
        const txt = groups
          .map(g => `${g.title}\n${g.items.map(i => `  ${i.name} ${i.price} ${i.chgPct > 0 ? "+" : ""}${i.chgPct.toFixed(2)}%`).join("\n")}`)
          .join("\n")
        await e.reply(txt)
      }
    })
  }

  async marketCloudMap(e) {
    return guard(e, async () => {
      const name = args(e, "大盘云图", "云图").trim()
      const cfg = getConfig()
      const data = await fetchCloudmap("market", name || null, { stocks: cfg.cloudmapStocks })
      const ok = await replyImage(e, cloudmapCard(data))
      if (!ok) await e.reply(`${data.title}：${data.items.length} 只，行情数据请在有渲染环境的设备查看`)
    })
  }

  async industryCloudMap(e) {
    return guard(e, async () => {
      const name = args(e, "行业云图", "板块云图").trim()
      const data = await fetchCloudmap("industry", name || null)
      const ok = await replyImage(e, cloudmapCard(data))
      if (!ok) await e.reply(`${data.title} ${data.sub}`)
    })
  }

  async conceptCloudMap(e) {
    return guard(e, async () => {
      const name = args(e, "概念云图").trim()
      const data = await fetchCloudmap("concept", name || null)
      const ok = await replyImage(e, cloudmapCard(data))
      if (!ok) await e.reply(`${data.title} ${data.sub}`)
    })
  }
}
