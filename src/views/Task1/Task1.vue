<template>
  <div class="heatwave-vis">
    <!-- 信息面板 -->
    <heatwave-info-panel
      ref="infoPanel"
      v-if="selectedEvent"
      :selected-event="selectedEvent"
      @close="selectedEvent = null"
      class="info-panel-wrapper"
      :class="{ hidden: !selectedEvent }"
      v-on="debugEventListeners"
      @click="handlePanelClick"
    />
    <!-- 控制面板 -->
    <div class="control-panel">
      <div class="control-group">
        <!-- 动画控制按钮 -->
        <div class="control-item animation-controls">
          <button
            class="control-button"
            :class="{ active: isGlobalPlaying }"
            @click="toggleGlobalAnimation"
            title="播放/暂停"
          >
            <span class="icon">{{ isGlobalPlaying ? '⏸' : '▶️' }}</span>
          </button>
          <button
            class="control-button"
            @click="resetGlobalAnimation"
            title="停止"
          >
            <span class="icon">⏹</span>
          </button>
        </div>
        <!-- 时间选择 -->
        <div class="control-item date-picker">
          <el-date-picker
            v-model="timeRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            value-format="YYYY-MM-DD"
            @change="filterEvents"
            popper-class="ventusky-datepicker"
            :clearable="false"
          />
        </div>
        <!-- 持续时间滑块 -->
        <div class="control-item duration-slider">
          <div class="slider-label">持续时间 ≥ {{ minDuration }}天</div>
          <el-slider
            v-model="minDuration"
            :min="1"
            :max="90"
            :step="1"
            @change="filterEvents"
          />
        </div>
      </div>
    </div>
    <!-- 全屏地图 -->
    <div id="map-container"></div>
    <!-- 图例 -->
    <div class="legend speed-legend">
      <div class="legend-title">移动速度图例</div>
      <div v-for="(item, index) in speedRanges" :key="index" class="legend-item">
        <div class="color-box" :style="{ backgroundColor: item.color }"></div>
        <span>{{ item.label }}</span>
      </div>
    </div>
    <!-- 时间轴 -->
    <div class="timeline-container" v-if="isGlobalPlaying">
      <div class="timeline-bar">
        <div class="timeline-progress" :style="progressStyle"></div>
      </div>
      <div class="timeline-label">{{ formattedCurrentDate }}</div>
    </div>
    <!-- 自定义缩放控件 -->
    <div class="custom-zoom-control">
      <button @click="safeZoomIn" title="放大">+</button>
      <button @click="safeZoomOut" title="缩小">-</button>
    </div>
  </div>
</template>

<script>
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import HeatwaveInfoPanel from './HeatwaveInfoPanel.vue';

const SPEED_COLORS = {
  low: '#4CAF50',
  medium: '#FFC107',
  high: '#F44336'
};

// 简单的防抖函数
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

