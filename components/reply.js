/** 出图与回话的小工具 */

import { segment } from "oicq"
import { render, hasRenderer } from "../render.js"
import { getConfig } from "../model/store.js"

const log = globalThis.logger ?? console

export function img(buf) {
  return segment.image(buf)
}

/**
 * 渲染并发送图片；渲染失败时回退到文字
 * @returns {Promise<boolean>} 是否已用图片回复
 */
export async function replyImage(e, body, opt = {}) {
  const cfg = getConfig()
  if (cfg.image === false) return false
  if (!hasRenderer()) {
    log.warn?.("[SayuStock] 未检测到渲染器（puppeteer），本次以文字回复")
    return false
  }
  const buf = await render(body, opt)
  if (!buf) return false
  await e.reply(img(buf))
  return true
}

/** 指令前缀校验：requirePrefix 打开时，必须以 # 或 ＃ 开头才响应 */
function prefixOk(e) {
  const cfg = getConfig()
  if (cfg.requirePrefix === false) return true
  return /^[#＃]/.test(String(e.msg ?? "").trim())
}

/** 统一异常处理：把错误原因回给用户，避免静默失败 */
export async function guard(e, fn) {
  if (!prefixOk(e)) return false
  try {
    return await fn()
  } catch (err) {
    log.error?.(`[SayuStock] ${e.msg} 处理失败: ${err?.stack ?? err}`)
    await e.reply(`❌ ${err?.message ?? "查询失败，稍后再试"}`)
    return true
  }
}

/** 取指令后的参数文本（命令词按大小写无关做整词剥离，避免 #IPO日历 这类大小写写法漏剥） */
export function args(e, ...commands) {
  let text = String(e.msg ?? "").replace(/^[#＃]/, "").trim()
  for (const c of commands) {
    if (!c) continue
    const pattern = c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    text = text.replace(new RegExp(pattern, "gi"), " ")
  }
  return text.replace(/[，,]/g, " ").replace(/\s+/g, " ").trim()
}

export function tokenize(text) {
  return String(text ?? "")
    .replace(/[，,、]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
}
