/**
 * 卡片组装：把数据层的结果拼成 HTML 片段（配合 render.js 的样式表）。
 */

import {
  card,
  esc,
  footer,
  money,
  num,
  pct,
  price,
  signed,
  tone,
  toneColor,
  nowText,
} from "../render.js"
import { intradaySVG, klineSVG, compareSVG, treemapSVG, heatColor, sparkline, valuationSVG, vixSVG } from "./charts.js"

/** 卡片内容宽度：900 - 容器左右 padding(16*2) - 卡片左右 padding(18*2) */
const CW = 828

/* ------------------------------------------------------------ 大盘概览 */

export function overviewCard(d) {
  const main = d.indexes[0]
  const others = d.indexes.slice(1)
  const breadth = d.breadth
  const totalTurnover = d.indexes.slice(0, 2).reduce((a, b) => a + (Number(b.amount) || 0), 0)

  const big = `<div class="flex-between" style="align-items:flex-end;margin-bottom:14px">
    <div>
      <div class="fs12 sub" style="margin-bottom:4px">${esc(main.name)}</div>
      <div class="big">
        <span class="big-num ${tone(main.chgPct)}">${price(main.price)}</span>
        <span class="big-chg ${tone(main.chgPct)}">${pct(main.chgPct)}</span>
        <span class="big-chg ${tone(main.chgPct)}" style="font-size:14px">${signed(main.chg)}</span>
      </div>
    </div>
    <div style="text-align:right;line-height:1.9" class="fs12">
      <div class="sub">两市成交额 <b class="fs13">${money(totalTurnover)}</b></div>
      <div><span class="up bold">↑ ${breadth.up}</span> <span class="flat">— ${breadth.flat}</span> <span class="down bold">↓ ${breadth.down}</span></div>
    </div>
  </div>`

  const tiles = others
    .map(
      i => `<div class="tile">
      <div class="tile-name">${esc(i.name)}</div>
      <div class="tile-val ${tone(i.chgPct)}">${price(i.price)}</div>
      <div class="tile-chg ${tone(i.chgPct)}">${pct(i.chgPct)}</div>
    </div>`,
    )
    .join("")

  /* 涨跌分布 */
  const buckets = breadth.buckets ?? []
  const total = buckets.reduce((a, b) => a + b.value, 0) || 1
  const segs = buckets
    .filter(b => b.value > 0)
    .map(
      b =>
        `<div style="width:${((b.value / total) * 100).toFixed(2)}%;background:${heatColor(b.heat)};height:16px" title="${
          b.label
        } ${b.value}"></div>`,
    )
    .join("")

  const bandRow = buckets
    .map(
      b => `<div style="flex:1;text-align:center">
        <div class="fs12 bold ${b.side > 0 ? "up" : b.side < 0 ? "down" : "flat"}" style="font-size:11px">${b.value}</div>
        <div class="fs12" style="font-size:9.5px;color:#98a1ad;margin-top:2px">${b.label}</div>
      </div>`,
    )
    .join("")

  const breadthBlock = `<div style="margin:16px 0 6px">
    <div class="sect-title">涨跌分布 · 全A ${total} 只</div>
    <div style="display:flex;height:16px;border-radius:8px;overflow:hidden;gap:1px">${segs}</div>
    <div style="display:flex;margin-top:8px">${bandRow}</div>
  </div>`

  /* 领涨 / 领跌行业 */
  const industryRow = (list, isUp) =>
    list
      .map(
        it => `<div style="display:grid;grid-template-columns:112px auto;gap:10px;align-items:center;padding:4px 0">
        <span class="fs13" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.name)}</span>
        <span class="fs13 bold ${isUp ? "up" : "down"}">${pct(it.chgPct)}</span>
      </div>`,
      )
      .join("")

  const industry = `<div class="grid2" style="margin-top:14px;gap:24px">
    <div>
      <div class="sect-title">领涨行业</div>
      ${industryRow(d.industries.up, true)}
    </div>
    <div style="border-left:1px solid #f0f2f6;padding-left:18px">
      <div class="sect-title">领跌行业</div>
      ${industryRow(d.industries.down, false)}
    </div>
  </div>`

  const inner = `${big}
    <div class="grid5" style="margin-bottom:4px">${tiles}</div>
    ${breadthBlock}
    ${industry}
    ${footer()}`

  return card("大盘概览", d.sub ?? "主要指数 · 涨跌分布 · 成交额", esc(d.time ?? nowText()), inner)
}

