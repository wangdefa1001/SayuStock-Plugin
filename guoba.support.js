/**
 * 锅巴（Guoba）配置面板适配。
 *
 * 约定：插件根目录 guoba.support.js 导出 supportGuoba()，返回
 *   pluginInfo —— 面板里的插件卡片信息
 *   configInfo.schemas —— 表单字段（field 为点号路径，对应 data/config.json 的结构）
 *   configInfo.getConfigData / setConfigData —— 读/存配置
 *
 * 面板保存后即时生效的部分：requirePrefix、image、各数量上限、news.push
 * 需要重载插件（重启 Yunzai 或热重载）才生效：news.interval（定时任务的 cron 在加载时生成）
 */

import { getConfig, saveConfig, DEFAULT_CONFIG } from "./model/store.js"

/** "news.push" → { news: { push: v } } */
function setPath(target, dottedKey, value) {
  const keys = String(dottedKey).split(".")
  let cur = target
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]
    if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {}
    cur = cur[k]
  }
  cur[keys[keys.length - 1]] = value
}

export function supportGuoba() {
  return {
    pluginInfo: {
      name: "SayuStock-Plugin",
      title: "早柚股票 SayuStock",
      author: "SayuStock-Plugin contributors",
      authorLink: "https://github.com/wangdefa1001",
      link: "https://github.com/wangdefa1001/SayuStock-Plugin",
      isV3: true,
      isV2: false,
      description: "移植自 SayuStock 的看盘插件：大盘概览 / 云图 / 个股分时 / K线 / 自选 / 对比 / 财经快讯",
      icon: "mdi:chart-candlestick",
      iconColor: "#e0333a",
    },
    configInfo: {
      schemas: [
        { label: "基础设置", component: "SOFT_GROUP_BEGIN" },
        {
          field: "requirePrefix",
          label: "指令必须带 # 前缀",
          bottomHelpMessage:
            "开启后只有「#大盘概览」这类带 # 的指令才会响应，避免误触发聊天内容；关闭后裸指令也响应。改动即时生效。",
          component: "Switch",
        },
        {
          field: "image",
          label: "启用了出图",
          bottomHelpMessage:
            "关闭后只回文字结果。没装 puppeteer 渲染器（或宿主缺中文字体）时可以临时关掉。改动即时生效。",
          component: "Switch",
        },

        { label: "数量上限", component: "SOFT_GROUP_BEGIN" },
        {
          field: "maxMultiStock",
          label: "个股多图上限",
          bottomHelpMessage: "「#个股 A B C」一次最多画几个迷你分时，建议 4~6",
          component: "InputNumber",
          componentProps: { min: 1, max: 13, step: 1, placeholder: "默认 5" },
        },
        {
          field: "maxCompare",
          label: "对比标的上限",
          bottomHelpMessage: "「#对比个股」一次最多几条线，太多会挤在一起，建议 6~12",
          component: "InputNumber",
          componentProps: { min: 2, max: 20, step: 1, placeholder: "默认 12" },
        },
        {
          field: "cloudmapStocks",
          label: "大盘云图取样数",
          bottomHelpMessage: "取总市值前 N 只画热力图，数值越大方块越碎，建议 80~150",
          component: "InputNumber",
          componentProps: { min: 40, max: 300, step: 10, placeholder: "默认 120" },
        },
        {
          field: "maxWatch",
          label: "自选上限",
          bottomHelpMessage: "每个用户最多能加多少只自选",
          component: "InputNumber",
          componentProps: { min: 5, max: 100, step: 5, placeholder: "默认 30" },
        },

        { label: "财经快讯", component: "SOFT_GROUP_BEGIN" },
        {
          field: "news.push",
          label: "启用快讯推送",
          bottomHelpMessage: "关闭后不再定时推送到已订阅的群（订阅关系保留，仍可用「#财经快讯」查询）。改动即时生效。",
          component: "Switch",
        },
        {
          field: "news.mode",
          label: "推送模式",
          bottomHelpMessage:
            "只要闻：仅推东财标记的要闻（约总量的 10%，与原版默认一致）；全部快讯：整页都推，消息会多很多；每小时/每日汇总：定时合并推送一次。修改后需重载插件。",
          component: "Select",
          componentProps: {
            options: [
              { label: "只要闻（实时，推荐）", value: "important" },
              { label: "全部快讯（实时）", value: "all" },
              { label: "每小时汇总", value: "hourly" },
              { label: "每日 08:00 汇总", value: "daily" },
            ],
          },
        },
        {
          field: "news.interval",
          label: "推送间隔（分钟）",
          bottomHelpMessage: "仅「只要闻 / 全部快讯」模式生效；cron 在插件加载时生成，修改后需重载插件",
          component: "InputNumber",
          componentProps: { min: 1, max: 60, step: 1, placeholder: "默认 5" },
        },
        {
          field: "news.maxPerPush",
          label: "单条消息最多几条",
          bottomHelpMessage: "一次推送里合并几条快讯，超出会拆成多条发送；建议 5~8",
          component: "InputNumber",
          componentProps: { min: 1, max: 20, step: 1, placeholder: "默认 6" },
        },
        {
          field: "news.pages",
          label: "每次拉取页数",
          bottomHelpMessage: "每页约 50 条，拉多了请求重、延迟高，一般 1~2 页足够",
          component: "InputNumber",
          componentProps: { min: 1, max: 5, step: 1, placeholder: "默认 3" },
        },
      ],

      getConfigData() {
        return getConfig()
      },

      /**
       * @param {Record<string, any>} data 形如 { "news.push": true, image: false }
       * @param {{Result?: {ok: Function, error: Function}}} param1
       */
      setConfigData(data = {}, { Result } = {}) {
        const patch = {}
        for (const [keyPath, value] of Object.entries(data)) setPath(patch, keyPath, value)
        try {
          const saved = saveConfig(patch)
          if (Result?.ok) return Result.ok(saved, "保存成功")
          return true
        } catch (err) {
          if (Result?.error) return Result.error(err?.message ?? "保存失败")
          throw err
        }
      },
    },
  }
}

/** 供 README/面板展示的默认值，避免两处硬编码不一致 */
export const GUOBA_DEFAULTS = DEFAULT_CONFIG
