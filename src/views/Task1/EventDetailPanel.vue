<!-- src/views/Task1/EventDetailPanel.vue -->
<template>
    <div class="detail-panel">
      <div class="header">
        <h3>事件详情 #{{ eventData.event_id }}</h3>
        <div class="duration">持续 {{ eventData.duration }} 天</div>
      </div>
      
      <div class="metric-grid">
        <div class="metric-item">
          <label>开始时间</label>
          <div>{{ eventData.start_date }}</div>
        </div>
        <div class="metric-item">
          <label>峰值时间</label>
          <div>{{ eventData.peak_date }}</div>
        </div>
        <div class="metric-item highlight">
          <label>最大异常值</label>
          <div>{{ eventData.max_anomaly.toFixed(1) }}°C</div>
        </div>
        <div class="metric-item highlight">
          <label>移动速度</label>
          <div>{{ eventData._speed.toFixed(1) }} km/天</div>
        </div>
      </div>
  
      <div class="chart-container">
        <line-chart :data="chartData" :options="chartOptions" />
      </div>
    </div>
  </template>
  
  <script>

import { Line as LineChart } from 'vue-chartjs' // ✅ 直接使用主路径
  export default {
    components: { LineChart },
    props: ['eventData'],
    computed: {
      chartData() {
        return {
          labels: this.eventData.daily_info.map(d => d.date),
          datasets: [{
            label: '每日异常值',
            data: this.eventData.daily_info.map(d => d.max_anomaly),
            borderColor: '#d73027',
            tension: 0.3,
            fill: false
          }]
        }
      },
      chartOptions() {
        return {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            tooltip: {
              mode: 'index',
              intersect: false
            }
          },
          scales: {
            x: {
              grid: { display: false }
            },
            y: {
              title: { text: '温度异常 (°C)' }
            }
          }
        }
      }
    }
  }
  </script>
  
  <style scoped>
  .detail-panel {
    padding: 20px;
  }
  
  .header {
    margin-bottom: 20px;
    border-bottom: 1px solid #eee;
    padding-bottom: 10px;
  }
  
  .metric-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 15px;
    margin-bottom: 20px;
  }
  
  .metric-item label {
    display: block;
    color: #666;
    font-size: 0.9em;
    margin-bottom: 5px;
  }
  
  .highlight div {
    font-weight: bold;
    color: #d73027;
  }
  
  .chart-container {
    height: 300px;
  }
  </style>