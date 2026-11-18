/** 估值对比：市盈率(PE) / 市净率(PB) / 股息率 历史走势 */

import plugin from "../../../lib/plugins/plugin.js"
import { args, guard, replyImage, tokenize } from "../components/reply.js"
import { valuationCard } from "../components/cards.js"
import { fetchValuationCompare, parseValueRange } from "../model/valuation.js"
import { getConfig } from "../model/store.js"

export class SayuValuation extends plugin {
  constructor() {
    super({
      name: "早柚股票-估值对比",
      dsc: "市盈率 / 市净率 / 股息率 历史走势对比，支持时间范围与板块展开",
      event: "message",
      priority: 485,
      rule: [
        { reg: "^#?(市盈率对比|PE对比|pe对比)(.*)$", fnc: "peCompare" },
        { reg: "^#?(市净率对比|PB对比|pb对比)(.*)$", fnc: "pbCompare" },
        { reg: "^#?(股息率对比|分红率对比)(.*)$", fnc: "dyCompare" },
      ],
    })
  }

  async peCompare(e) { return this._run(e, "pe", ["市盈率对比", "PE对比", "pe对比"]) }
  async pbCompare(e) { return this._run(e, "pb", ["市净率对比", "PB对比", "pb对比"]) }
  async dyCompare(e) { return this._run(e, "dy", ["股息率对比", "分红率对比"]) }

  async _run(e, kind, cmds) {
    return guard(e, async () => {
      const raw = args(e, ...cmds)
      const { start, end, label, rest } = parseValueRange(raw)
      const tokens = tokenize(rest)
      if (!tokens.length) {
        return e.reply(
          "请给出要对比的标的，例如：\n市盈率对比 600519 000001\n市净率对比 近一年 600519 000001\n股息率对比 白酒ETF 医药ETF",
        )
      }
      const cfg = getConfig()
      const limit = cfg.maxCompare || 12
      const { list, failures, rangeText, valueName } = await fetchValuationCompare(tokens, {
        kind,
        rangeText: label,
        start,
        end,
        limit,
      })
      if (!list.length) {
        return e.reply("❌ 未获取到" + valueName + "历史数据：" + (failures.join("；") || "可能该标的不支持东财估值接口"))
      }
      const ok = await replyImage(e, valuationCard({ list, failures, rangeText, valueName }))
      if (!ok) {
        const txt = list
          .map(s => {
            const first = s.points[0].value
            const last = s.points[s.points.length - 1].value
            const d = last - first
            return "  " + s.name + " 最新 " + last.toFixed(2) + "（区间 " + (d >= 0 ? "+" : "") + d.toFixed(2) + "）"
          })
          .join("\n")
        await e.reply("【" + valueName + "·" + rangeText + "对比】\n" + txt)
      }
    })
  }
}
