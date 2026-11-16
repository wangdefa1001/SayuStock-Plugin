/**
 * 财经快讯（7x24）。
 *
 * 原插件用雪球 livenews，匿名调用需要 xq_a_token（靠 Playwright 抓 Cookie），
 * TRSS 侧没有 Playwright 运行环境，因此改用东财 7x24 快讯接口：
 * 无需登录、无需 Cookie，内容源与雪球快讯高度重合。
 * 指令名保留「订阅雪球新闻」以兼容原插件的使用习惯。
 */

import fs from "node:fs"
import path from "node:path"
import { DATA_DIR, getSubs, setSubs } from "./store.js"

const log = globalThis.logger ?? console
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

const NEWS_API = "https://np-weblist.eastmoney.com/comm/web/getFastNewsList"

/** 内存缓存，保留 48h，避免每次请求都重新翻页 */
const CACHE = {
  items: [],
  sortEnd: "",
}

const RETENTION_MS = 48 * 3600 * 1000

export function getCachedNews(limit = 10) {
  return CACHE.items.slice(0, limit)
}

function cleanSummary(summary = "") {
  return String(summary)
    .replace(/^【[^】]*】/, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** 拉取一页快讯 */
export async function fetchNewsPage({ pageSize = 30, sortEnd = "" } = {}) {
  const params = new URLSearchParams({
    client: "web",
    biz: "web_724",
    fastColumn: "102",
    sortEnd: String(sortEnd ?? ""),
    pageSize: String(pageSize),
    req_trace: `${Date.now()}000`,
  })
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 15000)
  try {
    const res = await fetch(`${NEWS_API}?${params}`, {
      signal: ac.signal,
      headers: { "User-Agent": UA, Referer: "https://kuaixun.eastmoney.com/", Accept: "*/*" },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    const list = json?.data?.fastNewsList ?? []
    return {
      sortEnd: json?.data?.sortEnd ?? "",
      items: list.map(i => ({
        id: String(i.code ?? i.realSort ?? i.showTime),
        time: i.showTime ?? "",
        title: i.title ?? "",
        summary: cleanSummary(i.summary ?? ""),
        code: i.code,
        // 东财用 titleColor 标要闻（0=普通，>0=要闻），与原版 important 口径一致
        important: Number(i.titleColor) > 0,
        stocks: (i.stockList ?? []).map(s => ({ name: s.name, code: s.market_code ?? s.code })),
      })),
    }
  } finally {
    clearTimeout(timer)
  }
}

/** 拉取并合并到缓存，返回新增条目 */
export async function pullNews(pages = 1) {
  const fresh = []
  let sortEnd = ""
  for (let i = 0; i < pages; i++) {
    let page
    try {
      page = await fetchNewsPage({ pageSize: 50, sortEnd })
    } catch (err) {
      log.error?.(`[SayuStock] 拉取快讯失败: ${err.message}`)
      break
    }
    if (!page.items.length) break
    fresh.push(...page.items)
    sortEnd = page.sortEnd
  }

  const seen = new Set(CACHE.items.map(i => i.id))
  const added = fresh.filter(i => !seen.has(i.id) && i.title)
  for (const it of added) seen.add(it.id)

  CACHE.items = [...added, ...CACHE.items]
  if (sortEnd) CACHE.sortEnd = sortEnd

  const now = Date.now()
  CACHE.items = CACHE.items.filter(i => {
    const t = new Date(i.time.replace(/-/g, "/")).getTime()
    return !Number.isFinite(t) || now - t <= RETENTION_MS
  })
  // 上限保护，避免长时间运行内存膨胀
  if (CACHE.items.length > 600) CACHE.items.length = 600

  return added
}

/** 推送游标持久化，进程重启不会重复推送 */
const SEEN_FILE = path.join(DATA_DIR, "news_seen.json")

export function loadSeen() {
  try {
    return new Set(JSON.parse(fs.readFileSync(SEEN_FILE, "utf8")))
  } catch {
    return new Set()
  }
}

export function saveSeen(seen) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(SEEN_FILE, JSON.stringify([...seen].slice(-800)), "utf8")
  } catch (err) {
    log.error?.(`[SayuStock] 保存快讯游标失败: ${err.message}`)
  }
}

export function subscribedGroups() {
  return Object.keys(getSubs().groups)
}

export { getSubs, setSubs }

/** 格式化单条快讯 */
export function formatNews(item) {
  const body = item.summary && item.summary !== item.title ? item.summary : ""
  return [`【${item.time.slice(11, 16)}】${item.title}`, body].filter(Boolean).join("\n")
}

/** 格式化多条快讯为一条消息 */
export function formatNewsList(items, title = "财经快讯") {
  const head = `===== ${title} =====`
  return [head, ...items.map((i, idx) => `${idx + 1}. ${formatNews(i)}`)].join("\n\n")
}
