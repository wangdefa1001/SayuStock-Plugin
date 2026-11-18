/**
 * 估值对比数据层：市盈率(PE_TTM) / 市净率(PB_MRQ) / 股息率(滚动12月) 历史序列。
 *
 * 数据口径对齐 SayuStock(gsuid_core 版)：
 *  - PE/PB  东财 RPT_VALUEANALYSIS_DET（datacenter.eastmoney.com），字段 PE_TTM / PB_MRQ
 *  - 股息率  东财 RPT_SHAREBONUS_DET 分红历史 + 日K线，按「上一财年已完整除权」
 *            的报告期金额 / 当日收盘价 计算（见 emDividendYield 注释）
 *
 * 只依赖 model 内部模块，不引入任何 npm 依赖，可脱离 Yunzai 单独跑测试。
 */

import { rawGet, kline, KLT } from "./em.js"
import { resolve, guessSecid } from "./symbol.js"
import { boardCodes, parseRange } from "./market.js"
import { stockName } from "./stockdb.js"

export const VALUE_NAME = { pe: "市盈率(PE_TTM)", pb: "市净率(PB_MRQ)", dy: "股息率(滚动12月)" }
const VALUE_FIELD = { pe: "PE_TTM", pb: "PB_MRQ" }
const VALUE_URL = "https://datacenter.eastmoney.com/securities/api/data/v1/get"
const DIV_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get"

function p2(n) { return String(n).padStart(2, "0") }
function ymd(offsetDays) {
  const d = new Date(Date.now() + 8 * 3600 * 1000 + (offsetDays || 0) * 86400 * 1000)
  return d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate())
}
function toDay(d) {
  if (!d) return null
  const t = d instanceof Date ? d : new Date(d)
  return t.getFullYear() + "-" + p2(t.getMonth() + 1) + "-" + p2(t.getDate())
}

/** 解析估值对比的时间范围；未指定时默认近三年（与原版一致） */
export function parseValueRange(text) {
  const t = String(text == null ? "" : text).trim()
  if (/近三年|最近三年|三年|近3年/.test(t)) {
    const now = new Date()
    const start = new Date(now.getTime() - 365 * 3 * 86400 * 1000)
    return { start, end: now, label: "近三年", rest: t.replace(/近三年|最近三年|三年|近3年/g, " ").trim() }
  }
  const r = parseRange(t)
  if (r.start) return r
  const now = new Date()
  const start = new Date(now.getTime() - 365 * 3 * 86400 * 1000)
  return { start, end: now, label: "近三年", rest: r.rest }
}

/* -------------------------------------------------------------- PE / PB */

async function emValueSeries(code, kind) {
  const field = VALUE_FIELD[kind]
  const res = await rawGet(
    VALUE_URL,
    {
      reportName: "RPT_VALUEANALYSIS_DET",
      columns: "ALL",
      filter: "(SECURITY_CODE=\"" + code + "\")",
      pageNumber: "1",
      pageSize: "5000",
      sortColumns: "TRADE_DATE",
      sortTypes: "-1",
      source: "WEB",
      client: "WEB",
    },
    { headers: { Referer: "https://data.eastmoney.com/" }, timeout: 20000, retry: 2 },
  )
  const rows = (res && res.result && res.result.data) || []
  const map = new Map()
  for (const row of rows) {
    const day = row && row.TRADE_DATE ? String(row.TRADE_DATE).slice(0, 10) : null
    const raw = row ? row[field] : null
    if (!day || raw == null) continue
    const v = Number(raw)
    if (!Number.isFinite(v) || v <= 0) continue
    map.set(day, v)
  }
  const arr = [...map.entries()]
  arr.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return arr.map(e => ({ day: e[0], value: e[1] }))
}

/* --------------------------------------------------------------- 股息率 */

