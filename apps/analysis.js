/** 分析类指令：技术分析、股票卡片、自动选股、组合体检 */

import plugin from "../../../lib/plugins/plugin.js"
import { args, guard, replyImage, tokenize } from "../components/reply.js"
import { techCard, stockCard, screenerCard, portfolioCard, holdingCard } from "../components/cards2.js"
import {
  fetchTechnical,
  fetchStockCard,
  screenStocks,
  parseScreenConditions,
  parsePeriod,
  fetchPortfolioCheck,
  fetchHoldingAnalysis,
} from "../model/analysis.js"

export class SayuAnalysis extends plugin {
  constructor() {
    super({
      name: "早柚股票-分析",
      dsc: "技术分析 / 股票卡片 / 自动选股 / 组合体检",
      event: "message",
      priority: 470,
      rule: [
        { reg: "^#?(技术分析|技术面)(.*)$", fnc: "technical" },
        { reg: "^#?(股票卡片|个股卡片)(.*)$", fnc: "stockCard" },
        { reg: "^#?(自动选股|选股)(.*)$", fnc: "screener" },
        { reg: "^#?(组合体检|持仓体检|组合诊断)(.*)$", fnc: "portfolio" },
        { reg: "^#?(持仓分析|持仓诊断)(.*)$", fnc: "holding" },
        { reg: "^#?(持仓分析|持仓诊断)(.*)$", fnc: "holding" },
      ],
    })
  }

  async technical(e) {
    return guard(e, async () => {
      const tokens = tokenize(args(e, "技术分析", "技术面"))
      if (!tokens.length) return e.reply("用法：#技术分析 600519\n可指定周期：#技术分析 周k 600519")

      let period = "d"
      const rest = []
      for (const tk of tokens) {
        const p = parsePeriod(tk)
        if (p && rest.length === 0) period = p
        else rest.push(tk)
      }
      if (!rest.length) return e.reply("请在周期后面跟上标的，例如：#技术分析 周k 600519")

      const data = await fetchTechnical(rest.join(" "), period)
      const ok = await replyImage(e, techCard(data))
      if (!ok) {
        const lines = (data.score?.items ?? []).map(i => `${i.name}：${i.text}`)
        await e.reply(
          [`【${data.name} ${data.period}】评分 ${data.score?.score}（${data.score?.label}）`, ...lines].join("\n"),
        )
      }
    })
  }

  async stockCard(e) {
    return guard(e, async () => {
      const q = args(e, "股票卡片", "个股卡片")
      if (!q) return e.reply("用法：#股票卡片 600519")
      const data = await fetchStockCard(q)
      const ok = await replyImage(e, stockCard(data))
      if (!ok) {
        await e.reply(
          `${data.name}(${data.code}) ${data.price} ${data.chgPct > 0 ? "+" : ""}${data.chgPct}%\n` +
            `PE ${data.pe ?? "--"} PB ${data.pb ?? "--"} 换手 ${data.turnover ?? "--"}%`,
        )
      }
    })
  }

  async screener(e) {
    return guard(e, async () => {
      const text = args(e, "自动选股", "选股")
      const { filters, keyword } = parseScreenConditions(text)
      const data = await screenStocks({ filters, keyword, limit: 20 })
      const ok = await replyImage(e, screenerCard(data))
      if (!ok) {
        await e.reply(
          `命中 ${data.matched} 只：${data.rows.map(r => `${r.name}(${r.code}) ${r.chg.toFixed(2)}%`).join("、")}`,
        )
      }
    })
  }

  async holding(e) {
    return guard(e, async () => {
      const tokens = tokenize(args(e, "持仓分析", "持仓诊断"))
      const data = await fetchHoldingAnalysis(e.user_id ?? e.sender?.user_id, tokens.length ? tokens : null)
      const ok = await replyImage(e, holdingCard(data))
      if (!ok) {
        const lines = data.items.map(
          i => `  ${i.name} 综合${i.total} 技术${i.techScore} 资金${i.moneyScore ?? "--"} 估值${i.valueScore}`,
        )
        await e.reply([`【持仓分析】整体 ${data.avg}（${data.avgVerdict}）`, ...lines].join("\n"))
      }
    })
  }

  async portfolio(e) {
    return guard(e, async () => {
      const tokens = tokenize(args(e, "组合体检", "持仓体检", "组合诊断"))
      const data = await fetchPortfolioCheck(e.user_id ?? e.sender?.user_id, tokens.length ? tokens : null)
      const ok = await replyImage(e, portfolioCard(data))
      if (!ok) {
        await e.reply(
          `【组合体检】${data.total} 只 · HHI ${data.hhi.toFixed(3)}\n` +
            data.warnings.map(w => `${w.level === "ok" ? "✅" : "⚠️"} ${w.text}`).join("\n"),
        )
      }
    })
  }
}
