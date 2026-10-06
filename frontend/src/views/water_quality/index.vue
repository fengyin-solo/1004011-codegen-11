<template>
  <section class="page" data-module="water_quality">
    <header class="page-head">
      <div>
        <h2>水质监测管理</h2>
        <p class="page-desc">维护水质监测记录，按 PH值、氨氮浓度、COD值、浊度的统一规则判定结论，录入、筛选标记与运营概览共用同一份结果。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记水质监测记录</button>
        <button class="btn" type="button" @click="exportRows">导出水质监测清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <label class="filter-item">
        <span>结论标记</span>
        <select v-model="filters['结论标记']">
          <option value="">全部标记</option>
          <option v-for="flag in flagOptions" :key="flag" :value="flag">{{ flag }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            <span :class="{ 'flag-exceeded': waterQualityFlag(row) === '已超标' }">
              {{ row.status }}
            </span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in actionsFor(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <span v-if="!actionsFor(row).length" class="text-muted">—</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无水质监测数据，可先登记水质监测记录</td>
        </tr>
      </tbody>
    </table>

    <div v-if="dialog.open" class="modal-mask" @click.self="closeDialog">
      <form class="modal-card" @submit.prevent="submitDialog">
        <h3 class="modal-title">{{ dialog.mode === 'record' ? '录入监测结果' : '超标复查' }} · {{ dialog.code }}</h3>
        <p class="modal-hint">四项指标按统一规则判定；空值或缺项只出结果，不触发超标。</p>
        <label v-for="metric in metricFields" :key="metric" class="filter-item">
          <span>{{ metric }}（{{ metricUnit(metric) }}）</span>
          <input v-model="dialog.form[metric]" type="number" step="0.01" inputmode="decimal" />
        </label>
        <p v-if="dialog.error" class="error-text">{{ dialog.error }}</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="closeDialog">取消</button>
          <button class="btn primary" type="submit">{{ dialog.mode === 'record' ? '提交结果' : '复查通过' }}</button>
        </div>
      </form>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条水质监测记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  recordWaterResult,
  recheckWaterResult,
  runAction as applyAction,
  waterQualityFlags,
} from '@/api/local-service'
import { WATER_METRICS, isWaterExceeded, waterQualityFlag } from '@/data/water-quality'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('water_quality')
const columns = ["监测编号", "取样点位", "取样日期", "PH值", "氨氮浓度", "COD值", "浊度", "监测结论"]
const metricFields = [...WATER_METRICS]
const flagOptions = waterQualityFlags()

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({ '结论标记': '' })
const filterFields = columns.slice(0, 3)

const dialog = reactive({
  open: false,
  mode: 'record' as 'record' | 'recheck',
  id: 0,
  code: '',
  error: '',
  form: { PH值: '', 氨氮浓度: '', COD值: '', 浊度: '' } as Record<string, string>,
})

const statusSummary = computed(() =>
  flagOptions.map((status) => ({
    status,
    count: rows.value.filter((row) => waterQualityFlag(row) === status).length,
  })),
)

const stats = computed(() => [
  { label: meta.metrics[0], value: rows.value.length },
  { label: meta.metrics[1], value: rows.value.filter((row) => waterQualityFlag(row) === '已出结果').length },
  { label: meta.metrics[2], value: rows.value.filter((row) => isWaterExceeded(row)).length },
])

function metricUnit(metric: string): string {
  if (metric === 'PH值') return '6~9'
  if (metric === '氨氮浓度') return 'mg/L'
  if (metric === 'COD值') return 'mg/L'
  return 'NTU'
}

// 动作随状态收敛：已出结果/已超标的结论只能通过录入或复查留档，不提供手工改状态。
function actionsFor(row: EntryRow): string[] {
  const flag = waterQualityFlag(row)
  if (flag === '待取样') {
    return ['安排取样']
  }
  if (flag === '已取样') {
    return ['录入结果']
  }
  if (flag === '已超标') {
    return ['复查通过']
  }
  return []
}

function resetFilters() {
  filters.value = { '结论标记': '' }
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '水质监测记录登记入口尚未接入审批流'
}

function openDialog(mode: 'record' | 'recheck', row: EntryRow) {
  dialog.open = true
  dialog.mode = mode
  dialog.id = Number(row.id)
  dialog.code = String(row['监测编号'] ?? '')
  dialog.error = ''
  dialog.form = {
    PH值: mode === 'recheck' ? String(row.PH值 ?? '') : '',
    氨氮浓度: mode === 'recheck' ? String(row.氨氮浓度 ?? '') : '',
    COD值: mode === 'recheck' ? String(row.COD值 ?? '') : '',
    浊度: mode === 'recheck' ? String(row.浊度 ?? '') : '',
  }
}

function closeDialog() {
  dialog.open = false
}

function submitDialog() {
  // 已填项必须是数字；留空表示该指标未录入（不完整数据不触发超标）。
  const invalid = metricFields.find((metric) => {
    const raw = dialog.form[metric].trim()
    return raw !== '' && !Number.isFinite(Number(raw))
  })
  if (invalid) {
    dialog.error = `请填写合法的${invalid}数值`
    return
  }
  const input = {
    PH值: dialog.form.PH值.trim(),
    氨氮浓度: dialog.form.氨氮浓度.trim(),
    COD值: dialog.form.COD值.trim(),
    浊度: dialog.form.浊度.trim(),
  }
  const result = dialog.mode === 'record'
    ? recordWaterResult(dialog.id, input)
    : recheckWaterResult(dialog.id, input)
  if (!result.ok) {
    dialog.error = result.message
    return
  }
  closeDialog()
  errorMessage.value = result.message
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  if (action === '录入结果') {
    openDialog('record', row)
    return
  }
  if (action === '复查通过') {
    openDialog('recheck', row)
    return
  }
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '水质监测列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.text-muted {
  color: var(--muted);
}
.flag-exceeded {
  color: #b42318;
  font-weight: 600;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(16, 24, 40, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal-card {
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
  width: 420px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.modal-title {
  margin: 0;
  font-size: 16px;
}
.modal-hint {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