async function emDividendYield(code, secid) {
  const divRes = await rawGet(
    DIV_URL,
    {
      reportName: "RPT_SHAREBONUS_DET",
      columns: "ALL",
      filter: "(SECURITY_CODE=\"" + code + "\")",
      pageNumber: "1",
      pageSize: "50",
      sortColumns: "REPORT_DATE",
      sortTypes: "-1",
      source: "WEB",
      client: "WEB",
    },
    { headers: { Referer: "https://data.eastmoney.com/" }, timeout: 20000, retry: 2 },
  )
  const divRows = (divRes && divRes.result && divRes.result.data) || []
  if (!divRows.length) return []

  // 1. 解析每条分红 → (报告期, 除权日, 每股税前分红)
  const events = []
  for (const row of divRows) {
    const bonus = row ? row.PRETAX_BONUS_RMB : null
    if (bonus == null) continue
    const exStr = (row.EX_DIVIDEND_DATE || row.PLAN_NOTICE_DATE || row.NOTICE_DATE)
    if (!exStr) continue
    const exDate = String(exStr).slice(0, 10)
    const bonusPerShare = Number(bonus) / 10
    if (!(bonusPerShare > 0)) continue
    const reportDate = row.REPORT_DATE ? String(row.REPORT_DATE).slice(0, 10) : null
    events.push({ reportDate, exDate, bonusPerShare })
  }
  if (!events.length) return []

  // 2. 按报告期归并（同一报告期多次分红金额相加，生效日取该报告期最晚除权日）
  const groups = new Map()
  for (const ev of events) {
    const key = ev.reportDate || (ev.exDate.slice(0, 4) + "-01-01")
    if (!groups.has(key)) groups.set(key, { reportDate: key, bonus: 0, exDates: [] })
    const g = groups.get(key)
    g.bonus += ev.bonusPerShare
    g.exDates.push(ev.exDate)
  }
  const periods = [...groups.values()].map(g => ({
    reportDate: g.reportDate,
    bonusPerShare: g.bonus,
    effectiveDate: g.exDates.slice().sort().slice(-1)[0],
  }))

  // 3. 近十年日 K 收盘价
  const kl = await kline(secid, KLT.d, { beg: ymd(-3650), end: ymd(0) }).catch(() => null)
  const bars = (kl && kl.bars) || []
  if (!bars.length) return []

  // 4. 逐日计算：分子 = 当前自然年内「已完整除权」且「报告期年份 = 当前年-1」的分红之和
  const out = []
  for (const b of bars) {
    if (!(b.close > 0)) continue
    const year = Number(String(b.date).slice(0, 4))
    const target = year - 1
    let rolling = 0
    for (const p of periods) {
      if (p.effectiveDate <= b.date && Number(p.reportDate.slice(0, 4)) === target) rolling += p.bonusPerShare
    }
    if (rolling <= 0) continue
    out.push({ day: b.date, value: (rolling / b.close) * 100 })
  }
  return out
}

/* -------------------------------------------------------------- 单只序列 */

async function targetOf(query) {
  const q = String(query == null ? "" : query).trim()
  if (!q) return null
  if (/^\d{6}$/.test(q)) {
    const g = guessSecid(q)
    if (g) {
      const t = await resolve(q).catch(() => null)
      const nm = stockName(q)
      return { secid: g.secid, code: q, name: (t && t.name) || (nm && nm !== q ? nm : q) }
    }
  }
  const t = await resolve(q).catch(() => null)
  return t ? { secid: t.secid, code: t.code, name: t.name } : null
}

export async function fetchValuationSeries(query, kind) {
  const target = await targetOf(query)
  if (!target) return null
  let points = []
  if (kind === "dy") points = await emDividendYield(target.code, target.secid)
  else points = await emValueSeries(target.code, kind)
  if (!points.length) return null
  return { name: target.name, code: target.code, points }
}

/* ------------------------------------------------------------ 批量对比 */

export async function fetchValuationCompare(queries, opts) {
  const o = opts || {}
  const kind = o.kind || "pe"
  const rangeText = o.rangeText || "近三年"
  const limit = o.limit || 12
  const valueName = VALUE_NAME[kind] || "估值"
  const startStr = toDay(o.start)
  const endStr = toDay(o.end)

  // 板块名 → 成分股展开
  const expanded = []
  for (const q of queries.slice(0, limit)) {
    if (/^[\d.]+$/.test(q)) { expanded.push(q); continue }
    const codes = await boardCodes(q, limit).catch(() => [])
    if (codes.length) { expanded.push(...codes.slice(0, limit)); continue }
    expanded.push(q)
  }

  const list = []
  const failures = []
  for (const q of expanded.slice(0, limit)) {
    let s = null
    try { s = await fetchValuationSeries(q, kind) } catch (err) { s = null }
    if (!s) { failures.push(q); continue }
    let pts = s.points
    if (startStr) pts = pts.filter(p => p.day >= startStr)
    if (endStr) pts = pts.filter(p => p.day <= endStr)
    if (pts.length < 2) { failures.push(s.name + "(" + s.code + ")"); continue }
    list.push({ name: s.name, code: s.code, points: pts })
  }
  return { list, failures, rangeText, valueName, kind }
}
