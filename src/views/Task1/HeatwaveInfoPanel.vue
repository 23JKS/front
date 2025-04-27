<template>
  <div class="info-panel-content" :style="{ width: panelWidth + 'px' }">
    <div class="resize-handle" @mousedown="startResize"></div>
    <div v-if="selectedEvent && selectedEvent.properties">
      <h3 class="panel-title">热浪事件 #{{ selectedEvent.properties.event_id }}</h3>
      <div class="info-grid">
        <div class="info-label">开始日期:</div>
        <div>{{ selectedEvent.properties.start_date?.toLocaleDateString() ?? '未知' }}</div>
        <div class="info-label">持续时间:</div>
        <div>{{ selectedEvent.properties.duration ?? 'N/A' }} 天</div>
        <div class="info-label">最大强度:</div>
        <div>{{ selectedEvent.properties.max_anomaly?.toFixed(2) ?? 'N/A' }} ℃</div>
      </div>
      <div class="close-button-container">
        <button class="close-button" @click="$emit('close')">×</button>
      </div>
      <!-- 折线图（三个子图） -->
      <div class="chart-card line-charts">
        <h3>每日热浪指标趋势</h3>
        <div ref="areaChartContainer" class="chart"></div>
        <div ref="heatChartContainer" class="chart"></div>
        <div ref="intensityChartContainer" class="chart"></div>
      </div>
      <!-- 质心轨迹图 -->
      <div class="chart-card hovmoller-charts">
        <h3>热浪质心轨迹分析</h3>
        <div ref="latTimeChartContainer" class="chart"></div>
        <div class="playback-controls">
          <button @click="startPlayback" :disabled="isPlaying">播放</button>
          <button @click="pausePlayback" :disabled="!isPlaying">暂停</button>
          <button @click="resetPlayback">重置</button>
        </div>
      </div>
    </div>
    <div v-else>
      <p>未选择任何事件</p>
    </div>
  </div>
</template>

<script>
import * as d3 from 'd3';
import * as echarts from 'echarts/core';
import { LineChart, ScatterChart } from 'echarts/charts';
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  VisualMapComponent
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

// 注册 ECharts 组件
echarts.use([
  LineChart,
  ScatterChart,
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  VisualMapComponent,
  CanvasRenderer
]);

