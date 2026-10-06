<template>
  <section class="page" data-module="water_quality">
    <header class="page-head">
      <div>
        <h2>水质监测管理</h2>
        <p class="page-desc">围绕监测编号、取样点位与 PH值、氨氮、COD、浊度四项指标登记取样；超标结论由统一规则判定，录入、筛选与运营概览共用。</p>
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
      <label class="filter-item filter-check">
        <input v-model="exceededOnly" type="checkbox" />
        <span>仅看超标</span>
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
          <td>{{ row.status }}</td>
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
            <span v-if="!actionsFor(row).length" class="muted-text">—</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无符合条件的水质监测数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条水质监测记录（超标判定按 PH 6～9、氨氮 ≤5、COD ≤40、浊度 ≤10 统一执行）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="resultModal.open" class="modal-mask" @click.self="closeResultModal">
      <form class="modal-panel" @submit.prevent="submitResult">
        <h3 class="modal-title">录入监测结果</h3>
        <p class="modal-sub">
          监测编号：{{ resultModal.row?.['监测编号'] }}　取样点位：{{ resultModal.row?.['取样点位'] }}
        </p>
        <label v-for="indicator in indicators" :key="indicator" class="modal-field">
          <span>{{ indicator }}（{{ ruleOf(indicator).limitText }}）</span>
          <input
            v-model="resultModal.form[indicator]"
            type="number"
            step="0.01"
            :placeholder="`请输入${indicator}${ruleOf(indicator).unit ? `（${ruleOf(indicator).unit}）` : ''}`"
          />
        </label>
        <p class="modal-tip">四项指标需全部填写；空值或不完整数据不出结论、不触发超标，提交后按统一规则生成监测结论并留档。</p>
        <p v-if="resultModal.error" class="error-text">{{ resultModal.error }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeResultModal">取消</button>
          <button class="btn primary" type="submit">提交并判定</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  recordWaterQualityResult,
  runAction as applyAction,
} from '@/api/local-service'
import {
  WATER_EXCEEDED_FILTER,
  WATER_QUALITY_INDICATORS,
  WATER_QUALITY_RULES,
  WATER_STATUS_EXCEEDED,
  WATER_STATUS_PENDING_SAMPLE,
  WATER_STATUS_RESULTED,
  WATER_STATUS_SAMPLED,
  hasWaterResult,
  isWaterQualityExceeded,
} from '@/data/water-quality'
import type { WaterQualityIndicator } from '@/data/water-quality'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('water_quality')
const columns = ["监测编号", "取样点位", "取样日期", "PH值", "氨氮浓度", "COD值", "浊度", "监测结论"]
const statuses = ["待取样", "已取样", "已出结果", "已超标"]
const indicators = [...WATER_QUALITY_INDICATORS]
const filterFields = columns.slice(0, 3)

const rows = ref<EntryRow[]>([])
const allRowsView = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const exceededOnly = ref(false)

function ruleOf(indicator: WaterQualityIndicator) {
  return WATER_QUALITY_RULES[indicator]
}

// 统计始终基于全量记录，不受筛选条件影响；超标口径与运营概览、超标筛选完全一致。
const stats = computed(() => [
  { label: '取样计划数', value: allRowsView.value.length },
  { label: '已出结果数', value: allRowsView.value.filter(hasWaterResult).length },
  { label: '超标样本数', value: allRowsView.value.filter(isWaterQualityExceeded).length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: allRowsView.value.filter((row) => String(row.status) === status).length,
  })),
)

// 动作随状态收窄：待取样只能安排取样；已取样才能录入结果；已超标走复查恢复编号流程。
function actionsFor(row: EntryRow): string[] {
  switch (String(row.status)) {
    case WATER_STATUS_PENDING_SAMPLE:
      return ['安排取样']
    case WATER_STATUS_SAMPLED:
      return ['录入结果']
    case WATER_STATUS_EXCEEDED:
      return ['复查通过']
    case WATER_STATUS_RESULTED:
    default:
      return []
  }
}

function resetFilters() {
  filters.value = {}
  exceededOnly.value = false
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '水质监测记录登记入口尚未接入审批流'
}

type ResultForm = Record<WaterQualityIndicator, string>

const resultModal = reactive<{
  open: boolean
  row: EntryRow | null
  form: ResultForm
  error: string
}>({
  open: false,
  row: null,
  form: { PH值: '', 氨氮浓度: '', COD值: '', 浊度: '' },
  error: '',
})

function openResultModal(row: EntryRow) {
  resultModal.open = true
  resultModal.row = row
  resultModal.form = { PH值: '', 氨氮浓度: '', COD值: '', 浊度: '' }
  resultModal.error = ''
}

function closeResultModal() {
  resultModal.open = false
  resultModal.row = null
  resultModal.error = ''
}

function submitResult() {
  if (!resultModal.row) {
    return
  }
  const result = recordWaterQualityResult(Number(resultModal.row.id), { ...resultModal.form })
  if (!result.ok) {
    resultModal.error = result.message
    return
  }
  closeResultModal()
  errorMessage.value = ''
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  if (action === '录入结果') {
    openResultModal(row)
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
    // 全量数据单独拉一次，保证统计卡与状态汇总不被筛选条件收窄。
    allRowsView.value = listEntries(meta.key).items
    const query: Record<string, string> = { ...filters.value }
    if (exceededOnly.value) {
      query[WATER_EXCEEDED_FILTER] = 'true'
    }
    const payload = listEntries(meta.key, query)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '水质监测列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.filter-check {
  display: flex;
  align-items: center;
  gap: 4px;
  align-self: flex-end;
  padding-bottom: 6px;
}
.filter-check input {
  margin: 0;
}
.muted-text {
  color: var(--muted);
  font-size: 13px;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal-panel {
  width: 420px;
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
}
.modal-title {
  margin: 0 0 4px;
  font-size: 16px;
}
.modal-sub {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--muted);
}
.modal-field {
  display: block;
  margin-bottom: 10px;
}
.modal-field span {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 4px;
}
.modal-field input {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 13px;
}
.modal-tip {
  margin: 4px 0 10px;
  font-size: 12px;
  color: var(--muted);
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
