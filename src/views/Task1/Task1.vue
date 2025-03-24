<template>
  <div class="task1-container">
   <!-- 筛选控制面板 -->
   <div class="filter-panel">
      <el-date-picker
        v-model="timeRange"
        type="daterange"
        range-separator="至"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        @change="updateTimeRange"
      />
      
      <!-- 异常值筛选滑动条 -->
      <div class="slider-container">
        
        <el-slider
          v-model="minAnomaly"
          :min="2"
          :max="10"
          :step="0.5"
          show-input
          @change="updateAnomaly"
        />
      </div>

      <el-button @click="drawArea">绘制筛选区域</el-button>
    </div>
    <div id="map" style="height: 800px; width: 100%;"></div>
    
    <!-- 图例控件 -->
    <div class="legend-control" v-if="map">
      <div class="legend-title">温度异常 (°C)</div>
      <div class="legend-scale">
        <div v-for="(item, index) in legendItems" :key="index" class="legend-item">
          <span class="legend-color" :style="{backgroundColor: item.color}"></span>
          <span class="legend-label">{{ item.label }}</span>
        </div>
      </div>
    </div>
     <!-- 历史记录面板 -->
  
  </div>
 
</template>

<script>
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export default {
  name: 'TaskOne',
  data() {
    return {
      map: null,
      heatwaveEvents: [],
      geoJsonLayer: null,
      isMapInitialized: false,
      mapAnimationFrame: null,
      legendItems: [
        { color: '#fee08b', label: '5-6' },
        { color: '#fc8d59', label: '6-7' },
        { color: '#d73027', label: '>7' }
      ]
    };
  },
  mounted() {
    this.initializeMap();
  },
  beforeUnmount() {
    this.cleanupMap();
  },
  methods: {
    initializeMap() {
      if (!this.isMapInitialized) {
        this.initMap();
        this.loadHeatwaveData().then(() => {
          this.renderHeatwaveEvents();
        });
      }
    },

    initMap() {
      const mapContainer = document.getElementById('map');
      if (mapContainer && !mapContainer._leaflet_id) {
        this.map = L.map('map', {
          zoomControl: false,
          preferCanvas: true
        }).setView([30, 140], 4);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors'
        }).addTo(this.map);

        L.control.zoom({
          position: 'topright'
        }).addTo(this.map);

        this.isMapInitialized = true;
      }
    },

    async loadHeatwaveData() {
      try {
        const response = await fetch('/data/marine_heatwaves_2020.geojson');
        if (!response.ok) throw new Error('Network response was not ok');
        
        const data = await response.json();
        this.heatwaveEvents = Array.isArray(data.features) ? data.features : [];
        
        if (!this.heatwaveEvents.length) {
          console.warn('No valid heatwave events found');
        }
      } catch (error) {
        console.error('数据加载失败:', error);
        throw error;
      }
    },

    renderHeatwaveEvents() {
      if (!this.map || !this.heatwaveEvents.length) return;

      if (this.geoJsonLayer) {
        this.geoJsonLayer.remove();
      }

      this.geoJsonLayer = L.geoJSON(this.heatwaveEvents, {
        style: feature => ({
          fillColor: this.getColor(feature.properties.max_anomaly),
          weight: 1,
          opacity: 0.8,
          color: 'white',
          fillOpacity: 0.7
        }),
        onEachFeature: (feature, layer) => {
          const popupContent = `
            <div class="leaflet-popup-content">
              <h4>${feature.properties.start_date}</h4>
              <p>持续时间: ${feature.properties.duration} 天</p>
              <p>最大异常值: ${feature.properties.max_anomaly.toFixed(2)}°C</p>
            </div>
          `;
          layer.bindPopup(popupContent);
        }
      }).addTo(this.map);

      cancelAnimationFrame(this.mapAnimationFrame);
      this.mapAnimationFrame = requestAnimationFrame(() => {
        this.safeFitBounds();
      });
    },

    safeFitBounds() {
      if (!this.map || !this.geoJsonLayer) return;

      try {
        const bounds = this.geoJsonLayer.getBounds();
        if (bounds && bounds.isValid()) {
          this.map.flyToBounds(bounds, {
            padding: [50, 50],
            duration: 1
          });
        }
      } catch (error) {
        console.warn('调整地图视野失败:', error);
      }
    },

    getColor(maxAnomaly) {
      return maxAnomaly > 7 ? '#d73027' :
             maxAnomaly > 6 ? '#fc8d59' :
             '#fee08b';
    },

    cleanupMap() {
      cancelAnimationFrame(this.mapAnimationFrame);
      
      if (this.geoJsonLayer) {
        this.geoJsonLayer.remove();
        this.geoJsonLayer = null;
      }
      
      if (this.map) {
        this.map.remove();
        this.map = null;
      }
      
      this.isMapInitialized = false;
    }
  }
};
</script>

<style scoped>
.task1-container {
  position: relative;
  height: 100%;
  width: 100%;
}

/* 图例样式 */
.legend-control {
  position: absolute;
  bottom: 70px; /* 调整此值来上移图例 */
  right: 20px;
  z-index: 1000;
  background: rgba(255, 255, 255, 0.9);
  padding: 12px;
  border-radius: 5px;
  box-shadow: 0 1px 5px rgba(0,0,0,0.2);
  font-family: Arial, sans-serif;
  line-height: 1.5;
}


.legend-title {
  font-weight: bold;
  margin-bottom: 8px;
  font-size: 14px;
  color: #333;
}

.legend-scale {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.legend-item {
  display: flex;
  align-items: center;
}

.legend-color {
  display: inline-block;
  width: 20px;
  height: 20px;
  margin-right: 8px;
  border: 1px solid #ccc;
  border-radius: 3px;
}

.legend-label {
  font-size: 13px;
  color: #555;
}

/* 弹窗样式 */
:deep(.leaflet-popup-content) {
  min-width: 200px;
  padding: 10px;
}

:deep(.leaflet-popup-content h4) {
  margin-top: 0;
  color: #333;
  font-size: 16px;
}

:deep(.leaflet-popup-content p) {
  margin-bottom: 5px;
  color: #666;
  font-size: 14px;
}
</style>