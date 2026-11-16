/**
 * 出图入口：复用 TRSS-Yunzai 的渲染管线（lib/renderer）截 #container。
 *
 * 设计要点：
 *  - 所有样式内联进 HTML，不引用任何外部 CSS/JS/字体 CDN，
 *    手机端离线也能出图，也不会因为 file:// 相对路径失效。
 *  - 图形全部由本插件生成 SVG，不依赖 Chart.js 等前端库。
 */

import path from "node:path"
import { fileURLToPath } from "node:url"

const _dir = path.dirname(fileURLToPath(import.meta.url))
const TPL_FILE = path.join(_dir, "resources", "card.html")
const log = globalThis.logger ?? console

let renderer = null
let rendererErr = ""
try {
  const mod = await import("../../lib/renderer/loader.js")
  renderer = mod.default ?? mod
} catch (err) {
  rendererErr = err?.message ?? String(err)
  log.error?.(`[SayuStock] 渲染器加载失败，将以纯文本模式运行：${rendererErr}`)
}

export const hasRenderer = () => Boolean(renderer?.render)

/* --------------------------------------------------------------- 样式表 */

const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
body{background:#eef1f5;font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC",sans-serif;color:#1b2230;-webkit-font-smoothing:antialiased}
#container{width:900px;padding:16px;background:#eef1f5}
.card{background:#fff;border-radius:14px;padding:16px 18px;margin-bottom:12px;box-shadow:0 1px 2px rgba(16,24,40,.05),0 10px 24px -16px rgba(16,24,40,.28)}
.card:last-child{margin-bottom:0}
.hd{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:12px}
.hd-title{font-size:17px;font-weight:700;letter-spacing:.2px}
.hd-sub{font-size:12px;color:#6b7480;margin-top:3px}
.hd-right{font-size:12px;color:#6b7480;text-align:right;line-height:1.5}
.up{color:#e0333a}
.down{color:#0f9d58}
.flat{color:#8a93a3}
.mono{font-variant-numeric:tabular-nums;font-feature-settings:"tnum"}
.sub{color:#6b7480}
.fs12{font-size:12px}
.fs13{font-size:13px}
.fs18{font-size:18px}
.bold{font-weight:700}
.row{display:flex;gap:12px}
.col{flex:1;min-width:0}
.flex-between{display:flex;align-items:center;justify-content:space-between}
.grid5{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.grid1{display:grid;grid-template-columns:1fr;gap:10px}
.grid2{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.tile{background:#f7f8fa;border-radius:10px;padding:9px 10px;border:1px solid #eef0f4}
.tile-name{font-size:11px;color:#6b7480;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tile-val{font-size:16px;font-weight:700;margin-top:3px;letter-spacing:-.2px}
.tile-chg{font-size:11px;margin-top:1px}
.big{display:flex;align-items:baseline;gap:12px}
.big-num{font-size:40px;font-weight:800;letter-spacing:-1.2px;line-height:1.05}
.big-chg{font-size:16px;font-weight:700}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;background:#f0f2f6;color:#6b7480}
.pill-up{background:#fdeceb;color:#d02a31}
.pill-down{background:#e9f7ef;color:#0c8b4d}
.tbl{width:100%;border-collapse:collapse;font-size:13px}
.tbl th{font-size:11px;color:#8a93a3;font-weight:500;text-align:right;padding:6px 6px;border-bottom:1px solid #eef0f4}
.tbl th:first-child,.tbl td:first-child{text-align:left}
.tbl td{padding:7px 6px;text-align:right;border-bottom:1px solid #f4f6f9}
.tbl tr:last-child td{border-bottom:0}
.legend{display:flex;flex-wrap:wrap;gap:10px 16px;margin-bottom:8px}
.legend-item{display:flex;align-items:center;gap:6px;font-size:12px}
.dot{width:8px;height:8px;border-radius:2px;display:inline-block}
.badge{display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:6px;font-size:11px;font-weight:600}
.footer{margin-top:10px;padding-top:10px;border-top:1px dashed #eceff4;font-size:11px;color:#98a1ad;display:flex;justify-content:space-between}
.hint{font-size:12px;color:#8a93a3;line-height:1.7}
.chart-wrap{position:relative}
svg{display:block}
.empty{padding:26px;text-align:center;color:#98a1ad;font-size:13px}
.tag{font-size:11px;padding:1px 6px;border-radius:5px;background:#f2f4f8;color:#6b7480;margin-left:6px}
.kv{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:#6b7480}
.kv b{color:#1b2230;font-weight:700}
.sect-title{font-size:12px;font-weight:700;color:#4a5361;margin:0 0 8px}
.mini-hd{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px}
.mini-name{font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px}
.mini-val{font-size:13px;font-weight:700}
.help-item{display:flex;gap:10px;padding:8px 0;border-bottom:1px dashed #eef0f4;font-size:13px}
.help-item:last-child{border-bottom:0}
.help-cmd{width:210px;flex:none;font-weight:700;color:#1b2230}
.help-desc{flex:1;color:#5c6675}
.help-eg{color:#98a1ad;font-size:12px;margin-top:2px}
`

/* ------------------------------------------------------------- 渲染入口 */

/**
 * 渲染一张卡片
 * @param {string} body 卡片 HTML
 * @param {{width?:number, saveId?:string, type?:string}} opt
 * @returns {Promise<Buffer|false>}
 */
export async function render(body, { width = 900, saveId, type = "jpeg", quality = 92 } = {}) {
  if (!renderer?.render) return false
  const data = {
    tplFile: TPL_FILE,
    css: CSS.replace(/#container\{width:900px/, `#container{width:${width}px`),
    body,
    width,
    saveId: saveId || `sayustock_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    imgType: type,
    quality,
  }
  try {
    const img = await renderer.render("SayuStock", data)
    return img || false
  } catch (err) {
    log.error?.(`[SayuStock] 渲染失败: ${err?.message ?? err}`)
    return false
  }
}

/* --------------------------------------------------------------- 小工具 */

export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function num(v, d = 2) {
  if (v === null || v === undefined || v === "" || Number.isNaN(Number(v))) return "--"
  return Number(v).toFixed(d)
}

/** 价格：>=1 保留 2 位，<1（基金净值/低价股）保留 3 位 */
export function price(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "--"
  const n = Number(v)
  return n.toFixed(Math.abs(n) >= 1 ? 2 : 3)
}

export function pct(v, d = 2) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "--"
  const n = Number(v)
  return `${n > 0 ? "+" : ""}${n.toFixed(d)}%`
}

export function signed(v, d = 2) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "--"
  const n = Number(v)
  return `${n > 0 ? "+" : ""}${n.toFixed(d)}`
}

/** 成交额（元）→ 亿/万 */
export function money(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "--"
  const n = Number(v)
  if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(2)}万亿`
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(2)}亿`
  if (Math.abs(n) >= 1e4) return `${(n / 1e4).toFixed(2)}万`
  return n.toFixed(0)
}

export function vol(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "--"
  const n = Number(v)
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(2)}亿手`
  if (Math.abs(n) >= 1e4) return `${(n / 1e4).toFixed(2)}万手`
  return `${n.toFixed(0)}手`
}

/** 涨跌配色类名 */
export function tone(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n === 0) return "flat"
  return n > 0 ? "up" : "down"
}

export function toneColor(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n === 0) return "#8a93a3"
  return n > 0 ? "#e0333a" : "#0f9d58"
}

export function nowText() {
  const d = new Date(Date.now() + 8 * 3600 * 1000)
  const p = n => String(n).padStart(2, "0")
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

export function footer(extra = "数据来源：东方财富") {
  return `<div class="footer"><span>${esc(extra)}</span><span>早柚股票 SayuStock · ${nowText()} · 仅供学习参考，不构成投资建议</span></div>`
}

/** 卡片外壳 */
export function card(title, sub, right, inner, extraClass = "") {
  const head =
    title || right
      ? `<div class="hd"><div><div class="hd-title">${title ?? ""}</div>${
          sub ? `<div class="hd-sub">${sub}</div>` : ""
        }</div><div class="hd-right">${right ?? ""}</div></div>`
      : ""
  return `<div class="card ${extraClass}">${head}${inner}</div>`
}
