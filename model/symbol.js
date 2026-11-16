/**
 * 标的解析：把用户输入的「名称 / 代码 / 拼音 / 板块名」解析成东财 secid。
 */

import { suggest, quote, clist } from "./em.js"
import { searchByName, secidOf, stockName } from "./stockdb.js"

const cache = new Map()
const TTL = 10 * 60 * 1000

function cached(key, fn) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.t < TTL) return hit.v
  const v = fn()
  cache.set(key, { t: Date.now(), v })
  v.catch?.(() => cache.delete(key))
  return v
}

export function clearResolveCache() {
  cache.clear()
}

/** 六位代码按交易所规则推断 secid */
export function guessSecid(raw) {
  const code = String(raw).replace(/^(sh|sz|bj)/i, "").trim()
  if (!/^\d{6}$/.test(code)) return null
  if (/^(60|68|9|5)/.test(code)) return { secid: `1.${code}`, market: 1 }
  if (/^(00|30|20|1[5-8]|4|8)/.test(code)) return { secid: `0.${code}`, market: 0 }
  if (/^(0|3)/.test(code)) return { secid: `0.${code}`, market: 0 }
  return null
}

/** 已经是 secid 形式（1.600519 / 90.BK1036） */
export function isSecid(str) {
  return /^\d{1,3}\.[A-Za-z0-9]+$/.test(String(str).trim())
}

const TYPE_WEIGHT = [
  [/板块/, 40],
  [/^(沪A|深A|京A|A股)$/, 60],
  [/基金|ETF|LOF/, 50],
  [/指数/, 45],
  [/港股/, 40],
  [/美股/, 35],
  [/期货|现货|债券|外汇/, 20],
]

function typeWeight(item) {
  for (const [re, w] of TYPE_WEIGHT) if (re.test(item.type ?? "")) return w
  return 30
}

/**
 * 解析单个查询词。
 * @param {string} query 名称/代码
 * @param {object} opt
 * @param {boolean} opt.preferBoard 优先返回板块（云图、板块展开场景）
 * @param {boolean} opt.allowBoard 是否允许返回板块
 * @returns {Promise<{secid,name,code,type,isBoard}|null>}
 */
export async function resolve(query, { preferBoard = false, allowBoard = true } = {}) {
  const q = String(query ?? "").trim()
  if (!q) return null
  return cached(`r:${q}:${preferBoard}:${allowBoard}`, async () => {
    if (isSecid(q)) {
      const meta = await quote(q).catch(() => null)
      const code = meta?.code ?? q.split(".")[1] ?? q
      // 快照拿不到时用内置字典补名称，避免把 secid 直接当名字展示
      const local = stockName(code)
      return {
        secid: q,
        name: meta?.name ?? (local && local !== code ? local : q),
        code,
        type: q.startsWith("90.") ? "板块" : "",
        isBoard: q.startsWith("90."),
      }
    }

    const guessed = guessSecid(q)
    if (guessed) {
      const meta = await quote(guessed.secid).catch(() => null)
      if (meta?.name) {
        return {
          secid: guessed.secid,
          name: meta.name,
          code: meta.code ?? q,
          type: "",
          isBoard: /板块/.test(meta.name),
        }
      }
    }

    let rows = []
    try {
      rows = await suggest(q, 10)
    } catch {
      rows = []
    }
    if (!rows.length) {
      // 东财 suggest 被限流时用本地股票字典兜底
      const local = searchByName(q, 5)
      if (!local.length) return null
      const hit = local[0]
      return {
        secid: secidOf(hit.code),
        name: hit.name,
        code: hit.code,
        type: "",
        isBoard: false,
      }
    }

    const named = rows.filter(r => r.name === q)
    const pool = named.length ? named : rows
    const filtered = allowBoard ? pool : pool.filter(r => !r.isBoard)

    let best = null
    let bestScore = -1
    for (const r of filtered) {
      let score = typeWeight(r)
      if (r.name === q) score += 100
      else if (r.name?.startsWith(q)) score += 40
      if (preferBoard) score += r.isBoard ? 200 : -50
      else if (!allowBoard && r.isBoard) score -= 200
      if (score > bestScore) {
        bestScore = score
        best = r
      }
    }
    if (!best) return null
    return { secid: best.secid, name: best.name, code: best.code, type: best.type, isBoard: best.isBoard }
  })
}

/**
 * 板块成分股（按成交额降序），用于「个股 白酒」这类板块展开。
 * @param {string} boardSecid 形如 90.BK0896
 */
export async function boardConstituents(boardSecid, limit = 13) {
  if (!boardSecid) return []
  return cached(`bc:${boardSecid}:${limit}`, async () => {
    const { rows } = await clist({
      fs: `b:${boardSecid.replace(/^90\./, "")}`,
      fid: "f6",
      pz: limit,
      fields: ["f2", "f3", "f6", "f12", "f13", "f14"],
    })
    return rows
      .filter(r => r.f12 && /^\d{6}$/.test(String(r.f12)))
      .map(r => ({ secid: `${r.f13}.${r.f12}`, code: String(r.f12), name: r.f14 }))
  })
}

/**
 * 板块行情列表（大盘云图 / 行业云图 / 概念云图）。
 * @param {"industry"|"concept"} kind
 */
export async function boardList(kind = "industry", pz = 90) {
  const fs = kind === "concept" ? "m:90 t:3 f:!50" : "m:90 t:2 f:!50"
  return cached(`bl:${kind}:${pz}`, async () => {
    const { rows } = await clist({
      fs,
      fid: "f3",
      pz,
      fields: ["f2", "f3", "f6", "f12", "f14", "f20", "f104", "f105", "f128", "f207"],
    })
    return rows.filter(r => r.f12 && r.f14)
  })
}

/** 行业名称 → 板块 secid（先搜板块，再按名称兜底匹配行业列表） */
export async function resolveBoard(name) {
  const direct = await resolve(name, { preferBoard: true })
  if (direct?.isBoard) return direct

  // 纯代码/数字不可能是板块名，避免无谓地拉板块列表
  if (/^[\d.]+$/.test(String(name ?? ""))) return null

  for (const kind of ["industry", "concept"]) {
    const list = await boardList(kind).catch(() => [])
    const exact = list.find(r => r.f14 === name)
    if (exact) return { secid: `90.${exact.f12}`, name: exact.f14, code: exact.f12, type: "板块", isBoard: true }
    const fuzzy = list.find(r => r.f14?.includes(name) || name?.includes(r.f14))
    if (fuzzy) return { secid: `90.${fuzzy.f12}`, name: fuzzy.f14, code: fuzzy.f12, type: "板块", isBoard: true }
  }
  return null
}
