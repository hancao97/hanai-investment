<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, shallowRef } from 'vue'
import * as echarts from 'echarts/core'
import { TreemapChart, LineChart, BarChart, CandlestickChart, RadarChart, GaugeChart } from 'echarts/charts'
import {
  TooltipComponent,
  GridComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  TitleComponent
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsCoreOption, ECharts } from 'echarts/core'

echarts.use([
  TreemapChart,
  LineChart,
  BarChart,
  CandlestickChart,
  RadarChart,
  GaugeChart,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  TitleComponent,
  CanvasRenderer
])

const props = defineProps<{ option: EChartsCoreOption | null }>()
const emit = defineEmits<{ chartClick: [params: unknown] }>()

const el = ref<HTMLDivElement | null>(null)
const chart = shallowRef<ECharts | null>(null)
let resizeObserver: ResizeObserver | null = null

function onContainerClick(event: MouseEvent): void {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-sector-code]') : null
  const sectorCode = target?.dataset.sectorCode
  if (!sectorCode) return
  event.stopPropagation()
  emit('chartClick', {
    data: {
      sectorCode,
      name: target.dataset.sectorName ?? ''
    }
  })
}

onMounted(() => {
  if (!el.value) return
  el.value.addEventListener('click', onContainerClick)
  chart.value = echarts.init(el.value)
  chart.value.on('click', (params) => emit('chartClick', params))
  if (props.option) chart.value.setOption(props.option)
  resizeObserver = new ResizeObserver(() => chart.value?.resize())
  resizeObserver.observe(el.value)
})

watch(
  () => props.option,
  (opt) => {
    if (opt && chart.value) chart.value.setOption(opt, { notMerge: true })
  }
)

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  el.value?.removeEventListener('click', onContainerClick)
  chart.value?.dispose()
})
</script>

<template>
  <div ref="el" class="echart" />
</template>

<style scoped>
.echart {
  width: 100%;
  height: 100%;
}
</style>