export default {
  name: 'HeatwaveVisualization',
  components: {
    HeatwaveInfoPanel
  },
  data() {
    const defaultStart = new Date(2020, 5, 1); // 2020-06-01
    const defaultEnd = new Date(2020, 7, 31); // 2020-08-31
    return {
      debugEventListeners: {
        click: (e) => {
          console.log('面板点击事件', e);
          console.log('原生事件:', e.nativeEvent);
        }
      },
      selectedEvent: null,
      loadedTiles: new Set(),
      currentZoom: 4,
      tileLayers: new Map(),
      progressStyle: { width: '0%' },
      isGlobalPlaying: false,
      globalAnimationInterval: null,
      currentStep: 0,
      maxSteps: 0,
      timelineDates: [],
      activeLayers: new Map(),
      animationSpeed: 1,
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
      allEvents: [],
      filteredEvents: [],
      speedRanges: [
        { min: 0, max: 25, color: SPEED_COLORS.low, label: '低速 (<25 km/d)' },
        { min: 25, max: 50, color: SPEED_COLORS.medium, label: '中速 (25-50 km/d)' },
        { min: 50, max: Infinity, color: SPEED_COLORS.high, label: '高速 (>50 km/d)' }
      ],
      currentDate: null,
      isZooming: false,
      animationFrameId: null
    };
  },
  computed: {
    formattedCurrentDate() {
      return this.currentDate ? this.currentDate.toLocaleDateString() : '未定义';
    }
  },
  async mounted() {
    try {
      console.log('面板组件是否存在:', !!this.$refs.infoPanel);
      this.initMap();
      this.map.on('moveend', this.updateTiles);
      this.map.on('zoomstart', () => {
        this.isZooming = true;
        console.log('Zoom 开始');
      });
      this.map.on('zoomend', () => {
        this.isZooming = false;
        this.currentZoom = this.map.getZoom();
        console.log('Zoom 结束, 当前级别:', this.currentZoom);
        this.updateTiles();
      });
      await this.loadData();
      this.filterEvents();
      console.log('初始化完成');
    } catch (error) {
      console.error('初始化失败:', error);
    }
  },
  watch: {
    animationSpeed() {
      if (this.isGlobalPlaying) {
        this.pauseGlobalAnimation();
        this.startGlobalAnimation();
      }
    }
  },
  methods: {
    debouncedInvalidateSize: debounce(function () {
      if (this.map && this.isMapInitialized) {
        this.map.invalidateSize({ animate: false });
        console.log('执行防抖 invalidateSize');
      }
    }, 100),
    safeZoomIn() {
      if (this.map && this.isMapInitialized) {
        console.log('执行 zoomIn');
        this.map.zoomIn();
      } else {
        console.warn('地图未初始化，跳过 zoomIn');
      }
    },
    safeZoomOut() {
      if (this.map && this.isMapInitialized) {
        console.log('执行 zoomOut');
        this.map.zoomOut();
      } else {
        console.warn('地图未初始化，跳过 zoomOut');
      }
    },
    handlePanelClick(e) {
      console.log('处理面板点击事件', e);
      e.stopPropagation();
      this.$nextTick(() => {
        if (this.map) {
          this.debouncedInvalidateSize();
          console.log('面板点击后调整地图大小');
        }
      });
    },
    handleFeatureClick(feature, layer) {
      try {
        console.log('点击事件数据:', {
          eventId: feature.properties?.event_id,
          startDate: feature.properties?.start_date,
          duration: feature.properties?.duration,
          maxAnomaly: feature.properties?.max_anomaly,
          dailyInfoLength: feature.properties?.daily_info?.length
        });

        if (!feature.properties || !feature.properties.event_id) {
          throw new Error('无效的 feature 数据');
        }

        this.selectedEvent = {
          type: feature.type,
          properties: {
            event_id: feature.properties.event_id ?? 'unknown',
            start_date: feature.properties.start_date instanceof Date
              ? feature.properties.start_date
              : new Date(feature.properties.start_date),
            duration: feature.properties.duration ?? 0,
            max_anomaly: feature.properties.max_anomaly ?? 0,
            cumulative_anomaly: feature.properties.cumulative_anomaly ?? 0,
            centroid_change_rate: feature.properties.centroid_change_rate ?? 0,
            daily_info: Array.isArray(feature.properties.daily_info)
              ? feature.properties.daily_info.map(info => ({
                  ...info,
                  date: info.date instanceof Date ? info.date : new Date(info.date)
                }))
              : []
          },
          geometry: feature.geometry
        };

        console.log('更新 selectedEvent:', this.selectedEvent);

        if (this.currentHighlight) {
          this.currentHighlight.setStyle(this.currentHighlight.originalStyle);
        }
        layer.setStyle({
          weight: 5,
          opacity: 1,
          color: this.getSpeedColor(feature.properties.speed)
        }).bringToFront();
        this.currentHighlight = layer;

        this.$nextTick(() => {
          if (this.$refs.infoPanel) {
            const panelEl = this.$refs.infoPanel.$el;
            panelEl.style.zIndex = '2000';
            panelEl.style.pointerEvents = 'auto';
            console.log('面板状态:', {
              exists: !!panelEl,
              zIndex: panelEl.style.zIndex,
              display: panelEl.style.display,
              selectedEvent: !!this.selectedEvent,
              popupOpen: !!layer.getPopup()?.isOpen(),
              panelWidth: panelEl.offsetWidth
            });
            if (this.map) {
              this.debouncedInvalidateSize();
              console.log('点击要素后调整地图大小');
            }
          } else {
            console.warn('infoPanel 未找到，可能尚未渲染');
          }
        });
      } catch (e) {
        console.error('点击处理异常:', e);
        this.selectedEvent = null;
      }
    },
    findLayerById(eventId) {
      let targetLayer = null;
      if (this.geoJsonLayer) {
        this.geoJsonLayer.eachLayer(layer => {
          if (layer.feature?.properties.event_id === eventId) {
            targetLayer = layer;
          }
        });
      }
      return targetLayer;
    },
    highlightFeature(layer) {
      if (!layer.originalStyle) {
        layer.originalStyle = {
          color: layer.options.color,
          weight: layer.options.weight,
          opacity: layer.options.opacity
        };
      }
      layer.setStyle({
        weight: 5,
        opacity: 1,
        color: this.getSpeedColor(layer.feature.properties.speed)
      });
      layer.bringToFront();
      this.currentHighlight = layer;
    },
    resetFeatureStyle(layer) {
      if (layer.originalStyle) {
        layer.setStyle(layer.originalStyle);
      }
      this.currentHighlight = null;
    },
    getTileKey(bounds) {
      return `${Math.floor(bounds.getSouth() / 5) * 5}-${Math.floor(bounds.getWest() / 5) * 5}`;
    },
    getRequiredTiles() {
      if (!this.map) return new Set();
      const bounds = this.map.getBounds();
      const tiles = new Set();
      for (let lat = Math.floor(bounds.getSouth() / 5) * 5; lat <= bounds.getNorth(); lat += 5) {
        for (let lng = Math.floor(bounds.getWest() / 5) * 5; lng <= bounds.getEast(); lng += 5) {
          tiles.add(`${lat}-${lng}`);
        }
      }
      return tiles;
    },
    async updateTiles() {
      if (!this.map || !this.isMapInitialized) {
        console.warn('地图未初始化，跳过 updateTiles');
        await new Promise(resolve => setTimeout(resolve, 100));
        return;
      }
      const bounds = this.map.getBounds();
      const zoom = this.map.getZoom();
      const gridSize = zoom > 6 ? 2 : 5;
      const tiles = new Set();
      for (let lat = Math.floor(bounds.getSouth() / gridSize) * gridSize; lat <= bounds.getNorth(); lat += gridSize) {
        for (let lng = Math.floor(bounds.getWest() / gridSize) * gridSize; lng <= bounds.getEast(); lng += gridSize) {
          tiles.add(`${lat}-${lng}`);
        }
      }
      console.log('更新瓦片:', tiles);
    },
    async loadTileData(lat, lng) {
      try {
        const response = await fetch('/mock/api/heatwaves.geojson');
        const fullData = await response.json();
        const west = lng;
        const east = lng + 5;
        const south = lat;
        const north = lat + 5;
        const filteredFeatures = fullData.features.filter(feature => {
          const [minLng, minLat, maxLng, maxLat] = this.getFeatureBBox(feature);
          return (
            minLng < east &&
            maxLng > west &&
            minLat < north &&
            maxLat > south
          );
        });
        if (!this.map) return L.layerGroup();
        return L.geoJSON({
          type: "FeatureCollection",
          features: filteredFeatures
        }, {
          style: this.getFeatureStyle,
          onEachFeature: this.bindFeatureEvents,
          coordsToLatLng: coords => L.latLng(coords[1], coords[0])
        }).addTo(this.map);
      } catch (error) {
        console.error('本地数据加载失败:', error);
        return L.layerGroup();
      }
    },
    getFeatureBBox(feature) {
      const coords = feature.geometry.coordinates[0];
      let minLng = Infinity, maxLng = -Infinity;
      let minLat = Infinity, maxLat = -Infinity;
      coords.forEach(([lng, lat]) => {
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      });
      return [minLng, minLat, maxLng, maxLat];
    },
    bindFeatureEvents(feature, layer) {
      console.log(`绑定事件到要素 ${feature.properties.event_id}`);
      layer.options.interactive = true;
      layer.off('click');
      layer.on('click', (e) => {
        console.log('图层点击触发:', feature.properties.event_id);
        L.DomEvent.stopPropagation(e);

        if (feature.properties) {
          const popupContent = this.createPopupContent(feature.properties);
          layer.bindPopup(popupContent, {
            maxWidth: 300,
            autoPan: true,
            offset: [0, -10]
          }).openPopup(e.latlng);
        }

        this.handleFeatureClick(feature, layer);
      });
      layer.on('add', () => {
        console.log('图层已添加:', layer._leaflet_id);
      });
    },
    clearAllLayers() {
      if (this.geoJsonLayer && this.geoJsonLayer._map) {
        this.geoJsonLayer.remove();
        this.geoJsonLayer = null;
      }
      this.activeLayers.forEach((layers, eventId) => {
        layers.forEach(layer => {
          if (layer._map) {
            layer.remove();
          }
        });
        this.activeLayers.delete(eventId);
      });
      if (this.pathLayer && this.pathLayer._map) {
        this.pathLayer.remove();
        this.pathLayer = null;
      }
      if (this.markerLayer && this.markerLayer._map) {
        this.markerLayer.remove();
        this.markerLayer = null;
      }
      if (this.map) {
        this.debouncedInvalidateSize();
        console.log('清理图层后调整地图大小');
      }
    },
    toggleGlobalAnimation() {
      this.isGlobalPlaying = !this.isGlobalPlaying;
      console.log('切换动画状态，isGlobalPlaying:', this.isGlobalPlaying);
      if (this.isGlobalPlaying) {
        this.clearAllLayers();
        this.startGlobalAnimation();
        console.log('动画开始，isGlobalPlaying:', this.isGlobalPlaying);
      } else {
        this.pauseGlobalAnimation();
        console.log('动画暂停，isGlobalPlaying:', this.isGlobalPlaying);
      }
    },
    startGlobalAnimation() {
      if (!this.timeRange || this.timeRange.length !== 2) {
        this.$message.error('请先选择有效的时间范围');
        return;
      }
      const startDate = new Date(this.timeRange[0]);
      const endDate = new Date(this.timeRange[1]);
      if (isNaN(startDate) || isNaN(endDate)) {
        this.$message.error('时间范围格式错误');
        return;
      }
      this.timelineDates = [];
      let currentDate = new Date(startDate);
      while (currentDate <= endDate) {
        this.timelineDates.push(new Date(currentDate));
        currentDate.setDate(currentDate.getDate() + 1);
      }
      console.log('生成时间轴:', {
        start: this.timelineDates[0]?.toISOString(),
        end: this.timelineDates[this.timelineDates.length - 1]?.toISOString(),
        days: this.timelineDates.length
      });
      this.maxSteps = this.timelineDates.length;
      this.currentStep = 0;
      this.currentDate = this.timelineDates[0];
      this.progressStyle = { width: '0%' };
      this.globalAnimationInterval = setInterval(
        this.updateGlobalAnimation,
        1000 / this.animationSpeed
      );
    },
    isSameDay(date1, date2) {
      return (
        date1.getFullYear() === date2.getFullYear() &&
        date1.getMonth() === date2.getMonth() &&
        date1.getDate() === date2.getDate()
      );
    },
    updateGlobalAnimation() {
        // Check if we've reached the end of the timeline
      if (this.currentStep >= this.maxSteps) {
        this.pauseGlobalAnimation(); // Stop the animation when we reach the end
        this.renderEvents();
        return;
      }
      // if(this.c)
      if (this.isZooming) return;
      const currentDate = this.timelineDates[this.currentStep];
      const [rangeStart, rangeEnd] = this.timeRange.map(d => new Date(d));
      
      if (currentDate < rangeStart || currentDate > rangeEnd) {
        this.pauseGlobalAnimation();
        return; // 超出范围则停止
      }
      // 使用 LayerGroup 管理动态图层
      if (!this.animationLayer) {
        this.animationLayer = L.layerGroup().addTo(this.map);
      } else {
        this.animationLayer.clearLayers();
      }

     
   
      // const currentISODate = this.formatDate(currentDate);

      this.filteredEvents.forEach(event => {
        const startDate = new Date(event.properties.start_date);
        const eventEndDate = new Date(startDate);
        eventEndDate.setDate(startDate.getDate() + event.properties.duration);
        
        // 宽松条件：只要当前日期在事件周期内，就显示最近日期的多边形
        if (currentDate < startDate || currentDate > eventEndDate) {
        
          return; // 超出范围则停止
        }

        // 找到 <= 当前日期的最后一条记录
        const dayInfo = event.properties.daily_info
          .filter(d => new Date(d.date) <= currentDate)
          .pop() || event.properties.daily_info[0];

        if (!dayInfo?.geometry) {
          console.warn(`[${event.id}] 无有效几何数据`);
          return;
        }

        // 渲染多边形
        const polygons = this.parseMultiPolygon(dayInfo.geometry)
          .map(coords => L.polygon(coords, {
            color: this.getSpeedColor(event.properties.speed),
            fillOpacity: 0.5
          }));
        
        polygons.forEach(p => this.animationLayer.addLayer(p));
      });

      // 更新时间轴
      this.currentStep++;
      this.progressStyle = { width: `${(this.currentStep / this.maxSteps) * 100}%` };
      this.currentDate = currentDate;
    },
    parseMultiPolygon(geometry) {
      if (!geometry?.coordinates) return [];
      const flatten = (arr, depth = 0) => {
        if (depth > 3) return arr;
        return arr.flatMap(item =>
          Array.isArray(item[0][0]) ? flatten(item, depth + 1) : item
        );
      };
      switch (geometry.type) {
        case 'MultiPolygon':
          return flatten(geometry.coordinates);
        case 'Polygon':
          return [geometry.coordinates];
        case 'GeometryCollection':
          return geometry.geometries.flatMap(g => this.parseMultiPolygon(g));
        default:
          console.warn('未知几何类型:', geometry.type);
          return [];
      }
    },
    getEventEndDate(event) {
      const startDate = new Date(event.properties.start_date);
      const endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + event.properties.duration);
      return endDate;
    },
    formatDate(date) {
      return date.toISOString().split('T')[0];
    },
    pauseGlobalAnimation() {
      clearInterval(this.globalAnimationInterval);
      this.isGlobalPlaying = false;
    },
    resetGlobalAnimation() {
      this.pauseGlobalAnimation();
      this.activeLayers.forEach(layers => {
        layers.forEach(layer => {
          if (layer._map) {
            layer.remove();
          }
        });
      });
      this.activeLayers.clear();
      this.filterEvents();
      this.safeFitBounds();
      this.currentStep = 0;
      this.currentDate = null;
      this.progressStyle = { width: '0%' };
      if (this.map) {
        this.debouncedInvalidateSize();
      }
    },
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
          return L.polygon(day.geometry.coordinates[0], {
            color: this.getSpeedColor(feature.properties.speed),
            weight: 2,
            opacity: 0.8,
            fillOpacity: 0.2
          });
        } catch (e) {
          console.warn('无效的边界数据:', day.geometry);
          return null;
        }
      }).filter(Boolean);
      const pathPoints = days.map(d => [d.centroid.lat, d.centroid.lon]);
      if (this.map) {
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
      }
    },
    playNextStep() {
      if (!this.isPlaying) return;
      const anim = this.currentAnimation;
      const interval = 1000;
      this.animationInterval = setInterval(() => {
        if (anim.currentIndex < anim.polygons.length - 1) {
          this.updateAnimationFrame(anim);
        } else {
          this.stopAnimation();
        }
      }, interval);
    },
    updateAnimationFrame(anim) {
      if (anim.currentPolygon && this.map) {
        this.map.removeLayer(anim.currentPolygon);
      }
      anim.currentIndex++;
      anim.currentPolygon = anim.polygons[anim.currentIndex].addTo(this.map);
      const point = anim.feature.properties.daily_info[anim.currentIndex].centroid;
      anim.marker.setLatLng([point.lat, point.lon]);
      this.animationProgress = (anim.currentIndex / (anim.polygons.length - 1)) * 100;
    },
    stopAnimation() {
      this.isPlaying = false;
      clearInterval(this.animationInterval);
      this.animationProgress = 0;
      this.currentAnimation = null;
    },
    clearAnimation() {
      if (this.pathLayer && this.pathLayer._map) {
        this.map.removeLayer(this.pathLayer);
        this.pathLayer = null;
      }
      if (this.currentAnimation) {
        if (this.currentAnimation.marker && this.currentAnimation.marker._map) {
          this.map.removeLayer(this.currentAnimation.marker);
        }
        if (this.currentAnimation.currentPolygon && this.currentAnimation.currentPolygon._map) {
          this.map.removeLayer(this.currentAnimation.currentPolygon);
        }
        this.currentAnimation.polygons?.forEach(p => {
          if (p._map) this.map.removeLayer(p);
        });
      }
      this.stopAnimation();
    },
    async loadData() {
      try {
        const response = await fetch('/data/final_heatwaves.geojson');
        if (!response.ok) {
          throw new Error(`HTTP 错误: ${response.status}`);
        }
        let rawData = await response.text();
        rawData = this.fixGeoJSONStructure(rawData);
        console.log('预处理后的数据片段:', rawData.substring(0, 500));
        const data = JSON.parse(rawData);

        this.allEvents = data.features.map((feature, index) => {
          const props = feature.properties || {};
          const dailyInfo = this.parseDailyInfo(props.daily_info || '[]');
          const validDays = dailyInfo.filter(d => d.centroid && d.geometry);
          const speed = validDays.length > 1
            ? this.calculateSpeed(validDays, Number(props.duration) || 1)
            : 0;

          return {
            type: 'Feature',
            geometry: feature.geometry || { type: 'Polygon', coordinates: [] },
            properties: {
              event_id: props.event_id ?? `unknown_${index}`,
              start_date: props.start_date ? new Date(props.start_date) : new Date(),
              duration: Number(props.duration) || 0,
              max_anomaly: Number(props.max_anomaly) || 0,
              cumulative_anomaly: Number(props.cumulative_anomaly) || 0,
              centroid_change_rate: Number(props.centroid_change_rate) || 0,
              daily_info: validDays,
              speed: speed,
              centroid: validDays[0]?.centroid || { lat: 0, lon: 0 }
            }
          };
        }).filter(event => {
          const isValid = event.properties.daily_info.length > 0 &&
                         !isNaN(event.properties.start_date.getTime());
          if (!isValid) {
            console.warn('过滤无效事件:', event.properties.event_id);
          }
          return isValid;
        });

        console.log('数据加载成功', {
          totalEvents: this.allEvents.length,
          sampleEvent: this.allEvents[0]
        });
        this.filterEvents();
      } catch (error) {
        console.error('数据加载失败:', error);
        this.$message.error('数据加载失败: ' + error.message);
      }
    },
    fixGeoJSONStructure(str) {
      return str
        .replace(/'/g, '"')
        .replace(/None/g, 'null')
        .replace(/Decimal\(("[^"]+")\)/g, '$1')
        .replace(/\(/g, '[').replace(/\)/g, ']')
        .replace(/,\s*]/g, ']')
        .replace(/\[\s*,/g, '[')
        .replace(/"daily_info":\s*"\[(.*?)\]"/gs, (match, inner) => {
          return `"daily_info": [${inner
            .replace(/(\w+):/g, '"$1":')
            .replace(/("[^"]+")\s*:/g, '$1:')
          }]`;
        });
    },
    parseDailyInfo(dailyInfo) {
      if (typeof dailyInfo === 'string') {
        try {
          dailyInfo = JSON.parse(dailyInfo);
        } catch (e) {
          console.warn('解析 daily_info 失败:', e);
          return [];
        }
      }
      return dailyInfo.map(day => {
        try {
          const coordinates = this.normalizeCoordinates(day.geometry?.coordinates || []);
          return {
            date: day.date ? new Date(day.date) : null,
            centroid: day.centroid ? {
              lat: Number(day.centroid.lat) || 0,
              lon: Number(day.centroid.lon) || 0
            } : null,
            geometry: coordinates.length > 0 ? {
              type: 'Polygon',
              coordinates: coordinates
            } : null,
            area_km2: Number(day.area_km2) || 0,
            max_anomaly: Number(day.max_anomaly) || 0
          };
        } catch (e) {
          console.warn('每日数据解析失败:', e);
          return null;
        }
      }).filter(day => day && day.date && !isNaN(day.date.getTime()) && day.centroid && day.geometry);
    },
    normalizeCoordinates(coords) {
      const process = (arr, depth = 0) => {
        if (depth > 3) return arr;
        return arr.map(item => {
          if (Array.isArray(item)) {
            if (depth === 2 && item.length === 2) {
              return [item[1], item[0]];
            }
            return process(item, depth + 1);
          }
          return item;
        });
      };
      try {
        return process(coords || []);
      } catch (e) {
        console.error('坐标转换失败:', e);
        return [];
      }
    },
    calculateSpeed(dailyInfo, duration) {
      if (!dailyInfo || dailyInfo.length < 2 || duration < 1) return 0;
      let totalDistance = 0;
      for (let i = 1; i < dailyInfo.length; i++) {
        const prev = dailyInfo[i - 1].centroid;
        const curr = dailyInfo[i].centroid;
        if (!prev || !curr) continue;
        totalDistance += this.haversineDistance(
          [prev.lon, prev.lat],
          [curr.lon, curr.lat]
        );
      }
      return totalDistance / duration;
    },
    haversineDistance(coord1, coord2) {
      const R = 6371;
      const dLat = this.toRadians(coord2[1] - coord1[1]);
      const dLon = this.toRadians(coord2[0] - coord1[0]);
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(this.toRadians(coord1[1])) *
        Math.cos(this.toRadians(coord2[1])) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    },
    toRadians(degrees) {
      return degrees * Math.PI / 180;
    },
    initMap() {
      if (this.map) {
        console.log('地图已初始化，跳过重复初始化');
        return;
      }
      const container = document.getElementById('map-container');
      if (!container) {
        console.error('地图容器未找到');
        return;
      }
      container.style.width = '100%';
      container.style.height = '100%';
      container._leaflet_id = null;
      try {
        this.map = L.map('map-container', {
          renderer: L.canvas(),
          zoomControl: false,
          preferCanvas: true,
          dragging: true
        }).setView([30, 140], 4);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors'
        }).addTo(this.map);
        L.control.zoom({ position: 'bottomright' }).addTo(this.map);
        this.map.on('moveend', this.updateTiles);
        this.map.on('click', (e) => {
          console.log('地图点击:', e.latlng);
        });
        this.isMapInitialized = true;
        console.log('地图初始化完成');
      } catch (e) {
        console.error('地图初始化失败:', e);
        this.isMapInitialized = false;
      }
    },
    renderEvents() {
      if (this.isGlobalPlaying || !this.map || !this.isMapInitialized) {
        console.warn('地图未初始化或动画播放中，跳过 renderEvents');
        return;
      }
      if (this.geoJsonLayer) {
        this.geoJsonLayer.remove();
        this.geoJsonLayer = null;
      }
      if (!this.filteredEvents?.length) {
        console.warn('无过滤事件，无法渲染');
        return;
      }

      this.geoJsonLayer = L.geoJSON(this.filteredEvents, {
        interactive: true,
        bubblingMouseEvents: true,
        coordsToLatLng: (coords) => {
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
          const originalStyle = {
            color: this.getSpeedColor(feature.properties.speed),
            weight: 2,
            opacity: 0.8
          };
          layer.setStyle(originalStyle);
          layer.originalStyle = originalStyle;

          this.bindFeatureEvents(feature, layer);

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
      this.debouncedInvalidateSize();
    },
    filterEvents() {
      if (!this.timeRange || !Array.isArray(this.timeRange)) {
        console.warn('时间范围无效:', this.timeRange);
        this.filteredEvents = [];
        this.renderEvents();
        return;
      }
      if (!this.allEvents.length) {
        console.warn('无可用事件数据');
        return;
      }
      if (!this.isGlobalPlaying) {
        if (this.geoJsonLayer) {
          this.geoJsonLayer.remove();
          this.geoJsonLayer = null;
        }
      }
      const [startDate, endDate] = this.timeRange.map(d => new Date(d));
      this.filteredEvents = this.allEvents.filter(event => {
        const props = event.properties;
        const duration = Number(props.duration) || 0;
        if (duration < this.minDuration) return false;
        const eventStart = new Date(props.start_date);
        const eventEnd = new Date(eventStart);
        eventEnd.setDate(eventStart.getDate() + duration);
        const isValid = (
          eventStart >= startDate &&
          eventEnd <= endDate &&
          !isNaN(eventStart.getTime())
        );
        return isValid;
      });
      console.log('过滤结果:', {
        original: this.allEvents.length,
        filtered: this.filteredEvents.length,
        sampleFiltered: this.filteredEvents[0]
      });
      if (!this.isGlobalPlaying) {
        this.renderEvents();
      }
    },
    createMovementPath(feature) {
      const points = feature.properties.daily_info
        .map(d => [d.centroid.lat, d.centroid.lon])
        .filter(p => p[0] && p[1]);
      return L.polyline(points, {
        color: '#ff0000',
        weight: 3,
        opacity: 0.9
      });
    },
    getSpeedColor(speed) {
      return this.speedRanges.find(range =>
        speed >= range.min && speed < range.max
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
            <div>🌡️ 最大强度:</div>
            <div>${properties.max_anomaly.toFixed(2)} ℃</div>
            <div>🚀 移动速度:</div>
            <div>${properties.speed.toFixed(1)} km/d</div>
            <div>📍 初始位置:</div>
            <div>
              ${centroid ? `${centroid.lat.toFixed(2)}°N, ${centroid.lon.toFixed(2)}°E` : '未知'}
            </div>
          </div>
        </div>
      `;
    },
    safeFitBounds() {
      if (this.geoJsonLayer && this.map) {
        const bounds = this.geoJsonLayer.getBounds();
        if (bounds.isValid()) {
          this.map.fitBounds(bounds, { padding: [30, 30] });
          this.debouncedInvalidateSize();
        }
      }
    }
  },
  beforeUnmount() {
    this.selectedEvent = null;
    if (this.globalAnimationInterval) clearInterval(this.globalAnimationInterval);
    if (this.animationInterval) clearInterval(this.animationInterval);
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    this.clearAllLayers();
    if (this.map) {
      this.map.eachLayer(layer => {
        try {
          if (layer._map) layer.remove();
        } catch (e) {
          console.warn('移除图层失败:', e);
        }
      });
      this.map.off();
      this.map.remove();
      this.map = null;
      this.isMapInitialized = false;
      console.log('地图已清理');
    }
    this.activeLayers.clear();
    this.currentDate = null;
  }
};
</script>

<style scoped>
/* 信息面板样式保持不变 */
.info-panel-wrapper {
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease;
  position: fixed;
  right: 0;
  top: 0;
  height: 100vh;
  background: #ffffff !important;
  border-left: 1px solid rgba(0, 0, 0, 0.15);
  border-radius: 0;
  box-shadow: -4px 0 16px rgba(0, 0, 0, 0.1);
  z-index: 2000 !important;
  pointer-events: auto !important;
  overflow-y: auto;
  transition: transform 0.3s ease, opacity 0.3s ease;
  display: block;
  opacity: 1;
}

.info-panel-wrapper.hidden {
  opacity: 0;
  transform: translateX(100%);
}

@media (max-width: 768px) {
  .info-panel-wrapper {
    width: 90vw !important;
    max-width: 400px;
    right: 0;
    top: 0;
    height: 100vh;
  }
}

/* 地图容器 */
#map-container {
  pointer-events: auto;
  z-index: 999;
  width: 100%;
  height: 100%;
}

/* 弹出窗口 */
.event-popup {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #e3f2fd;
  background: rgba(32, 45, 64, 0.95);
  border-radius: 8px;
  padding: 12px;
  max-width: 300px;
}

.event-popup h4 {
  margin: 0 0 8px;
  font-size: 16px;
  color: #4a90e2;
}

.popup-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px;
  font-size: 12px;
}

.popup-grid div:nth-child(odd) {
  font-weight: 500;
  color: #a3bffa;
}

.popup-grid div:nth-child(even) {
  color: #e3f2fd;
}

/* 主容器 */
.heatwave-vis {
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  position: relative;
  background: #ffffff;
  display: flex;
  flex-direction: column;
}

#map-container {
  flex: 1;
  position: relative;
  background: #ffffff;
  touch-action: none;
  z-index: 1;
  pointer-events: auto !important;
}

/* 控制面板 */
.control-panel {
  position: fixed;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(8px);
  border-radius: 12px;
  padding: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  display: flex;
  align-items: center;
  max-width: 600px;
  width: 90%;
}

.control-group {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.control-item {
  display: flex;
  align-items: center;
  padding: 4px;
}

.animation-controls {
  display: flex;
  gap: 4px;
}

.control-button {
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 8px;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 18px;
  color: #2c3e50;
}

.control-button:hover {
  background: #ffffff;
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
}

.control-button.active {
  background: #4a90e2;
  color: #ffffff;
  border-color: #4a90e2;
}

.control-button .icon {
  line-height: 1;
}

.date-picker {
  max-width: 220px;
}

:deep(.el-date-editor--daterange) {
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 8px;
  height: 36px;
  padding: 0 8px;
  font-size: 12px;
}

:deep(.el-range-input) {
  color: #2c3e50;
  background: transparent;
}

:deep(.el-range-separator) {
  color: #2c3e50;
  font-size: 12px;
}

:deep(.el-date-editor .el-range__icon) {
  color: #4a90e2;
}

.duration-slider {
  width: 200px;
}

.slider-label {
  color: #2c3e50;
  font-size: 12px;
  margin-right: 8px;
}

:deep(.el-slider__runway) {
  background: rgba(0, 0, 0, 0.1);
  border-radius: 4px;
  height: 4px;
}

:deep(.el-slider__bar) {
  background: #4a90e2;
  border-radius: 4px;
  height: 4px;
}

:deep(.el-slider__button) {
  width: 12px;
  height: 12px;
  background: #ffffff;
  border: 2px solid #4a90e2;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

/* 时间轴 */
.timeline-container {
  position: fixed;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  width: 60%;
  z-index: 1000;
}

.timeline-bar {
  height: 4px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
}

.timeline-progress {
  height: 100%;
  background: #4a90e2;
  border-radius: 2px;
  transition: width 0.3s ease;
}

.timeline-label {
  color: #fff;
  text-align: center;
  margin-top: 8px;
  font-size: 14px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

/* 图例 */
.legend {
  position: fixed;
  right: 20px;
  bottom: 140px;
  z-index: 1000;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 8px;
  padding: 10px;
}

.legend-title {
  margin: 0 0 8px;
  font-size: 14px;
  color: #2c3e50;
  font-weight: 600;
}

.legend-item {
  display: flex;
  align-items: center;
  margin: 4px 0;
  gap: 6px;
  color: #2c3e50;
  font-size: 12px;
}

.color-box {
  width: 14px;
  height: 14px;
  border-radius: 3px;
}

/* 缩放控件 */
.custom-zoom-control {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.custom-zoom-control button {
  background: rgba(255, 255, 255, 0.95) !important;
  border: 1px solid rgba(0, 0, 0, 0.1) !important;
  color: #2c3e50 !important;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
  transition: all 0.2s ease;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.custom-zoom-control button:hover {
  background: #ffffff !important;
  transform: translateY(-1px);
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.2);
}

/* 动画 */
@keyframes polygon-pulse {
  0% {
    transform: scale(0.9);
    opacity: 0.8;
  }
  50% {
    transform: scale(1.05);
    opacity: 1;
  }
  100% {
    transform: scale(0.9);
    opacity: 0.8;
  }
}

@keyframes marker-pulse {
  0% {
    transform: scale(0.8);
    box-shadow: 0 0 0 0 rgba(255, 0, 0, 0.7);
  }
  70% {
    transform: scale(1.1);
    box-shadow: 0 0 0 10px rgba(255, 0, 0, 0);
  }
  100% {
    transform: scale(0.8);
    box-shadow: 0 0 0 0 rgba(255, 0, 0, 0);
  }
}

.animated-polygon {
  animation: polygon-pulse 2s ease-in-out infinite;
}

.animated-marker .pulsing-dot {
  animation: marker-pulse 1.5s infinite;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .control-panel {
    bottom: 100px;
    width: 95%;
    padding: 6px;
  }

  .control-group {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }

  .control-item {
    padding: 4px;
  }

  .animation-controls {
    justify-content: center;
  }

  .date-picker {
    max-width: none;
  }

  .duration-slider {
    max-width: none;
  }

  .timeline-container {
    width: 80%;
    bottom: 20px;
  }

  .legend {
    bottom: 160px;
    right: 10px;
    max-width: 160px;
  }

  .custom-zoom-control {
    top: 10px;
    right: 10px;
  }
}

:deep(.el-button) {
  background: rgba(255, 255, 255, 0.8) !important;
  border: 1px solid rgba(0, 0, 0, 0.1) !important;
  color: #2c3e50 !important;
  border-radius: 8px !important;
}

:deep(.el-button:hover) {
  background: #ffffff !important;
  transform: translateY(-1px);
}

:deep(.ventusky-datepicker) {
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

:deep(.el-popper) {
  background: rgba(255, 255, 255, 0.95) !important;
  border: 1px solid rgba(0, 0, 0, 0.1) !important;
  border-radius: 8px !important;
}
</style>