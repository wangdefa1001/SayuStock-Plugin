/**
 * 早柚股票 SayuStock —— TRSS-Yunzai 移植版
 *
 * 原项目：https://github.com/KimigaiiWuyi/SayuStock （gsuid_core / Python 插件）
 * 本插件用 JS 重写了行情数据层、绘图层与指令层，运行在 TRSS-Yunzai 上。
 *
 * 入口只做一件事：把各指令模块的插件类聚合到 apps，
 * 由 Yunzai 的插件加载器统一实例化（插件目录下只需存在 index.js）。
 */

import { SayuMarket } from "./apps/market.js"
import { SayuStock } from "./apps/stock.js"
import { SayuCompare } from "./apps/compare.js"
import { SayuWatchlist } from "./apps/watchlist.js"
import { SayuNews } from "./apps/news.js"
import { SayuHelp } from "./apps/help.js"

export const apps = {
  market: SayuMarket,
  stock: SayuStock,
  compare: SayuCompare,
  watchlist: SayuWatchlist,
  news: SayuNews,
  help: SayuHelp,
}