/* --------------------------------------------------------------- 云图 */

export function cloudmapCard({ title, sub, items, unit = "只", extra = "" }) {
  const body = treemapSVG(items, { width: CW, height: 470 })
  const sorted = [...items].sort((a, b) => (b.chg ?? 0) - (a.chg ?? 0))
  const top = sorted.slice(0, 3)
  const bottom = sorted.slice(-3).reverse()
  const nameOf = i => `${esc(i.name)} <b class="${tone(i.chg)}">${pct(i.chg)}</b>`
  const legend = `<div class="kv" style="margin-top:10px;justify-content:space-between">
    <span>领涨：${top.map(nameOf).join(" · ")}</span>
    <span>领跌：${bottom.map(nameOf).join(" · ")}</span>
  </div>
  <div class="kv" style="margin-top:6px;color:#98a1ad;font-size:11px">
    <span>色阶：深绿 -5% 以下 ← 浅灰 0% → 深红 +5% 以上；面积 = 总市值</span>
  </div>`
  return card(title, sub, `${items.length} ${unit} · ${nowText()}`, body + legend + extra + footer(), "")
}

/* ------------------------------------------------------------- 个股分时 */

export function intradayCard(s, { ndays = 1 } = {}) {
  const last = s.points[s.points.length - 1]
  const preClose = s.preClose
  const chgPct = ((last.price - preClose) / preClose) * 100
  const chg = last.price - preClose
  const svg = intradaySVG(s, { width: CW })
  const amount = s.points.reduce((a, p) => a + (p.amount || 0), 0)
  const volume = s.points.reduce((a, p) => a + (p.volume || 0), 0)

  const head = `<div class="flex-between" style="align-items:flex-end;margin-bottom:10px">
    <div>
      <div class="hd-title">${esc(s.name)} <span class="sub fs12">${esc(s.code)}</span></div>
      <div class="fs12 sub" style="margin-top:2px">${ndays > 1 ? `五日分时（${s.points[0].date} ~ ${last.date}）` : "当日分时"}</div>
    </div>
    <div style="text-align:right">
      <div class="big-num ${tone(chgPct)}" style="font-size:30px">${price(last.price)}</div>
      <div class="fs13 ${tone(chgPct)} bold">${signed(chg)} ${pct(chgPct)}</div>
    </div>
  </div>
  <div class="kv" style="margin-bottom:8px">
    <span>昨收 <b>${price(preClose)}</b></span>
    <span>最高 <b class="up">${price(Math.max(...s.points.map(p => p.high)))}</b></span>
    <span>最低 <b class="down">${price(Math.min(...s.points.map(p => p.low)))}</b></span>
    <span>成交额 <b>${money(amount)}</b></span>
    <span>成交量 <b>${num(volume, 0)} 手</b></span>
  </div>`

  return card("", "", "", head + svg + footer())
}

/* ----------------------------------------------------------------- K线 */

const PERIOD_TEXT = { 101: "日K", 102: "周K", 103: "月K", 104: "季K", 105: "年K" }

