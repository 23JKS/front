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
      
      <div class="slider-container">
        <span>最小累计强度：{{ minCumulativeIntensity }}</span>
        <el-slider
          v-model="minCumulativeIntensity"
          :min="0"
          :max="500"
          :step="5"
          @change="filterEvents"
        />
      </div>
      
      <div class="slider-container">
        <span>最小最大强度：{{ minMaxIntensity }}</span>
        <el-slider
          v-model="minMaxIntensity"
          :min="0"
          :max="50"
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

    <!-- 强度图例 -->
    <div class="legend intensity-legend">
      <div v-for="(item, index) in intensityRanges" :key="index" class="legend-item">
        <div class="color-box" :style="{ backgroundColor: item.color }"></div>
        <span>{{ item.label }}</span>
      </div>
    </div>
  </div>
</template>

<script>
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const GeoJSONFixer = {
  preprocess(str) {
    return str
      .replace(/'/g, '"')
      .replace(/None/g, 'null')
      .replace(/(\w+):/g, '"$1":')
      .replace(/(\d+\.\d+),\s*]/g, '$1]')
      .replace(/,(\s*[\]}])/g, '$1')
      .replace(/\(/g, '[').replace(/\)/g, ']')
      .replace(/(\d+),]/g, '$1]');
  },

  safeParse(str) {
    try {
      return JSON.parse(str);
    } catch (e) {
      const fixed = str
        .replace(/(\[[^[]+?)([,\]]*)$/g, '$1]')
        .replace(/},]/g, '}]');
      return JSON.parse(fixed);
    }
  }
};

// 强度颜色映射
const INTENSITY_COLORS = {
  low: '#4CAF50',    // 绿色 - 低强度
  medium: '#FFC107', // 黄色 - 中等强度
  high: '#F44336'    // 红色 - 高强度
};

