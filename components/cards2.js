/**
 * 分析类卡片：技术分析、股票卡片、自动选股、组合体检、基金持仓、IPO 日历。
 */

import { card, esc, footer, money, num, pct, price, signed, tone, nowText } from "../render.js"
import { sparkline } from "./charts.js"

const CW = 828

/* ------------------------------------------------------------ 通用小组件 */

/** 环形评分（0~100） */
function scoreRing(score) {
  const r = 34
  const c = 2 * Math.PI * r
  const val = Math.max(0, Math.min(100, Number(score) || 0))
  const dash = (val / 100) * c
  const color = val >= 75 ? "#e0333a" : val >= 60 ? "#f0a020" : val >= 45 ? "#8a93a3" : "#0f9d58"
  return `<svg width="86" height="86" viewBox="0 0 86 86">
    <circle cx="43" cy="43" r="${r}" fill="none" stroke="#eef1f5" stroke-width="9"/>
    <circle cx="43" cy="43" r="${r}" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round"
      stroke-dasharray="${dash.toFixed(1)} ${(c - dash).toFixed(1)}" transform="rotate(-90 43 43)"/>
    <text x="43" y="47" text-anchor="middle" font-size="20" font-weight="700" fill="${color}">${Math.round(val)}</text>
    <text x="43" y="61" text-anchor="middle" font-size="9" fill="#98a1ad">评分</text>
  </svg>`
}

function kvRow(pairs) {
  return `<div class="kv" style="margin:8px 0 4px">${pairs
    .map(([k, v, cls]) => `<span>${esc(k)} <b class="${cls ?? ""}">${v}</b></span>`)
    .join("")}</div>`
}

function perfRow(perf) {
  const one = (label, v) =>
    `<div class="tile" style="padding:7px 9px">
      <div class="tile-name">${label}</div>
      <div class="tile-val ${tone(v)}" style="font-size:14px">${v === null || v === undefined ? "--" : pct(v)}</div>
    </div>`
  return `<div class="grid3" style="margin:8px 0">
    ${one("近 5 日", perf.d5)}${one("近 20 日", perf.d20)}${one("近 60 日", perf.d60)}
  </div>`
}

/* ------------------------------------------------------------ 技术分析 */

export function techCard(d) {
  const items = d.score?.items ?? []
  const ind = d.indicators

  const signalRows = items
    .map(
      it => `<div class="flex-between" style="padding:5px 0;border-bottom:1px dashed #f2f4f8">
        <span class="fs13">${esc(it.name)}</span>
        <span class="fs13 bold ${it.bull === true ? "up" : it.bull === false ? "down" : "flat"}">${esc(it.text)}</span>
      </div>`,
    )
    .join("")

  const indicatorTable = `<table class="tbl" style="margin-top:6px">
    <thead><tr><th>指标</th><th>数值</th><th>指标</th><th>数值</th></tr></thead>
    <tbody>
      <tr><td>MA5</td><td class="mono">${num(ind.ma5, 2)}</td><td>MACD DIF</td><td class="mono">${num(ind.dif, 3)}</td></tr>
      <tr><td>MA10</td><td class="mono">${num(ind.ma10, 2)}</td><td>MACD DEA</td><td class="mono">${num(ind.dea, 3)}</td></tr>
      <tr><td>MA20</td><td class="mono">${num(ind.ma20, 2)}</td><td>MACD 柱</td><td class="mono ${tone(ind.macd)}">${num(ind.macd, 3)}</td></tr>
      <tr><td>MA60</td><td class="mono">${num(ind.ma60, 2)}</td><td>KDJ (K/D/J)</td><td class="mono">${num(ind.k, 1)} / ${num(ind.d, 1)} / ${num(ind.j, 1)}</td></tr>
      <tr><td>BOLL 上轨</td><td class="mono">${num(ind.bollUp, 2)}</td><td>RSI6 / RSI14</td><td class="mono">${num(ind.rsi6, 1)} / ${num(ind.rsi14, 1)}</td></tr>
      <tr><td>BOLL 中轨</td><td class="mono">${num(ind.bollMid, 2)}</td><td>BOLL 下轨</td><td class="mono">${num(ind.bollLow, 2)}</td></tr>
    </tbody>
  </table>`

  const head = `<div class="flex-between" style="align-items:flex-end;margin-bottom:10px">
    <div>
      <div class="hd-title">${esc(d.name)} <span class="sub fs12">${esc(d.code)}</span>
        <span class="tag">${esc(d.period)}</span></div>
      <div class="fs12 sub" style="margin-top:2px">技术面评分与信号 · ${esc(d.date)}</div>
    </div>
    <div style="text-align:right">
      <div class="big-num ${tone(d.chgPct)}" style="font-size:28px">${price(d.price)}</div>
      <div class="fs13 ${tone(d.chgPct)} bold">${pct(d.chgPct)}</div>
    </div>
  </div>`

  const scoreBlock = `<div style="display:flex;gap:18px;align-items:center;margin-bottom:6px">
    ${scoreRing(d.score?.score)}
    <div style="flex:1">
      <div class="fs13 bold" style="margin-bottom:4px">结论：<span class="${
        d.score?.score >= 60 ? "up" : d.score?.score < 45 ? "down" : "flat"
      }">${esc(d.score?.label ?? "中性")}</span></div>
      <div class="fs12 sub">综合均线排列、MACD、KDJ、RSI 的加权结果，仅作参考</div>
      <div style="margin-top:6px">${sparkline(d.bars.map(b => b.close).slice(-60), {
        w: 320,
        h: 40,
        color: tone(d.chgPct) === "up" ? "#e0333a" : "#0f9d58",
      })}</div>
    </div>
  </div>`

  const body = `${head}${scoreBlock}
    <div class="grid2" style="gap:20px;align-items:start">
      <div><div class="sect-title">信号明细</div>${signalRows}</div>
      <div><div class="sect-title">关键指标</div>${indicatorTable}</div>
    </div>
    <div class="sect-title" style="margin-top:12px">区间表现</div>
    ${perfRow(d.perf)}
    ${footer()}`

  return card("", "", "", body)
}

