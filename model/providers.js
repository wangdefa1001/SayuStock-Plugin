/**
 * 备用行情源：腾讯 / 新浪 / 天天基金。
 *
 * 东财按端点限流时（ulist/clist/stock/get/trends2/kline 会被逐个断连），
 * 这些源可以做兜底。返回结构对齐 model/em.js，调用方不需要分支判断。
 *
 * 注意：新浪、腾讯返回 GBK 编码，必须按 arrayBuffer + TextDecoder('gbk') 解。
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

async function getGBK(url, headers = {}, timeout = 10000) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeout)
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { "User-Agent": UA, ...headers } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return new TextDecoder("gbk").decode(Buffer.from(await res.arrayBuffer()))
  } finally {
    clearTimeout(timer)
  }
}

async function getJSON(url, headers = {}, timeout = 10000) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeout)
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { "User-Agent": UA, ...headers } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return JSON.parse(await res.text())
  } finally {
    clearTimeout(timer)
  }
}

/** 东财 secid → 腾讯/新浪用的 sh600519 / sz000001 / bj430047 */
export function toSymbol(secid) {
  const [mkt, code] = String(secid ?? "").split(".")
  if (!code) return null
  if (mkt === "1") return `sh${code}`
  if (mkt === "0") return /^(4|8)/.test(code) ? `bj${code}` : `sz${code}`
  if (mkt === "2") return `sh${code}` // 部分指数在 2 段，腾讯用 sh/sz 均可
  return null
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/* ------------------------------------------------------------- 腾讯快照 */

/**
 * 腾讯批量快照，返回与东财 ulist 同构的行（f2 现价 / f3 涨跌幅 / …）
 */
export async function tencentQuotes(secids = []) {
  const symbols = secids.map(toSymbol).filter(Boolean)
  if (!symbols.length) return []
  const text = await getGBK(`https://qt.gtimg.cn/q=${symbols.join(",")}`)
  const rows = []
  for (const line of text.split(";")) {
    const m = line.match(/v_([a-z]{2}\d{6})="([^"]*)"/)
    if (!m) continue
    const f = m[2].split("~")
    if (f.length < 46) continue
    const price = num(f[3])
    if (price === null) continue
    rows.push({
      f2: price,
      f3: num(f[32]),
      f4: num(f[31]),
      f5: num(f[36]),
      f6: (num(f[37]) ?? 0) * 1e4, // 成交额：万元 → 元
      f8: num(f[38]),
      f9: num(f[39]),
      f12: f[2],
      f13: m[1].startsWith("sh") ? 1 : 0,
      f14: f[1],
      f18: num(f[4]),
      f20: (num(f[45]) ?? 0) * 1e8, // 总市值：亿 → 元
      f23: num(f[46]),
      // 备用源不提供的字段留空，调用方按 null 处理
      f15: num(f[33]),
      f16: num(f[34]),
      f17: num(f[5]),
      f171: num(f[43]),
    })
  }
  return rows
}

/** 腾讯单只快照 → model/em.js 的 quote() 结构 */
export async function tencentQuote(secid) {
  const [row] = await tencentQuotes([secid])
  if (!row) return null
  return {
    secid,
    code: row.f12,
    name: row.f14,
    decimal: 2,
    price: row.f2,
    high: row.f15,
    low: row.f16,
    open: row.f17,
    preClose: row.f18,
    volume: row.f5,
    amount: row.f6,
    chg: row.f4,
    chgPct: row.f3,
    amplitude: row.f171,
    turnover: row.f8,
    pe: row.f9,
    pb: row.f23,
    marketCap: row.f20,
    floatCap: null,
    time: null,
  }
}

/* ------------------------------------------------------------- 新浪快照 */

/** 新浪批量快照（字段比腾讯少：无 PE/PB/市值） */
export async function sinaQuotes(secids = []) {
  const symbols = secids.map(toSymbol).filter(Boolean)
  if (!symbols.length) return []
  const text = await getGBK(`https://hq.sinajs.cn/list=${symbols.join(",")}`, {
    Referer: "https://finance.sina.com.cn/",
  })
  const rows = []
  for (const line of text.split("\n")) {
    const m = line.match(/hq_str_([a-z]{2}\d{6})="([^"]*)"/)
    if (!m) continue
    const f = m[2].split(",")
    if (f.length < 32 || !f[0]) continue
    const price = num(f[3])
    const preClose = num(f[2])
    if (price === null || !preClose) continue
    const chg = price - preClose
    rows.push({
      f2: price,
      f3: (chg / preClose) * 100,
      f4: chg,
      f5: (num(f[8]) ?? 0) / 100, // 成交量：股 → 手
      f6: num(f[9]),
      f12: m[1].slice(2),
      f13: m[1].startsWith("sh") ? 1 : 0,
      f14: f[0],
      f18: preClose,
      f17: num(f[1]),
      f15: num(f[4]),
      f16: num(f[5]),
      f171: preClose ? ((num(f[4]) - num(f[5])) / preClose) * 100 : null,
    })
  }
  return rows
}

/* --------------------------------------------------------------- K线 */

const KLT_TENCENT = {
  "101": "day",
  "102": "week",
  "103": "month",
  "60": "m60",
  "30": "m30",
  "15": "m15",
  "5": "m5",
}

