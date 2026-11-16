/**
 * 分析类数据编排：技术分析、股票卡片、自动选股、组合体检。
 */

import { ulist, kline, clist, clistMany, quote, hotmap, KLT } from "./em.js"
import { resolve } from "./symbol.js"
import { getWatch } from "./store.js"
import { stockInfo } from "./stockdb.js"
import { ma, macd, kdj, rsi, boll, scoreTechnical } from "./indicators.js"

const p2 = n => String(n).padStart(2, "0")
function cnDate(offsetDays = 0) {
  const d = new Date(Date.now() + 8 * 3600 * 1000 + offsetDays * 86400 * 1000)
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`
}
function ymd(offsetDays = 0) {
  return cnDate(offsetDays).replace(/-/g, "")
}

const PERIOD_MAP = {
  d: { klt: KLT.d, text: "日K", days: 400 },
  w: { klt: KLT.w, text: "周K", days: 1200 },
  m: { klt: KLT.m, text: "月K", days: 3000 },
  "60m": { klt: "60", text: "60分钟", days: 120 },
  "30m": { klt: "30", text: "30分钟", days: 90 },
}

/** 解析「日K / 周K / 60分钟」这类周期前缀 */
export function parsePeriod(text) {
  const t = String(text ?? "").trim()
  const map = [
    [/^(周k|周K|week)$/, "w"],
    [/^(月k|月K|month)$/, "m"],
    [/^(60分钟|60m|小时k|小时K)$/, "60m"],
    [/^(30分钟|30m)$/, "30m"],
    [/^(日k|日K|day)$/, "d"],
  ]
  for (const [re, key] of map) if (re.test(t)) return key
  return null
}

/* ------------------------------------------------------------ 技术分析 */

export async function fetchTechnical(query, period = "d") {
  const target = await resolve(query, { allowBoard: false })
  if (!target) throw new Error(`没找到「${query}」`)

  const cfg = PERIOD_MAP[period] ?? PERIOD_MAP.d
  const data = await kline(target.secid, cfg.klt, { beg: ymd(-cfg.days), end: ymd(0) })
  const bars = data?.bars ?? []
  if (bars.length < 30) throw new Error(`${target.name} K线数据不足（${bars.length} 根），无法做技术分析`)

  const closes = bars.map(b => b.close)
  const highs = bars.map(b => b.high)
  const lows = bars.map(b => b.low)
  const last = closes.length - 1

  const m5 = ma(closes, 5)
  const m10 = ma(closes, 10)
  const m20 = ma(closes, 20)
  const m60 = bars.length >= 60 ? ma(closes, 60) : null
  const { dif, dea, hist } = macd(closes)
  const k = kdj(highs, lows, closes)
  const r6 = rsi(closes, 6)
  const r14 = rsi(closes, 14)
  const b = boll(closes, 20, 2)
  const score = scoreTechnical(bars)

  const lastBar = bars[last]
  const chg = (arr, n) => {
    if (arr.length <= n) return null
    const prev = arr[arr.length - 1 - n]
    return prev ? ((arr[arr.length - 1] - prev) / prev) * 100 : null
  }

  return {
    name: data.name || target.name,
    code: data.code || target.code,
    secid: target.secid,
    period: cfg.text,
    price: lastBar.close,
    chgPct: lastBar.chgPct,
    date: lastBar.date,
    bars,
    score,
    indicators: {
      ma5: m5[last],
      ma10: m10[last],
      ma20: m20[last],
      ma60: m60 ? m60[last] : null,
      dif: dif[last],
      dea: dea[last],
      macd: hist[last],
      k: k.k[last],
      d: k.d[last],
      j: k.j[last],
      rsi6: r6[last],
      rsi14: r14[last],
      bollUp: b.up[last],
      bollMid: b.mid[last],
      bollLow: b.low[last],
    },
    perf: {
      d5: chg(closes, 5),
      d20: chg(closes, 20),
      d60: closes.length > 60 ? chg(closes, 60) : null,
    },
  }
}

/* ------------------------------------------------------------ 股票卡片 */

export async function fetchStockCard(query) {
  const target = await resolve(query, { allowBoard: false })
  if (!target) throw new Error(`没找到「${query}」`)

  const [q, kl] = await Promise.all([
    quote(target.secid).catch(() => null),
    kline(target.secid, KLT.d, { beg: ymd(-400), end: ymd(0) }).catch(() => null),
  ])
  if (!q && !kl?.bars?.length) throw new Error(`${target.name} 行情获取失败`)

  const bars = kl?.bars ?? []
  const closes = bars.map(b => b.close)
  const info = stockInfo(target.code ?? q?.code)
  const lastBar = bars[bars.length - 1]
  const price = q?.price ?? lastBar?.close
  const chgPct = q?.chgPct ?? lastBar?.chgPct

  const chg = n => {
    if (closes.length <= n) return null
    const prev = closes[closes.length - 1 - n]
    return prev ? ((closes[closes.length - 1] - prev) / prev) * 100 : null
  }

  return {
    name: q?.name || kl?.name || target.name,
    code: q?.code || kl?.code || target.code,
    price,
    chgPct,
    chg: q?.chg ?? lastBar?.chg,
    open: q?.open ?? lastBar?.open,
    high: q?.high ?? lastBar?.high,
    low: q?.low ?? lastBar?.low,
    preClose: q?.preClose ?? (lastBar ? lastBar.close - lastBar.chg : null),
    turnover: q?.turnover ?? lastBar?.turnover,
    amount: q?.amount ?? lastBar?.amount,
    amplitude: q?.amplitude ?? lastBar?.amplitude,
    pe: q?.pe,
    pb: q?.pb,
    marketCap: q?.marketCap,
    floatCap: q?.floatCap,
    industry: info ? [info.industry_l1, info.industry_l2].filter(Boolean).join(" / ") : "",
    score: scoreTechnical(bars),
    perf: { d5: chg(5), d20: chg(20), d60: bars.length > 60 ? chg(60) : null },
    closes: closes.slice(-60),
  }
}

/* ------------------------------------------------------------ 自动选股 */

const CMP = { ">": (a, b) => a > b, ">=": (a, b) => a >= b, "<": (a, b) => a < b, "<=": (a, b) => a <= b }

function toNum(s) {
  const n = Number(String(s ?? "").replace(/[^\d.-]/g, ""))
  return Number.isFinite(n) ? n : null
}

/**
 * 解析选股条件，例如「市值50-200 PE<30 涨跌幅>2 换手>3 成交额>5亿 行业 半导体」
 * @returns {{filters: Array, keyword: string, rest: string}}
 */
export function parseScreenConditions(text) {
  const tokens = String(text ?? "")
    .replace(/[，,、]/g, " ")
    .split(/\s+/)
    .filter(Boolean)

  const filters = []
  let keyword = ""
  let needPE = false

  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i]

    // 行业/概念关键词（后面可能跟空格分隔的名称）
    let m = tk.match(/^(行业|概念|板块)[:：]?(.*)$/)
    if (m) {
      keyword = (m[2] || tokens[i + 1] || "").trim()
      if (!m[2] && tokens[i + 1]) i++
      continue
    }

    // 市值区间 50-200 或 >100
    m = tk.match(/^市值(\d+(?:\.\d+)?)[-~至](\d+(?:\.\d+)?)$/)
    if (m) {
      filters.push({ key: "capYi", label: `市值 ${m[1]}~${m[2]}亿`, test: r => r.capYi >= +m[1] && r.capYi <= +m[2] })
      continue
    }
    m = tk.match(/^市值([><]=?)(\d+(?:\.\d+)?)$/)
    if (m) {
      filters.push({ key: "capYi", label: `市值${m[1]}${m[2]}亿`, test: r => CMP[m[1]](r.capYi, +m[2]) })
      continue
    }

    // 区间写法：涨跌幅3-8 / 换手2-10 / PE10-30
    m = tk.match(/^(PE|涨跌幅|涨幅|换手|换手率)(\d+(?:\.\d+)?)[-~至](\d+(?:\.\d+)?)$/i)
    if (m) {
      const lo = +m[2]
      const hi = +m[3]
      const isPE = /^pe$/i.test(m[1])
      const key = isPE ? "pe" : /换手/.test(m[1]) ? "turnover" : "chg"
      if (isPE) needPE = true
      const name = isPE ? "PE" : /换手/.test(m[1]) ? "换手" : "涨跌幅"
      filters.push({
        key,
        label: `${name} ${lo}~${hi}${isPE ? "" : "%"}`,
        test: r => r[key] >= lo && r[key] <= hi,
      })
      continue
    }

    // PE
    m = tk.match(/^PE([><]=?)(\d+(?:\.\d+)?)$/i)
    if (m) {
      needPE = true
      filters.push({ key: "pe", label: `PE${m[1]}${m[2]}`, test: r => CMP[m[1]](r.pe, +m[2]) })
      continue
    }

    // 涨跌幅
    m = tk.match(/^(?:涨跌幅|涨幅|跌幅)([><]=?)(-?\d+(?:\.\d+)?)$/)
    if (m) {
      filters.push({ key: "chg", label: `涨跌幅${m[1]}${m[2]}%`, test: r => CMP[m[1]](r.chg, +m[2]) })
      continue
    }

    // 换手率
    m = tk.match(/^换手(?:率)?([><]=?)(\d+(?:\.\d+)?)$/)
    if (m) {
      filters.push({ key: "turnover", label: `换手${m[1]}${m[2]}%`, test: r => CMP[m[1]](r.turnover, +m[2]) })
      continue
    }

    // 成交额（亿/万）
    m = tk.match(/^成交额([><]=?)(\d+(?:\.\d+)?)(亿|万)?$/)
    if (m) {
      const unit = m[3] === "万" ? 1e4 : 1e8
      filters.push({
        key: "amount",
        label: `成交额${m[1]}${m[2]}${m[3] ?? "亿"}`,
        test: r => CMP[m[1]](r.amount / unit, +m[2]),
      })
      continue
    }

    // 价格
    m = tk.match(/^(?:股价|价格)([><]=?)(\d+(?:\.\d+)?)$/)
    if (m) {
      filters.push({ key: "price", label: `股价${m[1]}${m[2]}`, test: r => CMP[m[1]](r.price, +m[2]) })
      continue
    }

    if (!keyword) keyword = tk
  }

  return { filters, keyword, needPE }
}

/**
 * 全市场筛选。
 * 主源用热力图接口（一次拿全市场 5000+ 只，不翻页）；
 * 需要 PE 时再补一次列表接口（热力图不含 PE）。
 */
export async function screenStocks({ filters = [], keyword = "", limit = 20 } = {}) {
  const rows = await hotmap()
  let universe = rows.map(r => ({
    code: r.code,
    name: r.name,
    price: r.price,
    chg: r.chg,
    capYi: r.cap / 1e8,
    turnover: r.turnover,
    amount: r.amount,
    pe: null,
    industry: stockInfo(r.code)?.industry_l1 ?? "",
    industryAll: (() => {
      const i = stockInfo(r.code)
      return i ? [i.industry_l1, i.industry_l2, i.industry_l3].filter(Boolean).join("/") : ""
    })(),
  }))

  const needPE = filters.some(f => f.key === "pe")
  let peFilled = false
  if (needPE) {
    // 列表接口带 f9(市盈率)，翻到多少算多少；失败则退化为不支持 PE 条件
    const peRows = await clistMany(
      { fs: "m:0 t:6,m:0 t:80,m:1 t:2,m:1 t:23", fid: "f20", po: 1, fields: ["f9", "f12"] },
      600,
    ).catch(() => [])
    if (peRows.length) {
      const peMap = new Map(peRows.map(r => [String(r.f12), Number(r.f9)]))
      for (const u of universe) {
        const pe = peMap.get(u.code)
        if (Number.isFinite(pe) && pe > 0) {
          u.pe = pe
          peFilled = true
        }
      }
    }
    if (!peFilled) {
      throw new Error("PE 数据源（东财列表接口）当前不可用，请去掉 PE 条件再试")
    }
  }

  if (keyword) {
    // 行业按「段前缀」匹配：「白酒」不该命中「非白酒」，但应命中「白酒Ⅱ / 白酒Ⅲ」
    universe = universe.filter(u => {
      if (u.productName === keyword) return true
      if ((u.name ?? "").includes(keyword)) return true
      if (u.code === keyword) return true
      const segs = String(u.industryAll ?? "").split("/").filter(Boolean)
      return segs.some(seg => seg === keyword || seg.startsWith(keyword))
    })
  }

  const active = filters.filter(f => f.key !== "pe" || peFilled)
  universe = universe.filter(u => active.every(f => {
    const v = u[f.key]
    if (f.key === "pe") return Number.isFinite(v) && f.test(u)
    return Number.isFinite(v ?? NaN) ? f.test(u) : false
  }))

  universe.sort((a, b) => b.chg - a.chg)
  return {
    matched: universe.length,
    total: rows.length,
    rows: universe.slice(0, limit),
    conditions: [...active.map(f => f.label), keyword ? `行业/名称含「${keyword}」` : ""].filter(Boolean),
  }
}

/* ------------------------------------------------------------ 组合体检 */

/** 本地字典只收个股，ETF/LOF/指数要单独归类，否则全被算进「未分类」 */
function classifyNonStock(code) {
  const c = String(code ?? "")
  if (/^(15|16|18|50|51|52|56|58)/.test(c)) return "ETF/基金"
  if (/^(11|12)/.test(c)) return "可转债"
  if (/^9/.test(c)) return "B股/其他"
  return "未分类"
}

const HHI_WARN = 0.25
const TOP_WARN = 40

export async function fetchPortfolioCheck(uid, queries = null) {
  let secids = queries
  if (!secids) {
    secids = getWatch(uid)
    if (!secids.length) throw new Error("你还没有自选，先「#添加自选 600519」或用「#组合体检 600519 510300」指定标的")
  }

  const list = []
  const missing = []
  for (const s of secids.slice(0, 20)) {
    const target = await resolve(s, { allowBoard: false }).catch(() => null)
    if (!target) {
      missing.push(s)
      continue
    }
    const code = target.code ?? String(target.secid).split(".")[1]
    const info = stockInfo(code)
    list.push({
      // 快照不可用时 resolve 会把 secid 当名字返回，这里退化成纯代码
      name: /^\d+\./.test(String(target.name)) ? code : target.name,
      code,
      industry: info?.industry_l1 ?? classifyNonStock(code),
      industry2: info?.industry_l2 ?? "",
    })
  }
  if (!list.length) throw new Error("这些标的都没识别出来")

  // 等权处理：自选没有仓位信息，按等权估算行业暴露
  const byIndustry = new Map()
  for (const item of list) {
    byIndustry.set(item.industry, (byIndustry.get(item.industry) ?? 0) + 1)
  }
  const total = list.length
  const dist = [...byIndustry.entries()]
    .map(([name, count]) => ({ name, count, weight: (count / total) * 100 }))
    .sort((a, b) => b.weight - a.weight)

  const hhi = dist.reduce((a, d) => a + (d.weight / 100) ** 2, 0)
  const top = dist[0]

  const warnings = []
  if (total < 3) warnings.push({ level: "warn", text: `只有 ${total} 只标的，分散度不足，单只波动会直接放大到整个组合` })
  if (top && top.weight >= TOP_WARN) {
    warnings.push({ level: "danger", text: `${top.name} 占比 ${top.weight.toFixed(0)}%，单行业暴露过高（阈值 ${TOP_WARN}%）` })
  }
  if (hhi >= HHI_WARN) {
    warnings.push({
      level: "warn",
      text: `赫芬达尔指数 ${hhi.toFixed(3)}，高于 ${HHI_WARN}，行业集中度偏高`,
    })
  }
  if (!warnings.length) warnings.push({ level: "ok", text: "行业分布较分散，未触发集中度预警" })

  const details = await Promise.all(
    list.slice(0, 12).map(async item => {
      const q = await quote(itemSecid(item.code)).catch(() => null)
      return { ...item, chgPct: q?.chgPct ?? null, price: q?.price ?? null }
    }),
  )

  return { total, dist, hhi, top, warnings, details, missing, asOf: cnDate(0) }
}

function itemSecid(code) {
  const c = String(code)
  return /^(60|68|5|9)/.test(c) ? `1.${c}` : `0.${c}`
}

export { ulist, clist }
