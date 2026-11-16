/** IPO 日历：A股走 datacenter 申购表，港股/美股走列表接口的上市日期 */

import { rawGet, clist } from "./em.js"

const DATACENTER = "https://datacenter-web.eastmoney.com/api/data/v1/get"

const pad = n => String(n).padStart(2, "0")
function dayOffset(offset = 0) {
  const d = new Date(Date.now() + 8 * 3600 * 1000 + offset * 86400 * 1000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

const WINDOW_FROM = -3
const WINDOW_TO = 10

const datePart = v => (typeof v === "string" && v.length >= 10 ? v.slice(0, 10) : "")
const inWindow = d => d >= dayOffset(WINDOW_FROM) && d <= dayOffset(WINDOW_TO)

/** A股：新股申购与上市 */
async function fetchCn() {
  const res = await rawGet(
    DATACENTER,
    {
      reportName: "RPTA_APP_IPOAPPLY",
      columns: "ALL",
      pageSize: 300,
      pageNumber: 1,
      sortColumns: "APPLY_DATE",
      sortTypes: -1,
      source: "WEB",
      client: "WEB",
    },
    { headers: { Referer: "https://data.eastmoney.com/" }, retry: 1 },
  )
  const list = res?.result?.data ?? []
  const rows = []
  for (const it of list) {
    const applyDate = datePart(it.APPLY_DATE)
    const listingDate = datePart(it.LISTING_DATE)
    if (!inWindow(applyDate) && !inWindow(listingDate)) continue
    rows.push({
      market: "A股",
      code: String(it.SECURITY_CODE ?? ""),
      applyCode: String(it.APPLY_CODE ?? ""),
      name: it.SECURITY_NAME_ABBR || it.SECURITY_NAME || it.SECURITY_CODE || "",
      board: it.MARKET_TYPE_NEW || it.TRADE_MARKET || "",
      applyDate,
      listingDate,
      price: Number(it.ISSUE_PRICE) || Number(it.PREDICT_ISSUE_PRICE) || null,
      pe: Number(it.AFTER_ISSUE_PE) || Number(it.ISSUE_PE) || null,
      industryPe: Number(it.INDUSTRY_PE) || null,
      raise: Number(it.TOTAL_RAISE_FUNDS) || null,
    })
  }
  return rows
}

/** 港股 / 美股：列表接口按上市日期(f26)倒序，含未来上市日 */
async function fetchOversea(kind) {
  const fs = kind === "hk" ? "m:116 t:3,m:116 t:4" : "m:105,m:106,m:107"
  const { rows } = await clist({
    fs,
    fid: "f26",
    po: 1,
    pz: 100,
    fields: ["f12", "f14", "f26"],
  })
  const out = []
  for (const r of rows ?? []) {
    const listingDate = datePart(r.f26) || String(r.f26 ?? "").slice(0, 10)
    if (!inWindow(listingDate)) continue
    out.push({
      market: kind === "hk" ? "港股" : "美股",
      code: String(r.f12 ?? ""),
      applyCode: "",
      name: r.f14 ?? "",
      board: "",
      applyDate: "",
      listingDate,
      price: null,
      pe: null,
      industryPe: null,
      raise: null,
    })
  }
  return out
}

/**
 * @param {"a"|"hk"|"us"|"all"} market
 */
export async function fetchIpoCalendar(market = "a") {
  const wantA = market === "a" || market === "all"
  const wantHk = market === "hk" || market === "all"
  const wantUs = market === "us" || market === "all"

  const tasks = []
  const failures = []
  if (wantA) tasks.push(fetchCn().catch(err => (failures.push(`A股：${err.message}`), [])))
  if (wantHk) tasks.push(fetchOversea("hk").catch(err => (failures.push(`港股：${err.message}`), [])))
  if (wantUs) tasks.push(fetchOversea("us").catch(err => (failures.push(`美股：${err.message}`), [])))

  const groups = await Promise.all(tasks)
  const rows = groups.flat()

  rows.sort((a, b) => {
    const da = a.applyDate || a.listingDate
    const db = b.applyDate || b.listingDate
    return da === db ? 0 : da < db ? -1 : 1
  })

  if (!rows.length && failures.length) {
    throw new Error(`IPO 数据获取失败：${failures.join("；")}`)
  }

  return {
    rows,
    from: dayOffset(WINDOW_FROM),
    to: dayOffset(WINDOW_TO),
    failures,
  }
}
