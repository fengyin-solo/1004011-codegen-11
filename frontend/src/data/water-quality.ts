import type { EntryRow } from './types'

/**
 * 水质监测超标判定的唯一规则来源。
 * 录入结果、列表筛选标记、运营概览都引用这里的结论，不再各自写一套判定。
 * 阈值集中在 WATER_QUALITY_RULES 配置，规则调整只改本文件。
 */

export const WATER_QUALITY_INDICATORS = ['PH值', '氨氮浓度', 'COD值', '浊度'] as const
export type WaterQualityIndicator = (typeof WATER_QUALITY_INDICATORS)[number]

export const WATER_MODULE_KEY = 'water_quality'

export const WATER_STATUS_PENDING_SAMPLE = '待取样'
export const WATER_STATUS_SAMPLED = '已取样'
export const WATER_STATUS_RESULTED = '已出结果'
export const WATER_STATUS_EXCEEDED = '已超标'

// 列表「仅看超标」筛选项使用的保留字段名，不对应任何数据列。
export const WATER_EXCEEDED_FILTER = '仅看超标'

type WaterQualityRule = {
  unit: string
  /** 合格区间/限值的说明，直接展示在录入提示里。 */
  limitText: string
  isExceeded: (value: number) => boolean
}

// 参考地表水/污水排放常规限值：PH 6～9、氨氮 ≤5mg/L、COD ≤40mg/L、浊度 ≤10NTU。
export const WATER_QUALITY_RULES: Record<WaterQualityIndicator, WaterQualityRule> = {
  PH值: { unit: '', limitText: '6～9 为合格区间', isExceeded: (value) => value < 6 || value > 9 },
  氨氮浓度: { unit: 'mg/L', limitText: '≤ 5 mg/L', isExceeded: (value) => value > 5 },
  COD值: { unit: 'mg/L', limitText: '≤ 40 mg/L', isExceeded: (value) => value > 40 },
  浊度: { unit: 'NTU', limitText: '≤ 10 NTU', isExceeded: (value) => value > 10 },
}

/** 空值、空白与非数字一律视为缺测，返回 null，不参与任何超标判定。 */
export function parseIndicator(raw: unknown): number | null {
  if (raw === null || raw === undefined) {
    return null
  }
  const text = String(raw).trim()
  if (text === '') {
    return null
  }
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

export type WaterQualityEvaluation = {
  /** 四项指标是否全部填齐；不齐全时不出结论、不触发超标。 */
  complete: boolean
  values: Partial<Record<WaterQualityIndicator, number>>
  missing: WaterQualityIndicator[]
  exceeded: boolean
  exceededItems: WaterQualityIndicator[]
}

/** 按 PH值、氨氮、COD、浊度的统一规则计算结论。 */
export function evaluateWaterQuality(
  input: Record<string, unknown>,
): WaterQualityEvaluation {
  const values: Partial<Record<WaterQualityIndicator, number>> = {}
  const missing: WaterQualityIndicator[] = []
  for (const indicator of WATER_QUALITY_INDICATORS) {
    const value = parseIndicator(input[indicator])
    if (value === null) {
      missing.push(indicator)
    } else {
      values[indicator] = value
    }
  }
  const complete = missing.length === 0
  const exceededItems = complete
    ? WATER_QUALITY_INDICATORS.filter((indicator) =>
        WATER_QUALITY_RULES[indicator].isExceeded(values[indicator] as number),
      )
    : []
  return { complete, values, missing, exceeded: exceededItems.length > 0, exceededItems }
}

/** 由统一判定生成写入「监测结论」列的留档文案。仅在四项齐全时调用。 */
export function buildWaterConclusion(evaluation: WaterQualityEvaluation): string {
  if (!evaluation.complete) {
    return '数据不完整'
  }
  return evaluation.exceeded ? `超标（${evaluation.exceededItems.join('、')}）` : '达标'
}

/**
 * 筛选标记与运营概览共用的超标谓词：只看记录已经存档的统一结论状态，
 * 不对历史数据重新取值判定，保证「已有记录按原结论展示」。
 */
export function isWaterQualityExceeded(row: EntryRow): boolean {
  return String(row.status) === WATER_STATUS_EXCEEDED
}

/** 是否已出具过监测结果（含已超标），用于「已出结果数」统计与重复判定拦截。 */
export function hasWaterResult(row: EntryRow): boolean {
  const status = String(row.status)
  return status === WATER_STATUS_RESULTED || status === WATER_STATUS_EXCEEDED
}
