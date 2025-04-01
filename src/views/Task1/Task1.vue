<template>
  <div class="heatwave-vis">
    <!-- 控制面板 -->
    <div class="control-panel">
      <el-date-picker
        v-model="timeRange"
        type="daterange"
        range-separator="至"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        value-format="YYYY-MM-DD"
        @change="filterEvents"
      />
      
      <div class="slider-container">
        <span>最小持续时间：{{ minDuration }}天</span>
        <el-slider
          v-model="minDuration"
          :min="1"
          :max="90"
          :step="1"
          @change="filterEvents"
        />
      </div>
      <div class="animation-control" v-if="currentAnimation">
        <el-slider
          v-model="animationProgress"
          :min="0"
          :max="100"
          :step="1"
          @change="updateAnimationPosition"
        />
        <el-button-group>
          <el-button @click="toggleAnimation">
            {{ isPlaying ? '暂停' : '播放' }}
          </el-button>
          <el-button @click="stopAnimation">停止</el-button>
        </el-button-group>
      </div>

    </div>

    <!-- 地图容器 -->
    <div id="map-container"></div>

    <!-- 速度图例 -->
    <div class="legend speed-legend">
      <div v-for="(item, index) in speedRanges" :key="index" class="legend-item">
        <div class="color-box" :style="{ backgroundColor: item.color }"></div>
        <span>{{ item.label }}</span>
      </div>
    </div>
  </div>
</template>

<script>
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';


// 升级版 GeoJSONFixer
const GeoJSONFixer = {
  preprocess(str) {
    return str
      .replace(/'/g, '"')
      .replace(/None/g, 'null')
      .replace(/(\w+):/g, '"$1":')
      // 修复坐标数组中的非法逗号 (172.1, 45.2],] => 172.1,45.2]]
      .replace(/(\d+\.\d+),\s*]/g, '$1]')
      // 移除多余逗号 [[1,2],,] => [[1,2]]
      .replace(/,(\s*[\]}])/g, '$1')
      // 修复多级数组闭合问题 ((( => [[[ 
      .replace(/\(/g, '[').replace(/\)/g, ']')
      // 处理数字后的非法逗号 123,] => 123]
      .replace(/(\d+),]/g, '$1]');
  },

  // 安全解析方法
  safeParse(str) {
    try {
      return JSON.parse(str);
    } catch (e) {
      // 尝试修复未闭合的数组
      const fixed = str
        .replace(/(\[[^[]+?)([,\]]*)$/g, '$1]')
        .replace(/},]/g, '}]');
      return JSON.parse(fixed);
    }
  }
};
// 速度颜色映射
const SPEED_COLORS = {
  low: '#4CAF50',
  medium: '#FFC107',
  high: '#F44336'
};

