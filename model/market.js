/**
 * 业务编排层：指令 → 数据。apps/ 只负责收指令、出图、回话。
 */

import { ulist, trends, kline, clist, clistMany, breadth, quote, okxTickers, hotmap, KLT } from "./em.js"
import { resolve, resolveBoard, boardConstituents, boardList, guessSecid } from "./symbol.js"
import { getWatch } from "./store.js"
import { stockInfo, codesByIndustry, secidOf } from "./stockdb.js"

const log = globalThis.logger ?? console

/* 大盘概览用的指数（与原插件 draw_info.py 的 _OVERVIEW_INDEXES 对齐） */
export const OVERVIEW_INDEXES = [
  ["上证指数", "1.000001"],
  ["中证全指", "1.000985"],
  ["创业板指", "0.399006"],
  ["科创综指", "1.000680"],
  ["沪深300", "1.000300"],
  ["中证500", "1.000905"],
  ["中证1000", "1.000852"],
  ["中证2000", "2.932000"],
  ["中证A500", "1.000510"],
  ["北证50", "0.899050"],
]

const p2 = n => String(n).padStart(2, "0")
function ymd(offsetDays = 0) {
  const d = new Date(Date.now() + 8 * 3600 * 1000 + offsetDays * 86400 * 1000)
  return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}`
}
function cnDate(offsetDays = 0) {
  const d = new Date(Date.now() + 8 * 3600 * 1000 + offsetDays * 86400 * 1000)
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`
}
function cnTime() {
  const d = new Date(Date.now() + 8 * 3600 * 1000)
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(
    d.getUTCMinutes(),
  )}`
}

export const timeText = cnTime

/** 用热力图数据按一级行业聚合成板块行情（clist 被限流时的兜底，市值加权） */
function industryAggFromHotmap(rows) {
  const agg = new Map()
  for (const r of rows) {
    if (!r.cap) continue
    const ind = stockInfo(r.code)?.industry_l1 || "其他"
    const a = agg.get(ind) ?? { name: ind, cap: 0, weighted: 0 }
    a.cap += r.cap
    a.weighted += r.cap * r.chg
    agg.set(ind, a)
  }
  // 「其他/未知」是本地表里没有行业归类的占位桶，混在排行榜里没有意义
  const SKIP = new Set(["其他", "未知"])
  return [...agg.values()]
    .filter(a => a.cap > 0 && !SKIP.has(a.name))
    .map(a => {
      const chg = a.weighted / a.cap
      // 云图渲染读 chg，行业排行读 chgPct，两个都带上省得两处再转
      return { name: a.name, chg, chgPct: chg, cap: a.cap }
    })
}

/** 行业涨跌排行：优先东财板块接口（口径与行情中心一致），失败退回热力图聚合 */
async function fetchIndustryRanking() {
  try {
    const [up, down] = await Promise.all([
      clist({ fs: "m:90 t:2 f:!50", fid: "f3", po: 1, pz: 8, fields: ["f3", "f12", "f14"] }),
      clist({ fs: "m:90 t:2 f:!50", fid: "f3", po: 0, pz: 8, fields: ["f3", "f12", "f14"] }),
    ])
    const pick = list =>
      (list.rows ?? [])
        .filter(r => Number.isFinite(Number(r.f3)) && r.f14)
        .map(r => ({ name: r.f14, chgPct: Number(r.f3) }))
    const upList = pick(up)
    const downList = pick(down).reverse()
    if (upList.length && downList.length) return { up: upList.slice(0, 6), down: downList.slice(0, 6) }
    throw new Error("板块接口返回为空")
  } catch {
    const rows = await hotmap().catch(() => [])
    const agg = industryAggFromHotmap(rows).sort((a, b) => b.chgPct - a.chgPct)
    return { up: agg.slice(0, 6), down: agg.slice(-6).reverse() }
  }
}

/**
 * 板块名 → 成分股 secid 列表。
 * 先走东财板块成分接口，被限流时用本地行业表兜底（仅一级/二级/三级行业名）。
 */
export async function boardCodes(name, limit = 13) {
  try {
    const board = await resolveBoard(name)
    if (board) {
      const list = await boardConstituents(board.secid, limit)
      if (list.length) return list.map(i => i.secid)
    }
  } catch {
    /* 落到本地兜底 */
  }
  return codesByIndustry(name)
    .slice(0, limit)
    .map(i => secidOf(i.code))
}

/* ------------------------------------------------------------ 大盘概览 */

export async function fetchOverview() {
  const secids = OVERVIEW_INDEXES.map(i => i[1])
  const [rows, bar, industries] = await Promise.all([
    ulist(secids, ["f2", "f3", "f4", "f12", "f13", "f14", "f6"]).catch(() => []),
    breadth().catch(() => null),
    fetchIndustryRanking().catch(() => ({ up: [], down: [] })),
  ])

  const map = new Map(rows.map(r => [`${r.f13}.${r.f12}`, r]))
  const indexes = OVERVIEW_INDEXES.map(([name, secid]) => {
    const r = map.get(secid)
    return {
      name: r?.f14 || name,
      price: Number(r?.f2),
      chgPct: Number(r?.f3),
      chg: Number(r?.f4),
      amount: Number(r?.f6) || 0,
    }
  }).filter(i => Number.isFinite(i.price))

  if (!indexes.length) throw new Error("指数行情获取失败：东财行情接口暂时不可用（可能是限流），请稍后重试")

  return {
    indexes,
    breadth: bar ?? { buckets: [], up: 0, down: 0, flat: 0 },
    industries,
    time: cnTime(),
  }
}

/* --------------------------------------------------------------- 云图 */

const FS_ALL_A = "m:0 t:6,m:0 t:80,m:1 t:2,m:1 t:23,m:0 t:81 s:2048"

/** 板块云图最多画多少只成分股：多了会碎成一片，看不清名字 */
const MAX_CLOUDMAP_STOCKS = 120

export async function fetchCloudmap(kind, name, { stocks = 120 } = {}) {
  const FOREIGN_FS = {
    港股: "m:116 t:3,m:116 t:4",
    美股: "m:105,m:106,m:107",
    英股: "m:155 t:1,m:155 t:2,m:155 t:3",
  }

  /* 港美股大盘云图：热力图只覆盖 A 股，这边只能走列表接口 */
  if (kind === "market" && name && FOREIGN_FS[name]) {
    const rows = await clistMany(
      { fs: FOREIGN_FS[name], fid: "f20", po: 1, fields: ["f3", "f12", "f14", "f20"] },
      stocks,
    )
    const items = rows
      .filter(r => r.f14 && Number(r.f20) > 0)
      .map(r => ({ name: r.f14, code: r.f12, chg: Number(r.f3) || 0, cap: Number(r.f20) }))
    if (!items.length) throw new Error(`${name}云图暂无数据（东财列表接口可能限流）`)
    return { title: `${name}云图`, sub: `总市值前 ${items.length} 只 · 面积=市值 颜色=涨跌`, items, unit: "只" }
  }

  /* 大盘云图：主源走热力图接口（一次给全市场、不翻页），失败退回列表接口 */
  if (kind === "market") {
    let items = []
    try {
      const rows = await hotmap()
      items = rows
        .filter(r => r.cap > 0)
        .sort((a, b) => b.cap - a.cap)
        .slice(0, stocks)
        .map(r => ({ name: r.name, code: r.code, chg: r.chg, cap: r.cap }))
    } catch {
      const rows = await clistMany(
        { fs: FS_ALL_A, fid: "f20", po: 1, fields: ["f3", "f12", "f14", "f20"] },
        stocks,
      ).catch(() => [])
      items = rows
        .filter(r => r.f14 && Number(r.f20) > 0)
        .map(r => ({ name: r.f14, code: r.f12, chg: Number(r.f3) || 0, cap: Number(r.f20) }))
    }
    if (!items.length) throw new Error("暂无大盘云图数据")
    return { title: "大盘云图", sub: `总市值前 ${items.length} 只 · 面积=市值 颜色=涨跌`, items, unit: "只" }
  }

  const kindText = kind === "concept" ? "概念" : "行业"

  if (!name) {
    /* 不带板块名：行业板块看全部行业（按成分股市值聚合），概念板块看全部概念 */
    if (kind === "industry") {
      try {
        const agg = industryAggFromHotmap(await hotmap())
        if (agg.length) {
          return {
            title: "行业云图",
            sub: `全部一级行业 ${agg.length} 个 · 面积=行业总市值 颜色=成分股市值加权涨跌`,
            items: agg,
            unit: "个",
          }
        }
      } catch {
        /* 落到东财板块列表 */
      }
    }
    const rows = await boardList(kind, 90)
    const items = rows
      .map(r => ({ name: r.f14, code: r.f12, chg: Number(r.f3) || 0, cap: Number(r.f20) || 0 }))
      .filter(i => i.cap > 0)
    if (!items.length) throw new Error(`暂无${kindText}板块数据`)
    return { title: `${kindText}云图`, sub: `全部${kindText}板块 ${items.length} 个 · 面积=板块市值`, items, unit: "个" }
  }

  /* 指定板块：行业先查本地表（含三級行业名），再查东财板块行情 */
  if (kind === "industry") {
    const local = codesByIndustry(name)
    if (local.length) {
      const set = new Set(local.map(i => i.code))
      try {
        const rows = (await hotmap())
          .filter(r => set.has(r.code) && r.cap > 0)
          .sort((a, b) => b.cap - a.cap)
          .slice(0, MAX_CLOUDMAP_STOCKS)
        if (rows.length) {
          return {
            title: "行业云图",
            sub: `${name} · 市值前 ${rows.length} 只成分股（本地行业表匹配）`,
            items: rows.map(r => ({ name: r.name, code: r.code, chg: r.chg, cap: r.cap })),
            unit: "只",
          }
        }
      } catch {
        /* 继续尝试东财板块 */
      }
    }
  }

  const board = await resolveBoard(name)
  if (!board) throw new Error(`未找到「${name}」相关${kindText}板块，换个名称试试`)

  let rows = []
  try {
    rows = await clistMany(
      { fs: `b:${board.code}`, fid: "f20", po: 1, fields: ["f3", "f12", "f14", "f20"] },
      300,
    )
  } catch {
    rows = []
  }
  let items = rows
    .filter(r => r.f14 && Number(r.f20) > 0 && /^\d{6}$/.test(String(r.f12)))
    .map(r => ({ name: r.f14, code: r.f12, chg: Number(r.f3) || 0, cap: Number(r.f20) }))
    .sort((a, b) => b.cap - a.cap)
    .slice(0, MAX_CLOUDMAP_STOCKS)

  if (!items.length) {
    // 板块成分接口被限流：概念板块没有本地表，只能明确告知；
    // 行业名能命中本地行业表时仍可出图。
    const local = codesByIndustry(name)
    if (local.length) {
      const set = new Set(local.map(i => i.code))
      const hm = await hotmap().catch(() => [])
      items = hm
        .filter(r => set.has(r.code) && r.cap > 0)
        .map(r => ({ name: r.name, code: r.code, chg: r.chg, cap: r.cap }))
      if (items.length) {
        return { title: `${kindText}云图`, sub: `${board.name} · ${items.length} 只成分股（本地行业表兜底）`, items, unit: "只" }
      }
    }
    throw new Error(`${board.name} 板块成分获取失败（东财板块接口限流），请稍后再试`)
  }

  return { title: `${kindText}云图`, sub: `${board.name} · ${items.length} 只成分股`, items, unit: "只" }
}

/* ----------------------------------------------------------- 个股分时 */

const SECTOR_ALIAS = /^(single-stock|compare-stock)$/

/**
 * @returns {{type:"single", series:object, ndays:number}|{type:"multi", list:object[], failures:string[], boardName?:string}}
 */
export async function fetchIntraday(query, { ndays = 1 } = {}) {
  const target = await resolve(query)
  if (!target) throw new Error(`没找到「${query}」，试试 代码 / 名称 / 拼音，例如 600519、贵州茅台`)

  if (target.isBoard) {
    let codes = []
    try {
      codes = (await boardConstituents(target.secid, 13)).map(i => i.secid)
    } catch {
      /* 板块成分接口被限流，走本地行业表 */
    }
    if (!codes.length) codes = await boardCodes(target.name, 13)
    if (!codes.length) throw new Error(`${target.name} 板块暂无成分股`)
    const res = await Promise.allSettled(codes.map(s => trends(s, ndays)))
    const series = res
      .map(r => (r.status === "fulfilled" && r.value ? r.value : null))
      .filter(Boolean)
    if (!series.length) throw new Error(`${target.name} 板块成分股分时数据为空`)
    return { type: "multi", list: series.slice(0, 13), failures: [], boardName: target.name }
  }

  const series = await trends(target.secid, ndays)
  if (!series) throw new Error(`${target.name} 暂无分时数据（可能停牌或未开盘）`)
  return { type: "single", series: { ...series, name: series.name || target.name }, ndays }
}

/** 多标的（空格分隔）批量分时 */
export async function fetchMultiIntraday(queries, { ndays = 1, limit = 5 } = {}) {
  const list = []
  const failures = []
  for (const q of queries.slice(0, limit)) {
    try {
      const r = await fetchIntraday(q, { ndays })
      if (r.type === "single") list.push(r.series)
      else list.push(...r.list.slice(0, limit))
    } catch (err) {
      failures.push(`${q}：${err.message}`)
    }
  }
  return { list: list.slice(0, limit), failures }
}

/* ------------------------------------------------------------- K线 */

export async function fetchKline(query, period = "d", { count = 260 } = {}) {
  const target = await resolve(query)
  if (!target) throw new Error(`没找到「${query}」`)
  if (target.isBoard) throw new Error("板块不支持看K线，直接看「板块云图」更合适")

  const klt = KLT[period] ?? KLT.d
  const bars = await kline(target.secid, klt, { beg: ymd(-Math.max(400, count * 2)), end: ymd(0) })
  if (!bars) throw new Error(`${target.name} 暂无K线数据（场外基金没有K线）`)
  return { ...bars, name: bars.name || target.name, klt }
}

/* ------------------------------------------------------------- 对比 */

export function parseRange(text) {
  const t = String(text ?? "").trim()
  const today = new Date(Date.now() + 8 * 3600 * 1000)
  let start = null
  let label = "最近一年"
  let rest = t

  const dateReg = /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/g
  const dates = [...t.matchAll(dateReg)]
  if (dates.length >= 2) {
    start = new Date(Number(dates[0][1]), Number(dates[0][2]) - 1, Number(dates[0][3]))
    const end = new Date(Number(dates[1][1]), Number(dates[1][2]) - 1, Number(dates[1][3]))
    rest = t.replace(dateReg, " ").replace(/[~～至-]+/g, " ").replace(/\s+/g, " ").trim()
    return { start, end, label: "自定义区间", rest }
  }

  if (/年初至今|今年|YTD|ytd/.test(t)) {
    start = new Date(today.getUTCFullYear(), 0, 1)
    label = "年初至今"
    rest = t.replace(/年初至今|今年|YTD|ytd/g, " ").replace(/\s+/g, " ").trim()
  } else if (/近一月|最近一月|一个月|近1月/.test(t)) {
    start = new Date(today.getTime() - 30 * 86400 * 1000)
    label = "最近一月"
    rest = t.replace(/近一月|最近一月|一个月|近1月/g, " ").replace(/\s+/g, " ").trim()
  } else if (/近三月|最近三月|三个月|近3月/.test(t)) {
    start = new Date(today.getTime() - 90 * 86400 * 1000)
    label = "最近三月"
    rest = t.replace(/近三月|最近三月|三个月|近3月/g, " ").replace(/\s+/g, " ").trim()
  } else if (/近一年|最近一年|一年|近1年/.test(t)) {
    start = new Date(today.getTime() - 365 * 86400 * 1000)
    label = "最近一年"
    rest = t.replace(/近一年|最近一年|一年|近1年/g, " ").replace(/\s+/g, " ").trim()
  } else if (/近两年|最近两年|两年/.test(t)) {
    start = new Date(today.getTime() - 730 * 86400 * 1000)
    label = "最近两年"
    rest = t.replace(/近两年|最近两年|两年/g, " ").replace(/\s+/g, " ").trim()
  }
  return { start, end: null, label, rest }
}

export async function fetchCompare(queries, { rangeText = "最近一年", start = null, end = null, limit = 12 } = {}) {
  const list = []
  const failures = []

  const expanded = []
  for (const q of queries.slice(0, limit)) {
    // 纯代码/secid 不可能是板块名，省掉两次板块查询
    if (/^[\d.]+$/.test(q)) {
      expanded.push(q)
      continue
    }
    const codes = await boardCodes(q, limit).catch(() => [])
    if (codes.length) {
      expanded.push(...codes.slice(0, limit))
      continue
    }
    expanded.push(q)
  }

  const beg = start ? `${start.getFullYear()}${p2(start.getMonth() + 1)}${p2(start.getDate())}` : ymd(-400)
  const fin = end ? `${end.getFullYear()}${p2(end.getMonth() + 1)}${p2(end.getDate())}` : ymd(0)

  const uniq = [...new Set(expanded)].slice(0, limit)
  const results = await Promise.allSettled(
    uniq.map(async q => {
      const target = await resolve(q)
      if (!target) throw new Error("未找到该标的")
      const bars = await kline(target.secid, KLT.d, { beg, end: fin })
      if (!bars) throw new Error("无K线数据")
      return { name: `${target.name}`, bars: bars.bars }
    }),
  )
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value?.bars?.length > 1) list.push(r.value)
    else failures.push(`${uniq[i]}：${r.reason?.message ?? "无数据"}`)
  })

  return { list, failures, rangeText }
}

/* ------------------------------------------------------------- 自选 */

export async function fetchWatchRows(uid, { withSeries = true } = {}) {
  const secids = getWatch(uid)
  if (!secids.length) return []
  const rows = await ulist(secids, [
    "f2",
    "f3",
    "f4",
    "f6",
    "f8",
    "f12",
    "f13",
    "f14",
    "f18",
  ]).catch(() => [])
  const map = new Map(rows.map(r => [`${r.f13}.${r.f12}`, r]))

  const out = []
  for (const secid of secids) {
    const r = map.get(secid)
    if (!r) continue
    out.push({
      secid,
      name: r.f14,
      code: r.f12,
      price: Number(r.f2),
      chgPct: Number(r.f3),
      chg: Number(r.f4),
      amount: Number(r.f6),
      turnover: Number(r.f8),
    })
  }

  if (withSeries) {
    const series = await Promise.allSettled(out.slice(0, 12).map(r => trends(r.secid, 1)))
    series.forEach((s, i) => {
      if (s.status === "fulfilled" && s.value) out[i].series = s.value
    })
  }
  return out
}

/** 把用户输入解析成自选条目（支持板块展开成成分股） */
export async function resolveWatchItems(tokens) {
  const items = []
  const failed = []
  for (const t of tokens) {
    try {
      const target = await resolve(t, { allowBoard: true })
      if (!target) {
        failed.push(t)
        continue
      }
      items.push({ secid: target.secid, name: target.name })
    } catch {
      failed.push(t)
    }
  }
  return { items, failed }
}

/* ----------------------------------------------------------- 全天候 */

const WEATHER_GROUPS = [
  {
    title: "全球股市",
    items: [
      ["道琼斯", "100.DJIA"],
      ["纳斯达克", "100.NDX"],
      ["标普500", "100.SPX"],
      ["日经225", "100.N225"],
      ["恒生指数", "100.HSI"],
      ["德国DAX", "100.GDAXI"],
      ["英国富时100", "100.FTSE"],
      ["欧洲斯托克50", "100.SX5E"],
      ["法国CAC40", "100.FCHI"],
    ],
  },
  {
    title: "大宗商品",
    items: [
      ["COMEX黄金", "101.GC00Y"],
      ["COMEX白银", "101.SI00Y"],
      ["NYMEX原油", "102.CL00Y"],
      ["COMEX铜", "101.HG00Y"],
      ["黄金9999", "118.AU9999"],
    ],
  },
  {
    title: "外汇 / 债券",
    items: [
      ["美元指数", "100.UDI"],
      ["美元兑离岸人民币", "133.USDCNH"],
      ["16国债19", "1.019547"],
    ],
  },
]

export async function fetchAllWeather() {
  const allSecids = WEATHER_GROUPS.flatMap(g => g.items.map(i => i[1]))
  const rows = await ulist(allSecids, ["f2", "f3", "f4", "f12", "f13", "f14"]).catch(() => [])
  const map = new Map(rows.map(r => [`${r.f13}.${r.f12}`, r]))

  const groups = WEATHER_GROUPS.map(g => ({
    title: g.title,
    items: g.items
      .map(([name, secid]) => {
        const r = map.get(secid)
        if (!r || !Number.isFinite(Number(r.f2))) return null
        return { name: r.f14 || name, price: Number(r.f2), chgPct: Number(r.f3) }
      })
      .filter(Boolean),
  }))

  const crypto = await okxTickers()
  if (crypto.length) groups.push({ title: "加密货币（OKX）", items: crypto })

  if (!groups.some(g => g.items.length)) throw new Error("全天候行情获取失败")
  return groups
}

/* ------------------------------------------------------------ 股票卡片 */

export async function fetchStockCard(query) {
  const target = await resolve(query)
  if (!target) throw new Error(`没找到「${query}」`)
  const [q, bars] = await Promise.all([
    quote(target.secid).catch(() => null),
    kline(target.secid, KLT.d, { beg: ymd(-400), end: ymd(0) }).catch(() => null),
  ])
  if (!q) throw new Error(`${target.name} 行情获取失败`)
  return { quote: q, bars: bars?.bars ?? [], name: q.name || target.name }
}

export { isSecidLike }
function isSecidLike(s) {
  return Boolean(guessSecid(s))
}

export { log }