export default {
  name: 'HeatwaveInfoPanel',
  props: {
    selectedEvent: {
      type: Object,
      default: null
    }
  },
  data() {
    return {
      panelWidth: window.innerWidth / 2,
      isResizing: false,
      minWidth: 300,
      maxWidth: window.innerWidth * 0.8,
      chartInstances: [],
      isPlaying: false,
      currentIndex: 0,
      animationInterval: null,
      arrowData: []
    };
  },
  watch: {
    selectedEvent: {
      handler(newVal) {
        console.log('HeatwaveInfoPanel received selectedEvent:', newVal);
        if (newVal && newVal.properties) {
          console.log('daily_info:', newVal.properties.daily_info);
          this.$nextTick(() => {
            this.resetPlayback();
            this.renderLineCharts();
            this.renderHovmollerCharts();
          });
        } else {
          console.warn('selectedEvent 无效或缺少 properties:', newVal);
          this.clearCharts();
        }
      },
      deep: true,
      immediate: true
    },
    panelWidth() {
      this.$nextTick(() => {
        if (this.selectedEvent && this.selectedEvent.properties) {
          this.renderLineCharts();
          this.renderHovmollerCharts();
        }
      });
    }
  },
  mounted() {
    window.addEventListener('resize', this.handleWindowResize);
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.handleWindowResize);
    this.clearCharts();
    this.pausePlayback();
  },
  methods: {
    startResize(event) {
      this.isResizing = true;
      document.addEventListener('mousemove', this.resize);
      document.addEventListener('mouseup', this.stopResize);
      event.preventDefault();
    },
    resize(event) {
      if (!this.isResizing) return;
      const newWidth = window.innerWidth - event.clientX;
      if (newWidth >= this.minWidth && newWidth <= this.maxWidth) {
        this.panelWidth = newWidth;
      }
    },
    stopResize() {
      this.isResizing = false;
      document.removeEventListener('mousemove', this.resize);
      document.removeEventListener('mouseup', this.stopResize);
    },
    handleWindowResize() {
      this.maxWidth = window.innerWidth * 0.8;
      if (this.panelWidth > this.maxWidth) {
        this.panelWidth = this.maxWidth;
      }
      this.chartInstances.forEach(instance => instance.resize());
    },
    clearCharts() {
      console.log('清除图表，停止动画');
      this.chartInstances.forEach(instance => instance.dispose());
      this.chartInstances = [];
      this.pausePlayback();
      this.arrowData = [];
    },
    calculateBearing(prevCentroid, currCentroid) {
      if (!prevCentroid || !currCentroid) return { speed: 0, angle: 0 };
      const R = 6371;
      const toRad = deg => (deg * Math.PI) / 180;
      const toDeg = rad => (rad * 180) / Math.PI;

      const lat1 = toRad(prevCentroid.lat);
      const lat2 = toRad(currCentroid.lat);
      const dLon = toRad(currCentroid.lon - prevCentroid.lon);

      const dLat = lat2 - lat1;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const speed = distance;

      const y = Math.sin(dLon) * Math.cos(lat2);
      const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
      let bearing = toDeg(Math.atan2(y, x));
      bearing = (bearing + 360) % 360;
      const angle = (90 - bearing + 360) % 360;

      return { speed, angle };
    },
    prepareData() {
      if (!this.selectedEvent?.properties?.daily_info) {
        console.warn('缺少 daily_info 数据:', this.selectedEvent);
        return { d3Data: [], echartsData: [] };
      }
      let dailyInfo;
      try {
        dailyInfo = typeof this.selectedEvent.properties.daily_info === 'string'
          ? JSON.parse(this.selectedEvent.properties.daily_info)
          : Array.isArray(this.selectedEvent.properties.daily_info)
            ? this.selectedEvent.properties.daily_info
            : [];
      } catch (e) {
        console.error('解析 daily_info 失败:', e);
        return { d3Data: [], echartsData: [] };
      }
      console.log('原始 daily_info:', dailyInfo);
      if (dailyInfo.length === 0) {
        console.warn('daily_info 为空数组');
        return { d3Data: [], echartsData: [] };
      }
      const d3Data = dailyInfo.map((day, index) => {
        if (
          !day.date ||
          !day.centroid ||
          day.centroid.lat == null ||
          day.centroid.lon == null ||
          day.max_anomaly == null ||
          isNaN(new Date(day.date).getTime())
        ) {
          console.warn('无效的 daily_info 条目:', { index, day });
          return null;
        }
        const intensity = Number(day.max_anomaly);
        if (isNaN(intensity)) {
          console.warn('无效的 max_anomaly:', { index, day, intensity });
          return null;
        }
        const lat = Number(day.centroid.lat);
        const lon = Number(day.centroid.lon);
        if (isNaN(lat) || isNaN(lon)) {
          console.warn('无效的 centroid:', { index, day, lat, lon });
          return null;
        }
        const prevCentroid = index > 0 ? dailyInfo[index - 1]?.centroid : null;
        const velocity = this.calculateBearing(prevCentroid, { lat, lon });
        return {
          date: new Date(day.date),
          area: Number(day.area_km2) || 0,
          intensity: intensity,
          heat_accumulation: Number(day.heat_accumulation) || (intensity * Number(day.area_km2)) || 0,
          lat: lat,
          lon: lon,
          speed: velocity.speed,
          angle: velocity.angle
        };
      }).filter(Boolean);

      const echartsData = d3Data.map(d => ({
        date: d.date.toLocaleDateString().replace(/\//g, '-'),
        area: d.area,
        heat_accumulation: d.heat_accumulation,
        intensity: d.intensity,
        lat: d.lat,
        lon: d.lon
      }));

      console.log('处理后的 D3 数据:', d3Data);
      console.log('处理后的 ECharts 数据:', echartsData);
      return { d3Data, echartsData };
    },
    renderLineCharts() {
      const containers = [
        { ref: this.$refs.areaChartContainer, metric: 'area', name: '面积', unit: 'km²', color: '#357abd' },
        { ref: this.$refs.heatChartContainer, metric: 'heat_accumulation', name: '热累积量', unit: '', color: '#d32f2f' },
        { ref: this.$refs.intensityChartContainer, metric: 'intensity', name: '强度', unit: '℃', color: '#388e3c' }
      ];

      if (!containers.every(c => c.ref) || !this.selectedEvent?.properties) return;

      this.chartInstances.forEach(instance => instance.dispose());
      this.chartInstances = [];

      const { echartsData } = this.prepareData();
      if (echartsData.length === 0) {
        containers.forEach(({ ref }) => {
          d3.select(ref)
            .append('div')
            .style('text-align', 'center')
            .style('line-height', '200px')
            .style('color', '#333333')
            .style('font-size', '14px')
            .text('无数据可用');
        });
        return;
      }

      containers.forEach(({ ref, metric, name, unit, color }) => {
        const chart = echarts.init(ref);
        chart.setOption({
          tooltip: {
            trigger: 'axis',
            formatter: params => {
              const date = params[0].name;
              const value = params[0].value;
              return `日期: ${date}<br>${name}: ${value.toFixed(2)} ${unit}`;
            }
          },
          grid: {
            containLabel: true,
            top: 30,
            bottom: 30,
            left: 50,
            right: 20
          },
          xAxis: {
            type: 'category',
            data: echartsData.map(d => d.date),
            axisLabel: {
              rotate: 30,
              color: '#333333',
              fontSize: 10
            }
          },
          yAxis: {
            type: 'value',
            name: `${name} (${unit})`,
            nameTextStyle: { color: '#333333' },
            axisLabel: { color: '#333333', fontSize: 10 }
          },
          series: [{
            name: name,
            type: 'line',
            smooth: true,
            data: echartsData.map(d => d[metric]),
            lineStyle: { width: 2, color: color },
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: `rgba(${parseInt(color.slice(1,3),16)},${parseInt(color.slice(3,5),16)},${parseInt(color.slice(5,7),16)},0.8)` },
                { offset: 1, color: `rgba(${parseInt(color.slice(1,3),16)},${parseInt(color.slice(3,5),16)},${parseInt(color.slice(5,7),16)},0.1)` }
              ])
            }
          }]
        });
        this.chartInstances.push(chart);
      });
    },
    startPlayback() {
      if (this.isPlaying || this.arrowData.length === 0) return;
      this.isPlaying = true;
      this.currentIndex = 0;
      this.updateChart();
      this.animationInterval = setInterval(() => {
        this.currentIndex++;
        if (this.currentIndex >= this.arrowData.length - 1) {
          this.pausePlayback();
        } else {
          this.updateChart();
        }
      }, 1000);
    },
    pausePlayback() {
      if (!this.isPlaying) return;
      this.isPlaying = false;
      clearInterval(this.animationInterval);
      this.animationInterval = null;
    },
    resetPlayback() {
      this.pausePlayback();
      this.currentIndex = 0;
      this.updateChart();
    },
    updateChart() {
      const container = this.$refs.latTimeChartContainer;
      if (!container) return;

      const chart = this.chartInstances.find(instance => instance.getDom() === container);
      if (!chart) return;

      let seriesData;
      if (this.currentIndex === 0) {
        seriesData = this.arrowData.slice(0, -1).map((d, i) => ({
          value: [d.lon, d.lat, d.intensity],
          date: d.date,
          symbolRotate: this.arrowData[i + 1] ? this.calculateBearing(
            { lat: d.lat, lon: d.lon },
            { lat: this.arrowData[i + 1].lat, lon: this.arrowData[i + 1].lon }
          ).angle : 0
        }));
      } else {
        const current = this.arrowData[this.currentIndex];
        const next = this.arrowData[this.currentIndex + 1];
        seriesData = current ? [{
          value: [current.lon, current.lat, current.intensity],
          date: current.date,
          symbolRotate: next ? this.calculateBearing(
            { lat: current.lat, lon: current.lon },
            { lat: next.lat, lon: next.lon }
          ).angle : 0
        }] : [];
      }

      chart.setOption({
        animationDuration: 1000,
        animationEasing: 'cubicInOut',
        animationDelay: idx => idx * 1000,
        series: [
          {
            name: '质心位置与方向',
            type: 'scatter',
            data: seriesData
          }
        ]
      });

      console.log('Updated chart with index:', this.currentIndex, 'seriesData:', seriesData);
    },
    renderHovmollerCharts() {
      const container = this.$refs.latTimeChartContainer;
      if (!container || !this.selectedEvent?.properties) return;

      const { echartsData, d3Data } = this.prepareData();
      if (echartsData.length === 0) {
        d3.select(container)
          .append('div')
          .style('text-align', 'center')
          .style('line-height', '200px')
          .style('color', '#333333')
          .style('font-size', '14px')
          .text('无数据可用');
        return;
      }

      const chart = echarts.init(container);
      this.chartInstances.push(chart);

      const maxIntensity = Math.max(...echartsData.map(d => d.intensity).filter(v => v != null), 5);

      const sortedD3Data = d3Data.sort((a, b) => a.date - b.date);

      this.arrowData = sortedD3Data.map(d => ({
        lon: d.lon,
        lat: d.lat,
        intensity: d.intensity,
        date: d.date.toLocaleDateString()
      }));

      console.log('arrowData:', this.arrowData);

      const seriesData = this.arrowData.slice(0, -1).map((d, i) => ({
        value: [d.lon, d.lat, d.intensity],
        date: d.date,
        symbolRotate: this.arrowData[i + 1] ? this.calculateBearing(
          { lat: d.lat, lon: d.lon },
          { lat: this.arrowData[i + 1].lat, lon: this.arrowData[i + 1].lon }
        ).angle : 0
      }));

      chart.setOption({
        tooltip: {
          trigger: 'item',
          formatter: params => {
            const { data } = params;
            if (!data || !data.date || data.value[0] == null || data.value[1] == null) {
              return '无效数据';
            }
            const intensity = typeof data.value[2] === 'number' && !isNaN(data.value[2]) ? data.value[2].toFixed(2) : 'N/A';
            return `日期: ${data.date}<br>经度: ${data.value[0].toFixed(2)} °E<br>纬度: ${data.value[1].toFixed(2)} °N<br>强度: ${intensity} ℃`;
          }
        },
        visualMap: {
          show: true,
          min: 0,
          max: maxIntensity,
          dimension: 2,
          inRange: {
            color: ['#440154', '#21908C', '#FDE725']
          },
          text: ['高', '低'],
          textStyle: { color: '#333333' },
          right: 10,
          top: 'middle'
        },
        grid: {
          containLabel: true,
          top: 30,
          bottom: 40,
          left: 50,
          right: 50
        },
        xAxis: {
          type: 'value',
          name: '经度 (°E)',
          nameLocation: 'middle',
          nameGap: 20,
          nameTextStyle: { color: '#333333' },
          axisLabel: {
            color: '#333333',
            fontSize: 10,
            formatter: '{value} °E'
          },
          min: Math.min(...echartsData.map(d => d.lon)) - 1,
          max: Math.max(...echartsData.map(d => d.lon)) + 1
        },
        yAxis: {
          type: 'value',
          name: '纬度 (°N)',
          nameLocation: 'middle',
          nameGap: 30,
          nameTextStyle: { color: '#333333' },
          axisLabel: {
            color: '#333333',
            fontSize: 10,
            formatter: '{value} °N'
          },
          min: Math.min(...echartsData.map(d => d.lat)) - 1,
          max: Math.max(...echartsData.map(d => d.lat)) + 1
        },
        series: [
          {
            name: '质心位置与方向',
            type: 'scatter',
            data: seriesData,
            symbol: 'path://M -5,-5 L 0,0 L -5,5 L 3,0 Z',
            symbolSize: d => {
              const intensity = d.value && typeof d.value[2] === 'number' && !isNaN(d.value[2]) ? d.value[2] : 0;
              return Math.max(intensity * 5, 10);
            },
            itemStyle: {
              opacity: 0.8
            }
          }
        ]
      });

      console.log('Initial centroid arrow series data:', seriesData);
    }
  }
};
</script>

