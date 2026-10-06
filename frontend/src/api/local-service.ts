import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  WATER_EXCEEDED_FILTER,
  WATER_MODULE_KEY,
  WATER_STATUS_EXCEEDED,
  WATER_STATUS_RESULTED,
  WATER_STATUS_SAMPLED,
  WATER_QUALITY_INDICATORS,
  buildWaterConclusion,
  evaluateWaterQuality,
  hasWaterResult,
  isWaterQualityExceeded,
} from '@/data/water-quality'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'
import type { WaterQualityIndicator } from '@/data/water-quality'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  let rows = listRows(key)
  // 「仅看超标」走共用判定谓词，不和文字检索混在一列里判断。
  if (key === WATER_MODULE_KEY && filters[WATER_EXCEEDED_FILTER] === 'true') {
    rows = rows.filter(isWaterQualityExceeded)
  }
  const textFilters = Object.fromEntries(
    Object.entries(filters).filter(
      ([field, value]) => field !== WATER_EXCEEDED_FILTER && value.trim() !== '',
    ),
  )
  const matched = filterRows(rows, textFilters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

/**
 * 水质监测录入结果：四项指标必须齐全，按统一规则算出「已出结果 / 已超标」与监测结论后落档。
 * 空值或不完整数据直接拒绝，不产生结论、不触发超标；已有结论的记录不允许重复判定。
 */
export function recordWaterQualityResult(
  id: number,
  input: Partial<Record<WaterQualityIndicator, string | number>>,
): ActionResult {
  const rows = listRows(WATER_MODULE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的水质监测记录` }
  }
  const current = String(rows[index].status)
  if (hasWaterResult(rows[index])) {
    return { ok: false, message: '该记录已出具结论并留档，重复判定不能改变历史结论' }
  }
  if (current !== WATER_STATUS_SAMPLED) {
    return { ok: false, message: '请先安排取样，取样完成后才能录入结果' }
  }
  const evaluation = evaluateWaterQuality(input as Record<string, unknown>)
  if (!evaluation.complete) {
    return {
      ok: false,
      message: `指标不完整（缺：${evaluation.missing.join('、')}），请补齐后再录入，空值不触发超标`,
    }
  }

  const indicatorFields: Partial<EntryRow> = {}
  for (const indicator of WATER_QUALITY_INDICATORS) {
    indicatorFields[indicator] = evaluation.values[indicator] as number
  }
  const status = evaluation.exceeded ? WATER_STATUS_EXCEEDED : WATER_STATUS_RESULTED
  const updated: EntryRow = {
    ...rows[index],
    ...indicatorFields,
    监测结论: buildWaterConclusion(evaluation),
    status,
    pending: evaluation.exceeded,
    abnormal: evaluation.exceeded,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(WATER_MODULE_KEY, next)
  return {
    ok: true,
    message: evaluation.exceeded
      ? `结果已录入，统一判定为「已超标」：${evaluation.exceededItems.join('、')}`
      : '结果已录入，统一判定为「已出结果」，各项指标达标',
  }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  // 水质监测「复查通过」：只允许已超标记录走复查，通过后编号流程恢复到「已出结果」；
  // 不动指标值与监测结论，历史留档保持原样，恢复后编号可继续参与正常统计。
  if (key === WATER_MODULE_KEY && action === '复查通过') {
    if (current !== WATER_STATUS_EXCEEDED) {
      return { ok: false, message: '只有「已超标」的记录需要复查，当前记录无需复查' }
    }
    const reviewed: EntryRow = {
      ...rows[index],
      status: WATER_STATUS_RESULTED,
      pending: false,
      abnormal: false,
    }
    const nextRows = [...rows]
    nextRows[index] = reviewed
    saveRows(key, nextRows)
    return { ok: true, message: '复查已通过，编号流程恢复为「已出结果」，历史留档保持不变' }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      // 水质监测异常量与列表、录入共用同一份超标判定，不读历史脏标记。
      abnormal:
        meta.key === WATER_MODULE_KEY
          ? entries.filter(isWaterQualityExceeded).length
          : entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
