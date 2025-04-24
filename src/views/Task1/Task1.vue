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
    <!-- 悬浮式控制面板 -->
    <div class="control-panel">
      <div class="control-group">
        <!-- 动画控制 -->
        <div class="control-item">
          <el-button-group class="full-width">
            <el-button type="primary" @click="toggleGlobalAnimation">
              {{ isGlobalPlaying ? '⏸ 暂停' : '▶️ 播放' }}
            </el-button>
            <el-button @click="resetGlobalAnimation">⏹ 停止</el-button>
          </el-button-group>
        </div>
        <!-- 时间选择 -->
        <div class="control-item date-picker-wrapper">
          <el-date-picker
            v-model="timeRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            value-format="YYYY-MM-DD"
            @change="filterEvents"
            popper-class="ventusky-datepicker"
          />
        </div>
        <!-- 持续时间控制 -->
        <div class="control-item slider-container">
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
      <button @click="safeZoomIn">+</button>
      <button @click="safeZoomOut">-</button>
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
      currentDate: null
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
      this.map.on('zoomend', () => {
        this.currentZoom = this.map.getZoom();
        console.log('Zoom 级别变化:', this.currentZoom);
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
    safeZoomIn() {
      if (this.map && this.isMapInitialized) {
        console.log('执行 zoomIn');
        this.map.zoomIn();
        this.map.invalidateSize();
      } else {
        console.warn('地图未初始化，跳过 zoomIn');
      }
    },
    safeZoomOut() {
      if (this.map && this.isMapInitialized) {
        console.log('执行 zoomOut');
        this.map.zoomOut();
        this.map.invalidateSize();
      } else {
        console.warn('地图未初始化，跳过 zoomOut');
      }
    },
    handlePanelClick(e) {
      console.log('处理面板点击事件', e);
      e.stopPropagation();
      this.$nextTick(() => {
        if (this.map) {
          this.map.invalidateSize();
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

        // 规范化 selectedEvent
        this.selectedEvent = {
          type: feature.type,
          properties: {
            event_id: feature.properties.event_id ?? 'unknown',
            start_date: feature.properties.start_date instanceof Date
              ? feature.properties.start_date
              : new Date(feature.properties.start_date),
            duration: feature.properties.duration ?? 0,
            max_anomaly: feature.properties.max_anomaly ?? 0, // 默认值
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

        // 高亮图层
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
              this.map.invalidateSize();
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
      if (this.geoJsonLayer) {
        this.geoJsonLayer.remove();
        this.geoJsonLayer = null;
      }
      this.activeLayers.forEach(layer => layer.remove());
      this.activeLayers.clear();
      if (this.pathLayer) {
        this.pathLayer.remove();
        this.pathLayer = null;
      }
      if (this.markerLayer) {
        this.markerLayer.remove();
        this.markerLayer = null;
      }
      if (this.map) {
        this.map.invalidateSize();
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
      const convertCoords = (coords) => {
        return coords.map(item => {
          if (Array.isArray(item[0])) return convertCoords(item);
          return [item[1], item[0]];
        });
      };
      const calculateEventEnd = (startDate, duration) => {
        const end = new Date(startDate);
        end.setUTCDate(end.getUTCDate() + duration);
        return end;
      };
      if (this.currentStep >= this.maxSteps) {
        this.resetGlobalAnimation();
        return;
      }
      const currentDate = this.timelineDates[this.currentStep];
      const currentISODate = this.formatDate(currentDate);
      this.activeLayers.forEach((layers, eventId) => {
        const event = this.filteredEvents.find(e => e.properties.event_id === eventId);
        if (!event) return;
        const eventEndDate = calculateEventEnd(event.properties.start_date, event.properties.duration);
        if (currentISODate > this.formatDate(eventEndDate)) {
          layers.forEach(layer => layer.remove());
          this.activeLayers.delete(eventId);
        }
      });
      this.filteredEvents.forEach(event => {
        const startDate = new Date(event.properties.start_date);
        const eventEndDate = calculateEventEnd(startDate, event.properties.duration);
        if (currentDate < startDate || currentDate > eventEndDate) return;
        const dayInfos = event.properties.daily_info.filter(d =>
          this.formatDate(new Date(d.date)) === currentISODate
        );
        if (dayInfos.length === 0) {
          console.warn(`[${event.properties.event_id}] 无当日数据: ${currentISODate}`);
          return;
        }
        let allGeometries = [];
        dayInfos.forEach(dayInfo => {
          const geometries = this.parseMultiPolygon(dayInfo.geometry);
          allGeometries = [...allGeometries, ...geometries];
        });
        if (this.activeLayers.has(event.properties.event_id)) {
          const oldLayers = this.activeLayers.get(event.properties.event_id);
          oldLayers.forEach(layer => layer.remove());
        }
        const newPolygons = allGeometries.map(coords => {
          try {
            const latlngs = convertCoords(coords);
            if (latlngs.flat(2).length < 6) {
              console.warn(`[${event.properties.event_id}] 无效坐标数量`);
              return null;
            }
            return L.polygon(latlngs, {
              color: this.getSpeedColor(event.properties.speed),
              weight: 2,
              opacity: 0.9,
              fillColor: this.getSpeedColor(event.properties.speed),
              fillOpacity: 0.5,
              className: `event-${event.properties.event_id}`
            });
          } catch (e) {
            console.error(`[${event.properties.event_id}] 创建失败:`, e);
            return null;
          }
        }).filter(Boolean);
        if (newPolygons.length > 0 && this.map) {
          newPolygons.forEach(p => p.addTo(this.map));
          this.activeLayers.set(event.properties.event_id, newPolygons);
          console.log(`[${event.properties.event_id}] 创建 ${newPolygons.length} 个多边形`);
        }
      });
      if (this.map) {
        requestAnimationFrame(() => {
          this.map.invalidateSize({ animate: true });
        });
      }
      this.currentStep++;
      this.progressStyle = { width: `${(this.currentStep / this.maxSteps) * 100}%` };
      this.currentDate = this.timelineDates[this.currentStep];
      if (this.currentStep >= this.maxSteps) {
        this.resetGlobalAnimation();
      }
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
        layers.forEach(layer => layer.remove());
      });
      this.activeLayers.clear();
      this.filterEvents();
      this.safeFitBounds();
      this.currentStep = 0;
      this.currentDate = null;
      this.progressStyle = { width: '0%' };
      if (this.map) {
        this.map.invalidateSize();
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
      if (this.pathLayer && this.map) {
        this.map.removeLayer(this.pathLayer);
        this.pathLayer = null;
      }
      if (this.currentAnimation) {
        if (this.currentAnimation.marker && this.map) {
          this.map.removeLayer(this.currentAnimation.marker);
        }
        if (this.currentAnimation.currentPolygon && this.map) {
          this.map.removeLayer(this.currentAnimation.currentPolygon);
        }
        this.currentAnimation.polygons?.forEach(p => {
          if (this.map) this.map.removeLayer(p);
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

        // 规范化数据
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
              max_anomaly: Number(props.max_anomaly) || 0, // 确保 max_anomaly 存在
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
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
          attribution: '© OpenStreetMap'
        }).addTo(this.map);
        L.control.zoom({ position: 'bottomright' }).addTo(this.map);
        this.map.on('moveend', this.updateTiles);
        this.map.on('zoomend', () => {
          this.currentZoom = this.map.getZoom();
          console.log('Zoom 级别变化:', this.currentZoom);
          this.updateTiles();
        });
        this.map.on('touchstart', (e) => {
          if (e.originalEvent.touches.length === 1) {
            this.map.dragging.enable();
          }
        });
        this.map.on('touchend', (e) => {
          console.log('触摸结束:', e.latlng);
        });
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
      this.map.invalidateSize();
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
          this.map.invalidateSize();
        }
      }
    }
  },
  beforeUnmount() {
    this.selectedEvent = null;
    if (this.globalAnimationInterval) clearInterval(this.globalAnimationInterval);
    if (this.animationInterval) clearInterval(this.animationInterval);
    this.clearAllLayers();
    if (this.map) {
      this.map.eachLayer(layer => {
        try {
          layer.remove();
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
.info-panel-wrapper {
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
  opacity:0;
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

#map-container {
  pointer-events: auto;
  z-index: 999;
  width: 100%;
  height: 100%;
}

.event-popup {
  font-family: Arial, sans-serif;
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

.heatwave-vis {
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  position: relative;
  background: #1a2335;
  display: flex;
  flex-direction: column;
}

#map-container {
  flex: 1;
  position: relative;
  background: #213042;
  touch-action: none;
  z-index: 1;
  pointer-events: auto !important;
}

.control-panel {
  position: fixed;
  top: 300px;
  left: 20px;
  z-index: 1000;
  max-width: 320px;
  background: rgba(32, 45, 64, 0.9);
  backdrop-filter: blur(5px);
  border-radius: 8px;
  padding: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.control-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.control-item {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  padding: 12px;
  max-width: 280px;
}

.slider-container {
  padding: 8px 12px;
}

.slider-label {
  color: #e3f2fd;
  font-size: 12px;
  margin-bottom: 8px;
}

.legend {
  position: fixed;
  right: 20px;
  bottom: 80px;
  z-index: 1000;
  background: rgba(32, 45, 64, 0.9);
  backdrop-filter: blur(2px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 12px;
}

.legend-title {
  color: #e3f2fd;
  font-weight: 500;
  margin-bottom: 8px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0;
}

.color-box {
  width: 16px;
  height: 16px;
  border-radius: 3px;
}

.legend-item span {
  color: #e3f2fd;
  font-size: 12px;
}

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

.custom-zoom-control {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.custom-zoom-control button {
  background: rgba(32, 45, 64, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #fff;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  cursor: pointer;
  backdrop-filter: blur(2px);
  transition: all 0.2s;
}

.custom-zoom-control button:hover {
  background: #4a6da7;
}

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

@media (max-width: 768px) {
  .control-panel {
    max-width: 280px;
    left: 10px;
    right: 10px;
    top: 10px;
  }
  .legend {
    bottom: 70px;
    right: 10px;
    max-width: 180px;
  }
  .timeline-container {
    width: 80%;
    bottom: 20px;
  }
  .custom-zoom-control {
    bottom: 70px;
  }
}

:deep(.el-button) {
  background: rgba(72, 114, 176, 0.8) !important;
  border: 1px solid #4a6da7 !important;
  color: #e3f2fd !important;
  transition: all 0.2s;
  border-radius: 6px !important;
}

:deep(.el-button:hover) {
  background: #4a6da7 !important;
  transform: translateY(-1px);
}

:deep(.el-slider__bar) {
  background: #4a90e2 !important;
}

:deep(.el-slider__button) {
  border-color: #4a90e2 !important;
}

.date-picker-wrapper {
  max-width: 240px;
  width: 100%;
  padding: 8px !important;
}

:deep(.el-date-editor--daterange) {
  --el-date-editor-width: 92% !important;
  max-width: 100%;
}

:deep(.el-range-separator) {
  width: 24px;
  font-size: 12px;
}

:deep(.el-range-input) {
  width: 45% !important;
  font-size: 12px;
  background: transparent;
}

@media (max-width: 768px) {
  .date-picker-wrapper {
    max-width: 240px;
  }
  :deep(.el-range-editor.el-input__wrapper) {
    padding: 0 6px !important;
  }
  :deep(.el-range-input) {
    font-size: 11px !important;
  }
  :deep(.el-range-separator) {
    font-size: 11px !important;
    padding: 0 2px;
  }
}
</style>