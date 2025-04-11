<template>
   <!-- 右侧内容区 -->
   <div class="main-content">
      <div class="dashboard-container">
        <h1>热浪事件分析看板</h1>
        
        <!-- 加载状态 -->
        <div v-if="loading" class="status-container">
          <div class="loading-spinner"></div>
          <div class="loading-text">数据加载中...</div>
        </div>

        <!-- 错误状态 -->
        <div v-if="error" class="status-container error">
          <div class="error-icon">!</div>
          <div class="error-text">{{ error }}</div>
        </div>

        <!-- 图表展示 -->
        <div v-if="!loading && !error" class="chart-grid">
          <!-- 持续时间分布 -->

          <div class="chart-card">
            <h3>事件持续时间分布</h3>
            <div ref="durationChartRef" class="chart"></div>
          </div>

          <!-- 异常值趋势 -->
          <div class="chart-card">
            <h3>最大异常值趋势</h3>
            <div ref="anomalyChartRef" class="chart"></div>
          </div>

          <!-- 涡旋覆盖比例 -->
          <div class="chart-card">
            <h3>涡旋覆盖比例分布</h3>
            <div ref="vortexChartRef" class="chart"></div>
          </div>

          <!-- 综合时间线 -->
          <div class="chart-card full-width">
            <h3>事件时间线分析</h3>
            <div ref="timelineChartRef" class="chart"></div>
          </div>
          <div class="chart-card full-width">
            <h3>盐度异常与热浪强度关联分析</h3>
            <div ref="salinityChartRef" class="chart"></div>
          </div>
        </div>
      </div>
  </div>
</template>

<script>
// 替换原有import语句
import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts'
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  DatasetComponent,
  TransformComponent,
  LegendComponent
} from 'echarts/components'
import { LabelLayout, UniversalTransition } from 'echarts/features'
import { CanvasRenderer } from 'echarts/renderers'

// 注册必要组件
echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  TitleComponent,
  TooltipComponent,
  GridComponent,
  DatasetComponent,
  TransformComponent,
  LegendComponent,
  LabelLayout,
  UniversalTransition,
  CanvasRenderer
])

import Papa from 'papaparse'
import mitt from 'mitt'  // 新增事件总线