/* ------------------------------------------------------------ 股票卡片 */

export function stockCard(d) {
  const head = `<div class="flex-between" style="align-items:flex-end;margin-bottom:10px">
    <div>
      <div class="hd-title">${esc(d.name)} <span class="sub fs12">${esc(d.code)}</span></div>
      <div class="fs12 sub" style="margin-top:2px">${esc(d.industry || "行业未分类")}</div>
    </div>
    <div style="text-align:right">
      <div class="big-num ${tone(d.chgPct)}" style="font-size:30px">${price(d.price)}</div>
      <div class="fs13 ${tone(d.chgPct)} bold">${signed(d.chg)} ${pct(d.chgPct)}</div>
    </div>
  </div>`

  const quoteKv = kvRow([
    ["今开", price(d.open), tone(d.open - d.preClose)],
    ["最高", price(d.high), "up"],
    ["最低", price(d.low), "down"],
    ["昨收", price(d.preClose)],
    ["换手", `${num(d.turnover, 2)}%`],
    ["振幅", `${num(d.amplitude, 2)}%`],
    ["成交额", money(d.amount)],
  ])

  const valueKv = kvRow([
    ["市盈率(动)", num(d.pe, 2)],
    ["市净率", num(d.pb, 2)],
    ["总市值", d.marketCap ? money(d.marketCap) : "--"],
    ["流通市值", d.floatCap ? money(d.floatCap) : "--"],
  ])

  const body = `${head}
    <div class="sect-title">盘口</div>${quoteKv}
    <div class="sect-title" style="margin-top:10px">估值</div>${valueKv}
    <div class="sect-title" style="margin-top:12px">技术面</div>
    <div style="display:flex;gap:16px;align-items:center">
      ${scoreRing(d.score?.score)}
      <div style="flex:1">
        <div class="fs13 bold">${esc(d.score?.label ?? "数据不足")}</div>
        <div class="kv" style="margin-top:4px">${(d.score?.items ?? [])
          .slice(0, 4)
          .map(it => `<span>${esc(it.name)} <b class="${it.bull === true ? "up" : it.bull === false ? "down" : "flat"}">${esc(it.text)}</b></span>`)
          .join("")}</div>
        <div style="margin-top:6px">${sparkline(d.closes ?? [], {
          w: 320,
          h: 40,
          color: tone(d.chgPct) === "up" ? "#e0333a" : "#0f9d58",
        })}</div>
      </div>
    </div>
    <div class="sect-title" style="margin-top:12px">区间表现</div>
    ${perfRow(d.perf)}
    ${footer()}`
  return card("", "", "", body)
}

/* ------------------------------------------------------------ 自动选股 */

