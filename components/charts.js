/**
 * SVG 图表：分时、K线、多股对比、云图矩形树、迷你走势。
 * 纯字符串拼装，不依赖任何前端图表库。
 */

const UP = "#e0333a"
const DOWN = "#0f9d58"
const GRID = "#eef1f5"
const AXIS_TXT = "#98a1ad"
const AVG = "#f0a020"

const PALETTE = [
  "#e0333a",
  "#2f6fed",
  "#f0a020",
  "#0f9d58",
  "#8b5cf6",
  "#0ea5e9",
  "#d946ef",
  "#65a30d",
  "#f97316",
  "#14b8a6",
  "#64748b",
  "#a855f7",
]

const r1 = n => Math.round(n * 10) / 10
const escTxt = s =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")

function niceTicks(min, max, count = 4) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  if (min === max) return [min]
  const span = max - min
  const raw = span / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag
  const start = Math.ceil(min / step) * step
  const ticks = []
  for (let v = start; v <= max + step * 0.001; v += step) ticks.push(r1(v))
  return ticks
}

function polyline(pts, color, width = 1.6, dash = "") {
  if (pts.length < 2) return ""
  const d = pts.map((p, i) => `${i ? "L" : "M"}${r1(p[0])},${r1(p[1])}`).join(" ")
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}"${
    dash ? ` stroke-dasharray="${dash}"` : ""
  } stroke-linejoin="round" stroke-linecap="round"/>`
}

function fmtAxNum(v) {
  const n = Math.abs(v)
  if (n >= 1e4) return (v / 1e4).toFixed(1) + "万"
  if (n >= 1e3) return v.toFixed(0)
  if (n >= 10) return v.toFixed(1)
  return v.toFixed(2)
}

/* --------------------------------------------------------------- 分时图 */

/**
 * @param {{name:string,code:string,preClose:number,points:Array,ndays:number,decimal:number}} s
 */
export function intradaySVG(s, { width = 860, compact = false } = {}) {
  const points = s.points ?? []
  if (!points.length) return `<div class="empty">暂无分时数据</div>`

  const padL = 4
  const isMulti = (s.ndays ?? 1) > 1
  const padR = compact ? 4 : isMulti ? 68 : 84
  const priceH = compact ? 96 : 196
  const volH = compact ? 0 : 54
  const gap = compact ? 0 : 10
  const axisH = compact ? 12 : 18
  const plotW = width - padL - padR
  const totalH = priceH + volH + gap + axisH

  const prices = points.map(p => p.price)
  const preClose = Number(s.preClose) || prices[0]

  let lo
  let hi
  if (isMulti) {
    lo = Math.min(...prices)
    hi = Math.max(...prices)
    const pad = (hi - lo) * 0.08 || hi * 0.01
    lo -= pad
    hi += pad
  } else {
    const dev = Math.max(
      Math.abs(Math.max(...prices) - preClose),
      Math.abs(preClose - Math.min(...prices)),
      preClose * 0.002,
    )
    lo = preClose - dev * 1.12
    hi = preClose + dev * 1.12
  }

  const xOf = i => padL + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW)
  const yOf = v => priceH - ((v - lo) / (hi - lo)) * (priceH - 6) - 3

  const last = points[points.length - 1]
  const lineColor = last.price > preClose ? UP : last.price < preClose ? DOWN : "#8a93a3"

  /* 网格 + 右侧价格轴 */
  let grid = ""
  const ticks = niceTicks(lo, hi, compact ? 2 : 4)
  for (const t of ticks) {
    const y = r1(yOf(t))
    grid += `<line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`
    if (compact) continue
    const pctV = ((t - preClose) / preClose) * 100
    const label = fmtAxNum(t)
    const sub = isMulti ? "" : `${pctV > 0 ? "+" : ""}${pctV.toFixed(2)}%`
    const c = isMulti ? AXIS_TXT : pctV > 0.0001 ? UP : pctV < -0.0001 ? DOWN : AXIS_TXT
    grid += `<text x="${padL + plotW + 8}" y="${y + 3.5}" font-size="10" fill="${c}">${label}</text>`
    if (sub)
      grid += `<text x="${padL + plotW + 8 + 42}" y="${y + 3.5}" font-size="9.5" fill="${c}" opacity=".85">${sub}</text>`
  }

  /* 昨收基准线 */
  const yBase = r1(yOf(preClose))
  const baseLine = `<line x1="${padL}" y1="${yBase}" x2="${padL + plotW}" y2="${yBase}" stroke="${
    isMulti ? "#c9d0da" : lineColor
  }" stroke-width="1" stroke-dasharray="4 4" opacity="${isMulti ? 0.9 : 0.55}"/>`

  /* 分时线 + 均价线 */
  const pricePts = points.map((p, i) => [xOf(i), yOf(p.price)])
  const avgPts = points.map((p, i) => [xOf(i), yOf(p.avg)])

  const areaD =
    `M${r1(pricePts[0][0])},${r1(pricePts[0][1])} ` +
    pricePts.map(p => `L${r1(p[0])},${r1(p[1])}`).join(" ") +
    ` L${r1(pricePts[pricePts.length - 1][0])},${priceH} L${r1(pricePts[0][0])},${priceH} Z`

  const gid = `g${Math.random().toString(36).slice(2, 8)}`
  const area = `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${lineColor}" stop-opacity="0.26"/>
      <stop offset="100%" stop-color="${lineColor}" stop-opacity="0.02"/>
    </linearGradient></defs>
    <path d="${areaD}" fill="url(#${gid})"/>`

  let avgLine = ""
  if (!compact && avgPts.length > 1) avgLine = polyline(avgPts, AVG, 1, "4 3")

  /* 成交量 */
  let volSvg = ""
  if (volH > 0) {
    const maxVol = Math.max(...points.map(p => p.volume), 1)
    const vTop = priceH + gap
    const bw = Math.max(1, (plotW / points.length) * 0.72)
    let bars = ""
    for (let i = 0; i < points.length; i++) {
      const h = (points[i].volume / maxVol) * (volH - 2)
      const pv = i > 0 ? points[i - 1].price : preClose
      const c = points[i].price >= pv ? UP : DOWN
      bars += `<rect x="${r1(xOf(i) - bw / 2)}" y="${r1(vTop + volH - h)}" width="${r1(bw)}" height="${r1(
        Math.max(h, 0.6),
      )}" fill="${c}" opacity=".55"/>`
    }
    volSvg = `<g>${bars}</g>`
  }

  /* 多日分隔与 X 轴标签 */
  const axisY = priceH + volH + gap + axisH - 4
  let dayLines = ""
  let xLabels = ""
  if (isMulti) {
    const dayStarts = []
    for (let i = 0; i < points.length; i++) {
      if (i === 0 || points[i].date !== points[i - 1].date) dayStarts.push(i)
    }
    for (const i of dayStarts) {
      if (i === 0) continue
      const x = r1(xOf(i))
      dayLines += `<line x1="${x}" y1="0" x2="${x}" y2="${priceH + volH + gap}" stroke="#dfe4ea" stroke-width="1" stroke-dasharray="3 3"/>`
    }
    for (const i of dayStarts) {
      const d = points[i].date.slice(5)
      xLabels += `<text x="${r1(xOf(i)) + 2}" y="${axisY}" font-size="9.5" fill="${AXIS_TXT}">${d}</text>`
    }
  } else {
    const toMin = t => {
      const [h, m] = String(t).split(":").map(Number)
      return Number.isFinite(h) ? h * 60 + (m || 0) : NaN
    }
    const targets = compact ? ["09:30", "11:00", "15:00"] : ["09:30", "10:30", "11:30", "14:00", "15:00"]
    const used = new Set()
    for (const tgt of targets) {
      let best = -1
      let bestDiff = Infinity
      for (let i = 0; i < points.length; i++) {
        const diff = Math.abs(toMin(points[Math.min(i, points.length - 1)].time) - toMin(tgt))
        if (diff < bestDiff) {
          bestDiff = diff
          best = i
        }
      }
      if (best < 0 || used.has(best)) continue
      used.add(best)
      const anchor = best === 0 ? "start" : best >= points.length - 1 ? "end" : "middle"
      xLabels += `<text x="${r1(xOf(best))}" y="${axisY}" font-size="${
        compact ? 8.5 : 9.5
      }" fill="${AXIS_TXT}" text-anchor="${anchor}">${points[best].time}</text>`
    }
  }

  /* 现价标记 */
  const lastX = r1(xOf(points.length - 1))
  const lastY = r1(yOf(last.price))
  const dot = `<circle cx="${lastX}" cy="${lastY}" r="2.6" fill="${lineColor}"/>`

  const svg = `<svg width="${width}" height="${totalH}" viewBox="0 0 ${width} ${totalH}" xmlns="http://www.w3.org/2000/svg">
    ${grid}${baseLine}${dayLines}${area}${polyline(pricePts, lineColor, compact ? 1.4 : 1.7)}${avgLine}${volSvg}${dot}${xLabels}
  </svg>`

  if (compact) return svg

  const chgPct = ((last.price - preClose) / preClose) * 100
  const legend = `<div class="legend">
    <span class="legend-item"><span class="dot" style="background:${lineColor}"></span>分时 ${preClose.toFixed(
      s.decimal ?? 2,
    )} 基线</span>
    <span class="legend-item"><span class="dot" style="background:${AVG}"></span>均价 ${last.avg.toFixed(
      s.decimal ?? 2,
    )}</span>
    <span class="legend-item ${chgPct >= 0 ? "up" : "down"}">涨跌 ${chgPct >= 0 ? "+" : ""}${chgPct.toFixed(2)}%</span>
  </div>`
  return `<div class="chart-wrap">${legend}${svg}</div>`
}