export default {
  name: 'HeatwaveVisualization',
  data() {
    const defaultStart = new Date(2020, 6, 1);
    const defaultEnd = new Date(2020, 8, 31);
    return {
      currentAnimation: null,
      currentHighlight: null,
      isPlaying: false,
      animationProgress: 0,
      animationInterval: null,
      pathLayer: null,
      markerLayer: null,
      isMapInitialized: false,
      map: null,
      geoJsonLayer: null,
      timeRange: [
        defaultStart.toISOString().split('T')[0],
        defaultEnd.toISOString().split('T')[0]
      ],
      minDuration: 3,
      minCumulativeIntensity: 100, // 默认最小累计强度
      minMaxIntensity: 1,         // 默认最小最大强度
      allEvents: [],
      filteredEvents: [],
      intensityRanges: [
        { min: 0, max: 100, color: INTENSITY_COLORS.low, label: '低强度 (<100)' },
        { min: 100, max: 300, color: INTENSITY_COLORS.medium, label: '中等强度 (100-300)' },
        { min: 300, max: Infinity, color: INTENSITY_COLORS.high, label: '高强度 (>300)' }
      ]
    };
  },
  
  async mounted() {
    try {
      this.initMap();
      await this.loadData();
      this.filterEvents();
    } catch (error) {
      console.error('初始化失败:', error);
    }
  },
  
  methods: {
    toggleAnimation() {
      this.isPlaying = !this.isPlaying;
      if (this.isPlaying) {
        this.playNextStep();
      } else {
        clearInterval(this.animationInterval);
      }
    },
    
    showMovementAnimation(feature) {
      this.clearAnimation();
      
      const days = feature.properties.daily_info;
      if (!days || days.length < 2) return;

      const polygons = days.map(day => {
        try {
          return L.polygon(day.boundary.coordinates[0], {
            color: this.getIntensityColor(feature.properties.cumulative_intensity),
            weight: 2,
            opacity: 0.8,
            fillOpacity: 0.2
          });
        } catch (e) {
          console.warn('无效的边界数据:', day.boundary);
          return null;
        }
      }).filter(Boolean);

      const pathPoints = days.map(d => [d.centroid.lat, d.centroid.lon]);
      this.pathLayer = L.polyline(pathPoints, {
        color: '#ff0000',
        weight: 3
      }).addTo(this.map);

      const marker = L.marker(pathPoints[0], {
        icon: L.divIcon({
          className: 'animated-marker',
          html: '<div class="pulsing-dot"></div>',
          iconSize: [20, 20]
        })
      }).addTo(this.map);

      this.currentAnimation = {
        feature,
        currentIndex: 0,
        polygons,
        marker,
        currentPolygon: null
      };

      if (polygons.length > 0) {
        this.currentAnimation.currentPolygon = polygons[0].addTo(this.map);
      }

      this.toggleAnimation();
    },

    playNextStep() {
      if (!this.isPlaying) return;

      const anim = this.currentAnimation;
      const interval = 1000;

      this.animationInterval = setInterval(() => {
        if (anim.currentIndex < anim.polygons.length - 1) {
          if (anim.currentPolygon) {
            this.map.removeLayer(anim.currentPolygon);
          }
          
          anim.currentIndex++;
          anim.currentPolygon = anim.polygons[anim.currentIndex].addTo(this.map);
          
          const point = anim.feature.properties.daily_info[anim.currentIndex].centroid;
          anim.marker.setLatLng([point.lat, point.lon]);
          this.animationProgress = (anim.currentIndex / (anim.polygons.length - 1)) * 100;
        } else {
          this.stopAnimation();
        }
      }, interval);
    },
   
    stopAnimation() {
      this.isPlaying = false;
      clearInterval(this.animationInterval);
      this.animationProgress = 0;
      this.currentAnimation = null;
    },

    clearAnimation() {
      if (this.pathLayer) this.map.removeLayer(this.pathLayer);
      if (this.currentAnimation) {
        if (this.currentAnimation.marker) this.map.removeLayer(this.currentAnimation.marker);
        if (this.currentAnimation.currentPolygon) this.map.removeLayer(this.currentAnimation.currentPolygon);
        this.currentAnimation.polygons?.forEach(p => this.map.removeLayer(p));
      }
      this.stopAnimation();
    },

    async loadData() {
      try {
        const response = await fetch('/data/final_heatwaves.geojson');
        const data = await response.json();

        this.allEvents = data.features.map(feature => {
          if (!feature?.properties) return null;
          const props = feature.properties;

          // 解析 daily_info
          let dailyInfo = [];
          try {
            const rawStr = props.daily_info || '[]';
            const processed = GeoJSONFixer.preprocess(rawStr);
            const chunkPattern = /\{"date".*?\}(?=\s*,?\s*\{)/g;
            const chunks = processed.match(chunkPattern) || [];
            
            dailyInfo = chunks.map(chunk => {
              try {
                const completeChunk = chunk.replace(/(\])*$/, ']');
                return GeoJSONFixer.safeParse(completeChunk + ']');
              } catch (e) {
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
            dailyInfo = this.fallbackParse(props.daily_info);
          }

          // 确保强度数据存在，否则设为0
          const cumulativeIntensity = Number(props.cumulative_anomaly) || 0;
          const maxIntensity = Number(props.max_anomaly) || 0;

          return {
            ...feature,
            properties: {
              event_id: props.event_id,
              start_date: new Date(props.start_date),
              duration: Number(props.duration) || 0,
              daily_info: dailyInfo,
              cumulative_intensity: cumulativeIntensity,
              max_intensity: maxIntensity,
              centroid: dailyInfo.length > 0 ? dailyInfo[0].centroid : null
            }
          };
        }).filter(event => 
          event?.properties?.daily_info?.length > 0
        );

        console.log('有效事件数:', this.allEvents.length);
        this.initMap();
        this.filterEvents();

      } catch (error) {
        console.error('数据加载失败:', error);
      }
    },

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
    
    initMap() {
      if (this.map) return;

      const container = document.getElementById('map-container');
      container.style.width = '100%';
      container._leaflet_id = null;
      
      this.map = L.map('map-container', {
        zoomControl: false,
        preferCanvas: true,
        dragging: true,
      }).setView([30, 140], 4);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(this.map);
      
      this.map.on('touchstart', (e) => {
        if (e.originalEvent.touches.length === 1) {
          this.map.dragging.enable();
        }
      });
      
      L.control.zoom({ position: 'topright' }).addTo(this.map);
      this.isMapInitialized = true;
    },
    
    renderEvents() {
      if (!this.map || typeof this.map.addLayer !== 'function') {
        console.error('地图实例异常');
        return;
      }

      if (this.geoJsonLayer) {
        this.geoJsonLayer.remove();
        this.geoJsonLayer = null;
      }

      if (!this.filteredEvents?.length) return;

      this.geoJsonLayer = L.geoJSON(this.filteredEvents, {
        coordsToLatLng: (coords) => {
          if (Array.isArray(coords) && coords.length >= 2) {
            return L.latLng(coords[1], coords[0]);
          }
          return L.latLng(0, 0);
        },
        style: (feature) => ({
          color: this.getIntensityColor(feature.properties.cumulative_intensity),
          weight: 2,
          opacity: 0.8,
          fillOpacity: 0.2
        }),
        onEachFeature: (feature, layer) => {
          if (feature.properties) {
            layer.bindPopup(this.createPopupContent(feature.properties));
          }
          
          const originalStyle = {
            color: this.getIntensityColor(feature.properties.cumulative_intensity),
            weight: 2,
            opacity: 0.8
          };
          layer.setStyle(originalStyle);
          layer.originalStyle = originalStyle;

          layer.on('click', () => {
            if (this.currentHighlight) {
              this.currentHighlight.setStyle(this.currentHighlight.originalStyle);
            }
            
            layer.setStyle({
              color: layer.originalStyle.color,
              weight: 5,
              opacity: 1
            });
            
            this.currentHighlight = layer;
          });
          
          // 可选：添加鼠标悬停效果
          layer.on('mouseover', () => {
            layer.setStyle({
              color: layer.originalStyle.color,
              weight: 3,
              opacity: 1
            });
          });
          
          layer.on('mouseout', () => {
            if (this.currentHighlight !== layer) {
              layer.setStyle(layer.originalStyle);
            }
          });
        }
      }).addTo(this.map);

      this.safeFitBounds();
    },

    filterEvents() {
        if (!this.allEvents.length) return;

        const [startDate, endDate] = this.timeRange.map(d => new Date(d));
        
        // 调试输出
        console.log('当前过滤条件:', {
          minDuration: this.minDuration,
          minCumulativeIntensity: this.minCumulativeIntensity,
          minMaxIntensity: this.minMaxIntensity,
          timeRange: this.timeRange
        });

        this.filteredEvents = this.allEvents.filter(event => {
          const props = event.properties;
          
          // 调试输出每个事件的属性
          console.log('检查事件:', {
            id: props.event_id,
            duration: props.duration,
            cumulative_intensity: props.cumulative_intensity,
            max_intensity: props.max_intensity,
            start_date: props.start_date
          });

          // 持续时间筛选
          const duration = Number(props.duration) || 0;
          if (duration < this.minDuration) {
            console.log(`事件 ${props.event_id} 因持续时间 ${duration} < ${this.minDuration} 被过滤`);
            return false;
          }

          // 累计强度筛选
          if (props.cumulative_intensity < this.minCumulativeIntensity) {
            console.log(`事件 ${props.event_id} 因累计强度 ${props.cumulative_intensity} < ${this.minCumulativeIntensity} 被过滤`);
            return false;
          }
          
          // 最大强度筛选
          if (props.max_intensity < this.minMaxIntensity) {
            console.log(`事件 ${props.event_id} 因最大强度 ${props.max_intensity} < ${this.minMaxIntensity} 被过滤`);
            return false;
          }

          // 时间范围筛选
          const eventStart = new Date(props.start_date);
          const eventEnd = new Date(eventStart);
          eventEnd.setDate(eventStart.getDate() + duration);
          
          const timeValid = (
            eventEnd >= startDate && 
            eventStart <= endDate &&
            !isNaN(eventStart.getTime())
          );
          
          if (!timeValid) {
            console.log(`事件 ${props.event_id} 因时间范围 ${eventStart} 到 ${eventEnd} 不在 ${startDate} 至 ${endDate} 之间被过滤`);
          }
          
          return timeValid;
        });

        console.log('过滤结果:', {
          original: this.allEvents.length,
          filtered: this.filteredEvents.length
        });
        
        // 如果没有过滤结果，尝试放宽条件测试
        if (this.filteredEvents.length === 0) {
          console.warn('没有匹配的事件，尝试放宽条件...');
          const testFiltered = this.allEvents.filter(e => e.properties.duration >= 1);
          console.log('仅按持续时间>=1天过滤结果:', testFiltered.length);
        }

        this.renderEvents();
      },
    // 根据累计强度获取颜色
    getIntensityColor(intensity) {
      return this.intensityRanges.find(range => 
        intensity >= range.min && intensity < range.max
      )?.color || '#999';
    },

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
          
          <div>🔥 累计强度:</div>
          <div>${properties.cumulative_intensity.toFixed(1)}</div>
          
          <div>💥 最大强度:</div>
          <div>${properties.max_intensity.toFixed(1)}</div>
          
          <div>📍 初始位置:</div>
          <div>
            ${ centroid ? `${centroid.lat.toFixed(2)}°N, ${centroid.lon.toFixed(2)}°E` : '未知' }
          </div>
        </div>
      </div>
    `;
    },

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
.leaflet-polygon {
  transition: opacity 0.5s ease-in-out;
}

.animated-marker .pulsing-dot {
  width: 20px;
  height: 20px;
  background: #ff0000;
  border-radius: 50%;
  animation: pulse 1.5s infinite;
  box-shadow: 0 0 0 0 rgba(255, 0, 0, 0.7);
}

@keyframes pulse {
  0% { transform: scale(0.8); }
  70% { transform: scale(1); box-shadow: 0 0 0 10px rgba(255,0,0,0); }
  100% { transform: scale(0.8); }
}

.animation-control {
  margin-top: 16px;
  padding: 12px;
  background: rgba(255,255,255,0.9);
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.heatwave-vis {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

#map-container {
  touch-action: none;
  z-index: 1;
  pointer-events: auto !important;
  height: 600px;
  width: 100%;
  background: #f0f2f5;
  position: relative;
}

.control-panel {
  padding: 16px;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  display: flex;
  gap: 24px;
  align-items: center;
  flex-wrap: wrap;
}

.slider-container {
  width: 300px;
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

.control-panel {
  position: relative;
  z-index: 2;
  pointer-events: auto;
}

.leaflet-container a.leaflet-control-attribution-leaflet {
  pointer-events: none !important;
}
</style>