export function screenerCard(d) {
  const rows = d.rows ?? []
  if (!rows.length) {
    return card(
      "自动选股",
      d.conditions?.join(" · ") || "",
      "",
      `<div class="empty">没有符合条件的标的<br/><span class="fs12">试试放宽市值区间或去掉某个条件</span></div>${footer()}`,
    )
  }

  const hasPE = rows.some(r => Number.isFinite(r.pe))
  const body = rows
    .map(
      r => `<tr>
      <td><div class="bold">${esc(r.name)}</div><div class="fs12 sub">${esc(r.code)}</div></td>
      <td class="mono ${tone(r.chg)}">${price(r.price)}</td>
      <td class="mono ${tone(r.chg)} bold">${pct(r.chg)}</td>
      <td class="mono">${num(r.capYi, 1)}</td>
      <td class="mono">${num(r.turnover, 2)}%</td>
      <td class="mono">${money(r.amount)}</td>
      ${hasPE ? `<td class="mono">${Number.isFinite(r.pe) ? r.pe.toFixed(1) : "--"}</td>` : ""}
      <td class="fs12 sub">${esc(r.industry)}</td>
    </tr>`,
    )
    .join("")

  const inner = `<table class="tbl">
    <thead><tr>
      <th>名称</th><th>现价</th><th>涨跌幅</th><th>市值(亿)</th><th>换手</th><th>成交额</th>
      ${hasPE ? "<th>PE</th>" : ""}<th>行业</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>
  <div class="kv" style="margin-top:8px;color:#98a1ad;font-size:11px">
    <span>命中 ${d.matched} 只 / 全市场 ${d.total} 只，按涨跌幅降序，最多展示 ${rows.length} 只</span>
  </div>
  ${footer("筛选口径：东财全市场快照，仅作选股参考")}`

  return card("自动选股", (d.conditions ?? []).join(" · ") || "无条件（全市场按涨跌幅排序）", `${d.matched} 只命中`, inner)
}

/* ------------------------------------------------------------ 组合体检 */

export function portfolioCard(d) {
  const bars = (d.dist ?? [])
    .slice(0, 8)
    .map(
      x => `<div style="display:grid;grid-template-columns:96px 1fr 52px;gap:8px;align-items:center;padding:3px 0">
        <span class="fs13" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.name)}</span>
        <div style="background:#f2f4f8;border-radius:5px;height:12px;overflow:hidden">
          <div style="width:${x.weight.toFixed(1)}%;height:12px;background:${
            x.weight >= 40 ? "#e0333a" : x.weight >= 25 ? "#f0a020" : "#2f6fed"
          }"></div>
        </div>
        <span class="fs12 mono" style="text-align:right">${x.weight.toFixed(0)}%</span>
      </div>`,
    )
    .join("")

  const warnRows = (d.warnings ?? [])
    .map(
      w => `<div style="display:flex;gap:8px;align-items:flex-start;padding:5px 0">
        <span style="color:${w.level === "danger" ? "#e0333a" : w.level === "warn" ? "#f0a020" : "#0f9d58"};font-weight:700">
          ${w.level === "danger" ? "✕" : w.level === "warn" ? "!" : "✓"}
        </span>
        <span class="fs13">${esc(w.text)}</span>
      </div>`,
    )
    .join("")

  const detailRows = (d.details ?? [])
    .map(
      x => `<tr>
      <td>${esc(x.name)}<span class="fs12 sub"> ${esc(x.code)}</span></td>
      <td class="fs12 sub">${esc(x.industry)}</td>
      <td class="mono ${tone(x.chgPct)}">${x.chgPct === null || x.chgPct === undefined ? "--" : pct(x.chgPct)}</td>
    </tr>`,
    )
    .join("")

  const head = `<div class="flex-between" style="margin-bottom:10px">
    <div>
      <div class="hd-title">组合体检</div>
      <div class="hd-sub">${d.total} 只标的 · 等权估算行业暴露 · ${esc(d.asOf)}</div>
    </div>
    <div style="text-align:right">
      <div class="fs12 sub">赫芬达尔指数</div>
      <div class="fs18 bold ${d.hhi >= 0.25 ? "up" : ""}">${num(d.hhi, 3)}</div>
    </div>
  </div>`

  const inner = `${head}
    <div class="sect-title">行业分布（等权）</div>
    ${bars || '<div class="empty">行业数据不足</div>'}
    <div class="sect-title" style="margin-top:12px">风险提示</div>
    ${warnRows}
    ${
      detailRows
        ? `<div class="sect-title" style="margin-top:12px">标的一览</div>
           <table class="tbl"><thead><tr><th>名称</th><th>行业</th><th>涨跌幅</th></tr></thead>
           <tbody>${detailRows}</tbody></table>`
        : ""
    }
    ${footer("等权估算，未考虑实际仓位与相关性")}`

  return card("", "", "", inner)
}