/* ----------------------------------------------------------------- K线 */

export function klineSVG(s, { width = 860, count = 120, withMA = true } = {}) {
  const all = s.bars ?? []
  if (!all.length) return `<div class="empty">暂无K线数据</div>`
  const bars = all.slice(-count)

  const padL = 4
  const padR = 84
  const priceH = 230
  const volH = 58
  const gap = 8
  const axisH = 18
  const plotW = width - padL - padR
  const totalH = priceH + volH + gap + axisH

  const lo = Math.min(...bars.map(b => b.low))
  const hi = Math.max(...bars.map(b => b.high))
  const pad = (hi - lo) * 0.06 || hi * 0.01
  const yLo = lo - pad
  const yHi = hi + pad
  const yOf = v => priceH - ((v - yLo) / (yHi - yLo)) * (priceH - 6) - 3
  const step = plotW / bars.length
  const xOf = i => padL + step * (i + 0.5)
  const bw = Math.max(1.2, Math.min(9, step * 0.62))

  let grid = ""
  for (const t of niceTicks(yLo, yHi, 4)) {
    const y = r1(yOf(t))
    grid += `<line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`
    grid += `<text x="${padL + plotW + 6}" y="${y + 3.5}" font-size="10" fill="${AXIS_TXT}">${fmtAxNum(t)}</text>`
  }

  let candles = ""
  const maxVol = Math.max(...bars.map(b => b.volume), 1)
  const vTop = priceH + gap
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]
    const up = b.close >= b.open
    const color = up ? UP : DOWN
    const x = r1(xOf(i))
    const yH = r1(yOf(b.high))
    const yL = r1(yOf(b.low))
    const yO = yOf(b.open)
    const yC = yOf(b.close)
    const top = Math.min(yO, yC)
    const bh = Math.max(Math.abs(yC - yO), 1)
    candles += `<line x1="${x}" y1="${yH}" x2="${x}" y2="${yL}" stroke="${color}" stroke-width="1"/>`
    candles += `<rect x="${r1(x - bw / 2)}" y="${r1(top)}" width="${r1(bw)}" height="${r1(bh)}" fill="${
      up ? color : color
    }" ${up ? "" : ""} opacity=".95"/>`
    const vh = (b.volume / maxVol) * (volH - 2)
    candles += `<rect x="${r1(x - bw / 2)}" y="${r1(vTop + volH - vh)}" width="${r1(bw)}" height="${r1(
      Math.max(vh, 0.6),
    )}" fill="${color}" opacity=".5"/>`
  }

  /* 均线 */
  let maSvg = ""
  if (withMA) {
    const closes = bars.map(b => b.close)
    const maColors = { 5: "#f0a020", 10: "#2f6fed", 20: "#8b5cf6", 60: "#0f9d58" }
    for (const n of [5, 10, 20, 60]) {
      if (bars.length < n) continue
      const pts = []
      for (let i = n - 1; i < closes.length; i++) {
        let sum = 0
        for (let k = i - n + 1; k <= i; k++) sum += closes[k]
        pts.push([xOf(i), yOf(sum / n)])
      }
      maSvg += polyline(pts, maColors[n], 1.1)
    }
  }

  /* X 轴日期 */
  let xLabels = ""
  const labelCount = 6
  const axisY = priceH + volH + gap + axisH - 4
  for (let k = 0; k < labelCount; k++) {
    const i = Math.round((k / (labelCount - 1)) * (bars.length - 1))
    const b = bars[i]
    if (!b) continue
    const txt = bars.length > 0 && /^\d{4}-\d{2}/.test(b.date) ? b.date.slice(2, 10) : b.date
    const anchor = k === 0 ? "start" : k === labelCount - 1 ? "end" : "middle"
    xLabels += `<text x="${r1(xOf(i))}" y="${axisY}" font-size="9.5" fill="${AXIS_TXT}" text-anchor="${anchor}">${txt}</text>`
  }

  const lastBar = bars[bars.length - 1]
  const legend = `<div class="legend">
    <span class="legend-item"><span class="dot" style="background:#f0a020"></span>MA5</span>
    <span class="legend-item"><span class="dot" style="background:#2f6fed"></span>MA10</span>
    <span class="legend-item"><span class="dot" style="background:#8b5cf6"></span>MA20</span>
    <span class="legend-item"><span class="dot" style="background:#0f9d58"></span>MA60</span>
    <span class="legend-item sub">共 ${bars.length} 根 · 最后一根 ${escTxt(lastBar.date)}</span>
  </div>`

  const svg = `<svg width="${width}" height="${totalH}" viewBox="0 0 ${width} ${totalH}" xmlns="http://www.w3.org/2000/svg">
    ${grid}${candles}${maSvg}${xLabels}
  </svg>`
  return `<div class="chart-wrap">${legend}${svg}</div>`
}

