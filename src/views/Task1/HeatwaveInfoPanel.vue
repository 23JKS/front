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
        <button @click="$emit('close')">关闭</button>
        <!-- 指纹图 -->
        <div class="chart-card">
          <h3>热浪指纹分析</h3>
          <div ref="chartContainer" class="chart"></div>
        </div>
        <!-- 折线图（三个子图） -->
        <div class="chart-card line-charts">
          <h3>每日热浪指标趋势</h3>
          <div ref="areaChartContainer" class="chart"></div>
          <div ref="heatChartContainer" class="chart"></div>
          <div ref="intensityChartContainer" class="chart"></div>
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
  import { LineChart } from 'echarts/charts';
  import {
    TitleComponent,
    TooltipComponent,
    GridComponent,
    LegendComponent
  } from 'echarts/components';
  import { CanvasRenderer } from 'echarts/renderers';
  // import { v4 as uuidv4 } from 'uuid';
  
  // 注册 ECharts 组件
  echarts.use([
    LineChart,
    TitleComponent,
    TooltipComponent,
    GridComponent,
    LegendComponent,
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
        chartInstances: []
      };
    },
    watch: {
      selectedEvent: {
        handler(newVal) {
          console.log('HeatwaveInfoPanel received selectedEvent:', newVal);
          if (newVal && newVal.properties) {
            console.log('daily_info:', newVal.properties.daily_info);
            this.$nextTick(() => {
              this.renderFingerprintChart();
              this.renderLineCharts();
            });
          } else {
            console.warn('selectedEvent 无效或缺少 properties:', newVal);
            d3.select(this.$refs.chartContainer).selectAll('*').remove();
            this.clearLineCharts();
          }
        },
        deep: true,
        immediate: true
      },
      panelWidth() {
        this.$nextTick(() => {
          if (this.selectedEvent && this.selectedEvent.properties) {
            this.renderFingerprintChart();
            this.renderLineCharts();
          }
        });
      }
    },
    mounted() {
      window.addEventListener('resize', this.handleWindowResize);
    },
    beforeUnmount() {
      window.removeEventListener('resize', this.handleWindowResize);
      d3.select(this.$refs.chartContainer).selectAll('*').remove();
      this.clearLineCharts();
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
      clearLineCharts() {
        this.chartInstances.forEach(instance => instance.dispose());
        this.chartInstances = [];
      },
      calculateVelocity(prevCentroid, currCentroid, days = 1) {
        if (!prevCentroid || !currCentroid) return { speed: 0, angle: 0 };
        const R = 6371;
        const dLat = ((currCentroid.lat - prevCentroid.lat) * Math.PI) / 180;
        const dLon = ((currCentroid.lon - prevCentroid.lon) * Math.PI) / 180;
        const lat1 = (prevCentroid.lat * Math.PI) / 180;
        const lat2 = (currCentroid.lat * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const speed = distance / days;
        const y = Math.sin(dLon) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
        const angle = (Math.atan2(y, x) * 180) / Math.PI;
        return { speed, angle };
      },
      prepareData() {
        if (!this.selectedEvent?.properties?.daily_info) {
          console.warn('缺少 daily_info 数据:', this.selectedEvent);
          return { d3Data: [], echartsData: [] };
        }
        const dailyInfo = Array.isArray(this.selectedEvent.properties.daily_info)
          ? this.selectedEvent.properties.daily_info
          : [];
        console.log('原始 daily_info:', dailyInfo);
        if (dailyInfo.length === 0) {
          console.warn('daily_info 为空数组');
          return { d3Data: [], echartsData: [] };
        }
        const d3Data = dailyInfo.map((day, index) => {
          if (!day.date || !day.centroid || isNaN(new Date(day.date).getTime())) {
            console.warn('无效的 daily_info 条目:', { index, day });
            return null;
          }
          const prevCentroid = index > 0 ? dailyInfo[index - 1]?.centroid : null;
          const velocity = this.calculateVelocity(prevCentroid, day.centroid);
          return {
            date: new Date(day.date),
            area: Number(day.area_km2) || 0,
            intensity: Number(day.max_anomaly) || 0,
            heat_accumulation: Number(day.heat_accumulation) || (Number(day.max_anomaly) * Number(day.area_km2)) || 0,
            speed: velocity.speed,
            angle: velocity.angle
          };
        }).filter(Boolean);
  
        const echartsData = d3Data.map(d => ({
          date: d.date.toLocaleDateString().replace(/\//g, '-'),
          area: d.area,
          heat_accumulation: d.heat_accumulation,
          intensity: d.intensity
        }));
  
        console.log('处理后的 D3 数据:', d3Data);
        console.log('处理后的 ECharts 数据:', echartsData);
        return { d3Data, echartsData };
      },
      renderFingerprintChart() {
        const container = this.$refs.chartContainer;
        if (!container || !this.selectedEvent?.properties) return;
  
        d3.select(container).selectAll('*').remove();
  
        const width = this.panelWidth - 48;
        const height = 300;
        const margin = { top: 20, right: 20, bottom: 40, left: 60 };
        const innerWidth = width - margin.left - margin.right;
        const innerHeight = height - margin.top - margin.bottom;
  
        const svg = d3
          .select(container)
          .append('svg')
          .attr('width', width)
          .attr('height', height)
          .append('g')
          .attr('transform', `translate(${margin.left},${margin.top})`);
  
        const { d3Data } = this.prepareData();
        if (d3Data.length === 0) {
          svg
            .append('text')
            .attr('x', innerWidth / 2)
            .attr('y', innerHeight / 2)
            .attr('text-anchor', 'middle')
            .text('无数据可用')
            .style('fill', '#333333');
          return;
        }
  
        const xScale = d3
          .scaleTime()
          .domain(d3.extent(d3Data, d => d.date))
          .range([0, innerWidth]);
  
        const xAxis = d3.axisBottom(xScale).ticks(5);
        svg
          .append('g')
          .attr('transform', `translate(0,${innerHeight})`)
          .call(xAxis)
          .selectAll('text')
          .style('fill', '#333333')
          .style('font-size', '10px');
  
        const variables = [
          { key: 'area', label: '面积 (km²)', shape: 'bar' },
          { key: 'intensity', label: '强度 (℃)', shape: 'circle' },
          { key: 'speed', label: '速度 (km/d)', shape: 'arrow' }
        ];
        const yScale = d3
          .scaleBand()
          .domain(variables.map(v => v.key))
          .range([0, innerHeight])
          .padding(0.2);
  
        const subHeight = yScale.bandwidth();
  
        const colorScale = d3
          .scaleSequential(d3.interpolateInferno)
          .domain([0, d3.max(d3Data, d => Math.max(d.area, d.intensity, d.speed))]);
  
        variables.forEach((variable) => {
          const g = svg
            .append('g')
            .attr('transform', `translate(0,${yScale(variable.key)})`);
  
          const kde = kernelDensityEstimator(kernelEpanechnikov(0.2), xScale.ticks(50));
          const density = kde(
            d3Data.map(d => xScale(d.date)),
            d3Data.map(d => d[variable.key])
          );
  
          const violinScale = d3
            .scaleLinear()
            .domain([-d3.max(density, d => d[1]), d3.max(density, d => d[1])])
            .range([subHeight / 2, 0]);
  
          const area = d3
            .area()
            .x(d => d[0])
            .y0(d => violinScale(-d[1]))
            .y1(d => violinScale(d[1]))
            .curve(d3.curveCatmullRom);
  
          g.append('path')
            .datum(density)
            .attr('fill', 'rgba(0, 0, 0, 0.1)')
            .attr('stroke', '#357abd')
            .attr('d', area);
  
          g.selectAll('.heatmap-line')
            .data(d3Data)
            .enter()
            .append('line')
            .attr('x1', d => xScale(d.date))
            .attr('x2', d => xScale(d.date))
            .attr('y1', subHeight)
            .attr('y2', 0)
            .attr('stroke', d => colorScale(d[variable.key]))
            .attr('stroke-width', 2)
            .attr('opacity', 0.8);
  
          if (variable.shape === 'bar') {
            g.selectAll('.bar')
              .data(d3Data)
              .enter()
              .append('rect')
              .attr('x', d => xScale(d.date) - 5)
              .attr('y', d => subHeight - (d.area / d3.max(d3Data, d => d.area)) * subHeight)
              .attr('width', 10)
              .attr('height', d => (d.area / d3.max(d3Data, d => d.area)) * subHeight)
              .attr('fill', d => colorScale(d.area))
              .attr('opacity', 0.7);
          } else if (variable.shape === 'circle') {
            g.selectAll('.circle')
              .data(d3Data)
              .enter()
              .append('circle')
              .attr('cx', d => xScale(d.date))
              .attr('cy', subHeight / 2)
              .attr('r', d => (d.intensity / d3.max(d3Data, d => d.intensity)) * 8 + 3)
              .attr('fill', d => colorScale(d.intensity))
              .attr('opacity', 0.7);
          } else if (variable.shape === 'arrow') {
            g.selectAll('.arrow')
              .data(d3Data.filter(d => d.speed > 0))
              .enter()
              .append('path')
              .attr('d', d => {
                const x = xScale(d.date);
                const len = (d.speed / d3.max(d3Data, d => d.speed)) * 15;
                return `M${x},${subHeight / 2} L${x + len * Math.cos((d.angle * Math.PI) / 180)},${subHeight / 2 - len * Math.sin((d.angle * Math.PI) / 180)}`;
              })
              .attr('stroke', d => colorScale(d.speed))
              .attr('stroke-width', 2)
              .attr('marker-end', 'url(#arrowhead)');
          }
  
          g.append('text')
            .attr('x', -margin.left + 10)
            .attr('y', subHeight / 2)
            .attr('dy', '0.35em')
            .text(variable.label)
            .style('fill', '#333333')
            .style('font-size', '10px');
        });
  
        svg
          .append('defs')
          .append('marker')
          .attr('id', 'arrowhead')
          .attr('viewBox', '0 -5 10 10')
          .attr('refX', 5)
          .attr('refY', 0)
          .attr('markerWidth', 6)
          .attr('markerHeight', 6)
          .attr('orient', 'auto')
          .append('path')
          .attr('d', 'M0,-5L10,0L0,5')
          .attr('fill', '#357abd');
  
        const canvas = d3
          .select(container)
          .append('canvas')
          .attr('width', innerWidth)
          .attr('height', innerHeight)
          .style('position', 'absolute')
          .style('left', `${margin.left}px`)
          .style('top', `${margin.top}px`)
          .style('pointer-events', 'none');
  
        const ctx = canvas.node().getContext('2d');
        const animateDots = () => {
          ctx.clearRect(0, 0, innerWidth, innerHeight);
          d3Data.forEach(d => {
            variables.forEach(v => {
              const x = xScale(d.date);
              const y = yScale(v.key) + subHeight / 2;
              ctx.beginPath();
              ctx.arc(x, y, 2 + Math.sin(Date.now() / 500 + x) * 1.5, 0, 2 * Math.PI);
              ctx.fillStyle = colorScale(d[v.key]);
              ctx.globalAlpha = 0.5 + Math.sin(Date.now() / 500 + x) * 0.3;
              ctx.fill();
            });
          });
          requestAnimationFrame(animateDots);
        };
        animateDots();
  
        const tooltip = d3
          .select(container)
          .append('div')
          .style('position', 'absolute')
          .style('background', 'rgba(255, 255, 255, 0.9)')
          .style('color', '#333333')
          .style('padding', '5px')
          .style('border-radius', '4px')
          .style('pointer-events', 'none')
          .style('display', 'none')
          .style('font-size', '10px')
          .style('box-shadow', '0 2px 4px rgba(0, 0, 0, 0.2)');
  
        svg
          .selectAll('.bar, .circle, .arrow')
          .on('mouseover', (event, d) => {
            tooltip
              .style('display', 'block')
              .html(
                `日期: ${d.date.toLocaleDateString()}<br>` +
                `面积: ${d.area.toFixed(2)} km²<br>` +
                `强度: ${d.intensity.toFixed(2)} ℃<br>` +
                `速度: ${d.speed.toFixed(2)} km/d`
              )
              .style('left', `${event.pageX + 10}px`)
              .style('top', `${event.pageY - 10}px`);
          })
          .on('mouseout', () => {
            tooltip.style('display', 'none');
          });
      },
      renderLineCharts() {
        const containers = [
          { ref: this.$refs.areaChartContainer, metric: 'area', name: '面积', unit: 'km²', color: '#357abd' },
          { ref: this.$refs.heatChartContainer, metric: 'heat_accumulation', name: '热累积量', unit: '', color: '#d32f2f' },
          { ref: this.$refs.intensityChartContainer, metric: 'intensity', name: '强度', unit: '℃', color: '#388e3c' }
        ];
  
        if (!containers.every(c => c.ref) || !this.selectedEvent?.properties) return;
  
        this.clearLineCharts();
  
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
                  { offset: 0, color: `rgba(${parseInt(color.slice(1,3), 16)},${parseInt(color.slice(3,5), 16)},${parseInt(color.slice(5,7), 16)},0.8)` },
                  { offset: 1, color: `rgba(${parseInt(color.slice(1,3), 16)},${parseInt(color.slice(3,5), 16)},${parseInt(color.slice(5,7), 16)},0.1)` }
                ])
              }
            }]
          });
          this.chartInstances.push(chart);
        });
      }
    }
  };
  
  function kernelDensityEstimator(kernel, X) {
    return function (V, W) {
      return X.map(x => [
        x,
        d3.mean(W, (w, i) => kernel((x - V[i]) / (d3.deviation(V) || 1)) * w)
      ]);
    };
  }
  
  function kernelEpanechnikov(k) {
    return function (v) {
      return Math.abs((v /= k)) <= 1 ? (0.75 * (1 - v * v)) / k : 0;
    };
  }
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
    margin: 0 auto 24px;
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
  
  .chart-card:first-child .chart {
    height: 300px;
  }
  
  .chart-card.line-charts .chart {
    height: 200px;
    margin-bottom: 10px;
  }
  
  .chart-card.line-charts .chart:last-child {
    margin-bottom: 0;
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
    .chart-card:first-child .chart {
      height: 200px;
    }
    .chart-card.line-charts .chart {
      height: 150px;
    }
  }
  </style>