const emitter = mitt()
export default {
  name: 'HeatwaveAnalysisDashboard',
  data() {
    return {
      chartInstances: [],
      eventsData: [],
      loading: true,
      error: null
    }
  },
  mounted() {
    this.loadCSVData()
      // 添加resize监听
      window.addEventListener('resize', this.handleResize)
  },

  beforeUnmount() {
  // 清理所有图表实例
  this.chartInstances.forEach(instance => {
    instance.chart.dispose()
    window.removeEventListener('resize', instance.resizeHandler)
  })
  this.chartInstances = []
},
  methods: {
    async loadCSVData() {
      try {
        console.log('开始加载CSV数据')
        const startTime = Date.now()
        const response = await fetch('/data/eventually_heatwave.csv')
          // 添加路径验证
        console.log('请求URL:', response.url) 
        console.log('响应状态:', response.status)
        
        if (!response.ok) throw new Error(`HTTP错误 ${response.status}`)
        
        const csvText = await response.text()
        console.log('原始数据长度:', csvText.length)
        
        Papa.parse(csvText, {
          header: true,
          dynamicTyping: true,
          skipEmptyLines: true,
          transform: (value, field) => {
            // 专用日期处理
            if (field === 'start_date' || field === 'end_date') {
              return new Date(value)
            }
            return value
          },
          complete: (results) => {
            console.log(`数据解析完成，耗时 ${Date.now() - startTime}ms`)
            this.eventsData = this.cleanData(results.data)
           
             // 修正后的双重 nextTick
            this.$nextTick(() => {
              this.$nextTick(() => {
                this.initCharts()
                this.loading = false
              })
            })
           
            console.log('清洗后的数据:', this.eventsData)
             // 添加数据验证
            if (this.eventsData.length === 0) {
              this.handleError('数据验证失败', new Error('清洗后数据为空'))
              return
            }
            // this.initCharts()
            this.loading = false
          },
          error: (error) => {
            this.handleError('CSV解析错误', error)
          }
        })
      } catch (error) {
        this.handleError('数据加载失败', error)
      }
    },

    cleanData(rawData) {
      return rawData
        .map(item => ({
          id: item.event_id,
          duration: Number(item.duration),
          maxAnomaly: Number(item.max_anomaly) || 0, // 确保数值有效,
          startDate: item.start_date,
          endDate: item.end_date,
          vortexRatio: Number(item.vortex_coverage_ratio),
          heatFlux: Number(item.mean_heat_flux),
          windSpeed: Number(item.mean_wind),
          cumulativeSalinity: Number(item.cumulative_salinity_anomaly) || 0, // 新增盐度字段
        }))
        .filter(item => 
          !isNaN(item.duration) && 
          !isNaN(item.maxAnomaly) &&
          item.startDate instanceof Date &&
          item.endDate instanceof Date  &&  typeof item.maxAnomaly === 'number')
        .sort((a, b) => a.startDate - b.startDate)
    },

    initCharts() {
        // 验证所有图表容器
      const refs = [
        'durationChartRef',
        'anomalyChartRef',
        'vortexChartRef',
        'timelineChartRef'
      ]
      
      if (!refs.every(ref => this.$refs[ref])) {
        console.error('部分图表容器未找到，延迟初始化')
        setTimeout(() => this.initCharts(), 100)
        return
      }
      //打印调试信息
      console.log('开始初始化图表')
      // 验证DOM元素
      console.log('图表容器验证:')
      console.log('Duration Chart DOM:', this.$refs.durationChart)
      console.log('Anomaly Chart DOM:', this.$refs.anomalyChart)


      // 确保DOM更新完成
      this.$nextTick(() => {
        console.log('DOM更新完成')
        // 异常值趋势图
        this.createChart( 'anomalyChartRef', {
          tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' }
          },
          xAxis: {
            type: 'category',
            data: this.eventsData.map(d => 
              d.startDate.toLocaleDateString().replace(/\//g, '-')
            ),
            axisLabel: { rotate: 30 }
          },
          yAxis: { type: 'value', name: '异常值' },
          series: [{
            data: this.eventsData.map(d => d.maxAnomaly),
            type: 'line',
            smooth: true,
            lineStyle: { width: 2 },
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: 'rgba(145,204,117,0.8)' },
                { offset: 1, color: 'rgba(145,204,117,0.1)' }
              ])
            }
          }]
        })

        // 涡旋覆盖比例饼图
        this.createChart('vortexChartRef', {
          tooltip: {
            trigger: 'item',
            formatter: params => `
              ${params.name}<br>
              比例: ${(params.percent)}%<br>
              持续天数: ${params.data.duration}天
            `
          },
          series: [{
            type: 'pie',
            radius: ['40%', '70%'],
            data: this.eventsData.map(d => ({
              value: d.vortexRatio,
              name: `事件#${d.id}`,
              duration: d.duration
            })),
            itemStyle: {
              borderRadius: 6,
              borderColor: '#fff',
              borderWidth: 2
            },
            emphasis: {
              itemStyle: {
                shadowBlur: 10,
                shadowOffsetX: 0,
                shadowColor: 'rgba(0, 0, 0, 0.5)'
              }
            }
          }]
        })

        // 盐度关联分析散点图
      this.createChart('salinityChartRef', {
        tooltip: {
          trigger: 'item',
          formatter: params => `
            事件ID: #${params.data.eventId}<br>
            盐度累积量: ${params.data.value[0].toFixed(1)}<br>
            热浪强度: ${params.data.value[1].toFixed(1)}<br>
            持续天数: ${params.data.duration}天
          `
        },
        xAxis: {
          type: 'value',
          name: '前30天盐度异常累积量',
          nameLocation: 'middle',
          nameGap: 30,
          axisLabel: { formatter: '{value} unit' }
        },
        yAxis: {
          type: 'value',
          name: '最大热强度异常值',
          nameLocation: 'middle',
          nameGap: 40
        },
        visualMap: {
          type: 'continuous',
          min: Math.min(...this.eventsData.map(d => d.duration)),
          max: Math.max(...this.eventsData.map(d => d.duration)),
          dimension: 2,
          inRange: { color: ['#2463eb', '#70e0b2'] },
          right: 20,
          text: ['长持续', '短持续']
        },
        series: [{
          type: 'scatter',
          data: this.eventsData.map(d => ({
            value: [d.cumulativeSalinity, d.maxAnomaly, d.duration],
            eventId: d.id,
            duration: d.duration
          })),
          symbolSize: d => Math.sqrt(d[2]) * 4,
          itemStyle: {
            opacity: 0.8,
            borderColor: '#fff',
            borderWidth: 1
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: 'rgba(0,0,0,0.3)'
            }
          }
        }]
      });

        // 时间线散点图
        this.createChart('timelineChartRef', {
          tooltip: {
            trigger: 'item',
            formatter: params => {
              const data = params.data
              return `
                <strong>${data.name}</strong><br>
                日期: ${data.date}<br>
                最大异常值: ${data.value[1].toFixed(2)}<br>
                持续天数: ${data.duration}天
              `
            }
          },
          xAxis: {
            type: 'time',
            // 增加轴配置
            axisLabel: {
              formatter: '{yyyy}-{MM}-{dd}'
            },
            min: 'dataMin',
            max: 'dataMax',
            boundaryGap: false
          },
          yAxis: { type: 'value', name: '异常值' },
          series: [{
            type: 'scatter',
            symbolSize: d => {
              const value = d.value ? Math.abs(d.value[1]) : 0;
              return Math.sqrt(value) * 3 + 5; // 保证最小可见尺寸
            },
            data: this.eventsData
            .filter(d => typeof d.maxAnomaly === 'number') // 过滤无效数据
            .map(d => ({
              value: [d.startDate.getTime(), d.maxAnomaly || 0],// 确保数值存在
              name: `事件#${d.id}`,
              date: d.startDate.toLocaleDateString(),
              duration: d.duration
            })),
            itemStyle: {
              color: '#EE6666',
              opacity: 0.8
            },
            emphasis: {
              itemStyle: {
                borderColor: '#333',
                borderWidth: 2
              }
            }
          }]
        })
        // 持续时间分布图（仅保留直方图）
        const durations = this.eventsData.map(d => d.duration);
        const minDuration = Math.min(...durations);
        const maxDuration = Math.max(...durations);
        const binSize = Math.ceil((maxDuration - minDuration) / 10);

        // 生成直方图数据（基于最小值的分箱）
        const histogram = durations.reduce((acc, curr) => {
          const binIndex = Math.floor((curr - minDuration) / binSize);
          const binStart = minDuration + binIndex * binSize;
          acc[binStart] = (acc[binStart] || 0) + 1;
          return acc;
        }, {});

        // 过滤空区间
        const validBins = Object.keys(histogram)
          .map(Number)
          .filter(start => start >= minDuration)
          .sort((a,b) => a - b);

        // 图表配置
        this.createChart('durationChartRef', {
          tooltip: {
            trigger: 'axis',
            formatter: params => {
              const [start, end] = params[0].name.split('~');
              return `持续天数: ${start}~${end}天<br>事件数量: ${params[0].value}`;
            }
          },
          xAxis: {
            type: 'category',
            name: '持续时间区间（天）',
            data: validBins.map(start => `${start}~${start + binSize}`),
            axisLabel: { 
              rotate: 45,
              formatter: value => value.replace('~', '-') // 按需调整连接符
            }
          },
          yAxis: {
            type: 'value',
            name: '事件数量',
            min: 0,
            axisLabel: {
              formatter: value => Math.round(value) // 确保整数显示
            }
          },
          series: [{
            name: '持续时间分布',
            type: 'bar',
            data: validBins.map(start => histogram[start]),
            itemStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: '#5470C6' },
                { offset: 1, color: '#83A7F0' }
              ])
            },
            barCategoryGap: '10%' // 优化柱间距
          }]
        });
    
     
      })
    },

    createChart(refName, option) {
      const el = this.$refs[refName]
      if (!el || !el.offsetParent) {
        console.warn(`图表容器${refName}不可见，延迟创建`)
        setTimeout(() => this.createChart(refName, option), 300)
        return
      }
      
      const chart = echarts.init(el)
      chart.setOption({
        grid: {
          containLabel: true,
          top: 40,
          bottom: 30,
          left: 30,
          right: 20
        },
        ...option
      })
      
      
       // 使用事件总线替代$once
      const resizeHandler = () => chart.resize();
      emitter.on('window-resize', resizeHandler);

      // 存储图表实例和对应的处理器
      this.chartInstances.push({
        chart,
        handler: resizeHandler
      });
    },

    handleError(context, error) {
      console.error(`${context}:`, error)
      this.error = `${context}: ${error.message}`
      this.loading = false
    },
    handleResize() {
      emitter.emit('window-resize'); // 触发全局resize事件
    }
  }
}
</script>