<style scoped>
.info-panel-content {
  padding: 1.5rem;
  color: #333333;
  font-family: Arial, sans-serif;
  position: relative;
  height: auto;
  box-sizing: border-box;
  transition: width 0.2s ease;
  background: #ffffff;
}

.resize-handle {
  position: absolute;
  left: 0;
  top: 0;
  width: 6px;
  height: 100%;
  background: rgba(0, 0, 0, 0.2);
  cursor: ew-resize;
  z-index: 2100;
}

.resize-handle:hover {
  background: rgba(0, 0, 0, 0.4);
}

.panel-title {
  margin: 0 0 16px;
  font-size: 1.8rem;
  color: #2c3e50;
  text-align: center;
}

.info-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 12px;
  margin-bottom: 24px;
  font-size: 16px;
}

.info-label {
  font-weight: 500;
  color: #213042;
}

.close-button-container {
  position: absolute;
  top: 15px;
  right: 15px;
  z-index: 1000;
}

.close-button {
  background: transparent;
  border: none;
  color: #666;
  font-size: 28px;
  padding: 0 8px;
  line-height: 1;
  transition: color 0.2s;
  cursor: pointer;
}

.close-button:hover {
  color: #333;
}

button {
  background: #357abd;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 16px;
  transition: background 0.2s;
  display: block;
  margin: 0;
}