export function klineCard(s, { klt = "101", count = 120 } = {}) {
  const bars = s.bars.slice(-count)
  const last = bars[bars.length - 1]
  const svg = klineSVG(s, { width: CW, count })
  const head = `<div class="flex-between" style="align-items:flex-end;margin-bottom:8px">
    <div>
      <div class="hd-title">${esc(s.name)} <span class="sub fs12">${esc(s.code)}</span>
        <span class="tag">${PERIOD_TEXT[klt] ?? "K线"}</span></div>
      <div class="fs12 sub" style="margin-top:2px">${esc(bars[0].date)} ~ ${esc(last.date)}</div>
    </div>
    <div style="text-align:right">
      <div class="big-num ${tone(last.chgPct)}" style="font-size:28px">${price(last.close)}</div>
      <div class="fs13 ${tone(last.chgPct)} bold">${signed(last.chg)} ${pct(last.chgPct)}</div>
    </div>
  </div>
  <div class="kv" style="margin-bottom:8px">
    <span>开 <b>${price(last.open)}</b></span>
    <span>高 <b class="up">${price(last.high)}</b></span>
    <span>低 <b class="down">${price(last.low)}</b></span>
    <span>成交额 <b>${money(last.amount)}</b></span>
    <span>换手 <b>${num(last.turnover, 2)}%</b></span>
    <span>振幅 <b>${num(last.amplitude, 2)}%</b></span>
  </div>`
  return card("", "", "", head + svg + footer())
}

/* --------------------------------------------------------- 多股迷你分时 */

export function multiIntradayCard(list, { title = "个股分时", sub = "" } = {}) {
  if (!list.length) return card(title, sub, "", `<div class="empty">暂无数据</div>`)

  const cols = list.length <= 1 ? 1 : list.length <= 4 ? 2 : 3
  // 卡片内容 828 宽：grid1 单列 / grid2 各 408 / grid3 各 269，减去 tile 内边距与边框
  const tileGap = cols === 1 ? 0 : cols === 2 ? 12 : 10
  const tileW = (CW - tileGap * (cols - 1)) / cols
  const chartW = Math.floor(tileW - 22)

  const items = list
    .map(s => {
      const last = s.points[s.points.length - 1]
      const chgPct = ((last.price - s.preClose) / s.preClose) * 100
      return `<div class="tile" style="padding:10px">
        <div class="mini-hd">
          <span class="mini-name">${esc(s.name)}</span>
          <span class="mini-val ${tone(chgPct)}">${pct(chgPct)}</span>
        </div>
        <div class="flex-between" style="margin-bottom:2px">
          <span class="fs12 ${tone(chgPct)} bold">${price(last.price)}</span>
          <span class="fs12 sub">${esc(s.code)}</span>
        </div>
        ${intradaySVG(s, { width: chartW, compact: true })}
      </div>`
    })
    .join("")

  return card(
    title,
    sub,
    `${list.length} 只 · ${nowText()}`,
    `<div class="grid${cols}">${items}</div>${footer()}`,
  )
}

/* ------------------------------------------------------------- 多股对比 */

export function compareCard(list, { rangeText = "最近一年", failures = [] } = {}) {
  const svg = compareSVG(list, { width: CW, height: 300 })
  const fail = failures.length
    ? `<div class="kv" style="margin-top:8px;color:#c2410c">未能获取：${esc(failures.join("；"))}</div>`
    : ""
  const sub = `${rangeText} · 归一化涨跌幅`
  return card("对比个股", sub, `${list.length} 只`, svg + fail + footer())
}

/* --------------------------------------------------------------- 自选 */

export function watchlistCard(rows) {
  if (!rows.length) {
    return card(
      "我的自选",
      "",
      "",
      `<div class="empty">你还没有添加自选<br/><span class="fs12">发送「添加自选 600519 贵州茅台」即可添加</span></div>`,
    )
  }

  const body = rows
    .map(r => {
      const s = r.series
      const spark = s ? sparkline(s.points.map(p => p.price), { w: 74, h: 24, color: toneColor(r.chgPct) }) : ""
      return `<tr>
      <td>
        <div class="bold">${esc(r.name)}</div>
        <div class="fs12 sub">${esc(r.code)}</div>
      </td>
      <td class="mono ${tone(r.chgPct)}">${price(r.price)}</td>
      <td class="mono ${tone(r.chgPct)} bold">${pct(r.chgPct)}</td>
      <td class="mono ${tone(r.chgPct)}">${signed(r.chg)}</td>
      <td class="mono">${num(r.turnover, 2)}%</td>
      <td class="mono">${money(r.amount)}</td>
      <td style="width:80px">${spark}</td>
    </tr>`
    })
    .join("")

  const inner = `<table class="tbl">
    <thead><tr>
      <th>名称</th><th>现价</th><th>涨跌幅</th><th>涨跌额</th><th>换手</th><th>成交额</th><th>分时</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>${footer()}`

  return card("我的自选", `共 ${rows.length} 只`, nowText(), inner)
}

