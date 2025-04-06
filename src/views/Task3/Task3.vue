<template>
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
        <div ref="durationChart" class="chart"></div>
      </div>

      <!-- 异常值趋势 -->
      <div class="chart-card">
        <h3>最大异常值趋势</h3>
        <div ref="anomalyChart" class="chart"></div>
      </div>

      <!-- 涡旋覆盖比例 -->
      <div class="chart-card">
        <h3>涡旋覆盖比例分布</h3>
        <div ref="vortexChart" class="chart"></div>
      </div>

      <!-- 综合时间线 -->
      <div class="chart-card full-width">
        <h3>事件时间线分析</h3>
        <div ref="timelineChart" class="chart"></div>
      </div>
    </div>
  </div>
</template>

<script>
import * as echarts from 'echarts'
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
    // 移除窗口resize监听
    window.removeEventListener('resize', this.handleResize);
    
    // 清理所有图表实例
    this.chartInstances.forEach(({ chart, handler }) => {
      emitter.off('window-resize', handler); // 移除事件监听
      chart.dispose(); // 销毁图表
    });
    this.chartInstances = []; // 清空数组
  },
  methods: {
    async loadCSVData() {
      try {
        const startTime = Date.now()
        const response = await fetch('/data/eventually_heatwave.csv')
        
        if (!response.ok) throw new Error(`HTTP错误 ${response.status}`)
        
        const csvText = await response.text()
        
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
            this.initCharts()
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
          maxAnomaly: Number(item.max_anomaly),
          startDate: item.start_date,
          endDate: item.end_date,
          vortexRatio: Number(item.vortex_coverage_ratio),
          heatFlux: Number(item.mean_heat_flux),
          windSpeed: Number(item.mean_wind)
        }))
        .filter(item => 
          !isNaN(item.duration) && 
          !isNaN(item.maxAnomaly) &&
          item.startDate instanceof Date &&
          item.endDate instanceof Date
        )
        .sort((a, b) => a.startDate - b.startDate)
    },

    initCharts() {
      // 确保DOM更新完成
      this.$nextTick(() => {
        // 持续时间直方图
        this.createChart(this.$refs.durationChart, {
          tooltip: {
            trigger: 'axis',
            formatter: params => {
              const data = this.eventsData[params[0].dataIndex]
              return `
                <strong>事件#${data.id}</strong><br>
                持续天数: ${data.duration}<br>
                开始日期: ${data.startDate.toLocaleDateString()}
              `
            }
          },
          xAxis: {
            type: 'category',
            data: this.eventsData.map(d => `事件#${d.id}`),
            axisLabel: {
              rotate: 45,
              interval: 0,
              formatter: (value) => value.split('#')[1]
            }
          },
          yAxis: { type: 'value', name: '天数' },
          series: [{
            data: this.eventsData.map(d => d.duration),
            type: 'bar',
            itemStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: '#5470C6' },
                { offset: 1, color: '#83A7F0' }
              ])
            }
          }]
        })

        // 异常值趋势图
        this.createChart(this.$refs.anomalyChart, {
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
        this.createChart(this.$refs.vortexChart, {
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

        // 时间线散点图
        this.createChart(this.$refs.timelineChart, {
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
            axisLabel: {
              formatter: {
                year: '{yyyy}',
                month: '{MMM}',
                day: '{dd}'
              }
            },
            splitLine: { show: false }
          },
          yAxis: { type: 'value', name: '异常值' },
          series: [{
            type: 'scatter',
            symbolSize: d => Math.sqrt(d.value[1]) * 8,
            data: this.eventsData.map(d => ({
              value: [d.startDate, d.maxAnomaly],
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
      })
    },

    createChart(el, option) {
      if (!el) return
      
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
      
      this.chartInstances.push(chart)
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
</style>