button:hover {
  background: #2a5d9c;
}

.chart-card {
  background: white;
  padding: 1.5rem;
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.08);
  transition: transform 0.2s;
  margin-bottom: 1.5rem;
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
  width: 100%;
}

.chart-card.line-charts .chart {
  height: 200px;
  margin-bottom: 10px;
}

.chart-card.line-charts .chart:last-child {
  margin-bottom: 0;
}

.chart-card.hovmoller-charts .chart {
  height: 300px;
}

.playback-controls {
  margin-top: 10px;
  text-align: center;
}

.playback-controls button {
  display: inline-block;
  margin: 0 5px;
  padding: 8px 16px;
  font-size: 14px;
  background: #357abd;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s;
}

.playback-controls button:hover {
  background: #2a5d9c;
}

.playback-controls button:disabled {
  background: #cccccc;
  cursor: not-allowed;
}

p {
  color: #333333;
  text-align: center;
  font-size: 14px;
}

@media (max-width: 768px) {
  .info-panel-content {
    padding: 1rem;
  }
  .panel-title {
    font-size: 1.4rem;
  }
  .info-grid {
    font-size: 14px;
    gap: 8px;
  }
  button {
    padding: 8px 16px;
    font-size: 14px;
  }
  .resize-handle {
    width: 8px;
  }
  .chart-card h3 {
    font-size: 1rem;
  }
  .chart-card.line-charts .chart {
    height: 150px;
  }
  .chart-card.hovmoller-charts .chart {
    height: 200px;
  }
  .playback-controls button {
    padding: 6px 12px;
    font-size: 12px;
  }
}
</style>