<style scoped>

.dashboard-container {
  padding: 2rem;
  max-width: 1400px;
  margin: 0 auto;
  min-height: 100vh;
}

h1 {
  text-align: center;
  color: #2c3e50;
  margin-bottom: 2rem;
  font-size: 2.2rem;
}

.chart-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
  gap: 1.5rem;
}

.chart-card {
  background: white;
  padding: 1.5rem;
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.08);
  transition: transform 0.2s;
}

.chart-card:hover {
  transform: translateY(-2px);
}

.chart-card h3 {
  margin: 0 0 1rem;
  color: #444;
  font-size: 1.1rem;
  font-weight: 600;
}

.chart {
  height: 400px;
}

.full-width {
  grid-column: 1 / -1;
}

.status-container {
  text-align: center;
  padding: 4rem;
  color: #666;
}

.loading-spinner {
  display: inline-block;
  width: 2rem;
  height: 2rem;
  border: 3px solid #f3f3f3;
  border-radius: 50%;
  border-top-color: #3498db;
  animation: spin 1s ease-in-out infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-text {
  margin-top: 1rem;
  font-size: 1.1rem;
}

.error {
  color: #e74c3c;
}

.error-icon {
  display: inline-block;
  width: 2rem;
  height: 2rem;
  line-height: 2rem;
  border-radius: 50%;
  background: #e74c3c;
  color: white;
  font-weight: bold;
  margin-bottom: 1rem;
}

@media (max-width: 768px) {
  .chart-grid {
    grid-template-columns: 1fr;
  }
  
  .chart {
    height: 300px;
  }
  
  h1 {
    font-size: 1.8rem;
  }
}
.full-width {
  grid-column: 1 / -1;
}
.chart-card h3 {
  font-size: 1.2rem;  /* 统一标题大小 */
}
</style>