export default {
  name: 'HeatwaveVisualization',
  data() {
    // 设置2020年6月1日 - 8月31日作为默认时间范围
  const defaultStart = new Date(2020, 6, 1)  // 2020-06-01
  const defaultEnd = new Date(2020, 8, 31)   // 2020-09-30
    return {
      isMapInitialized: false ,// 新增地图初始化状态标记,
      map: null,
      geoJsonLayer: null,
      timeRange: [defaultStart.toISOString().split('T')[0],
      defaultEnd.toISOString().split('T')[0]],
      minDuration: 3,
      allEvents: [],
      filteredEvents: [],
      speedRanges: [
        { min: 0, max: 25, color: SPEED_COLORS.low, label: '低速 (<25 km/d)' },
        { min: 25, max: 50, color: SPEED_COLORS.medium, label: '中速 (25-50 km/d)' },
        { min: 50, max: Infinity, color: SPEED_COLORS.high, label: '高速 (>50 km/d)' }
      ]
    };
  },
  // 修改后的初始化方法
  async mounted() {
      try {
        // 先初始化地图
        this.initMap();
        
        // 再加载数据
        await this.loadData();
        
        // 最后过滤事件
        this.filterEvents();

        console.log('初始化完成');
      } catch (error) {
        console.error('初始化失败:', error);
      }
    },
  methods: {

  

   // 数据加载方法重构
   // 修改后的 loadData 方法
    async loadData() {
      try {
        const response = await fetch('/data/final_heatwaves.geojson');
        const data = await response.json();

        this.allEvents = data.features.map(feature => {
          if (!feature?.properties) return null;
          const props = feature.properties;

          // 容错解析 daily_info
          let dailyInfo = [];
          try {
            const rawStr = props.daily_info || '[]';
            const processed = GeoJSONFixer.preprocess(rawStr);
            
            // 分块解析策略
            const chunkPattern = /\{"date".*?\}(?=\s*,?\s*\{)/g;
            const chunks = processed.match(chunkPattern) || [];
            
            dailyInfo = chunks.map(chunk => {
              try {
                // 补全闭合括号
                const completeChunk = chunk.replace(/(\])*$/, ']');
                return GeoJSONFixer.safeParse(completeChunk + ']');
              } catch (e) {
                // 终极回退：正则提取关键数据
                const dateMatch = chunk.match(/"date": "(\d{4}-\d{2}-\d{2})"/);
                const centroidMatch = chunk.match(/"centroid": \{"lon": ([\d.]+), "lat": ([\d.]+)\}/);
                
                return dateMatch && centroidMatch ? {
                  date: dateMatch[1],
                  centroid: {
                    lon: parseFloat(centroidMatch[1]),
                    lat: parseFloat(centroidMatch[2])
                  }
                } : null;
              }
            }).filter(Boolean);

          } catch (e) {
            console.warn(`事件 ${props.event_id} daily_info 解析失败，使用备用方案:`, e);
            // 备用解析：仅提取基础信息
            dailyInfo = this.fallbackParse(props.daily_info);
          }

          // 构建有效事件 (即使部分数据缺失)
          return {
            ...feature,
            properties: {
              event_id: props.event_id,
              start_date: new Date(props.start_date),
              duration: Number(props.duration) || 0,
              daily_info: dailyInfo,
              speed: this.calculateSpeed(dailyInfo, props.duration),
              centroid: dailyInfo.length > 0 ? dailyInfo[0].centroid : null
            }
          };
        }).filter(event => 
          event?.properties?.daily_info?.length > 0 // 保留有至少一天数据的事件
        );

        console.log('有效事件数:', this.allEvents.length);
        this.initMap();
        this.filterEvents();

      } catch (error) {
        console.error('数据加载失败:', error);
      }
    },

   // 增强的备用解析
    fallbackParse(str) {
      const results = [];
      const pattern = /"date": "(\d{4}-\d{2}-\d{2})".*?"lon": ([\d.]+).*?"lat": ([\d.]+)/g;
      
      let match;
      while ((match = pattern.exec(str)) !== null) {
        results.push({
          date: match[1],
          centroid: {
            lon: parseFloat(match[2]),
            lat: parseFloat(match[3])
          }
        });
      }
      return results;
    },
    // 计算移动速度
    calculateSpeed(dailyInfo, duration) {
      if (!dailyInfo || dailyInfo.length < 2 || duration < 1) return 0;

      let totalDistance = 0;
      for (let i = 1; i < dailyInfo.length; i++) {
        const prev = dailyInfo[i-1].centroid;
        const curr = dailyInfo[i].centroid;
        
        if (!prev || !curr) continue;

        totalDistance += this.haversineDistance(
          [prev.lon, prev.lat],
          [curr.lon, curr.lat]
        );
      }
      return totalDistance / duration;
    },


    // 哈弗辛公式计算距离
    haversineDistance(coord1, coord2) {
      const R = 6371; // 地球半径(km)
      const dLat = this.toRadians(coord2[1] - coord1[1]);
      const dLon = this.toRadians(coord2[0] - coord1[0]);
      
      const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(this.toRadians(coord1[1])) * 
        Math.cos(this.toRadians(coord2[1])) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
        
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    },

    toRadians(degrees) {
      return degrees * Math.PI / 180;
    },

    // 初始化地图
     // 强化的地图初始化
     initMap() {
        // 清理旧地图
        if (this.map) return;

        // 创建前强制重置容器
        const container = document.getElementById('map-container');
        container.style.width = '100%';
        container._leaflet_id = null; // 清除leaflet缓存
        // 创建新地图实例
        this.map = L.map('map-container', {
          zoomControl: false,
          preferCanvas: true,
          // zoomControl: false,
          dragging: true, // 显式启用拖动
      
        }).setView([30, 140], 4);

        // 添加底图
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors'
        }).addTo(this.map);
        
        // 添加触摸事件监听修复
        this.map.on('touchstart', (e) => {
          if (e.originalEvent.touches.length === 1) {
            this.map.dragging.enable();
          }
        });
        // 添加控件
        L.control.zoom({ position: 'topright' }).addTo(this.map);
        this.isMapInitialized = true;
    },
   // 增强的渲染方法
   renderEvents() {
      if (!this.map || typeof this.map.addLayer !== 'function') {
        console.error('地图实例异常');
        return;
      }

      // 清理旧图层
      if (this.geoJsonLayer) {
        this.geoJsonLayer.remove();
        this.geoJsonLayer = null;
      }

      // 空数据检查
      if (!this.filteredEvents?.length) return;

      // 创建新图层
      this.geoJsonLayer = L.geoJSON(this.filteredEvents, {
        coordsToLatLng: (coords) => {
          // 坐标有效性检查
          if (Array.isArray(coords) && coords.length >= 2) {
            return L.latLng(coords[1], coords[0]);
          }
          return L.latLng(0, 0);
        },
        style: (feature) => ({
          color: this.getSpeedColor(feature.properties.speed),
          weight: 2,
          opacity: 0.8,
          fillOpacity: 0.2
        }),
        onEachFeature: (feature, layer) => {
          // 弹窗绑定
          if (feature.properties) {
            layer.bindPopup(this.createPopupContent(feature.properties));
          }
          
          // 轨迹绘制
          // if (feature.properties?.daily_info?.length > 1) {
          //   const path = this.createMovementPath(feature);
          //   path.addTo(this.map);  // 直接添加到地图
          // }
        }
      }).addTo(this.map);

      // 自适应视图
      this.safeFitBounds();
    },

    // 事件筛选
   // 事件过滤方法加强
    filterEvents() {
      if (!this.allEvents.length) return;

      const [startDate, endDate] = this.timeRange.map(d => new Date(d));
      
      this.filteredEvents = this.allEvents.filter(event => {
        const props = event.properties;
        
        // 持续时间筛选（类型安全）
        const duration = Number(props.duration) || 0;
        if (duration < this.minDuration) return false;

        // 时间范围筛选（日期有效性检查）
        const eventStart = new Date(props.start_date);
        const eventEnd = new Date(eventStart);
        eventEnd.setDate(eventStart.getDate() + duration);
        
        return (
          eventEnd >= startDate && 
          eventStart <= endDate &&
          !isNaN(eventStart.getTime())
        );
      });

      console.log('过滤结果:', {
        original: this.allEvents.length,
        filtered: this.filteredEvents.length
      });
      this.renderEvents();
    },

    // 创建移动轨迹路径
    createMovementPath(feature) {
      const points = feature.properties.daily_info
        .map(d => [d.centroid.lat, d.centroid.lon]); // 确保坐标顺序正确
      
      return L.polyline(points, {
        color: '#ff0000', // 临时使用醒目颜色
        weight: 3,
        opacity: 0.9
      });
    },

    // 获取速度对应的颜色
    getSpeedColor(speed) {
      return this.speedRanges.find(range => 
        speed >= range.min && speed < range.max
      )?.color || '#999';
    },

    // 创建弹窗内容
    createPopupContent(properties) {
      const centroid = properties.centroid;
      return `
      <div class="event-popup">
        <h4>事件 #${properties.event_id}</h4>
        <div class="popup-grid">
          <div>📅 开始日期:</div>
          <div>${properties.start_date.toLocaleDateString()}</div>
          
          <div>⏳ 持续时间:</div>
          <div>${properties.duration} 天</div>
          
          <div>🚀 移动速度:</div>
          <div>${properties.speed.toFixed(1)} km/d</div>
          
          <div>📍 初始位置:</div>
          <div>
            ${ centroid ? `${centroid.lat.toFixed(2)}°N, ${centroid.lon.toFixed(2)}°E` : '未知' }
          </div>
        </div>
      </div>
    `;
    },

    // 处理地图缩放
    safeFitBounds() {
      if (this.geoJsonLayer) {
        const bounds = this.geoJsonLayer.getBounds();
        if (bounds.isValid()) {
          this.map.fitBounds(bounds, { padding: [30, 30] });
        }
      }
    }
  },
  beforeUnmount() {
    // 彻底清理地图
    if (this.map) {
      this.map.eachLayer(layer => layer.remove());
      this.map.remove();
      this.map = null;
    }
    this.isMapInitialized = false;
  }
};
</script>

