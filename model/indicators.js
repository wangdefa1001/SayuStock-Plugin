/** 技术指标：MA / EMA / BOLL / MACD / KDJ / RSI（与 SayuStock utils/indicators.py 同口径） */

export function ma(values, n) {
  const out = new Array(values.length).fill(null)
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= n) sum -= values[i - n]
    if (i >= n - 1) out[i] = sum / n
  }
  return out
}

export function ema(values, n) {
  const out = new Array(values.length).fill(null)
  const k = 2 / (n + 1)
  let prev = null
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    prev = prev === null ? v : v * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

export function boll(values, n = 20, mult = 2) {
  const mid = ma(values, n)
  const up = new Array(values.length).fill(null)
  const low = new Array(values.length).fill(null)
  for (let i = n - 1; i < values.length; i++) {
    const slice = values.slice(i - n + 1, i + 1)
    const m = mid[i]
    const sd = Math.sqrt(slice.reduce((a, v) => a + (v - m) ** 2, 0) / n)
    up[i] = m + mult * sd
    low[i] = m - mult * sd
  }
  return { mid, up, low }
}

export function macd(values, fast = 12, slow = 26, signal = 9) {
  const ef = ema(values, fast)
  const es = ema(values, slow)
  const dif = values.map((_, i) => (ef[i] ?? 0) - (es[i] ?? 0))
  const dea = ema(dif, signal)
  const hist = dif.map((v, i) => (v - (dea[i] ?? 0)) * 2)
  return { dif, dea, hist }
}

export function kdj(highs, lows, closes, n = 9) {
  const k = []
  const d = []
  const j = []
  let pk = 50
  let pd = 50
  for (let i = 0; i < closes.length; i++) {
    const from = Math.max(0, i - n + 1)
    const hh = Math.max(...highs.slice(from, i + 1))
    const ll = Math.min(...lows.slice(from, i + 1))
    const rsv = hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100
    pk = (2 / 3) * pk + (1 / 3) * rsv
    pd = (2 / 3) * pd + (1 / 3) * pk
    k.push(pk)
    d.push(pd)
    j.push(3 * pk - 2 * pd)
  }
  return { k, d, j }
}

export function rsi(values, n = 14) {
  const out = new Array(values.length).fill(null)
  let gain = 0
  let loss = 0
  for (let i = 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1]
    const g = Math.max(diff, 0)
    const l = Math.max(-diff, 0)
    if (i <= n) {
      gain += g / n
      loss += l / n
      if (i === n) out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)
    } else {
      gain = (gain * (n - 1) + g) / n
      loss = (loss * (n - 1) + l) / n
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)
    }
  }
  return out
}

/** 简单技术面打分，用于股票卡片/技术分析 */
export function scoreTechnical(bars) {
  if (!bars || bars.length < 30) return null
  const closes = bars.map(b => b.close)
  const highs = bars.map(b => b.high)
  const lows = bars.map(b => b.low)
  const m5 = ma(closes, 5)
  const m10 = ma(closes, 10)
  const m20 = ma(closes, 20)
  const m60 = bars.length >= 60 ? ma(closes, 60) : null
  const { dif, dea } = macd(closes)
  const { k, d } = kdj(highs, lows, closes)
  const r = rsi(closes)
  const last = closes.length - 1

  const items = []
  let score = 50

  if (m5[last] && m10[last]) {
    const bull = m5[last] > m10[last]
    score += bull ? 8 : -8
    items.push({ name: "MA5/MA10", text: bull ? "多头排列" : "空头排列", bull })
  }
  if (m20[last]) {
    const above = closes[last] > m20[last]
    score += above ? 8 : -8
    items.push({ name: "MA20", text: above ? "站上20日线" : "跌破20日线", bull: above })
  }
  if (m60 && m60[last]) {
    const above = closes[last] > m60[last]
    score += above ? 6 : -6
    items.push({ name: "MA60", text: above ? "站上60日线" : "跌破60日线", bull: above })
  }
  if (dif[last] !== null) {
    const bull = dif[last] > dea[last]
    score += bull ? 10 : -10
    items.push({ name: "MACD", text: bull ? "金叉区间" : "死叉区间", bull })
  }
  if (k[last]) {
    const low = k[last] < 20
    const high = k[last] > 80
    if (low) score += 8
    if (high) score -= 8
    items.push({
      name: "KDJ",
      text: low ? "超卖" : high ? "超买" : "中性",
      bull: low ? true : high ? false : null,
    })
  }
  if (r[last] !== null) {
    const low = r[last] < 30
    const high = r[last] > 70
    if (low) score += 6
    if (high) score -= 6
    items.push({ name: "RSI14", text: `RSI ${r[last].toFixed(1)}`, bull: low ? true : high ? false : null })
  }

  score = Math.max(0, Math.min(100, Math.round(score)))
  const label = score >= 75 ? "强势" : score >= 60 ? "偏强" : score >= 45 ? "中性" : score >= 30 ? "偏弱" : "弱势"
  return { score, label, items }
}
