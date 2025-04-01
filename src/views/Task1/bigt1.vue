<!-- Task1.vue -->
<template>
    <div class="task1-container">
      <div class="filter-panel">
        <el-date-picker
          v-model="localTimeRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          value-format="YYYY-MM-DD"
          style="width: 100px !important;"
          @change="handleTimeRangeChange"
        />
  
  
        <div class="slider-group">
          <div class="slider-container">
            <span class="slider-label">最小峰值强度 (°C):</span>
            <el-slider
              v-model="minPeakIntensity"
              :min="1"
              :max="30"
              :step="0.5"
              style="width: 300px;"
              :format-tooltip="val => val.toFixed(1)"
              show-input
              @change="updateFilters"
            />
          </div>
  
          <div class="slider-container">
            <span class="slider-label">累积强度 (°C·天):</span>
            <el-slider
              v-model="cumulativeRange"
              :min="0"
              :max="10000"
              :step="100"
              range
              show-stops
              @change="updateFilters"
            />
          </div>
        </div>
  
        <el-button-group class="btn-group">
          <el-button type="primary" @click="drawArea">绘制筛选区域</el-button>
          <el-button type="danger" @click="clearDrawnArea">清除区域</el-button>
          <el-button @click="toggleHeatmap">{{ heatmapVisible ? '关闭' : '开启' }}热力图</el-button>
        </el-button-group>
      </div>
      <!-- 添加加载状态提示 -->
      <div v-if="loading" class="loading-overlay">
        <div class="loading-text">
          <el-icon class="is-loading"><loading /></el-icon>
          正在加载地图数据...
        </div>
      </div>
      <div id="map" style="height: 800px; width: 100%;"></div>
  
      <div class="legend-control" v-if="map">
        <div class="legend-section">
          <div class="legend-title">峰值强度 (°C)</div>
          <div class="legend-scale">
            <div v-for="(item, index) in intensityLegend" :key="'intensity-'+index" class="legend-item">
              <span class="legend-color" :style="{backgroundColor: item.color}"></span>
              <span class="legend-label">{{ item.label }}</span>
            </div>
          </div>
        </div>
        
        <div class="legend-section">
          <div class="legend-title">移动速度 (km/天)</div>
          <div class="legend-scale">
            <div v-for="(item, index) in speedLegend" :key="'speed-'+index" class="legend-item">
              <span class="legend-line" :style="getLineStyle(item)"></span>
              <span class="legend-label">{{ item.label }}</span>
            </div>
          </div>
        </div>
      </div>
  
      <el-dialog title="事件详情" v-model="detailDialogVisible" width="50%">
        <event-detail-panel v-if="selectedEvent" :event-data="selectedEvent" />
      </el-dialog>
    </div>
  </template>
  
  <script>
  import L from 'leaflet';
  import 'leaflet/dist/leaflet.css';
  import 'leaflet-draw/dist/leaflet.draw.css';
  import { mapMutations } from 'vuex';
  
  import { Chart } from 'chart.js/auto' // 修改导入方式
  import EventDetailPanel from './EventDetailPanel.vue';
  import { Loading } from '@element-plus/icons-vue';
  
  
  // 修复Leaflet默认图标丢失问题
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
    iconUrl: require('leaflet/dist/images/marker-icon.png'),
    shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
  });
  
  export default {
    components: { EventDetailPanel ,Loading},
    name: 'TaskOne',
    data() {
      return {
        map: null,
        heatwaveEvents: [],
        filteredEvents: [],
        geoJsonLayer: null,
        heatmapLayer: null,
        mapInitialized: false,
        localTimeRange: null,
        minPeakIntensity: 0,
        cumulativeRange: [0, 5000],
        intensityLegend: [
          { color: '#fee08b', label: '10-12' },
          { color: '#fc8d59', label: '12-15' },
          { color: '#d73027', label: '15-18' },
          { color: '#8b0000', label: '>18' }
        ],
        speedLegend: [
          { width: 1, color: '#b2abd2', dash: null, label: '<10' },
          { width: 2, color: '#8073ac', dash: null, label: '10-20' },
          { width: 3, color: '#542788', dash: '5,5', label: '>20' }
        ],
        drawnItems: null,
        drawControl: null,
        currentDrawnLayer: null,
        heatmapVisible: false,
        detailDialogVisible: false,
        selectedEvent: null,
        loading: true,
        loadingMessage: '正在初始化地图...',
        initializationError: null
      };
    },
    mounted() {
      this.$nextTick(() => {
        this.initializeMap();
      });
    },
    computed: {
        dataStats() {
          return {
            minPeak: Math.min(...this.heatwaveEvents.map(e => e.properties._peak)),
            maxPeak: Math.max(...this.heatwaveEvents.map(e => e.properties._peak)),
            minCumulative: Math.min(...this.heatwaveEvents.map(e => e.properties._cumulative)),
            maxCumulative: Math.max(...this.heatwaveEvents.map(e => e.properties._cumulative)),
            dateRange: [
              this.getEarliestDate(),
              this.getLatestDate()
            ]
          };
        }
    },
    methods: {
      ...mapMutations(['setTimeRange', 'setSpatialRegion']),
       // 新增的时间范围处理方法
       handleTimeRangeChange(range) {
        console.log('时间范围变更:', range);
        this.setTimeRange(range); // 提交到 Vuex
        this.updateFilters();     // 触发筛选
      },
      async loadHeatwaveData() {
        try {
          const response = await fetch('/data/new_heatwaves.geojson');
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          
          const data = await response.json();
          console.log('数据字段验证:', Object.keys(data.features[0].properties));
  
          this.heatwaveEvents = data.features.map(f => {
            // 解析每日信息获取最大面积
            const dailyInfo = JSON.parse(f.properties.daily_info);
            const maxArea = Math.max(...dailyInfo.map(d => d.area_km2));
            
            return {
              ...f,
              properties: {
                // 保留原始字段
                ...f.properties,
                // 添加计算字段
                _peak: parseFloat(f.properties.max_anomaly) || 0,
                _cumulative: parseFloat(f.properties.cumulative_anomaly) || 0,
                _speed: parseFloat(f.properties.centroid_change_rate) || 0,
                _max_area: maxArea
              }
            };
          });
  
          console.log('处理后的首条数据:', JSON.stringify(this.heatwaveEvents[0], null, 2));
          this.updateFilters();
        } catch (error) {
          console.error('数据加载失败:', error);
          this.$message.error('热浪数据加载失败，请检查控制台');
        }
      },
      // 增强版地图初始化方法
      // 修改initializeMap方法
      async initializeMap() {
        try {
          // 检查地图容器是否存在
          const mapContainer = document.getElementById('map');
          if (!mapContainer) {
            throw new Error('无法找到地图容器，请确认元素ID正确');
          }
  
          // 清理旧地图实例
          if (this.map) {
            this.map.off();
            this.map.remove();
            this.map = null;
          }
  
          // 创建新地图实例
          this.map = L.map('map', {
            preferCanvas: true,
            zoomControl: false,
            center: [35, 140],
            zoom: 4,
            fadeAnimation: true
          });
  
          // 添加调试信息
          console.log('地图实例创建完成，开始加载底图...');
  
          // 添加基础底图（带重试机制）
          const baseLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxNativeZoom: 19,
            maxZoom: 19,
            minZoom: 2,
            attribution: '© OpenStreetMap contributors'
          }).on('tileerror', (err) => {
            console.error('底图加载错误:', err);
          });
  
          // 带超时的底图加载等待
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('底图加载超时（10秒），请检查网络连接'));
            }, 10000);
  
            baseLayer.addTo(this.map);
            this.map.whenReady(() => {
              clearTimeout(timeout);
              console.log('底图加载完成');
              resolve();
            });
          });
  
          // 初始化绘制工具
          this.drawnItems = new L.FeatureGroup().addTo(this.map);
          console.log('绘制工具初始化完成');
  
          // 加载数据（带超时重试）
          await Promise.race([
            this.loadHeatwaveData(),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('数据加载超时（15秒）')), 15000)
            )
          ]);
          
          console.log('数据加载完成，开始渲染');
          this.updateFilters();
  
        } catch (error) {
          console.error('初始化流程失败:', error);
          this.$message.error({
            message: `初始化失败: ${error.message}`,
            duration: 5000
          });
          
          // 失败时创建备用底图
          if (!this.map && document.getElementById('map')) {
            this.map = L.map('map', {
              center: [35, 140],
              zoom: 4
            });
            L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}').addTo(this.map);
            this.$message.warning('已加载备用底图');
          }
        } finally {
          console.log('初始化流程结束');
          this.loading = false;
        }
      },
     // 增强数据加载方法
     
         // 使用Haversine公式计算两点之间的距离
      calculateDistance(lat1, lon1, lat2, lon2) {
        const toRad = x => x * Math.PI / 180;
        const R = 6371e3; // 地球半径，单位：米
        const φ1 = toRad(lat1);
        const φ2 = toRad(lat2);
        const Δφ = toRad(lat2 - lat1);
        const Δλ = toRad(lon2 - lon1);
        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
                  Math.cos(φ1) * Math.cos(φ2) *
                  Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c; // 返回距离（米）
      },
      calculateMovementSpeed(feature) {
        try {
          const dailyData = JSON.parse(feature.properties.daily_info);
          const validDays = dailyData.filter(d => d.centroid);
          if (validDays.length < 2) return 0;
          
          const first = validDays[0].centroid;
          const last = validDays[validDays.length - 1].centroid;
          const distance = this.calculateDistance(first.lat, first.lon, last.lat, last.lon);
          return distance ? (distance / 1000) / validDays.length : 0;
        } catch {
          return 0;
        }
      },
      // 在methods中添加颜色映射方法
      getIntensityColor(value) {
        return value > 18 ? '#8b0000' :   // 深红
              value > 15 ? '#d73027' :   // 红色
              value > 12 ? '#fc8d59' :   // 橙色
              '#fee08b';                // 浅黄
      },
      // 修改样式获取方法
      getStyle(feature) {
        const maxAnomaly = feature.properties.max_anomaly;
        return {
          fillColor: this.getIntensityColor(maxAnomaly),
          color: '#ffffff',  // 边界颜色
          weight: 1,         // 边界宽度
          fillOpacity: 0.8   // 填充透明度
        };
      },
     // 增强渲染方法
    // 修改 renderHeatwaveEvents 方法
     
      // 修改多边形渲染逻辑
     // 修改渲染方法（关键部分）
  renderHeatwaveEvents() {
    try {
      this.geoJsonLayer = L.geoJSON(this.filteredGeoJSON, {
        style: this.getStyle.bind(this),
        onEachFeature: (feature, layer) => {
          // 绑定交互事件
          layer.on({
            mouseover: e => this.highlightFeature(e),
            mouseout: e => this.resetFeatureStyle(e),
            click: () => this.showEventDetail(feature.properties)
          });
          
          // 添加动态标签
          const anomaly = feature.properties.max_anomaly.toFixed(1);
          layer.bindTooltip(`强度: ${anomaly}°C`, 
            { permanent: false, direction: 'top' });
        }
      }).addTo(this.map);
  
      // 自动调整视图
      if (this.geoJsonLayer.getLayers().length > 0) {
        this.map.fitBounds(this.geoJsonLayer.getBounds(), {
          padding: [50, 50],
          maxZoom: 6
        });
      }
    } catch (error) {
      console.error('渲染失败:', error);
    }
  },
  
    // 新增交互高亮方法
  highlightFeature(e) {
    const layer = e.target;
    layer.setStyle({
      weight: 3,
      color: '#666',
      fillOpacity: 1
    });
  },
      getSpeedColor(speed) {
        return speed > 20 ? '#542788' :
               speed > 10 ? '#8073ac' :
               '#b2abd2';
      },
      // 修改要素处理方法
      onEachFeature(feature, layer) {
        const props = feature.properties;
        
        // 根据几何类型处理
        switch(feature.geometry.type) {
          case 'Point':
            // 点要素处理
            layer.bindPopup(this.createPopupContent(props));
            layer.on('click', () => this.showEventDetail(props));
            break;
            
          case 'Polygon':
            // 多边形交互处理
            layer.on({
              mouseover: e => this.highlightFeature(e),
              mouseout: e => this.resetFeatureStyle(e),
              click: () => this.showEventDetail(props)
            });
            break;
        }
      },
      // 新增多边形交互方法
      highlightFeature(e) {
        const layer = e.target;
        layer.setStyle({
          fillOpacity: 0.9,
          weight: 3
        });
      },
      resetFeatureStyle(e) {
        this.geoJsonLayer.resetStyle(e.target);
      },
  
      // 修改事件详情显示方法
      showEventDetail(props) {
        this.selectedEvent = {
          ...props,
          daily_info: JSON.parse(props.daily_info),
          geometry: this.findFeatureGeometry(props.event_id)
        };
        this.detailDialogVisible = true;
      },
  
      // 新增几何查找方法
      findFeatureGeometry(eventId) {
        return this.heatwaveEvents.find(
          e => e.properties.event_id === eventId
        )?.geometry;
      },
     // 修改 createPopupContent 方法
    createPopupContent(props) {
        const safeGet = (obj, prop, fallback = 'N/A') => 
          obj[prop] !== undefined ? obj[prop] : fallback;
  
        return `
          <div class="popup-content">
            <h3>事件 #${safeGet(props, 'event_id')}</h3>
            <div class="metric-row">
              <div class="metric-item">
                <label>开始时间</label>
                <div class="metric-value">${safeGet(props, 'start_date')}</div>
              </div>
              <div class="metric-item">
                <label>持续时间</label>
                <div class="metric-value">${safeGet(props, 'duration', 0)} 天</div>
              </div>
            </div>
            
            <div class="metric-row">
              <div class="metric-item highlight">
                <label>峰值强度</label>
                <div class="metric-value">
                  ${(safeGet(props, 'max_anomaly', 0)).toFixed(1)}°C
                </div>
              </div>
              <div class="metric-item highlight">
                <label>累积强度</label>
                <div class="metric-value">
                  ${(safeGet(props, 'cumulative_anomaly', 0)/1e3).toFixed(0)}k°C·天
                </div>
              </div>
            </div>
            
            <div class="metric-row">
              <div class="metric-item">
                <label>移动速度</label>
                <div class="metric-value">
                  ${safeGet(props, 'centroid_change_rate', 0).toFixed(1)} km/天
                </div>
              </div>
            </div>
            
            <div class="chart-container">
              <canvas class="mini-chart" width="300" height="100"></canvas>
            </div>
          </div>
        `;
      },
  
      attachMiniChart(layer, props) {
        const container = layer.getPopup()?.getElement();
        if (!container) return;
  
        const canvas = container.querySelector('.mini-chart');
        if (!canvas) return;
  
        const dailyData = JSON.parse(props.daily_info);
        new Chart(canvas, {
          type: 'line',
          data: {
            labels: dailyData.map(d => d.date.substr(5)),
            datasets: [{
              label: '每日异常',
              data: dailyData.map(d => d.max_anomaly),
              borderColor: '#d73027',
              tension: 0.3,
              fill: false
            }]
          },
          options: {
            responsive: false,
            plugins: {
              legend: { display: false },
              tooltip: { enabled: false }
            },
            scales: {
              x: { display: false },
              y: { 
                display: true,
                ticks: { color: '#666', font: { size: 8 } },
                grid: { color: 'rgba(0,0,0,0.1)' }
              }
            }
          }
        });
      },
  
      updateFilters() {
        console.log('当前筛选条件:', {
          timeRange: this.localTimeRange,
          minPeak: this.minPeakIntensity,
          cumulative: this.cumulativeRange
        });
  
        this.filteredEvents = this.heatwaveEvents.filter(event => {
          const props = event.properties;
          let rejectReason = [];
          
          // 时间筛选
          if (this.localTimeRange?.length === 2) {
            const start = new Date(this.localTimeRange[0]);
            const end = new Date(this.localTimeRange[1]);
            const eventStart = new Date(props.start_date);
       
    
            if(!(eventStart >= start&&eventStart <= end)) {
              rejectReason.push(`不在该时间段 (${props.start_date})`);
              console.log(`事件 ${props.event_id} 被过滤: 时间不在范围内`);
            }
          }
  
          // 峰值强度筛选
          if (props._peak < this.minPeakIntensity) {
            rejectReason.push(`峰值不足 (${props._peak} < ${this.minPeakIntensity})`);
          }
  
          // 累积强度筛选
          if (props._cumulative < this.cumulativeRange[0]) {
            rejectReason.push(`累积过低 (${props._cumulative} < ${this.cumulativeRange[0]})`);
          }
          if (props._cumulative > this.cumulativeRange[1]) {
            rejectReason.push(`累积过高 (${props._cumulative} > ${this.cumulativeRange[1]})`);
          }
  
          if (rejectReason.length > 0) {
            console.log(`事件 ${props.event_id} 被过滤:`, rejectReason.join(', '));
            return false;
          }
          return true;
        });
  
        console.log('最终通过数量:', this.filteredEvents.length);
        this.renderHeatwaveEvents();
      },
  
      // 修改热力图生成方法
      toggleHeatmap() {
        if (this.heatmapVisible) {
          if (this.heatmapLayer) this.map.removeLayer(this.heatmapLayer);
        } else {
          // 使用每日数据生成热力图
          const heatData = this.filteredEvents.flatMap(event => {
            try {
              const dailyData = JSON.parse(event.properties.daily_info);
              return dailyData.map(d => [
                d.centroid.lat,  // 纬度
                d.centroid.lon,  // 经度
                d.max_anomaly    // 值
              ]);
            } catch {
              return [];
            }
          });
          
          this.heatmapLayer = L.heatLayer(heatData, {
            radius: 25,
            blur: 15,
            gradient: {
              0.4: 'blue',
              0.6: 'lime',
              0.8: 'yellow',
              1: 'red'
            }
          }).addTo(this.map);
        }
        this.heatmapVisible = !this.heatmapVisible;
      },
  
      getLineStyle(item) {
        return {
          width: `${item.width}px`,
          backgroundColor: item.color,
          border: `1px solid ${item.color}`,
          borderStyle: item.dash ? 'dashed' : 'solid'
        };
      },
   
    }
  };
  </script>
  
  <style scoped>
  
  
  /* 新增加载动画样式 */
  .loading-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(255, 255, 255, 0.9);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .loading-text {
    font-size: 1.2em;
    color: #606266;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  
  /* 确保地图容器可见 */
  #map {
    border: 1px solid #ddd;
    background: #f8f9fa;
    min-height: 600px; /* 最小高度保证 */
  }
  
  /* 优化后的样式 */
  .task1-container {
    position: relative;
    height: 100vh;
    display: flex;
    flex-direction: column;
  }
  
  
  .filter-panel {
    padding: 15px;
    background: #f8f9fa;
    border-bottom: 1px solid #dee2e6;
    display: flex;
    gap: 20px;
    /* width: px; */
    
    flex-wrap: wrap;
    align-items: center;
  }
  
  .slider-group {
    flex: 1;
    display: flex;
    gap: 30px;
    min-width: 700px;
  }
  
  .slider-container {
    flex: 1;
    width:100px;
  }
  
  .slider-label {
    display: block;
    margin-bottom: 8px;
    font-size: 12px;
    color: #606266;
  }
  
  .btn-group {
    margin-left: auto;
    width: auto;
  }
  
  .legend-control {
    position: absolute;
    bottom: 20px;
    right: 20px;
    background: rgba(255, 255, 255, 0.95);
    padding: 15px;
    border-radius: 8px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.1);
    max-width: 200px;
  }
  
  .legend-section {
    margin-bottom: 15px;
  }
  
  .legend-title {
    font-weight: 600;
    margin-bottom: 8px;
    color: #303133;
    font-size: 12px;
  }
  
  .legend-item {
    display: flex;
    align-items: center;
    margin: 5px 0;
  }
  
  .legend-color {
    width: 20px;
    height: 15px;
    margin-right: 10px;
    border-radius: 3px;
  }
  
  .legend-line {
    display: inline-block;
    width: 30px;
    height: 2px;
    margin-right: 10px;
  }
  
  .legend-label {
    font-size: 12px;
    color: #606266;
  }
  </style>