<style scoped>
.heatwave-vis {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

#map-container {
  touch-action: none; /* 禁用浏览器默认触摸行为 */
  z-index: 1; /* 确保地图在最上层 */
  pointer-events: auto !important; /* 强制启用交互 */
  height: 600px; /* 确保明确的高度 */
  width: 100%;
  background: #f0f2f5;
  position: relative; /* 修复定位问题 */
}

.control-panel {
  padding: 16px;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  display: flex;
  gap: 24px;
  align-items: center;
}

.slider-container {
  width: 500px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.legend {
  position: fixed;
  bottom: 20px;
  right: 20px;
  background: rgba(255,255,255,0.9);
  padding: 12px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  z-index: 1000;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0;
}

.color-box {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: 1px solid rgba(0,0,0,0.1);
}

.event-popup {
  max-width: 280px;
}

.popup-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 12px;
  margin-top: 8px;
}

.popup-grid > div:nth-child(odd) {
  font-weight: 500;
  color: #666;
}
/* 修复ElementUI组件可能导致的覆盖问题 */
.control-panel {
  position: relative;
  z-index: 2; /* 保持控制面板在地图之上 */
  pointer-events: auto; /* 允许操作控件 */
}

/* 禁用leaflet的捕捉提示干扰 */
.leaflet-container a.leaflet-control-attribution-leaflet {
  pointer-events: none !important;
}
</style>