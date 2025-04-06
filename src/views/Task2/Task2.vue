<template>
  <div class="heatwave-vis">
    <!-- 控制面板 -->
    <div class="control-panel">

      <div class="heatmap-control">
        <el-tooltip content="基于事件密度生成热力图" placement="top">
          <el-switch
            v-model="showHeatmap"
            active-text="热力图"
            @change="toggleHeatmap"
          />
        </el-tooltip>
        
        <div v-if="showHeatmap" class="heatmap-options">
          <el-radio-group v-model="heatmapType" size="small">
            <el-radio-button label="density">事件密度</el-radio-button>
            <el-radio-button label="intensity">强度分布</el-radio-button>
          </el-radio-group>
          
          <el-slider
            v-model="heatmapRadius"
            :min="10"
            :max="50"
            :step="5"
            label="热力半径"
            @change="updateHeatmap"
          />
        </div>
      </div>


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
    </div>

    <!-- 地图容器 -->
    <div id="map-container"></div>

    <!-- 在模板部分修改图例部分 -->
    <div class="legend-container">
      <!-- 强度图例只在非热力图模式显示 -->
      <div v-if="!showHeatmap" class="legend intensity-legend">
        <h4>事件强度</h4>
        <div v-for="(item, index) in intensityRanges" :key="index" class="legend-item">
          <div class="color-box" :style="{ backgroundColor: item.color }"></div>
          <span>{{ item.label }}</span>
        </div>
      </div>

      <!-- 热力图例单独显示 -->
      <div v-if="showHeatmap" class="legend heat-legend">
        <h4>{{ heatLegendTitle }}</h4>
        <div class="legend-scale">
          <div class="gradient-bar"></div>
          <div class="scale-labels">
            <span>低</span>
            <span>高</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat/dist/leaflet-heat.js';
const GeoJSONFixer = {
  preprocess(str) {
    return str
      .replace(/'/g, '"')
      .replace(/None/g, 'null')
      .replace(/(\w+):/g, '"$1":')
      .replace(/(\d+\.\d+),\s*]/g, '$1]')
      .replace(/,(\s*[\]}])/g, '$1')
      .replace(/$/g, '[').replace(/$/g, ']')
      .replace(/(\d+),]/g, '$1]');
  },

  safeParse(str) {
    try {
      return JSON.parse(str);
    } catch (e) {
      const fixed = str
        .replace(/($$[^[]+?)([,$$]*)$/g, '$1]')
        .replace(/},]/g, '}]');
      return JSON.parse(fixed);
    }
  }
};

const INTENSITY_COLORS = {
  low: '#4CAF50',
  medium: '#FFC107',
  high: '#F44336'
};

