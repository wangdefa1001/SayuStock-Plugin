/** 基金持仓：东财基金持仓接口 + 名称搜索 */

import { rawGet, ulist } from "./em.js"
import { stockInfo } from "./stockdb.js"

/** 东财基金接口要求的固定设备号（App 端硬编码值，缺失会返回空） */
const DEVICE_ID = "1234567.py.service"
const POS_API = "https://fundwebapi.eastmoney.com/FundMEApi/FundPositionList"
const SEARCH_API = "https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx"

/** 基金代码/名称搜索，返回 { code, name } 或 null */
export async function searchFund(key) {
  try {
    const res = await rawGet(SEARCH_API, { m: 1, key: String(key) }, { retry: 1 })
    const list = res?.Datas ?? []
    if (!list.length) return null
    const exact = list.find(i => i.CODE === String(key)) ?? list[0]
    return { code: exact.CODE, name: exact.NAME }
  } catch {
    return null
  }
}

/**
 * 查基金前十大重仓股。
 * @param {string} query 基金代码或名称
 */
export async function fetchFundHoldings(query) {
  const raw = String(query ?? "").trim()
  if (!raw) throw new Error("请后跟基金代码或名称，例如：#基金持仓 000001")

  let code = /^\d{6}$/.test(raw) ? raw : null
  let fundName = ""

  const hit = await searchFund(raw)
  if (hit) {
    // 用户给的是名称时，以搜索命中的代码为准；给代码时用搜索补名称
    if (!code) code = hit.code
    if (hit.code === code) fundName = hit.name
  }
  if (!code) throw new Error(`没找到基金「${raw}」，试试直接给六位基金代码`)

  const res = await rawGet(
    POS_API,
    {
      pageIndex: 1,
      pageSize: 10,
      deviceid: DEVICE_ID,
      version: "4.3.0",
      product: "Eastmoney",
      plat: "Web",
      FCODE: code,
    },
    { headers: { Referer: "https://fund.eastmoney.com/" }, retry: 1 },
  )

  if (res?.Success === false || res?.ErrCode) {
    throw new Error(`基金 ${code} 持仓获取失败：${res?.ErrMsg ?? res?.ErrorMessage ?? "接口返回异常"}`)
  }

  const datas = res?.Datas ?? []
  if (!datas.length) {
    throw new Error(`基金 ${code} 暂无持仓数据（可能是新基金、债基或 QDII，不披露股票持仓）`)
  }

  const rows = datas.map(d => {
    const info = stockInfo(d.ShareCode)
    return {
      code: String(d.ShareCode ?? ""),
      name: d.ShareName ?? info?.name ?? d.ShareCode,
      weight: Number(d.ShareProportion) || 0,
      industry: info ? [info.industry_l1, info.industry_l2].filter(Boolean).join(" / ") : "",
      market: String(d.NEWTEXCH ?? "") === "1" ? "沪" : "深",
    }
  })

  // 补现价与涨跌幅（拿不到就留空，不影响占比展示）
  try {
    const quotes = await ulist(
      rows.map(r => `${r.market === "沪" ? 1 : 0}.${r.code}`),
      ["f2", "f3", "f12"],
    )
    const map = new Map((quotes ?? []).map(q => [String(q.f12), q]))
    for (const r of rows) {
      const q = map.get(r.code)
      if (q) {
        r.price = Number(q.f2)
        r.chgPct = Number(q.f3)
      }
    }
  } catch {
    /* 行情失败不影响持仓表 */
  }

  const totalWeight = rows.reduce((a, r) => a + r.weight, 0)
  return { code, name: fundName || code, rows, totalWeight, asOf: null }
}
