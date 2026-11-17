/**
 * 东方财富行情接口封装。
 *
 * 全部字段口径以 SayuStock(gsuid_core 版) 的东财适配层为准：
 *  - 实时快照   push2/api/qt/stock/get
 *  - 批量快照   push2/api/qt/ulist.np/get
 *  - 分时       push2(his)/api/qt/stock/trends2/get
 *  - K线        push2his/api/qt/stock/kline/get
 *  - 板块列表   push2/api/qt/clist/get
 *  - 涨跌分布   quotederivates/datacenter/updowndistribution
 *  - 名称搜索   searchapi/api/suggest/get
 */

import { stockName } from "./stockdb.js"
import { tencentQuotes, tencentQuote, sinaQuotes, tencentKline, tencentIntraday } from "./providers.js"

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

const log = globalThis.logger ?? console

export class StockError extends Error {
  constructor(message) {
    super(message)
    this.name = "StockError"
  }
}

function qs(params = {}) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue
    sp.append(k, String(v))
  }
  return sp.toString()
}

/** 简易 TTL 缓存 + 并发闸门：降低被东财限流的概率（同一 IP 高频访问会被断连） */
const CACHE = new Map()
const MAX_CONCURRENCY = 4
let running = 0
const waiting = []

async function withSlot(fn) {
  if (running >= MAX_CONCURRENCY) await new Promise(resolve => waiting.push(resolve))
  running++
  try {
    return await fn()
  } finally {
    running--
    const next = waiting.shift()
    if (next) next()
  }
}

function cached(key, ttlMs, fn) {
  const hit = CACHE.get(key)
  if (hit && Date.now() - hit.t < ttlMs) return Promise.resolve(hit.v)
  return withSlot(fn).then(v => {
    CACHE.set(key, { t: Date.now(), v })
    if (CACHE.size > 800) {
      const now = Date.now()
      for (const [k, item] of CACHE) if (now - item.t > 30 * 60 * 1000) CACHE.delete(k)
      if (CACHE.size > 800) CACHE.delete(CACHE.keys().next().value)
    }
    return v
  })
}

export function clearCache() {
  CACHE.clear()
}

/**
 * 主机级熔断：同一接口连续失败后短时间内直接失败，
 * 避免东财整体限流时每个指令都卡满重试时间（实测能到 20~40 秒）。
 */
const FAIL_COOLDOWN = 20000
const failAt = new Map()

