/**
 * 场内 ETF 工具：
 *  - ETF找股：按个股反查持有它的场内 ETF（东财基金反查 zlsj/detail），按主题归类并给出权重
 *  - ETF对比：并排对比 2~4 只 ETF 的前十大持仓与申万二级行业权重（东财基金持仓接口）
 *
 * 与原版 stock_info/etf_compare.py 的口径差异：原版用交易所申赎清单（全量篮子），
 * 本移植版用东财「前十大持仓」作稳健代理，覆盖沪/深全部 ETF，且不依赖交易所 XML 接口。
 */

import { rawGet } from "./em.js"
import { resolve } from "./symbol.js"
import { stockInfo } from "./stockdb.js"
import { fetchFundHoldings } from "./fund.js"

const HOLDER_URL = "https://data.eastmoney.com/dataapi/zlsj/detail"
const ETF_RE = /^(15|51|52|56|58)\d{4}$/
const STOCK_RE = /^(00|30|60|68)\d{4}$/
const UNKNOWN_INDUSTRY = "未匹配申万二级"
export const MAX_COMPARE = 4

const THEMES = [
  ["酒类", ["中证酒", "白酒", "酒ETF"]],
  ["食品饮料", ["食品饮料", "细分食品", "饮食ETF"]],
  ["消费电子", ["消费电子", "全指电子", "中证电子"]],
  ["通信与5G", ["通信", "5G", "光通信"]],
  ["人工智能与算力", ["人工智能", "算力", "AIGC", "机器人"]],
  ["半导体", ["半导体", "芯片"]],
  ["计算机与软件", ["计算机", "软件", "信创", "云计算", "大数据", "传媒", "游戏"]],
  ["工业互联网", ["工业互联网", "工业互联"]],
  ["智能制造", ["智能制造", "工业4.0", "高端制造"]],
  ["汽车与智能驾驶", ["新能源车", "新能源汽车", "智能汽车", "汽车", "车联网"]],
  ["新能源与电池", ["新能源", "电池", "锂电", "储能", "光伏", "风电", "碳中和"]],
  ["医药与医疗", ["医药", "医疗", "创新药", "中药", "生物"]],
  ["银行", ["银行"]],
  ["证券与金融", ["证券", "券商", "非银", "金融", "保险"]],
  ["有色与贵金属", ["有色", "黄金", "稀土", "铜", "金属"]],
  ["能源与周期", ["煤炭", "石油", "石化", "化工", "钢铁", "电力", "公用事业"]],
  ["军工与航天", ["军工", "国防", "航天", "航空"]],
  ["红利与高股息", ["红利", "高股息", "现金流"]],
  ["基建与地产", ["地产", "房地产", "基建", "建材", "建筑"]],
  ["农林牧渔", ["农业", "养殖", "畜牧", "农牧"]],
  ["交通运输", ["交运", "物流", "航运"]],
  ["大消费", ["消费"]],
  ["宽基", ["上证50", "上证180", "沪深300", "A500", "中证100", "中证500", "中证800", "中证1000", "中证2000", "科创50", "科创板", "创业板", "深证100", "深证成指", "MSCI"]],
]

export function isETFCode(code) { return ETF_RE.test(String(code || "")) }

export function fundTheme(name) {
  const text = String(name || "").toUpperCase()
  for (const [theme, keys] of THEMES) {
    if (keys.some(k => text.includes(k.toUpperCase()))) return theme
  }
  return "其他主题"
}

function p2(n) { return String(n).padStart(2, "0") }

/** 最近 n 个季度末报告期（降序），用于基金反查的 ReportDate */
export function recentPeriods(n) {
  const now = new Date()
  const out = []
  let y = now.getFullYear()
  const qEnds = [[12, 31], [9, 30], [6, 30], [3, 31]]
  for (let year = y; out.length < (n || 6); year--) {
    for (const [m, d] of qEnds) {
      const day = new Date(year, m - 1, d)
      if (day.getTime() > now.getTime()) continue
      out.push(year + "-" + p2(m) + "-" + p2(d))
      if (out.length >= (n || 6)) break
    }
    if (year < now.getFullYear() - 3) break
  }
  return out
}

export async function resolveStock(query) {
  const t = await resolve(query).catch(() => null)
  if (!t || !STOCK_RE.test(String(t.code))) return null
  return { code: String(t.code), name: t.name }
}

export async function resolveETFCode(query) {
  const q = String(query || "").trim()
  if (!q) return null
  if (ETF_RE.test(q)) return q
  const lower = q.toLowerCase()
  const last6 = lower.slice(-6)
  if (ETF_RE.test(last6) && (lower === last6 || lower === "sh" + last6 || lower === "sz" + last6)) return last6
  const t = await resolve(q).catch(() => null)
  if (t && isETFCode(t.code)) return String(t.code)
  return null
}