/* ------------------------------------------------------------- 全天候 */

export function allWeatherCard(groups) {
  const blocks = groups
    .filter(g => g.items?.length)
    .map(g => {
      const items = g.items
        .map(
          it => `<div class="tile" style="padding:8px 9px">
          <div class="tile-name">${esc(it.name)}</div>
          <div class="tile-val ${tone(it.chgPct)}" style="font-size:14px">${
            it.decimal === 0 ? Number(it.price).toFixed(0) : price(it.price)
          }</div>
          <div class="tile-chg ${tone(it.chgPct)}">${pct(it.chgPct)}</div>
        </div>`,
        )
        .join("")
      return `<div style="margin-bottom:12px">
        <div class="sect-title">${esc(g.title)}</div>
        <div class="grid4">${items}</div>
      </div>`
    })
    .join("")
  return card("全天候板块", "全球股市 · 大宗商品 · 外汇 · 加密货币", nowText(), blocks + footer())
}

/* --------------------------------------------------------------- 帮助 */

export function helpCard(sections) {
  const blocks = sections
    .map(
      sec => `<div style="margin-bottom:14px">
      <div class="sect-title">${esc(sec.title)} <span class="sub" style="font-weight:400">${esc(sec.desc ?? "")}</span></div>
      ${sec.items
        .map(
          it => `<div class="help-item">
          <div class="help-cmd">${esc(it.cmd)}</div>
          <div class="help-desc">${esc(it.desc)}<div class="help-eg">例：${esc(it.eg ?? "")}</div></div>
        </div>`,
        )
        .join("")}
    </div>`,
    )
    .join("")
  return card(
    "早柚股票 SayuStock",
    "TRSS-Yunzai 移植版 · 数据来源 东方财富",
    "指令需带 # 前缀（锅巴面板可关）",
    blocks + footer("行情有延迟，仅供学习参考"),
  )
}


/* --------------------------------------------------------------- 估值对比 */

export function valuationCard(d) {
  const list = d.list || []
  const failures = d.failures || []
  const valueName = d.valueName || "估值"
  const rangeText = d.rangeText || "近三年"
  const svg = valuationSVG(list, { width: CW, height: 300 })

  const rows = list
    .map(s => {
      const pts = s.points
      const first = pts[0].value
      const last = pts[pts.length - 1].value
      const vals = pts.map(p => p.value)
      const min = Math.min(...vals)
      const max = Math.max(...vals)
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length
      const chg = last - first
      const chgCls = chg > 0 ? "up" : chg < 0 ? "down" : "flat"
      return ('<tr>' +
        '<td><div class="bold">' + esc(s.name) + '</div><div class="fs12 sub">' + esc(s.code) + '</div></td>' +
        '<td class="mono bold">' + last.toFixed(2) + '</td>' +
        '<td class="mono ' + chgCls + '">' + (chg > 0 ? "+" : "") + chg.toFixed(2) + '</td>' +
        '<td class="mono">' + min.toFixed(2) + '</td>' +
        '<td class="mono">' + max.toFixed(2) + '</td>' +
        '<td class="mono">' + avg.toFixed(2) + '</td>' +
      '</tr>')
    })
    .join("")

  const table = list.length
    ? '<table class="tbl" style="margin-top:12px"><thead><tr>' +
      '<th>标的</th><th>最新</th><th>区间变化</th><th>区间最低</th><th>区间最高</th><th>均值</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>'
    : ""

  const fail = failures.length
    ? '<div class="kv" style="margin-top:8px;color:#c2410c">未能获取：' + esc(failures.join("；")) + '</div>'
    : ""

  const sub = rangeText + " · " + valueName + "历史走势"
  return card("估值对比", sub, list.length + " 只", svg + table + fail + footer())
}


