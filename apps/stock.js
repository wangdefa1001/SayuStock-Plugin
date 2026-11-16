/** 个股：分时 / 五日 / 日K / 周K / 月K / 我的个股 */

import plugin from "../../../lib/plugins/plugin.js"
import { args, guard, replyImage, tokenize } from "../components/reply.js"
import { intradayCard, klineCard, multiIntradayCard } from "../components/cards.js"
import { fetchIntraday, fetchKline, fetchMultiIntraday } from "../model/market.js"
import { getConfig, getWatch } from "../model/store.js"
import { resolve } from "../model/symbol.js"

const PERIODS = [
  { re: /^(五日|5日|五日分时)$/, ndays: 5 },
  { re: /^(日k|日K|day)$/i, klt: "101", period: "d" },
  { re: /^(周k|周K|week)$/i, klt: "102", period: "w" },
  { re: /^(月k|月K|month)$/i, klt: "103", period: "m" },
  { re: /^(季k|季K)$/i, klt: "104", period: "q" },
  { re: /^(年k|年K|year)$/i, klt: "105", period: "y" },
]

export class SayuStock extends plugin {
  constructor() {
    super({
      name: "早柚股票-个股",
      dsc: "个股分时 / 五日分时 / 日K周K月K / 我的个股",
      event: "message",
      priority: 500,
      rule: [
        { reg: "^#?个股(.*)$", fnc: "stock" },
        { reg: "^#?我的个股$", fnc: "myStocks" },
      ],
    })
  }

  async stock(e) {
    return guard(e, async () => {
      const raw = args(e, "个股")
      const tokens = tokenize(raw)
      if (!tokens.length) {
        return e.reply("请后跟股票代码或名称，例如：\n个股 证券ETF\n个股 五日 贵州茅台\n个股 日k 600519\n个股 白酒ETF 医药ETF")
      }

      let ndays = 1
      let period = null
      let kltText = ""
      for (const p of PERIODS) {
        if (p.re.test(tokens[0])) {
          if (p.ndays) ndays = p.ndays
          if (p.period) {
            period = p.period
            kltText = p.klt
          }
          tokens.shift()
          break
        }
      }

      if (!tokens.length) return e.reply("请在周期后面跟上股票代码或名称，例如：个股 日k 600519")

      /* K线：单只 */
      if (period) {
        if (tokens.length > 1) {
          return e.reply("K线一次只能看一只，多只请用「对比个股」或去掉周期看分时对比")
        }
        const s = await fetchKline(tokens[0], period, { count: period === "d" ? 120 : 90 })
        const ok = await replyImage(e, klineCard(s, { klt: kltText, count: period === "d" ? 120 : 90 }))
        if (!ok) {
          const last = s.bars[s.bars.length - 1]
          await e.reply(`${s.name}(${s.code}) ${last.date} 收 ${last.close}（${last.chgPct > 0 ? "+" : ""}${last.chgPct}%）`)
        }
        return
      }

      /* 分时：单只 */
      if (tokens.length === 1) {
        const r = await fetchIntraday(tokens[0], { ndays })
        if (r.type === "single") {
          const ok = await replyImage(e, intradayCard(r.series, { ndays }))
          if (!ok) {
            const last = r.series.points[r.series.points.length - 1]
            const p = ((last.price - r.series.preClose) / r.series.preClose) * 100
            await e.reply(`${r.series.name} ${last.price}（${p > 0 ? "+" : ""}${p.toFixed(2)}%）`)
          }
          return
        }
        const title = r.boardName ? `${r.boardName} 板块成分股分时` : "多股分时"
        const ok = await replyImage(e, multiIntradayCard(r.list, { title, sub: `${ndays > 1 ? "五日" : "当日"}分时` }))
        if (!ok) await e.reply(`${title}：共 ${r.list.length} 只`)
        return
      }

      /* 分时：多只 */
      const cfg = getConfig()
      const { list, failures } = await fetchMultiIntraday(tokens, { ndays, limit: cfg.maxMultiStock })
      if (!list.length) return e.reply(`❌ 没查到数据：${failures.join("；")}`)
      const ok = await replyImage(
        e,
        multiIntradayCard(list, {
          title: "多股分时",
          sub: `${ndays > 1 ? "五日" : "当日"}${failures.length ? ` · 失败 ${failures.length} 只` : ""}`,
        }),
      )
      if (!ok) await e.reply(`共 ${list.length} 只：${list.map(s => s.name).join("、")}`)
    })
  }

  async myStocks(e) {
    return guard(e, async () => {
      const uid = e.user_id ?? e.sender?.user_id
      const secids = getWatch(uid)
      if (!secids.length) {
        return e.reply("您还未添加自选呢~ 发送「添加自选 600519 贵州茅台」即可\n也可以直接：个股 中证白酒 中证2000")
      }
      const cfg = getConfig()
      const list = []
      const failures = []
      for (const secid of secids.slice(0, cfg.maxMultiStock)) {
        try {
          const meta = await resolve(secid)
          const r = await fetchIntraday(secid, { ndays: 1 })
          if (r.type === "single") list.push({ ...r.series, name: r.series.name || meta?.name })
        } catch (err) {
          failures.push(`${meta?.name ?? secid}`)
        }
      }
      if (!list.length) return e.reply("自选股行情获取失败，稍后再试")
      const ok = await replyImage(
        e,
        multiIntradayCard(list, {
          title: "我的个股",
          sub: `自选前 ${list.length} 只当日分时${failures.length ? ` · 跳过 ${failures.join("、")}` : ""}`,
        }),
      )
      if (!ok) await e.reply(`自选 ${list.length} 只：${list.map(s => s.name).join("、")}`)
    })
  }
}
