/** 基金持仓 / IPO 日历 */

import plugin from "../../../lib/plugins/plugin.js"
import { args, guard, replyImage } from "../components/reply.js"
import { fundCard, ipoCard } from "../components/cards2.js"
import { fetchFundHoldings } from "../model/fund.js"
import { fetchIpoCalendar } from "../model/ipo.js"

const MARKET_ALIAS = {
  a: ["a", "a股", "沪深", "沪", "深", "cn", "china", "中国"],
  hk: ["hk", "港股", "香港", "h"],
  us: ["us", "美股", "美国", "nasdaq", "纳斯达克"],
  all: ["all", "全部", "所有", "全球"],
}

function parseMarket(text) {
  const t = String(text ?? "").trim().toLowerCase()
  if (!t) return "a"
  for (const [key, list] of Object.entries(MARKET_ALIAS)) if (list.includes(t)) return key
  return "a"
}

export class SayuFund extends plugin {
  constructor() {
    super({
      name: "早柚股票-基金",
      dsc: "基金持仓分布",
      event: "message",
      priority: 470,
      rule: [{ reg: "^#?(基金持仓|持仓分布)(.*)$", fnc: "holdings" }],
    })
  }

  async holdings(e) {
    return guard(e, async () => {
      const q = args(e, "基金持仓", "持仓分布")
      if (!q) return e.reply("用法：#基金持仓 000001\n也支持名称：#基金持仓 沪深300ETF")
      const data = await fetchFundHoldings(q)
      const ok = await replyImage(e, fundCard(data))
      if (!ok) {
        await e.reply(
          `【${data.name} ${data.code}】前十大重仓合计 ${data.totalWeight.toFixed(2)}%\n` +
            data.rows.map(r => `  ${r.name}(${r.code}) ${r.weight.toFixed(2)}%`).join("\n"),
        )
      }
    })
  }
}

export class SayuIpo extends plugin {
  constructor() {
    super({
      name: "早柚股票-新股",
      dsc: "IPO 日历",
      event: "message",
      priority: 470,
      rule: [
        // 大小写都收：用户既可能写 #IPO日历 也可能写 #ipo日历
        { reg: "^#?(IPO日历|ipo日历|新股日历|打新日历|新股)(\\s+\\S+)?$", fnc: "calendar" },
      ],
    })
  }

  async calendar(e) {
    return guard(e, async () => {
      const arg = args(e, "ipo日历", "新股日历", "打新日历", "新股")
      const market = parseMarket(arg)
      const data = await fetchIpoCalendar(market)
      const ok = await replyImage(e, ipoCard(data))
      if (!ok) {
        await e.reply(
          `【IPO 日历 ${data.from}~${data.to}】共 ${data.rows.length} 只\n` +
            data.rows.map(r => `  ${(r.applyDate || r.listingDate).slice(5)} ${r.name}(${r.code}) ${r.market}`).join("\n"),
        )
      }
    })
  }
}