/* ------------------------------------------------------------- 波动率卡片 */

export function vixCard(d) {
  const color = d.chg >= 0 ? "#e0333a" : "#0f9d58"
  const svg = vixSVG(d.points, { width: CW, height: 260, color })
  const big =
    '<div class="big" style="margin-bottom:6px">' +
    '<div class="big-num ' + tone(d.chg) + '">' + Number(d.last).toFixed(2) + '</div>' +
    '<div class="big-chg ' + tone(d.chg) + '">' + (d.chg >= 0 ? "+" : "") + Number(d.chg).toFixed(2) +
    '（' + (d.chgPct >= 0 ? "+" : "") + Number(d.chgPct).toFixed(2) + '%）</div>' +
    '</div>'
  const kv = '<div class="kv" style="margin-bottom:8px">' +
    '<span>昨收 <b>' + Number(d.pre).toFixed(2) + '</b></span>' +
    '<span>最高 <b>' + Number(d.high).toFixed(2) + '</b></span>' +
    '<span>最低 <b>' + Number(d.low).toFixed(2) + '</b></span>' +
    '<span>样本 <b>' + d.points.length + ' 点</b></span>' +
    '</div>'
  return card(d.label + " 波动率指数", "QVIX · 当日分时", d.label, big + kv + svg + footer("数据来源：optbbs"))
}


/* --------------------------------------------------------------- ETF 找股/对比 */

export function etfSearchCard(d) {
  const stock = d.stock
  const themes = d.themes.slice(0, 12).map(({ theme, funds }) => {
    const rows = funds.slice(0, 5).map(f =>
      '<tr><td>' + esc(f.name) + '</td><td class="fs12 sub">' + esc(f.code) + '</td>' +
      '<td class="mono bold">' + f.weight.toFixed(2) + '%</td></tr>').join("")
    return '<div style="margin-bottom:10px">' +
      '<div class="sect-title">' + esc(theme) + ' · ' + funds.length + ' 只</div>' +
      '<table class="tbl"><thead><tr><th>ETF</th><th>代码</th><th>权重</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
  }).join("")
  const sub = '报告期 ' + d.period + ' · 持有 ETF ' + d.funds.length + ' 只 · 主题 ' + d.themes.length + ' 个'
  return card("ETF找股 · " + stock.name, sub, d.funds.length + " 只", themes + footer())
}

export function etfCompareCard(d) {
  const focus = d.focus
  const cols = d.list.map(f => {
    const holdRows = f.rows.slice(0, 10).map(r => {
      const hit = focus && (String(r.name).includes(focus) || String(r.code) === focus)
      return '<div class="flex-between" style="padding:3px 4px;border-radius:6px;' + (hit ? 'background:#fff7ed;' : "") + '">' +
        '<span class="fs13' + (hit ? " bold up" : "") + '">' + esc(r.name) + '</span>' +
        '<span class="mono fs12">' + r.weight.toFixed(2) + '%</span></div>'
    }).join("")
    const indRows = f.industries.slice(0, 8).map(x =>
      '<span class="pill" style="margin:2px">' + esc(x.name) + ' ' + x.weight.toFixed(1) + '%</span>').join("")
    return '<div class="tile"><div class="bold">' + esc(f.name) + '</div><div class="fs12 sub">' + esc(f.code) + '</div>' +
      '<div class="sect-title" style="margin-top:8px">前十大持仓</div>' + holdRows +
      '<div class="sect-title" style="margin-top:8px">申万二级行业</div><div>' + indRows + '</div></div>'
  }).join("")
  const fail = d.failures && d.failures.length
    ? '<div class="kv" style="color:#c2410c;margin-top:8px">未获取：' + esc(d.failures.join("；")) + '</div>'
    : ""
  const sub = d.list.length + " 只 · 前十大持仓与行业权重" + (focus ? " · 关注 " + esc(focus) : "")
  return card("ETF 对比", sub, d.list.length + " 只", '<div class="grid2">' + cols + '</div>' + fail + footer())
}
