/** 波动率指数：沪深300/上证50/创业板/科创板 QVIX 日内分时 */

import plugin from "../../../lib/plugins/plugin.js"
import { args, guard, replyImage } from "../components/reply.js"
import { vixCard } from "../components/cards.js"
import { fetchVix, resolveVix } from "../model/vix.js"

export class SayuVix extends plugin {
  constructor() {
    super({
      name: "早柚股票-波动率",
      dsc: "QVIX 波动率指数日内分时（沪深300/上证50/创业板/科创板）",
      event: "message",
      priority: 486,
      rule: [{ reg: "^#?(VIX|vix|波动率|QVIX|qvix)(.*)$", fnc: "vix" }],
    })
  }

  async vix(e) {
    return guard(e, async () => {
      const raw = args(e, "VIX", "vix", "波动率", "QVIX", "qvix").trim()
      const meta = resolveVix(raw)
      const data = await fetchVix(raw)
      const ok = await replyImage(e, vixCard(data))
      if (!ok) {
        await e.reply(
          "【" + data.label + "】最新 " + data.last.toFixed(2) + "（" + (data.chg >= 0 ? "+" : "") +
            data.chg.toFixed(2) + "，" + (data.chgPct >= 0 ? "+" : "") + data.chgPct.toFixed(2) + "%）\n" +
            "昨收 " + data.pre.toFixed(2) + " 最高 " + data.high.toFixed(2) + " 最低 " + data.low.toFixed(2) +
            "（" + meta.label + "）",
        )
      }
    })
  }
}
