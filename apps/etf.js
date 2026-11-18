/** 场内 ETF：ETF找股 / ETF对比 */

import plugin from "../../../lib/plugins/plugin.js"
import { args, guard, replyImage, tokenize } from "../components/reply.js"
import { etfSearchCard, etfCompareCard } from "../components/cards.js"
import { searchETFsHolding, compareETFs, MAX_COMPARE } from "../model/etf.js"

export class SayuEtf extends plugin {
  constructor() {
    super({
      name: "早柚股票-ETF工具",
      dsc: "ETF找股（按个股反查 ETF）/ ETF对比（前十大持仓与行业权重）",
      event: "message",
      priority: 487,
      rule: [
        { reg: "^#?(场内找股|ETF找股|etf找股)(.*)$", fnc: "search" },
        { reg: "^#?(ETF对比|etf对比|场内对比)(.*)$", fnc: "compare" },
      ],
    })
  }

  async search(e) {
    return guard(e, async () => {
      const q = args(e, "场内找股", "ETF找股", "etf找股").trim()
      if (!q) return e.reply("用法：ETF找股 工业富联")
      const data = await searchETFsHolding(q)
      const ok = await replyImage(e, etfSearchCard(data))
      if (!ok) {
        const lines = data.themes.map(t => t.theme + "：" + t.funds.slice(0, 3).map(f => f.name + " " + f.weight.toFixed(2) + "%").join("、"))
        await e.reply("【ETF找股·" + data.stock.name + "】报告期 " + data.period + "\n" + lines.join("\n"))
      }
    })
  }

  async compare(e) {
    return guard(e, async () => {
      const raw = args(e, "ETF对比", "etf对比", "场内对比")
      let tokens = tokenize(raw)
      let focus = ""
      const fi = tokens.indexOf("关注")
      if (fi >= 0) {
        focus = tokens[fi + 1] || ""
        tokens = tokens.slice(0, fi)
      }
      if (tokens.length < 1) {
        return e.reply("用法：ETF对比 515170 516900 159843 159862，可追加「关注 贵州茅台」")
      }
      const data = await compareETFs(tokens.slice(0, MAX_COMPARE), focus)
      const ok = await replyImage(e, etfCompareCard(data))
      if (!ok) {
        const txt = data.list.map(f => f.name + "(" + f.code + ")：\n  " + f.rows.slice(0, 5).map(r => r.name + " " + r.weight.toFixed(2) + "%").join("、")).join("\n")
        await e.reply("【ETF对比】\n" + txt)
      }
    })
  }
}
