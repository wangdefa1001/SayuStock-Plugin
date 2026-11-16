/** 对比个股 */

import plugin from "../../../lib/plugins/plugin.js"
import { args, guard, replyImage, tokenize } from "../components/reply.js"
import { compareCard } from "../components/cards.js"
import { fetchCompare, parseRange } from "../model/market.js"
import { getConfig, getWatch } from "../model/store.js"
import { resolve } from "../model/symbol.js"

export class SayuCompare extends plugin {
  constructor() {
    super({
      name: "早柚股票-对比",
      dsc: "多股涨跌幅对比，支持时间范围与板块展开",
      event: "message",
      priority: 480,
      rule: [{ reg: "^#?(对比个股|个股对比|对比)(.*)$", fnc: "compare" }],
    })
  }

  async compare(e) {
    return guard(e, async () => {
      const raw = args(e, "个股对比", "对比个股", "对比")
      const { start, end, label, rest } = parseRange(raw)
      let tokens = tokenize(rest)

      const cfg = getConfig()
      if (!tokens.length) {
        const secids = getWatch(e.user_id ?? e.sender?.user_id)
        if (!secids.length) {
          return e.reply("您还未添加自选呢~ 也可以直接对比：\n对比个股 510300 512880\n对比个股 年初至今 白酒ETF 医药ETF")
        }
        const names = []
        for (const s of secids.slice(0, cfg.maxCompare)) {
          const m = await resolve(s).catch(() => null)
          names.push(m?.name ?? s)
        }
        tokens = names
        if (secids.length > cfg.maxCompare) {
          await e.reply(`自选数量较多，本次只对比前 ${cfg.maxCompare} 只，请稍等结果...`)
        }
      }

      const { list, failures, rangeText } = await fetchCompare(tokens, {
        rangeText: label,
        start,
        end,
        limit: cfg.maxCompare,
      })

      if (!list.length) return e.reply(`❌ 对比失败：${failures.join("；")}`)

      const ok = await replyImage(e, compareCard(list, { rangeText, failures }))
      if (!ok) {
        const txt = list
          .map(s => {
            const base = s.bars[0].close
            const last = s.bars[s.bars.length - 1].close
            return `  ${s.name} ${(((last - base) / base) * 100).toFixed(2)}%`
          })
          .join("\n")
        await e.reply(`【${rangeText}对比】\n${txt}`)
      }
    })
  }
}