/* ------------------------------------------------------------ ETF 找股 */

async function fetchHolderPage(stock, period, page) {
  return rawGet(
    HOLDER_URL,
    {
      SHType: "1",
      SHCode: "",
      SCode: stock,
      ReportDate: period,
      sortField: "NETASSET_RATIO",
      sortDirec: "1",
      pageNum: String(page),
      pageSize: "100",
    },
    {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://data.eastmoney.com/zlsj/detail/" + period + "-1-" + stock + ".html",
        "X-Requested-With": "XMLHttpRequest",
      },
      timeout: 12000,
      retry: 1,
    },
  )
}

export async function latestETFPeriod(stock) {
  for (const period of recentPeriods(8)) {
    try {
      const res = await fetchHolderPage(stock, period, 1)
      const rows = res && res.data
      if (Array.isArray(rows) && rows.length) return period
    } catch (err) {
      /* 该季度无数据，继续往前找 */
    }
  }
  return null
}

export async function searchETFsHolding(stockQuery) {
  const stock = await resolveStock(stockQuery)
  if (!stock) throw new Error("未识别到沪深 A 股，请输入股票名称或六位代码")
  const period = await latestETFPeriod(stock.code)
  if (!period) throw new Error("未获取到基金反查数据（东财披露可能延迟，可稍后重试）")

  const funds = new Map()
  let pages = 1
  for (let page = 1; page <= Math.min(pages, 8); page++) {
    const res = await fetchHolderPage(stock.code, period, page)
    if (!res || !Array.isArray(res.data)) break
    if (typeof res.pages === "number" && res.pages > 0) pages = res.pages
    for (const row of res.data) {
      const code = String(row.HOLDER_CODE || "")
      const name = String(row.HOLDER_NAME || "")
      if (!isETFCode(code)) continue
      if (!/ETF/i.test(name)) continue
      if (name.includes("联接")) continue
      const w = Number(row.NETASSET_RATIO) || 0
      const prev = funds.get(code)
      if (prev) prev.weight = Math.max(prev.weight, w)
      else funds.set(code, { code, name, weight: w })
    }
    if (res.data.length < 100) break
  }
  if (!funds.size) throw new Error("未找到持有「" + stock.name + "」的场内 ETF")

  const list = [...funds.values()]
    .map(f => ({ ...f, theme: fundTheme(f.name) }))
    .sort((a, b) => b.weight - a.weight)
  const themeMap = new Map()
  for (const f of list) {
    if (!themeMap.has(f.theme)) themeMap.set(f.theme, [])
    themeMap.get(f.theme).push(f)
  }
  const themes = [...themeMap.entries()]
    .map(([theme, items]) => ({ theme, funds: items }))
    .sort((a, b) => b.funds.length - a.funds.length)
  return { stock, period, funds: list, themes }
}

/* ------------------------------------------------------------ ETF 对比 */

/** 单只 ETF 前十大持仓 + 申万二级行业权重 */
export async function fetchETFHoldings(codeValue) {
  const code = await resolveETFCode(codeValue)
  if (!code) throw new Error("「" + codeValue + "」不是有效的场内 ETF 代码或名称")
  const data = await fetchFundHoldings(code)
  const rows = (data.rows || []).map(r => ({
    code: r.code,
    name: r.name,
    weight: r.weight,
    industry: (stockInfo(r.code) && stockInfo(r.code).industry_l2) || UNKNOWN_INDUSTRY,
  }))
  const industryMap = new Map()
  for (const r of rows) {
    const key = r.industry || UNKNOWN_INDUSTRY
    industryMap.set(key, (industryMap.get(key) || 0) + r.weight)
  }
  const industries = [...industryMap.entries()]
    .map(([name, weight]) => ({ name, weight }))
    .sort((a, b) => b.weight - a.weight)
  return { code, name: data.name, rows, industries, totalWeight: data.totalWeight }
}

export async function compareETFs(codeValues, focus) {
  const codes = codeValues.slice(0, MAX_COMPARE)
  const list = []
  const failures = []
  for (const c of codes) {
    try {
      list.push(await fetchETFHoldings(c))
    } catch (err) {
      failures.push((err && err.message) ? err.message : String(c))
    }
  }
  if (!list.length) throw new Error("未获取到任何 ETF 的持仓数据：" + failures.join("；"))
  return { list, failures, focus: focus ? String(focus).trim() : "" }
}
