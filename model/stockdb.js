/**
 * 本地股票字典（5921 只，含三级行业分类，来源：SayuStock/chinese_stocks.json）。
 *
 * 作用：
 *  - 热力图接口只给代码不给名称，靠它补名称；
 *  - 名称搜索的离线兜底（东财 suggest 被限流时仍能按名称查代码）；
 *  - 行业/概念云图的行业归类。
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const _dir = path.dirname(fileURLToPath(import.meta.url))
let DB = null

function load() {
  if (DB) return DB
  try {
    const txt = fs.readFileSync(path.join(_dir, "data", "chinese_stocks.json"), "utf8")
    DB = JSON.parse(txt)
  } catch {
    DB = {}
  }
  return DB
}

export function stockInfo(code) {
  return load()[String(code)] ?? null
}

export function stockName(code) {
  return load()[String(code)]?.name ?? String(code)
}

/** 按名称模糊搜索，返回 [{code,name,industry}]，最多 limit 条 */
export function searchByName(keyword, limit = 10) {
  const kw = String(keyword ?? "").trim()
  if (!kw) return []
  const db = load()
  const exact = []
  const prefix = []
  const fuzzy = []
  for (const [code, info] of Object.entries(db)) {
    if (info.name === kw) exact.push({ code, ...info })
    else if (info.name.startsWith(kw)) prefix.push({ code, ...info })
    else if (info.name.includes(kw)) fuzzy.push({ code, ...info })
    if (exact.length >= limit) break
  }
  return [...exact, ...prefix, ...fuzzy].slice(0, limit)
}

/** 代码 → 交易所前缀（深 0 / 沪 1 / 北 0） */
export function secidOf(code) {
  const c = String(code)
  if (/^(60|68|90|5|9)/.test(c)) return `1.${c}`
  return `0.${c}`
}

/** 行业名归一化：去掉 Ⅰ/Ⅱ/Ⅲ 罗马数字后缀和空格，便于「白酒」匹配「白酒Ⅱ」 */
const norm = s =>
  String(s ?? "")
    .replace(/[ⅠⅡⅢⅣⅤ]/g, "")
    .replace(/\s+/g, "")
    .toUpperCase()

/**
 * 按行业名找成分股代码（分档匹配，命中即返回该档全部）。
 * @param {string} name 行业名，支持 一级/二级/三级，允许省略罗马数字后缀
 */
export function codesByIndustry(name) {
  const kw = norm(name)
  if (!kw) return []
  const all = Object.entries(load()).map(([code, info]) => ({ code, ...info }))
  const tiers = [
    i => norm(i.industry_l1) === kw || norm(i.industry_l2) === kw || norm(i.industry_l3) === kw,
    i => norm(i.industry_l2).startsWith(kw) || norm(i.industry_l3).startsWith(kw) || norm(i.industry_l1).startsWith(kw),
    i => norm(i.industry_l2).includes(kw) || norm(i.industry_l3).includes(kw),
  ]
  for (const tier of tiers) {
    const hit = all.filter(tier)
    if (hit.length) return hit
  }
  return []
}

/** 全部一级行业名 */
export function industryL1List() {
  const set = new Set()
  for (const info of Object.values(load())) if (info.industry_l1) set.add(info.industry_l1)
  return [...set]
}