export default {
  name: 'HeatwaveVisualization',
  data() {
    const defaultStart = new Date(2020, 5, 1);
    const defaultEnd = new Date(2020, 7, 31);
    return {
         // 新增热力图相关数据
      showHeatmap: false,
      heatLayer: null,
      heatmapType: 'density', // density｜intensity
      heatmapRadius: 25,
      heatmapGradient: {
        0.4: 'blue',
        0.6: 'lime',
        0.9: 'red'
      },

      currentHighlight: null,
      isMapInitialized: false,
      map: null,
      geoJsonLayer: null,
      timeRange: [
        defaultStart.toISOString().split('T')[0],
        defaultEnd.toISOString().split('T')[0]
      ],
      minDuration: 3,
      minCumulativeIntensity: 100,
      minMaxIntensity: 1,
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
    await this.initHeatPlugin();
    this.initMap();
    await this.loadData();
    this.filterEvents();
  } catch (error) {
    console.error('初始化失败:', error);
  }
  },
  computed: {
    heatLegendTitle() {
      return this.heatmapType === 'density' 
        ? '事件密度热力分布' 
        : '强度分布热力图';
    }
  },
  methods: {
    async initHeatPlugin() {
      if (typeof window !== 'undefined') {
        await import('leaflet.heat/dist/leaflet-heat.js');
      }
    },
    // 生成热力图数据点
    generateHeatmapData() {
      return this.filteredEvents.flatMap(event => {
        const baseIntensity = event.properties.cumulative_intensity;
        return event.properties.daily_info.map(day => {
          const weight = this.heatmapType === 'intensity' 
            ? day.intensity / baseIntensity
            : 1;
            
          return [
            day.centroid.lat,
            day.centroid.lon,
            weight * 0.5 // 强度权重系数
          ];
        });
      });
    },
    
     // 切换热力图显示
    // 修改后的切换热力图方法
    toggleHeatmap() {
      if (this.showHeatmap) {
        // 移除原有热浪多边形
        if (this.geoJsonLayer) {
          this.map.removeLayer(this.geoJsonLayer);
          this.geoJsonLayer = null;
        }

        const points = this.generateHeatmapData();
        this.heatLayer = L.heatLayer(points, {
          radius: this.heatmapRadius,
          blur: 15,
          gradient: this.heatmapGradient,
          maxZoom: 9
        }).addTo(this.map);
        this.addHeatLegend();
      } else {
        // 关闭热力图时重新渲染多边形
        this.heatLayer?.remove();
        this.heatLayer = null;
        this.removeHeatLegend();
        this.renderEvents(); // 重新显示热浪多边形
      }
    },

     // 更新热力图参数
     updateHeatmap() {
      if (this.heatLayer) {
        this.heatLayer.setOptions({
          radius: this.heatmapRadius,
          gradient: this.heatmapGradient
        });
        this.heatLayer.redraw();
      }
    },

    // 修改addHeatLegend方法
    addHeatLegend() {
      this.removeHeatLegend(); // 先移除旧图例
      
      this.heatLegend = L.control({ position: 'bottomleft' });
      
      this.heatLegend.onAdd = () => {
        const div = L.DomUtil.create('div', 'heat-legend');
        div.innerHTML = `
          <h4>${this.heatLegendTitle}</h4>
          <div class="legend-scale">
            <div style="background:linear-gradient(to right, 
              ${this.heatmapGradient[0.4]}, 
              ${this.heatmapGradient[0.6]}, 
              ${this.heatmapGradient[0.9]})"></div>
            <span>低</span><span>高</span>
          </div>
        `;
        return div;
      };
      
      this.heatLegend.addTo(this.map);
    },
    // 添加watch监听
    watch: {
      heatmapType() {
        if (this.showHeatmap) {
          this.addHeatLegend(); // 切换类型时更新图例
        }
      }
    },
    // 移除图例
    removeHeatLegend() {
      this.heatLegend?.remove();
    },
    async loadData() {
      try {
        const response = await fetch('/data/final_heatwaves.geojson');
        const data = await response.json();

        this.allEvents = data.features.map(feature => {
          if (!feature?.properties) return null;
          const props = feature.properties;

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
      if (this.showHeatmap) return; // 热力图模式下不渲染多边形
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
        
        this.filteredEvents = this.allEvents.filter(event => {
          const props = event.properties;
          
          const duration = Number(props.duration) || 0;
          if (duration < this.minDuration) return false;
          if (props.cumulative_intensity < this.minCumulativeIntensity) return false;
          if (props.max_intensity < this.minMaxIntensity) return false;

          const eventStart = new Date(props.start_date);
          const eventEnd = new Date(eventStart);
          eventEnd.setDate(eventStart.getDate() + duration);
          
          return (
            eventEnd >= startDate && 
            eventStart <= endDate &&
            !isNaN(eventStart.getTime())
          );
        });

         // 热力图模式下不渲染多边形
        if (!this.showHeatmap) {
          this.renderEvents();
        }
        // 热力图模式下需要更新热力数据
        else if (this.heatLayer) {
          const points = this.generateHeatmapData();
          this.heatLayer.setLatLngs(points);
          this.heatLayer.redraw();
        }
      },

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
          <div>${ centroid ? `${centroid.lat.toFixed(2)}°N, ${centroid.lon.toFixed(2)}°E` : '未知' }</div>
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
/* 修改/添加以下样式 */
.legend-container {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 1000;
  background: rgba(255, 255, 255, 0.9);
  padding: 12px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  min-width: 160px;
}

/* 统一图例标题样式 */
.legend h4 {
  margin: 0 0 10px;
  font-size: 14px;
  color: #333;
  font-weight: 600;
}

/* 强度图例样式 */
.intensity-legend .legend-item {
  display: flex;
  align-items: center;
  margin: 6px 0;
  gap: 8px;
}

/* 热力图例渐变条 */
.heat-legend .gradient-bar {
  height: 10px;
  width: 100%;
  border-radius: 4px;
  background: linear-gradient(
    to right,
    v-bind('heatmapGradient[0.4]'),
    v-bind('heatmapGradient[0.6]'),
    v-bind('heatmapGradient[0.9]')
  );
  transition: background 0.3s ease;
}

/* 热力刻度标签 */
.heat-legend .scale-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  font-size: 12px;
  color: #666;
}

/* 颜色块统一样式 */
.color-box {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  flex-shrink: 0;
}

/* 响应式调整 */
@media (max-width: 768px) {
  .legend-container {
    bottom: 10px;
    right: 10px;
    padding: 8px;
  }
  
  .legend h4 {
    font-size: 13px;
  }
  
  .scale-labels,
  .legend-item span {
    font-size: 11px;
  }
}

.heatmap-control {
  margin-left: 20px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.heatmap-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: rgba(255,255,255,0.8);
  padding: 8px;
  border-radius: 4px;
}

.heat-legend {
  background: rgba(255,255,255,0.9);
  padding: 10px;
  border-radius: 4px;
  box-shadow: 0 1px 5px rgba(0,0,0,0.2);
}

.heat-legend h4 {
  margin: 0 0 5px;
  font-size: 14px;
}

.legend-scale div {
  height: 10px;
  width: 150px;
  margin: 2px 0;
}

.legend-scale span {
  display: inline-block;
  width: 50%;
  font-size: 12px;
  text-align: center;
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
  height: 1000px;
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

.leaflet-container a.leaflet-control-attribution-leaflet {
  pointer-events: none !important;
}
</style>