/* ------------------------------------------------------------ 基金持仓 */

export function fundCard(d) {
  const rows = d.rows ?? []
  const maxW = Math.max(...rows.map(r => r.weight), 1)
  const list = rows
    .map(
      r => `<tr>
      <td>
        <div class="bold">${esc(r.name)}</div>
        <div class="fs12 sub">${esc(r.code)}${r.industry ? ` · ${esc(r.industry)}` : ""}</div>
      </td>
      <td style="width:190px">
        <div style="background:#f2f4f8;border-radius:4px;height:9px;overflow:hidden">
          <div style="width:${((r.weight / maxW) * 100).toFixed(1)}%;height:9px;background:#2f6fed"></div>
        </div>
      </td>
      <td class="mono bold">${r.weight.toFixed(2)}%</td>
      <td class="mono ${tone(r.chgPct)}">${r.chgPct === undefined ? "--" : pct(r.chgPct)}</td>
    </tr>`,
    )
    .join("")

  const inner = `<table class="tbl">
    <thead><tr><th>持仓</th><th>占比</th><th>净值占比</th><th>今日</th></tr></thead>
    <tbody>${list}</tbody>
  </table>
  <div class="kv" style="margin-top:8px;color:#98a1ad;font-size:11px">
    <span>前十大重仓合计 ${d.totalWeight.toFixed(2)}% · 数据来自基金季报披露，非实时持仓</span>
  </div>
  ${footer("基金持仓数据存在披露滞后")}`

  return card(`基金持仓 · ${d.name}`, d.code, nowText(), inner)
}

/* ------------------------------------------------------------ IPO 日历 */

export function ipoCard(d) {
  const rows = d.rows ?? []
  const head = `<div class="hd-sub" style="margin-bottom:10px">
    申购 / 上市窗口 ${esc(d.from)} ~ ${esc(d.to)} · 共 ${rows.length} 只
  </div>`

  if (!rows.length) {
    return card("IPO 日历", `${d.from} ~ ${d.to}`, "", `${head}<div class="empty">窗口内暂无新股</div>${footer()}`)
  }

  const inWin = d2 => Boolean(d2) && d2 >= d.from && d2 <= d.to
  const body = rows
    .map(r => {
      // 申购日在窗口内就标申购，否则说明是因为上市日被纳入窗口
      const evt = inWin(r.applyDate)
        ? { date: r.applyDate, tag: "申购" }
        : inWin(r.listingDate)
          ? { date: r.listingDate, tag: "上市" }
          : { date: r.applyDate || r.listingDate, tag: "" }
      return `<tr>
      <td><div class="bold">${esc(r.name || "--")}</div><div class="fs12 sub">${esc(r.code)}${r.board ? ` · ${esc(r.board)}` : ""}</div></td>
      <td class="fs12 sub">${esc(r.market)}</td>
      <td class="mono fs13">${esc(evt.date)}${evt.tag ? `<span class="tag">${evt.tag}</span>` : ""}</td>
      <td class="mono">${esc(r.listingDate || "--")}</td>
      <td class="mono">${r.price ? r.price.toFixed(2) : "--"}</td>
      <td class="mono">${r.industryPe ? r.industryPe.toFixed(1) : "--"}</td>
      <td class="mono">${r.raise ? money(r.raise) : "--"}</td>
    </tr>`
    })
    .join("")

  const inner = `${head}
  <table class="tbl">
    <thead><tr><th>名称</th><th>市场</th><th>申购日</th><th>上市日</th><th>发行价</th><th>行业PE</th><th>募资</th></tr></thead>
    <tbody>${body}</tbody>
  </table>
  ${d.failures?.length ? `<div class="kv" style="margin-top:6px;color:#c2410c">${esc(d.failures.join("；"))}</div>` : ""}
  ${footer("新股数据以交易所公告为准")}`

  return card("IPO 日历", "", nowText(), inner)
}
