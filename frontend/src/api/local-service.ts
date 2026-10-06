import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  hasWaterResult,
  isWaterExceeded,
  judgeWaterQuality,
  waterQualityFlag,
  type WaterFlag,
  type WaterVerdictInput,
} from '@/data/water-quality'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

const WATER_QUALITY_KEY = 'water_quality'

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
  const rest: Record<string, string> = { ...filters }
  if (key === WATER_QUALITY_KEY) {
    const flag = rest['结论标记']?.trim()
    delete rest['结论标记']
    if (flag) {
      rows = rows.filter((row) => waterQualityFlag(row) === flag)
    }
  }
  const matched = filterRows(rows, rest)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 水质监测结论标记筛选项：标记值与录入留档、概览统计用的是同一份判定规则。
export function waterQualityFlags(): WaterFlag[] {
  return ['待取样', '已取样', '已出结果', '已超标']
}

function saveWaterRow(id: number, updated: EntryRow): void {
  const rows = listRows(WATER_QUALITY_KEY)
  const index = rows.findIndex((item) => Number(item.id) === id)
  const next = [...rows]
  next[index] = updated
  saveRows(WATER_QUALITY_KEY, next)
}

// 录入结果：按共用规则算出统一结论再留档；空值与缺项只标记结果、不触发超标。
// 已留档的记录不允许重复录入，重复判定不得改写历史结论。
export function recordWaterResult(id: number, input: WaterVerdictInput): ActionResult {
  const row = listRows(WATER_QUALITY_KEY).find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的水质监测记录` }
  }
  if (hasWaterResult(row)) {
    return { ok: false, message: '该监测记录已出结果，结论已留档，不能重复录入' }
  }
  const verdict = judgeWaterQuality(input)
  const updated: EntryRow = {
    ...row,
    PH值: String(input.PH值 ?? '').trim(),
    氨氮浓度: String(input.氨氮浓度 ?? '').trim(),
    COD值: String(input.COD值 ?? '').trim(),
    浊度: String(input.浊度 ?? '').trim(),
    监测结论: verdict.conclusion,
    status: verdict.status,
    pending: false,
    abnormal: verdict.exceeded,
  }
  saveWaterRow(id, updated)
  return {
    ok: true,
    message: verdict.complete
      ? `结果已录入，判定为「${verdict.status}」`
      : '结果已录入，四项指标不完整，暂不判定超标',
  }
}

// 复查通过：只有复查数据按同一规则判定合格时，编号流程才恢复到「已出结果」；
// 复查仍超标则不放行。复查结论以本次留档为准，不改写初次超标记录的历史。
export function recheckWaterResult(id: number, input: WaterVerdictInput): ActionResult {
  const row = listRows(WATER_QUALITY_KEY).find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的水质监测记录` }
  }
  if (!isWaterExceeded(row)) {
    return { ok: false, message: '只有「已超标」的监测记录需要复查' }
  }
  const verdict = judgeWaterQuality(input)
  if (!verdict.complete) {
    return { ok: false, message: '复查数据四项指标不完整，无法通过复查' }
  }
  if (verdict.exceeded) {
    return { ok: false, message: `复查仍超标：${verdict.reasons.join('；')}` }
  }
  const updated: EntryRow = {
    ...row,
    PH值: String(input.PH值 ?? '').trim(),
    氨氮浓度: String(input.氨氮浓度 ?? '').trim(),
    COD值: String(input.COD值 ?? '').trim(),
    浊度: String(input.浊度 ?? '').trim(),
    监测结论: '复查通过：各项指标合格，恢复编号流程',
    status: '已出结果',
    pending: false,
    abnormal: false,
  }
  saveWaterRow(id, updated)
  return { ok: true, message: '复查通过，已恢复到「已出结果」编号流程' }
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
  // 水质记录一旦出结果，结论即留档：通用动作不能把编号流程倒退回取样环节，
  // 结论只能通过录入结果或复查通过两个专用入口更新。
  if (key === WATER_QUALITY_KEY && hasWaterResult(rows[index])) {
    return { ok: false, message: '该监测记录已出结果，结论已留档，不能回退取样流程' }
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
    // 水质模块的异常量按共用判定标记统计，与录入结果、列表筛选的口径保持一致。
    const abnormal =
      meta.key === WATER_QUALITY_KEY
        ? entries.filter((row) => isWaterExceeded(row)).length
        : entries.filter((row) => row.abnormal).length
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal,
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
