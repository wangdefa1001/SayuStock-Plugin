/** 帮助 */

import plugin from "../../../lib/plugins/plugin.js"
import { guard, replyImage } from "../components/reply.js"
import { helpCard } from "../components/cards.js"

const SECTIONS = [
  {
    title: "大盘行情",
    desc: "指数 / 涨跌分布 / 板块热力",
    items: [
      { cmd: "大盘概览", desc: "主要指数、涨跌分布、成交额、领涨领跌行业", eg: "大盘概览" },
      { cmd: "大盘云图", desc: "全A市值热力图（可跟 港股 / 美股）", eg: "大盘云图" },
      { cmd: "行业云图 [名称]", desc: "行业板块热力图，不跟名称则看全部行业", eg: "行业云图 半导体" },
      { cmd: "概念云图 [名称]", desc: "概念板块热力图", eg: "概念云图 白酒" },
      { cmd: "全天候", desc: "全球股市 / 大宗商品 / 外汇 / 加密", eg: "全天候" },
    ],
  },
  {
    title: "个股查询",
    desc: "分时 / 五日 / K线，多只空格分隔",
    items: [
      { cmd: "个股 [名称/代码]", desc: "当日分时图；给多只则出迷你分时对比", eg: "个股 证券ETF" },
      { cmd: "个股 五日 [名称]", desc: "五日分时（分时线，不是K线）", eg: "个股 五日 贵州茅台" },
      { cmd: "个股 日k [名称]", desc: "日K线；周k / 月k / 季k / 年k 同理", eg: "个股 日k 510300" },
      { cmd: "个股 [板块名]", desc: "板块自动展开为成交额前 13 只成分股分时", eg: "个股 白酒" },
      { cmd: "我的个股", desc: "自选前 5 只当日分时", eg: "我的个股" },
    ],
  },
  {
    title: "对比工具",
    desc: "多股归一化涨跌幅",
    items: [
      { cmd: "对比个股 [标的...]", desc: "默认最近一年日K归一化对比，最多 12 只", eg: "对比个股 510300 512880" },
      { cmd: "对比个股 年初至今 ...", desc: "支持 年初至今 / 最近一月 / 最近三月", eg: "对比个股 年初至今 白酒ETF 医药ETF" },
      { cmd: "对比个股 2024.01.01~2024.12.31 ...", desc: "自定义区间", eg: "对比个股 2024.01.01~2024.12.31 600519" },
    ],
  },
  {
    title: "自选管理",
    desc: "个人股票池",
    items: [
      { cmd: "添加自选 [标的...]", desc: "支持股票/ETF/指数/板块，空格分隔多个", eg: "添加自选 600519 贵州茅台" },
      { cmd: "删除自选 [标的...]", desc: "从自选移除", eg: "删除自选 600519" },
      { cmd: "清空自选", desc: "清空全部自选（需二次确认）", eg: "清空自选" },
      { cmd: "我的自选", desc: "自选行情表（价格/涨跌/换手/成交额/分时）", eg: "我的自选" },
    ],
  },
  {
    title: "分析工具",
    desc: "技术面 / 选股 / 组合",
    items: [
      { cmd: "技术分析 [标的]", desc: "均线/MACD/KDJ/RSI 评分与信号，可加周期", eg: "技术分析 600519" },
      { cmd: "技术分析 周k [标的]", desc: "周期支持 日k / 周k / 月k / 60分钟", eg: "技术分析 周k 贵州茅台" },
      { cmd: "股票卡片 [标的]", desc: "盘口 + 估值 + 技术 + 区间表现一页纸", eg: "股票卡片 510300" },
      { cmd: "自动选股 [条件...]", desc: "市值/PE/涨跌幅/换手/成交额/行业 组合筛选", eg: "自动选股 市值50-200 涨跌幅>2" },
      { cmd: "组合体检 [标的...]", desc: "自选或指定组合的行业集中度与风险提示", eg: "组合体检" },
    ],
  },
  {
    title: "基金与新股",
    desc: "基金持仓 / IPO 日历",
    items: [
      { cmd: "基金持仓 [基金]", desc: "前十大重仓股与净值占比", eg: "基金持仓 000001" },
      { cmd: "IPO日历 [市场]", desc: "申购与上市窗口，可跟 A股/港股/美股", eg: "IPO日历 港股" },
    ],
  },
  {
    title: "新闻订阅",
    desc: "财经快讯 7x24",
    items: [
      { cmd: "订阅雪球新闻", desc: "群内每 5 分钟自动推送快讯", eg: "订阅雪球新闻" },
      { cmd: "取消订阅雪球新闻", desc: "关闭本群推送", eg: "取消订阅雪球新闻" },
      { cmd: "财经快讯 [条数]", desc: "立即查询最新快讯，默认 8 条", eg: "财经快讯 12" },
    ],
  },
]

/** 帮助里统一展示带 # 的写法：无论面板是否强制前缀，# 写法都一定可用 */
const withPrefix = sections =>
  sections.map(sec => ({
    ...sec,
    items: sec.items.map(it => ({
      ...it,
      cmd: it.cmd.startsWith("#") ? it.cmd : `#${it.cmd}`,
      eg: String(it.eg ?? "").startsWith("#") ? it.eg : `#${it.eg}`,
    })),
  }))

export class SayuHelp extends plugin {
  constructor() {
    super({
      name: "早柚股票-帮助",
      dsc: "帮助图",
      event: "message",
      priority: 470,
      rule: [{ reg: "^#?(股票帮助|早柚股票帮助|SayuStock帮助)$", fnc: "help", log: false }],
    })
  }

  async help(e) {
    return guard(e, async () => {
      const sections = withPrefix(SECTIONS)
      const ok = await replyImage(e, helpCard(sections), { saveId: "sayustock_help" })
      if (ok) return
      const text = sections.map(
        s => `【${s.title}】\n${s.items.map(i => `· ${i.cmd} —— ${i.desc}（例：${i.eg}）`).join("\n")}`,
      ).join("\n\n")
      await e.reply(text)
    })
  }
}