/* ------------------------------------------------------------- 多股对比 */

/**
 * @param {Array<{name:string,bars:Array,chgPct?:number}>} list
 */
export function compareSVG(list, { width = 860, height = 300 } = {}) {
  const valid = (list ?? []).filter(s => s.bars?.length > 1)
  if (!valid.length) return `<div class="empty">暂无对比数据</div>`

  const series = valid.map((s, idx) => {
    const base = s.bars[0].close
    const vals = s.bars.map(b => ((b.close - base) / base) * 100)
    return { name: s.name, color: PALETTE[idx % PALETTE.length], vals, dates: s.bars.map(b => b.date), bars: s.bars }
  })

  const allVals = series.flatMap(s => s.vals)
  let lo = Math.min(...allVals, 0)
  let hi = Math.max(...allVals, 0)
  const padv = (hi - lo) * 0.1 || 1
  lo -= padv
  hi += padv

  const padL = 4
  const padR = 68
  const axisH = 20
  const plotW = width - padL - padR
  const plotH = height - axisH
  const maxLen = Math.max(...series.map(s => s.vals.length))

  const xOf = i => padL + (maxLen === 1 ? plotW / 2 : (i / (maxLen - 1)) * plotW)
  const yOf = v => plotH - ((v - lo) / (hi - lo)) * (plotH - 8) - 4

  let grid = ""
  for (const t of niceTicks(lo, hi, 5)) {
    const y = r1(yOf(t))
    const isZero = Math.abs(t) < 1e-9
    grid += `<line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" stroke="${isZero ? "#c9d0da" : GRID}" stroke-width="1"${
      isZero ? ' stroke-dasharray="4 4"' : ""
    }/>`
    grid += `<text x="${padL + plotW + 6}" y="${y + 3.5}" font-size="10" fill="${
      t > 0 ? UP : t < 0 ? DOWN : AXIS_TXT
    }">${t > 0 ? "+" : ""}${t.toFixed(1)}%</text>`
  }

  const lines = series
    .map(s => polyline(s.vals.map((v, i) => [xOf(i), yOf(v)]), s.color, 1.7))
    .join("")

  const longest = series.reduce((a, b) => (a.vals.length >= b.vals.length ? a : b))
  let xLabels = ""
  const n = 5
  for (let k = 0; k < n; k++) {
    const i = Math.round((k / (n - 1)) * (longest.dates.length - 1))
    const d = longest.dates[i] ?? ""
    const anchor = k === 0 ? "start" : k === n - 1 ? "end" : "middle"
    xLabels += `<text x="${r1(xOf(i))}" y="${plotH + 14}" font-size="9.5" fill="${AXIS_TXT}" text-anchor="${anchor}">${d.slice(
      2,
      10,
    )}</text>`
  }

  const legend = series
    .map(
      s =>
        `<span class="legend-item"><span class="dot" style="background:${s.color}"></span>${escTxt(s.name)} <b class="${
          s.vals[s.vals.length - 1] >= 0 ? "up" : "down"
        }">${s.vals[s.vals.length - 1] >= 0 ? "+" : ""}${s.vals[s.vals.length - 1].toFixed(2)}%</b></span>`,
    )
    .join("")

  const svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    ${grid}${lines}${xLabels}
  </svg>`
  return `<div class="chart-wrap"><div class="legend">${legend}</div>${svg}</div>`
}

/* --------------------------------------------------------------- 云图 */

function mix(a, b, t) {
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

/** 涨跌幅 → 热力色（-5% 深绿 … 0 浅灰 … +5% 深红） */
export function heatColor(chg) {
  const lvl = Math.max(-1, Math.min(1, (Number(chg) || 0) / 5))
  if (lvl >= 0) return mix([246, 238, 239], [196, 32, 42], lvl)
  return mix([236, 245, 240], [8, 116, 70], -lvl)
}

function squarify(items, W, H) {
  const total = items.reduce((a, b) => a + b.area, 0)
  if (!total) return []
  const scale = (W * H) / total
  const vals = items.map(it => ({ ...it, area: Math.max(it.area * scale, 1) }))
  const out = []
  let x = 0
  let y = 0
  let w = W
  let h = H
  let row = []

  const worst = (r, side) => {
    const s = r.reduce((a, b) => a + b.area, 0)
    const mx = Math.max(...r.map(i => i.area))
    const mn = Math.min(...r.map(i => i.area))
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn))
  }

  const layoutRow = () => {
    const area = row.reduce((a, b) => a + b.area, 0)
    if (!area) return
    if (w >= h) {
      const colW = Math.min(area / h, w)
      let cy = y
      for (const it of row) {
        const ih = (it.area / area) * h
        out.push({ ...it, x, y: cy, w: colW, h: ih })
        cy += ih
      }
      x += colW
      w -= colW
    } else {
      const rowH = Math.min(area / w, h)
      let cx = x
      for (const it of row) {
        const iw = (it.area / area) * w
        out.push({ ...it, x: cx, y, w: iw, h: rowH })
        cx += iw
      }
      y += rowH
      h -= rowH
    }
    row = []
  }

  for (let i = 0; i < vals.length; i++) {
    const side = Math.min(w, h)
    if (!row.length) {
      row.push(vals[i])
      continue
    }
    if (worst([...row, vals[i]], side) <= worst(row, side)) row.push(vals[i])
    else {
      layoutRow()
      row.push(vals[i])
    }
  }
  if (row.length) layoutRow()
  return out
}

/**
 * @param {Array<{name:string,chg:number,cap:number,code?:string}>} items
 */
export function treemapSVG(items, { width = 860, height = 460 } = {}) {
  const list = (items ?? [])
    .filter(i => i && Number(i.cap) > 0)
    .sort((a, b) => b.cap - a.cap)
    .map(i => ({ ...i, area: Number(i.cap) }))
  if (!list.length) return `<div class="empty">暂无云图数据</div>`

  const rects = squarify(list, width, height)
  let body = ""
  for (const r of rects) {
    if (r.w < 1.5 || r.h < 1.5) continue
    const fill = heatColor(r.chg)
    const lvl = Math.abs(Math.max(-1, Math.min(1, (Number(r.chg) || 0) / 5)))
    const txtColor = lvl > 0.42 ? "#fff" : "#2a3240"
    const showName = r.w > 34 && r.h > 18
    const showChg = r.w > 44 && r.h > 32
    const fs = Math.max(8.5, Math.min(13, Math.sqrt(r.w * r.h) / 4.4))
    const cx = r.x + r.w / 2
    const cy = r.y + r.h / 2
    body += `<rect x="${r1(r.x)}" y="${r1(r.y)}" width="${r1(r.w)}" height="${r1(r.h)}" fill="${fill}" stroke="#fff" stroke-width="0.8"/>`
    if (showName) {
      const maxChars = Math.max(2, Math.floor((r.w - 6) / fs))
      const nm = r.name.length > maxChars ? `${r.name.slice(0, Math.max(1, maxChars - 1))}…` : r.name
      body += `<text x="${r1(cx)}" y="${r1(cy + (showChg ? -2 : 3))}" font-size="${r1(fs)}" fill="${txtColor}" text-anchor="middle" font-weight="600">${escTxt(
        nm,
      )}</text>`
    }
    if (showChg) {
      body += `<text x="${r1(cx)}" y="${r1(cy + fs + 2)}" font-size="${r1(fs - 1.5)}" fill="${txtColor}" text-anchor="middle" opacity=".92">${
        r.chg > 0 ? "+" : ""
      }${(Number(r.chg) || 0).toFixed(2)}%</text>`
    }
  }

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="border-radius:10px;overflow:hidden">${body}</svg>`
}

/* ------------------------------------------------------------- 迷你走势 */

export function sparkline(values, { w = 90, h = 26, color = "#e0333a" } = {}) {
  const vals = (values ?? []).filter(v => Number.isFinite(v))
  if (vals.length < 2) return ""
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const span = hi - lo || 1
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * w, h - ((v - lo) / span) * (h - 3) - 1.5])
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${polyline(
    pts,
    color,
    1.3,
  )}</svg>`
}

export { PALETTE }