const failKey = url => String(url).replace(/^https?:\/\//, "").split("/")[0] + "/" + (String(url).split("/api/")[1]?.split("?")[0] ?? "")

async function getJSON(url, params, { timeout = 15000, retry = 2, headers = {} } = {}) {
  const finalUrl = params ? `${url}?${qs(params)}` : url
  const key = failKey(url)
  const cooling = failAt.get(key)
  if (cooling && Date.now() - cooling < FAIL_COOLDOWN) {
    throw new StockError(`请求失败 ${url}: 接口刚失败过，${Math.ceil((FAIL_COOLDOWN - (Date.now() - cooling)) / 1000)} 秒后重试`)
  }

  const BACKOFF = [0, 700, 1800, 3500]
  let lastErr
  for (let i = 0; i <= retry; i++) {
    if (BACKOFF[i]) await new Promise(r => setTimeout(r, BACKOFF[i] + Math.random() * 300))
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeout)
    try {
      const res = await fetch(finalUrl, {
        signal: ac.signal,
        headers: {
          "User-Agent": UA,
          Accept: "*/*",
          "Accept-Language": "zh-CN,zh;q=0.9",
          ...headers,
        },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      if (!text) throw new Error("空响应")
      const json = JSON.parse(text)
      failAt.delete(key)
      return json
    } catch (err) {
      lastErr = err
    } finally {
      clearTimeout(timer)
    }
  }
  failAt.set(key, Date.now())
  throw new StockError(`请求失败 ${url}: ${lastErr?.message ?? lastErr}（东财接口偶发限流，稍后重试）`)
}

/** push2 主域失败时自动退到延时域，东财偶发单域 502 */
async function push2JSON(path, params, opt) {
  const hosts = ["https://push2.eastmoney.com", "https://push2delay.eastmoney.com"]
  let lastErr
  for (const host of hosts) {
    try {
      return await getJSON(`${host}${path}`, params, opt)
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
}

const EM_HEADERS = { Referer: "https://quote.eastmoney.com/" }

/* ------------------------------------------------------------------ 快照 */

/** 批量快照，返回 rows（字段值已被 fltt=2 转为浮点） */
export async function ulist(secids, fields = ["f2", "f3", "f4", "f12", "f13", "f14"]) {
  if (!secids?.length) return []
  return cached(`ulist:${secids.join(",")}:${fields.join(",")}`, 5000, async () => {
    try {
      const res = await push2JSON(
        "/api/qt/ulist.np/get",
        { fltt: 2, invt: 2, fields: fields.join(","), secids: secids.join(",") },
        { headers: EM_HEADERS, retry: 1 },
      )
      const rows = res?.data?.diff
      if (rows?.length) return rows
      throw new StockError("批量行情为空")
    } catch (err) {
      // 兜底顺序：腾讯批量 → 新浪批量 → 东财逐只快照 → 日K反推
      for (const alt of [tencentQuotes, sinaQuotes]) {
        const rows = await alt(secids).catch(() => [])
        if (rows.length) return rows
      }
      const rows = await Promise.all(secids.map(s => quoteRow(s).catch(() => null)))
      let valid = rows.filter(Boolean)
      if (!valid.length) {
        // 单只快照也不通时，用日K最后一根反推快照（K线接口限流策略与 push2 不同）
        valid = (await Promise.all(secids.map(s => klineRow(s).catch(() => null)))).filter(Boolean)
      }
      if (!valid.length) throw err
      return valid
    }
  })
}

/** 单只快照 → ulist 的 f 字段形态，供限流兜底使用 */
async function quoteRow(secid) {
  const q = await quote(secid)
  if (!q) return null
  const [mkt] = String(secid).split(".")
  return {
    f2: q.price,
    f3: q.chgPct,
    f4: q.chg,
    f5: q.volume,
    f6: q.amount,
    f8: q.turnover,
    f9: q.pe,
    f12: q.code,
    f13: Number(mkt),
    f14: q.name,
    f18: q.preClose,
    f20: q.marketCap,
    f23: q.pb,
  }
}

const QUOTE_FIELDS = [
  "f43", // 最新价
  "f44", // 最高
  "f45", // 最低
  "f46", // 今开
  "f60", // 昨收
  "f47", // 成交量(手)
  "f48", // 成交额
  "f50", // 量比
  "f57", // 代码
  "f58", // 名称
  "f59", // 小数位
  "f86", // 时间戳
  "f107", // 市场
  "f116", // 总市值
  "f117", // 流通市值
  "f162", // 市盈率(动)
  "f167", // 市净率
  "f168", // 换手率
  "f169", // 涨跌额
  "f170", // 涨跌幅
  "f171", // 振幅
  "f292", // 交易状态
]

/**
 * 单只标的实时快照。
 * 注意：这里不带 fltt=2，东财返回的是「整数放大值」，需要按 f59 小数位还原，
 * 这是 SayuStock 原始实现的取数方式，直接照搬以保证价格精度一致。
 */
export async function quote(secid) {
  return cached(`quote:${secid}`, 5000, async () => {
  // 东财不通时直接用腾讯单只快照顶上
  const em = await emQuote(secid).catch(() => null)
  if (em) return em
  return tencentQuote(secid).catch(() => null)
  })
}

async function emQuote(secid) {
  const res = await push2JSON(
    "/api/qt/stock/get",
    { invt: 2, fltt: 2, secid, fields: QUOTE_FIELDS.join(",") },
    { headers: EM_HEADERS, retry: 1 },
  )
  const d = res?.data
  if (!d) return null
  const num = v => (v === "-" || v === undefined || v === null ? null : Number(v))
  return {
    secid,
    code: d.f57,
    name: d.f58,
    decimal: num(d.f59) ?? 2,
    price: num(d.f43),
    high: num(d.f44),
    low: num(d.f45),
    open: num(d.f46),
    preClose: num(d.f60),
    volume: num(d.f47),
    amount: num(d.f48),
    chg: num(d.f169),
    chgPct: num(d.f170),
    amplitude: num(d.f171),
    turnover: num(d.f168),
    pe: num(d.f162),
    pb: num(d.f167),
    marketCap: num(d.f116),
    floatCap: num(d.f117),
    time: num(d.f86),
  }
}

/** 东财 K 线 beg/end 需要的 YYYYMMDD */
function ymdOffset(days) {
  const d = new Date(Date.now() + 8 * 3600 * 1000 + days * 86400 * 1000)
  const p = n => String(n).padStart(2, "0")
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`
}

/**
 * 用日K最后一根反推快照。
 * 快照接口（stock/get）与列表接口（ulist/clist）常一起被限流，但 K 线接口的
 * 限流策略不同，实测「其它都挂、K线还能取」，所以作为最后一层兜底。
 */
async function klineRow(secid) {
  const data = await kline(secid, KLT.d, { beg: ymdOffset(-15), end: ymdOffset(0) })
  const bars = data?.bars ?? []
  if (!bars.length) return null
  const last = bars[bars.length - 1]
  const preClose = bars.length > 1 ? bars[bars.length - 2].close : last.close - last.chg
  return {
    f2: last.close,
    f3: last.chgPct,
    f4: last.chg,
    f5: last.volume,
    f6: last.amount,
    f8: last.turnover,
    f12: data.code,
    f13: Number(String(secid).split(".")[0]),
    f14: data.name,
    f18: preClose,
  }
}

/* ------------------------------------------------------------------ 分时 */
const TREND_F1 = "f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13"
const TREND_F2 = "f51,f52,f53,f54,f55,f56,f57,f58"

/**
 * 分时数据。ndays=1 走实时域，>1 必须走历史域（实时域会忽略 ndays）。
 * f51 时间, f52 现价, f53 开盘, f54 最高, f55 最低, f56 成交量, f57 成交额, f58 均价
 */
export async function trends(secid, ndays = 1) {
  const days = Math.max(1, Number(ndays) || 1)
  return cached(`trends:${secid}:${days}`, days > 1 ? 60000 : 20000, () => fetchTrends(secid, days))
}

async function fetchTrends(secid, days) {
  const em = await emTrends(secid, days).catch(() => null)
  if (em) return em
  // 备用源只提供当日分时；五日分时东财挂了就明确返回 null
  if (days === 1) return tencentIntraday(secid).catch(() => null)
  return null
}

async function emTrends(secid, days) {
  const base = days > 1 ? "https://push2his.eastmoney.com" : "https://push2.eastmoney.com"
  const params = {
    fields1: TREND_F1,
    fields2: TREND_F2,
    secid,
    iscr: 0,
    iscca: 0,
  }
  if (days > 1) params.ndays = days
  const res = await getJSON(`${base}/api/qt/stock/trends2/get`, params, { headers: EM_HEADERS })
  const data = res?.data
  if (!data?.trends?.length) return null

  const points = []
  for (const line of data.trends) {
    const p = line.split(",")
    if (p.length < 8) continue
    const ts = p[0].trim()
    const open = Number(p[2]) || 0
    let price = Number(p[1]) || 0
    // 集合竞价首分钟现价常为 0，用开盘价顶上，避免 Y 轴被 0 拉爆
    if (!price) price = open
    const avg = Number(p[7]) || price
    if (!price) continue
    points.push({
      ts,
      date: ts.split(" ")[0],
      time: (ts.split(" ")[1] ?? "").slice(0, 5),
      price,
      open,
      high: Number(p[3]) || price,
      low: Number(p[4]) || price,
      volume: Number(p[5]) || 0,
      amount: Number(p[6]) || 0,
      avg,
    })
  }
  if (!points.length) return null

  return {
    secid,
    code: data.code,
    name: data.name,
    decimal: data.decimal ?? 2,
    preClose: Number(data.preClose) || points[0].open || points[0].price,
    points,
    ndays: days,
  }
}

/* -------------------------------------------------------------------- K线 */

export const KLT = {
  d: "101",
  w: "102",
  m: "103",
  q: "104",
  y: "105",
}

/**
 * K线。fields2: 日期,开盘,收盘,最高,最低,成交量,成交额,振幅,涨跌幅,涨跌额,换手率
 */
export async function kline(secid, klt = KLT.d, { beg = "0", end = "20500101", fqt = 1, lmt } = {}) {
  return cached(`kline:${secid}:${klt}:${beg}:${end}:${fqt}:${lmt ?? ""}`, 300000, () =>
    fetchKline(secid, klt, { beg, end, fqt, lmt }),
  )
}

async function fetchKline(secid, klt, { beg, end, fqt, lmt }) {
  const em = await emKline(secid, klt, { beg, end, fqt, lmt }).catch(() => null)
  if (em) return em
  return tencentKline(secid, klt, lmt ?? 260).catch(() => null)
}

async function emKline(secid, klt, { beg, end, fqt, lmt }) {
  const params = {
    fields1: "f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
    rtntype: 6,
    klt,
    fqt,
    secid,
    beg,
    end,
  }
  if (lmt) params.lmt = lmt
  const res = await getJSON("https://push2his.eastmoney.com/api/qt/stock/kline/get", params, {
    headers: EM_HEADERS,
  })
  const data = res?.data
  if (!data?.klines?.length) return null
  const bars = []
  for (const line of data.klines) {
    const p = line.split(",")
    if (p.length < 11) continue
    bars.push({
      date: p[0],
      open: Number(p[1]),
      close: Number(p[2]),
      high: Number(p[3]),
      low: Number(p[4]),
      volume: Number(p[5]),
      amount: Number(p[6]),
      amplitude: Number(p[7]),
      chgPct: Number(p[8]),
      chg: Number(p[9]),
      turnover: Number(p[10]),
    })
  }
  if (!bars.length) return null
  return { secid, code: data.code, name: data.name, decimal: data.decimal ?? 2, bars }
}

/* ------------------------------------------------------------------ 板块 */

/** 板块/成分股列表，fs 形如 "m:90 t:2 f:!50" 或 "b:BK1036" */
export async function clist({
  fs,
  fid = "f3",
  po = 1,
  pz = 100,
  pn = 1,
  fields = ["f2", "f3", "f6", "f8", "f12", "f13", "f14", "f20", "f100", "f104", "f105"],
} = {}) {
  return cached(`clist:${fs}:${fid}:${po}:${pz}:${pn}:${fields.join(",")}`, 60000, async () => {
  const res = await push2JSON(
    "/api/qt/clist/get",
    { pn, pz, po, np: 1, fltt: 2, invt: 2, fid, fs, fields: fields.join(",") },
    { headers: EM_HEADERS, retry: 1 },
  )
  return { total: res?.data?.total ?? 0, rows: res?.data?.diff ?? [] }
  })
}

/** 东财 clist 单页上限 100，需要更多时按页拉取 */
export async function clistMany(opts = {}, want = 240) {
  const pz = 100
  const pages = Math.max(1, Math.ceil(want / pz))
  const rows = []
  for (let pn = 1; pn <= pages; pn++) {
    const { rows: page } = await clist({ ...opts, pz, pn })
    rows.push(...page)
    if (page.length < pz) break
  }
  return rows.slice(0, want)
}

/** 涨跌分布：2 正侧 10 档(由小到大)、3 负侧 10 档、4 平盘、5 涨停、6 跌停 */export async function breadth() {
  return cached("breadth", 60000, async () => {
  const res = await getJSON(
    "https://quotederivates.eastmoney.com/datacenter/updowndistribution",
    { mcodelist: "0.399002,1.000002,0.899050", version: 100, cver: "10.36.2" },
    { headers: { Referer: "https://quote.eastmoney.com/" } },
  )
  const arr = k => (Array.isArray(res?.[k]) ? res[k].map(Number) : [])
  const pos = arr("2")
  const neg = arr("3")
  const sum = (list, idx) => idx.reduce((a, i) => a + (list[i] || 0), 0)
  const buckets = [
    { label: "涨停", value: Number(res?.["5"]) || 0, side: 1, heat: 5.2 },
    { label: ">5%", value: sum(pos, [5, 6, 7, 8, 9]), side: 1, heat: 4.4 },
    { label: "3~5", value: sum(pos, [3, 4]), side: 1, heat: 3.4 },
    { label: "2~3", value: pos[2] || 0, side: 1, heat: 2.4 },
    { label: "1~2", value: pos[1] || 0, side: 1, heat: 1.4 },
    { label: "0~1", value: pos[0] || 0, side: 1, heat: 0.6 },
    { label: "平", value: Number(res?.["4"]) || 0, side: 0, heat: 0 },
    { label: "0~-1", value: neg[0] || 0, side: -1, heat: -0.6 },
    { label: "-1~-2", value: neg[1] || 0, side: -1, heat: -1.4 },
    { label: "-2~-3", value: neg[2] || 0, side: -1, heat: -2.4 },
    { label: "-3~-5", value: sum(neg, [3, 4]), side: -1, heat: -3.4 },
    { label: "<-5%", value: sum(neg, [5, 6, 7, 8, 9]), side: -1, heat: -4.4 },
    { label: "跌停", value: Number(res?.["6"]) || 0, side: -1, heat: -5.2 },
  ]
  const up = buckets.filter(b => b.side > 0).reduce((a, b) => a + b.value, 0)
  const down = buckets.filter(b => b.side < 0).reduce((a, b) => a + b.value, 0)
  const flat = buckets.find(b => b.side === 0)?.value ?? 0
  return { buckets, up, down, flat }
  })
}

/* ---------------------------------------------------------------- 热力图 */

/**
 * 全市场热力图数据（一次返回约 5500 只，含代码/涨跌幅/成交额/市值/换手）。
 * 东财列表接口对高频访问敏感，这条走的是另一台主机（quote.eastmoney.com），
 * 作为大盘云图的主数据源更稳，也省掉翻页。
 * 字段位置：1 代码 / 3 涨跌幅×100 / 10 成交额 / 11 换手×100 / 12 价格×100 / 13 总市值(百万元)
 */
export async function hotmap() {
  return cached("hotmap", 45000, async () => {
    const res = await getJSON("https://quote.eastmoney.com/stockhotmap/api/getquotedata", null, {
      timeout: 20000,
      headers: { Referer: "https://quote.eastmoney.com/" },
    })
    const arr = res?.data
    if (!Array.isArray(arr) || !arr.length) throw new StockError("云图数据为空")
    const rows = []
    for (const line of arr) {
      const p = String(line).split("|")
      if (p.length < 15) continue
      const code = p[1]
      if (!/^\d{6}$/.test(code)) continue
      rows.push({
        code,
        name: stockName(code),
        chg: Number(p[3]) / 100 || 0,
        price: Number(p[12]) / 100 || 0,
        cap: Math.max(Number(p[13]) || 0, Number(p[14]) || 0) * 1e6,
        amount: Number(p[10]) || 0,
        turnover: Number(p[11]) / 100 || 0,
      })
    }
    if (!rows.length) throw new StockError("云图数据解析为空")
    return rows
  })
}

/* ------------------------------------------------------------------ 搜索 */
/** 名称/拼音/代码搜索，返回东财 suggest 原始条目（含 QuoteID 与板块标识） */
export async function suggest(keyword, count = 10) {
  return cached(`suggest:${keyword}:${count}`, 1800000, async () => {
  const res = await getJSON("https://searchapi.eastmoney.com/api/suggest/get", {
    input: keyword,
    type: 14,
    token: "D43BF722C8E33BDC906FB84D85E326E8",
    count,
  })
  const rows = res?.QuotationCodeTable?.Data ?? []
  return rows.map(r => ({
    secid: r.QuoteID,
    code: r.Code,
    name: r.Name,
    type: r.SecurityTypeName,
    classify: r.Classify,
    market: String(r.MktNum ?? ""),
    isBoard: r.Classify === "BK" || String(r.MktNum) === "90" || String(r.QuoteID).startsWith("90."),
  }))
  })
}

/* ---------------------------------------------------------------- 加密货币 */

/** OKX 现货行情，用于全天候卡片的加密板块；失败返回空数组不影响整体 */
export async function okxTickers(instIds = ["BTC-USDT", "ETH-USDT", "SOL-USDT", "BNB-USDT"]) {
  try {
    const res = await getJSON(
      "https://www.okx.com/api/v5/market/tickers",
      { instType: "SPOT" },
      { timeout: 5000, retry: 0 },
    )
    const map = new Map((res?.data ?? []).map(i => [i.instId, i]))
    return instIds
      .map(id => {
        const t = map.get(id)
        if (!t) return null
        const last = Number(t.last)
        const open = Number(t.open24h) || last
        return {
          name: id.replace("-USDT", ""),
          price: last,
          chgPct: open ? ((last - open) / open) * 100 : 0,
        }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

export { getJSON as rawGet }
