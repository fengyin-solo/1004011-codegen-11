import type { EntryRow } from './types'

// 水质监测超标判定的唯一来源：录入结果、列表筛选标记、运营概览三处共用这里的规则，
// 阈值调整只改这一个文件，避免同一指标在各页面各写一套结论。
// 阈值参照《地表水环境质量标准》(GB 3838-2002) 的常用限值，按 demo 口径集中配置。
export const WATER_QUALITY_RULES = {
  PH_MIN: 6,
  PH_MAX: 9,
  AMMONIA_LIMIT: 2.0, // 氨氮浓度，mg/L
  COD_LIMIT: 40.0, // COD值，mg/L
  TURBIDITY_LIMIT: 10.0, // 浊度，NTU
} as const

export type WaterFlag = '待取样' | '已取样' | '已出结果' | '已超标'

export type WaterVerdictInput = Partial<Record<WaterMetric, string | number | null | undefined>>

export type WaterVerdict = {
  complete: boolean
  exceeded: boolean
  reasons: string[]
  flag: Exclude<WaterFlag, '待取样' | '已取样'>
  conclusion: string
  status: '已出结果' | '已超标'
}

export const WATER_METRICS = ['PH值', '氨氮浓度', 'COD值', '浊度'] as const
export type WaterMetric = (typeof WATER_METRICS)[number]

export const WATER_FLAG_OPTIONS: WaterFlag[] = ['待取样', '已取样', '已出结果', '已超标']

// 空字符串、null、undefined、无法解析为数字的内容都视为该指标未录入。
function readMetric(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

// 四项指标缺任何一项都属于不完整数据：只出结果，不触发超标判定。
export function judgeWaterQuality(input: WaterVerdictInput): WaterVerdict {
  const values: Record<WaterMetric, number | null> = {
    PH值: readMetric(input.PH值),
    氨氮浓度: readMetric(input.氨氮浓度),
    COD值: readMetric(input.COD值),
    浊度: readMetric(input.浊度),
  }

  if (WATER_METRICS.some((metric) => values[metric] === null)) {
    return {
      complete: false,
      exceeded: false,
      reasons: [],
      flag: '已出结果',
      conclusion: '数据不完整，暂不判定',
      status: '已出结果',
    }
  }

  const ph = values.PH值 as number
  const ammonia = values.氨氮浓度 as number
  const cod = values.COD值 as number
  const turbidity = values.浊度 as number

  const reasons: string[] = []
  if (ph < WATER_QUALITY_RULES.PH_MIN || ph > WATER_QUALITY_RULES.PH_MAX) {
    reasons.push(`PH值${ph}超出${WATER_QUALITY_RULES.PH_MIN}~${WATER_QUALITY_RULES.PH_MAX}范围`)
  }
  if (ammonia > WATER_QUALITY_RULES.AMMONIA_LIMIT) {
    reasons.push(`氨氮浓度${ammonia}高于${WATER_QUALITY_RULES.AMMONIA_LIMIT}mg/L`)
  }
  if (cod > WATER_QUALITY_RULES.COD_LIMIT) {
    reasons.push(`COD值${cod}高于${WATER_QUALITY_RULES.COD_LIMIT}mg/L`)
  }
  if (turbidity > WATER_QUALITY_RULES.TURBIDITY_LIMIT) {
    reasons.push(`浊度${turbidity}高于${WATER_QUALITY_RULES.TURBIDITY_LIMIT}NTU`)
  }

  const exceeded = reasons.length > 0
  return {
    complete: true,
    exceeded,
    reasons,
    flag: exceeded ? '已超标' : '已出结果',
    conclusion: exceeded ? `已超标：${reasons.join('；')}` : '各项指标合格',
    status: exceeded ? '已超标' : '已出结果',
  }
}

// 读取留档记录当前的统一标记：历史记录按其原有状态展示，不重新判定，
// 重复判定因此永远改不到历史留档。
export function waterQualityFlag(row: EntryRow): WaterFlag {
  const status = String(row.status ?? '')
  if ((WATER_FLAG_OPTIONS as string[]).includes(status)) {
    return status as WaterFlag
  }
  return '待取样'
}

export function isWaterExceeded(row: EntryRow): boolean {
  return waterQualityFlag(row) === '已超标'
}

// 留档记录是否已走完取样流程（待取样/已取样不参与结果与超标统计）。
export function hasWaterResult(row: EntryRow): boolean {
  const flag = waterQualityFlag(row)
  return flag === '已出结果' || flag === '已超标'
}
