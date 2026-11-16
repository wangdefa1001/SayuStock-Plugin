/**
 * 本地存储：配置、自选股、新闻订阅。
 * 全部落在插件目录 data/ 下的 JSON，便于用户直接查看/备份/迁移，
 * 不依赖 redis 或任何数据库插件。
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const _dir = path.dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = path.join(_dir, "..", "data")
const FILE = {
  config: path.join(DATA_DIR, "config.json"),
  watch: path.join(DATA_DIR, "watchlist.json"),
  subs: path.join(DATA_DIR, "news_sub.json"),
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return structuredClone(fallback)
    const txt = fs.readFileSync(file, "utf8")
    if (!txt.trim()) return structuredClone(fallback)
    return JSON.parse(txt)
  } catch {
    return structuredClone(fallback)
  }
}

function writeJSON(file, data) {
  ensureDir()
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8")
  fs.renameSync(tmp, file)
}

/* ------------------------------------------------------------------ 配置 */

export const DEFAULT_CONFIG = {
  /** 指令是否必须以 # 开头；关掉后「大盘概览」这种裸指令也会响应 */
  requirePrefix: true,
  /** 是否出图；关闭后仅回文字结果 */
  image: true,
  /** 「个股」一次最多展示多少只 */
  maxMultiStock: 5,
  /** 「对比个股」一次最多对比多少只 */
  maxCompare: 12,
  /** 大盘云图取市值前 N 只（东财单页 100，过大反而看不清） */
  cloudmapStocks: 120,
  /** 自选股上限 */
  maxWatch: 30,
  /** 财经快讯 */
  news: {
    /** 推送模式：important 只要闻 / all 全部 / hourly 每小时汇总 / daily 每日汇总 */
    mode: "important",
    /** 拉取间隔（分钟），仅 important / all 模式生效 */
    interval: 5,
    pages: 3,
    /** 是否允许定时推送到已订阅群 */
    push: true,
    /** 单条消息最多合并几条快讯 */
    maxPerPush: 6,
  },
}

export function getConfig() {
  const cfg = readJSON(FILE.config, DEFAULT_CONFIG)
  return {
    ...DEFAULT_CONFIG,
    ...cfg,
    news: { ...DEFAULT_CONFIG.news, ...(cfg.news ?? {}) },
  }
}

export function saveConfig(patch = {}) {
  const cur = getConfig()
  const cfg = {
    ...cur,
    ...patch,
    news: { ...cur.news, ...(patch.news ?? {}) },
  }
  writeJSON(FILE.config, cfg)
  return cfg
}

/* ------------------------------------------------------------------ 自选 */

/** @returns {string[]} 用户自选（存 secid 字符串，保证跨市场一致） */
export function getWatch(uid) {
  const all = readJSON(FILE.watch, {})
  const list = all[String(uid)]
  return Array.isArray(list) ? list.filter(Boolean) : []
}

export function setWatch(uid, list) {
  const all = readJSON(FILE.watch, {})
  const key = String(uid)
  const uniq = [...new Set(list.filter(Boolean))]
  if (uniq.length) all[key] = uniq
  else delete all[key]
  writeJSON(FILE.watch, all)
  return uniq
}

export function clearWatch(uid) {
  return setWatch(uid, [])
}

export function addWatch(uid, items) {
  const cfg = getConfig()
  const cur = getWatch(uid)
  const added = []
  const dup = []
  const overflow = []
  for (const it of items) {
    if (cur.includes(it.secid) || added.includes(it.secid)) {
      dup.push(it.name)
      continue
    }
    if (cur.length + added.length >= cfg.maxWatch) {
      overflow.push(it.name)
      continue
    }
    added.push(it.secid)
  }
  setWatch(uid, [...cur, ...added])
  return { added, dup, overflow, total: cur.length + added.length }
}

export function delWatch(uid, secids) {
  const cur = getWatch(uid)
  const removed = cur.filter(s => secids.includes(s))
  setWatch(
    uid,
    cur.filter(s => !secids.includes(s)),
  )
  return removed
}

/* --------------------------------------------------------------- 新闻订阅 */

export function getSubs() {
  const data = readJSON(FILE.subs, { groups: {}, state: {} })
  return {
    groups: data.groups && typeof data.groups === "object" ? data.groups : {},
    state: data.state && typeof data.state === "object" ? data.state : {},
  }
}

export function setSubs(data) {
  writeJSON(FILE.subs, data)
  return data
}

export function addSub(groupId, name = "", botId = "") {
  const data = getSubs()
  data.groups[String(groupId)] = { name, bot_id: botId, at: Date.now() }
  return setSubs(data)
}

export function delSub(groupId) {
  const data = getSubs()
  delete data.groups[String(groupId)]
  return setSubs(data)
}

export function isSub(groupId) {
  return Boolean(getSubs().groups[String(groupId)])
}