/**
 * 腾讯 K 线（前复权）→ model/em.js 的 kline() 结构
 * 返回行：[日期, 开, 收, 高, 低, 成交量(手)]
 */
export async function tencentKline(secid, klt = "101", count = 260) {
  const symbol = toSymbol(secid)
  const period = KLT_TENCENT[String(klt)]
  if (!symbol || !period) return null
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},${period},,,${count},qfq`
  const json = await getJSON(url, { Referer: "https://gu.qq.com/" })
  const node = json?.data?.[symbol]
  const list = node?.[`qfq${period}`] ?? node?.[period]
  if (!Array.isArray(list) || !list.length) return null

  const bars = []
  let prevClose = null
  for (const row of list) {
    const [date, open, close, high, low, volume, amount] = row
    const o = num(open)
    const c = num(close)
    const h = num(high)
    const l = num(low)
    if (!Number.isFinite(o) || !Number.isFinite(c)) continue
    const chg = prevClose === null ? 0 : c - prevClose
    const chgPct = prevClose ? (chg / prevClose) * 100 : 0
    bars.push({
      date: String(date),
      open: o,
      close: c,
      high: h ?? c,
      low: l ?? c,
      volume: num(volume) ?? 0,
      // 腾讯 K 线不返成交额/换手，置 null 让渲染层显示 "--" 而不是假的 0
      amount: num(amount) ?? null,
      amplitude: prevClose ? ((h - l) / prevClose) * 100 : 0,
      chgPct,
      chg,
      turnover: null,
    })
    prevClose = c
  }
  if (!bars.length) return null
  return { secid, code: symbol.slice(2), name: node?.qt?.[symbol]?.[1] ?? "", decimal: 2, bars }
}

/* --------------------------------------------------------------- 分时 */

/**
 * 腾讯分时 → model/em.js 的 trends() 结构
 * 行格式："0930 1458.88 442 64482496.00"（时间 价 累计成交量(手) 累计成交额）
 */
export async function tencentIntraday(secid, ndays = 1) {
  const symbol = toSymbol(secid)
  if (!symbol || ndays > 1) return null // 备用源只支持当日分时
  const json = await getJSON(`https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${symbol}`, {
    Referer: "https://gu.qq.com/",
  })
  const node = json?.data?.[symbol]
  const list = node?.data?.data
  if (!Array.isArray(list) || !list.length) return null

  const rawDate = String(node?.data?.date ?? "")
  const date = /^\d{8}$/.test(rawDate) ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}` : rawDate
  const preClose = Number(node?.qt?.[symbol]?.[4]) || null

  let prevVol = 0
  let prevAmt = 0
  const points = []
  for (const line of list) {
    const [hm, priceRaw, volRaw, amtRaw] = String(line).split(" ")
    const price = num(priceRaw)
    if (!price) continue
    const vol = num(volRaw) ?? 0
    const amt = num(amtRaw) ?? 0
    const cumVol = vol
    const cumAmt = amt
    const avg = cumVol > 0 ? (cumAmt / (cumVol * 100)) || price : price
    points.push({
      ts: `${date} ${hm.slice(0, 2)}:${hm.slice(2, 4)}`,
      date,
      time: `${hm.slice(0, 2)}:${hm.slice(2, 4)}`,
      price,
      open: price,
      high: price,
      low: price,
      volume: Math.max(cumVol - prevVol, 0),
      amount: Math.max(cumAmt - prevAmt, 0),
      avg,
    })
    prevVol = cumVol
    prevAmt = cumAmt
  }
  if (!points.length) return null
  return {
    secid,
    code: symbol.slice(2),
    name: node?.qt?.[symbol]?.[1] ?? "",
    decimal: 2,
    preClose: preClose ?? points[0].price,
    points,
    ndays: 1,
  }
}

/* ----------------------------------------------------------- 场外基金净值 */

/**
 * 天天基金历史净值（单位净值 DWJZ / 累计净值 LJJZ / 日增长率 JZZZL）
 * @param {string} code 6 位基金代码
 * @param {number} size 取多少条（按日期倒序返回后翻转）
 */
export async function fundNavHistory(code, size = 400) {
  // f10/lsjz 单页只给 20 条，改用基金 App 接口（pageSize 可到 500）
  const json = await getJSON(
    `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNHisNetList?pageIndex=1&pageSize=${Math.min(
      Math.max(Number(size) || 400, 20),
      500,
    )}&FCODE=${encodeURIComponent(code)}&deviceid=Wap&plat=Wap&product=EFund&version=2.0.0`,
    // 这个接口挑 UA：完整 Chrome UA 会回「网络繁忙」，用短 UA + Referer 才通
    { "User-Agent": "Mozilla/5.0", Referer: "https://fund.eastmoney.com/" },
    12000,
  )
  const list = json?.Datas
  if (!Array.isArray(list) || !list.length) return null
  const rows = list
    .map(i => ({
      date: i.FSRQ,
      nav: num(i.DWJZ),
      accNav: num(i.LJJZ),
      chgPct: num(i.JZZZL),
    }))
    .filter(i => i.date && Number.isFinite(i.nav))
    .reverse()
  return rows.length ? rows : null
}
