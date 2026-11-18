/**
 * 波动率指数（QVIX 系列）：沪深300 / 上证50 / 创业板 / 科创板等期权隐含波动率分时。
 *
 * 数据口径对齐原版 utils/stock/get_vix.py：1.optbbs.com 的当日分时 CSV，
 * 列形如 Time,QVIX,Pre,max,min；时间轴升序、价格取第二列。
 * 该站点仅支持旧版 RSA 套件，Node 现代 TLS 默认可能拒绝，故做超时/失败兜底。
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"
const CSV_URL = "https://1.optbbs.com/d/csv/d/"

export const VIX_LIST = {
  "300ETFVIX": "vix300", "沪深300VIX": "vix300", "HS300VIX": "vix300", "300VIX": "vix300",
  "VIX300": "vix300", "300IV": "vix300", "IV300": "vix300",
  "50VIX": "vix50", "50ETFVIX": "vix50", "50IV": "vix50", "VIX50": "vix50", "IV50": "vix50",
  "1000VIX": "vixindex1000", "VIX1000": "vixindex1000", "IV1000": "vixindex1000", "1000ETFVIX": "vixindex1000",
  "科创板VIX": "vixkcb", "科创版VIX": "vixkcb", "VIX科创版": "vixkcb", "VIX科创板": "vixkcb", "VIXKCB": "vixkcb", "KCBVIX": "vixkcb",
  "创业板VIX": "vixcyb", "VIX创业板": "vixcyb", "创业板IV": "vixcyb", "IV创业板": "vixcyb", "创业版VIX": "vixcyb", "VIX创业版": "vixcyb",
}

const LABEL = {
  vix300: "沪深300VIX",
  vix50: "上证50VIX",
  vixindex1000: "中证1000VIX",
  vixkcb: "科创板VIX",
  vixcyb: "创业板VIX",
}

/** 输入名称 → { file, label }；无匹配时默认沪深300VIX */
export function resolveVix(input) {
  const key = String(input == null ? "" : input).replace(/\s/g, "").toUpperCase()
  const file = VIX_LIST[key] || "vix300"
  return { file, label: LABEL[file] || key || "沪深300VIX" }
}

function num(v) {
  const n = parseFloat(String(v == null ? "" : v).trim())
  return Number.isFinite(n) ? n : null
}

/** 解析 optbbs CSV 文本 → { points, pre, high, low } */
export function parseVixCsv(text) {
  const raw = String(text || "").replace(/^\uFEFF/, "")
  const lines = raw.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return null
  const header = lines[0].split(",")
  if (header.length < 2) return null
  const priceIdx = 1
  const find = name => header.findIndex(h => h.trim().toLowerCase() === name.toLowerCase())
  const iPre = find("Pre")
  const iMax = find("max")
  const iMin = find("min")
  const points = []
  let pre = null, high = null, low = null
  for (let k = 1; k < lines.length; k++) {
    const cols = lines[k].split(",")
    if (cols.length < 2) continue
    let price = num(cols[priceIdx])
    if (price == null && cols.length > 2) price = num(cols[2])
    if (price == null) continue
    const t = String(cols[0]).trim()
    const m = t.match(/^(\d{1,2}):(\d{2})/)
    const hhmm = m ? (m[1].padStart(2, "0") + ":" + m[2]) : t
    points.push({ day: hhmm, value: price })
    if (pre == null && iPre >= 0) pre = num(cols[iPre])
    const hi = iMax >= 0 ? num(cols[iMax]) : null
    const lo = iMin >= 0 ? num(cols[iMin]) : null
    if (hi != null) high = high == null ? hi : Math.max(high, hi)
    if (lo != null) low = low == null ? lo : Math.min(low, lo)
  }
  if (!points.length) return null
  points.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
  return { points, pre, high, low }
}

/** 拉取某波动率指数的当日分时；失败抛出可读错误 */
export async function fetchVix(input) {
  const { file, label } = resolveVix(input)
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 15000)
  let text = ""
  try {
    const res = await fetch(CSV_URL + file + ".csv", { headers: { "User-Agent": UA }, signal: ac.signal })
    if (!res.ok) throw new Error("HTTP " + res.status)
    text = await res.text()
  } catch (err) {
    throw new Error("波动率数据源暂不可用：" + (err && err.message ? err.message : err))
  } finally {
    clearTimeout(timer)
  }
  const parsed = parseVixCsv(text)
  if (!parsed) throw new Error("波动率数据为空或格式异常")
  const last = parsed.points[parsed.points.length - 1].value
  const pre = parsed.pre != null ? parsed.pre : parsed.points[0].value
  const chg = last - pre
  const chgPct = pre ? (chg / pre) * 100 : 0
  return {
    label,
    file,
    points: parsed.points,
    last,
    pre,
    high: parsed.high != null ? parsed.high : Math.max(...parsed.points.map(p => p.value)),
    low: parsed.low != null ? parsed.low : Math.min(...parsed.points.map(p => p.value)),
    chg,
    chgPct,
  }
}
