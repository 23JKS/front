<template>
  <div class="chart-wrapper" ref="chart"></div>
</template>

<script>
import * as echarts from 'echarts';
import { ref, onMounted, onBeforeUnmount } from 'vue';
import marineData from '@/assets/marine_heatwaves.json';

export default {
  setup() {
    const chart = ref(null);
    let myChart = null;

    const debounceResize = debounce(() => myChart.resize(), 300);

    const initChart = () => {
      myChart = echarts.init(chart.value);
      
      // 注册自定义地图
      echarts.registerMap('marine_heatwaves', marineData);

      // 处理多边形数据
      const areaData = marineData.features.map(feature => ({
        name: feature.properties.start_date,
        value: feature.properties.max_anomaly
      }));

      // 处理散点数据
      const heatwavePoints = marineData.features.map(feature => ({
        value: [
          feature.geometry.coordinates[0][0][0],
          feature.geometry.coordinates[0][0][1],
          feature.properties.max_anomaly
        ],
        properties: feature.properties
      }));

      const option = {
        title: {
          text: '2020年海洋热浪事件分布',
          left: 'center',
          textStyle: { color: '#fff' }
        },
        tooltip: {
          trigger: 'item',
          formatter: params => {
            if (params.seriesType === 'scatter') {
              const { start_date, duration, max_anomaly } = params.data.properties;
              return `日期: ${start_date}<br/>持续时间: ${duration}天<br/>温度异常: ${max_anomaly.toFixed(2)}°C`;
            }
            return null;
          }
        },
        visualMap: {
          min: Math.min(...areaData.map(d => d.value)),
          max: Math.max(...areaData.map(d => d.value)),
          left: '30',
          bottom: '30',
          calculable: true,
          inRange: { color: ['#2E98CA', '#F4E925', '#FF4500'] },
          textStyle: { color: '#fff' }
        },
        geo: {
          map: 'marine_heatwaves',
          roam: true,
          itemStyle: {
            areaColor: 'rgba(46,152,202,0.5)', // 半透明填充
            borderColor: '#53D9FF',             // 边界颜色
            borderWidth: 1
          },
          emphasis: {
            itemStyle: {
              areaColor: '#8dd7fc' // 高亮颜色
            }
          }
        },
        series: [
          {
            type: 'scatter',
            coordinateSystem: 'geo',
            data: heatwavePoints,
            symbolSize: 12,
            itemStyle: {
              color: 'yellow',
              shadowBlur: 10,
              shadowColor: '#FF4500'
            }
          }
        ]
      };

      myChart.setOption(option);
    };

    onMounted(() => {
      initChart();
      window.addEventListener('resize', debounceResize);
    });

    onBeforeUnmount(() => {
      window.removeEventListener('resize', debounceResize);
      myChart.dispose();
    });

    return { chart };
  }
};

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
</script>

<style scoped>
.chart-wrapper {
  width: 100%;
  height: 600px;
  background: #0a1734;
}
</style>