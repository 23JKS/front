<template>
  <div class="heatwave-vis">
    <!-- 控制面板 -->
    <div class="control-panel">
      <el-button-group>
         <el-button type="success" @click="toggleGlobalAnimation">
           {{ isGlobalPlaying ? '⏸ 暂停动态图' : '🌊 播放动态图' }}
         </el-button>
         <el-button @click="resetGlobalAnimation">🗑️ 清除动态图</el-button>
       </el-button-group>

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
     <!-- 增强的动画控制面板 -->
     <div class="animation-control" v-if="currentAnimation">
        <div class="animation-info">
          <h4>动画控制</h4>
          <div>当前事件: #{{ currentAnimation.feature.properties.event_id }}</div>
          <div>总帧数: {{ currentAnimation.polygons.length }}</div>
        </div>
        
        <el-slider
          v-model="animationProgress"
          :min="0"
          :max="100"
          :step="1"
          @change="updateAnimationPosition"
        />
        
        <el-button-group>
          <el-button @click="toggleAnimation" type="primary">
            {{ isPlaying ? '⏸ 暂停' : '▶️ 播放' }}
          </el-button>
          <el-button @click="stopAnimation">⏹ 停止</el-button>
          <el-button @click="restartAnimation">🔄 重播</el-button>
        </el-button-group>
        
        <div class="speed-control">
          <span>播放速度:</span>
          <el-slider
            v-model="animationSpeed"
            :min="0.5"
            :max="3"
            :step="0.5"
            style="width: 200px"
          />
        </div>
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
      <!-- 添加时间指示器 -->
      <div class="timeline-indicator" v-if="isGlobalPlaying">
        当前时间: {{ formattedCurrentDate }}
      </div>
  </div>
</template>

<script>
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const SPEED_COLORS = {
  low: '#4CAF50',
  medium: '#FFC107',
  high: '#F44336'
};

export default {
  name: 'HeatwaveVisualization',
  data() {
  
    const defaultStart = new Date(2020, 5, 1); // 2020-06-01
    const defaultEnd = new Date(2020, 7, 31);   // 2020-08-31
    return {
      loadedTiles: new Set(),       // 已加载的区块标识
      currentZoom: 4,              // 当前缩放级别
      tileLayers: new Map(),        // 已加载的图层
    // 设置2020年6月1日 - 8月31日作为默认时间范围
      progressStyle: { width: '0%' }, // 初始化进度条样式
      isGlobalPlaying: false,
      globalAnimationInterval: null,
      currentStep: 0,
      maxSteps: 0,
      timelineDates: [],
      activeLayers: new Map(), // 改为 Map 以跟踪每个事件的图层
      animationSpeed: 1, 
      currentAnimation: null,
      currentHighlight: null, // 新增当前高亮要素的引用
      isPlaying: false,
      animationProgress: 0,
      animationInterval: null,
      pathLayer: null,
      markerLayer: null,
      isMapInitialized: false, // 新增地图初始化状态标记
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
      currentDate: null, // 新增：初始化 currentDate
    };
  },
  computed: {
    formattedCurrentDate() {
      return this.currentDate ? this.currentDate.toLocaleDateString() : '未定义';
    },
  },
  // 修改后的初始化方法
  async mounted() {
    try {
      // 先初始化地图
      this.initMap();
      this.map.on('moveend', this.updateTiles);
      this.map.on('zoomend', () => {
        this.currentZoom = this.map.getZoom();
        this.updateTiles();
      });
      // 再加载数据
      await this.loadData();
      
      // 最后过滤事件
      this.filterEvents();

      console.log('初始化完成');
    } catch (error) {
      console.error('初始化失败:', error);
    }
  },
  
  // 在现有speedRanges后添加监听
  watch: {
    animationSpeed() {
      if (this.isGlobalPlaying) {
        this.pauseGlobalAnimation();
        this.startGlobalAnimation();
      }
    }
  },
  methods: {
     // 生成区块唯一标识
    getTileKey(bounds) {
      return `${Math.floor(bounds.getSouth()/5)*5}-${Math.floor(bounds.getWest()/5)*5}`;
    },

    // 获取当前需要加载的区块
    getRequiredTiles() {
      const bounds = this.map.getBounds();
      const tiles = new Set();
      
      // 计算可视区域覆盖的区块
      for (let lat = Math.floor(bounds.getSouth()/5)*5; lat <= bounds.getNorth(); lat +=5) {
        for (let lng = Math.floor(bounds.getWest()/5)*5; lng <= bounds.getEast(); lng +=5) {
          tiles.add(`${lat}-${lng}`);
        }
      }
      return tiles;
    },
        // 更新区块加载状态
    // 修改updateTiles方法（约215行）
    async updateTiles() {
      // 暂停执行直到地图初始化完成
      if (!this.map) {
        await new Promise(resolve => setTimeout(resolve, 100));
        return this.updateTiles();
      }

      const bounds = this.map.getBounds();
      const zoom = this.map.getZoom();
      
      // 根据缩放级别动态调整区块大小
      const gridSize = zoom > 6 ? 2 : 5; // 高缩放级别使用更小网格
      
      const tiles = new Set();
      for (let lat = Math.floor(bounds.getSouth()/gridSize)*gridSize; 
          lat <= bounds.getNorth(); 
          lat += gridSize) {
        for (let lng = Math.floor(bounds.getWest()/gridSize)*gridSize;
            lng <= bounds.getEast();
            lng += gridSize) {
          tiles.add(`${lat}-${lng}`);
        }
      }
    },
    // 加载单个区块数据
    async loadTileData(lat, lng) {
      try {
        // 加载本地GeoJSON文件
        const response = await fetch('/mock/api/heatwaves.geojson');
        const fullData = await response.json();
        
        // 根据区块范围过滤要素
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

        return L.geoJSON({
          type: "FeatureCollection",
          features: filteredFeatures
        }, {
          style: this.getFeatureStyle,
          onEachFeature: this.bindFeatureEvents,
          coordsToLatLng: coords => L.latLng(coords[1], coords[0]) // 转换坐标顺序
        }).addTo(this.map);

      } catch (error) {
        console.error('本地数据加载失败:', error);
        return L.layerGroup();
      }
    },

    // 统一要素样式
      // 新增方法：获取要素的边界框
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
    // 统一事件绑定
    bindFeatureEvents(feature, layer) {
      layer.bindPopup(this.createPopupContent(feature.properties));
      
      layer.on({
        click: this.handleFeatureClick,
        mouseover: this.handleFeatureHover,
        mouseout: this.handleFeatureLeave
      });
    },
    // 在methods中添加
    clearAllLayers() {
      // 清除静态图层
      if (this.geoJsonLayer) {
        this.geoJsonLayer.remove();
        this.geoJsonLayer = null;
      }
      
      // 清除动态图层
      this.activeLayers.forEach(layer => layer.remove());
      this.activeLayers.clear();
      
      // 清除其他相关元素
      if (this.pathLayer) this.map.removeLayer(this.pathLayer);
      if (this.markerLayer) this.map.removeLayer(this.markerLayer);
    },
    toggleGlobalAnimation() {
      this.isGlobalPlaying = !this.isGlobalPlaying;
      console.log('切换动画状态，isGlobalPlaying:', this.isGlobalPlaying);
      if (this.isGlobalPlaying) {
        this.clearAllLayers(); // 新增：播放前清理所有图层
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
        end: this.timelineDates[this.timelineDates.length-1]?.toISOString(),
        days: this.timelineDates.length
      });

      this.maxSteps = this.timelineDates.length;
      this.currentStep = 0;
      this.currentDate = this.timelineDates[0]; // 确保 currentDate 被设置
      this.progressStyle = { width: '0%' };

      this.globalAnimationInterval = setInterval(
        this.updateGlobalAnimation,
        1000 / this.animationSpeed
      );
    },
    // 判断两个日期是否是同一天
    isSameDay(date1, date2) {
      return (
        date1.getFullYear() === date2.getFullYear() &&
        date1.getMonth() === date2.getMonth() &&
        date1.getDate() === date2.getDate()
      );
    },

      // 修改updateGlobalAnimation方法（关键部分）
    updateGlobalAnimation() {
      if (this.currentStep >= this.maxSteps) {
        this.resetGlobalAnimation();
        return;
      }

      const currentDate = this.timelineDates[this.currentStep];
      const currentISODate = this.formatDate(currentDate);

      // 清理过期图层（严格生命周期控制）
      this.activeLayers.forEach((layer, eventId) => {
        const event = this.filteredEvents.find(e => e.properties.event_id === eventId);
        if (!event) return;

        // 准确计算事件结束日期（包含最后一整天）
        const eventEndDate = new Date(event.properties.start_date);
        eventEndDate.setDate(eventEndDate.getDate() + event.properties.duration - 1); // 包含最后一天
        const eventEndISODate = this.formatDate(eventEndDate);

        // 严格过期判断（超过结束日期才移除）
        if (currentISODate > eventEndISODate) {
          layer.remove();
          this.activeLayers.delete(eventId);
        }
      });

      // 创建/更新多边形（禁用自动缩放）
      this.filteredEvents.forEach(event => {
        const startDate = new Date(event.properties.start_date);
        const startISODate = this.formatDate(startDate);
        const eventEndDate = new Date(startDate);
        eventEndDate.setDate(startDate.getDate() + event.properties.duration - 1);
        const eventEndISODate = this.formatDate(eventEndDate);

        // 仅处理当前日期范围内的事件
        if (currentISODate >= startISODate && currentISODate <= eventEndISODate) {
          const dayInfo = event.properties.daily_info.find(d => 
            this.formatDate(new Date(d.date)) === currentISODate
          );

          // 添加多边形可见性调试
          console.log(`事件#${event.properties.event_id} ${currentISODate}`, {
            start: startISODate,
            end: eventEndISODate,
            exists: !!dayInfo?.geometry?.coordinates
          });

          if (dayInfo?.geometry?.coordinates) {
            // 转换坐标顺序 [经度, 纬度] => [纬度, 经度]
            const latlngs = dayInfo.geometry.coordinates[0].map(c => [c[1], c[0]]);

            if (this.activeLayers.has(event.properties.event_id)) {
              // 更新现有多边形（保持当前位置）
              const polygon = this.activeLayers.get(event.properties.event_id);
              polygon.setLatLngs([latlngs]);
            } else {
              // 创建新多边形（禁用弹出动画）
              const polygon = L.polygon([latlngs], {
                color: this.getSpeedColor(event.properties.speed), // 边框颜色与填充色一致
                weight: 1,          // 减少边框宽度
                opacity: 0.5,       // 降低边框透明度
                fillColor: this.getSpeedColor(event.properties.speed),
                fillOpacity: 0.7
              }).addTo(this.map);
              
              this.activeLayers.set(event.properties.event_id, polygon);
            }
          }
        }
      });

 

      // 强制重绘图层
      this.map.invalidateSize({ animate: false });

      this.currentDate = currentDate;
      this.currentStep++;
      // 在 updateGlobalAnimation 末尾添加
      if (this.currentStep >= this.maxSteps) {
        this.resetGlobalAnimation();
        this.$message.success('播放完成，已恢复静态视图');
      }
    },
    // 新增方法：获取事件结束日期
    getEventEndDate(event) {
      const startDate = new Date(event.properties.start_date);
      const endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + event.properties.duration);
      return endDate;
    },

    // 新增方法：格式化日期为YYYY-MM-DD
    formatDate(date) {
      return date.toISOString().split('T')[0];
      // 或用更可靠的方式：
      // const pad = n => n.toString().padStart(2,'0');
      // return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
    },

    pauseGlobalAnimation() {
      clearInterval(this.globalAnimationInterval);
      this.isGlobalPlaying = false;
    },

    // 修改 resetGlobalAnimation 方法
    resetGlobalAnimation() {
      this.pauseGlobalAnimation();
      
      // 清除动态图层
      this.activeLayers.forEach(layer => layer.remove());
      this.activeLayers.clear();
      
      // 恢复静态视图
      this.filterEvents(); // 重新触发筛选和渲染
      this.safeFitBounds(); // 自动适应视图
      
      // 重置进度指示
      this.currentStep = 0;
      this.currentDate = null;
      this.progressStyle = { width: '0%' };
    },
    // 添加 toggleAnimation 方法
    toggleAnimation() {
      this.isPlaying = !this.isPlaying;
      if (this.isPlaying) {
        this.playNextStep();
      } else {
        clearInterval(this.animationInterval);
      }
    },

    // 新增动画相关方法
    showMovementAnimation(feature) {
      this.clearAnimation();
      
      const days = feature.properties.daily_info;
      if (!days || days.length < 2) return;

      // 存储多边形动画数据
      const polygons = days.map(day => {
        try {
          return L.polygon(day.boundary.coordinates[0], {
            color: this.getSpeedColor(feature.properties.speed), // 保持原色
            weight: 2,
            opacity: 0.8,
            fillOpacity: 0.2
          });
        } catch (e) {
          console.warn('无效的边界数据:', day.boundary);
          return null;
        }
      }).filter(Boolean);

      // 创建路径和标记（保持原有）
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

      // 动画状态
      this.currentAnimation = {
        feature,
        currentIndex: 0,
        polygons,
        marker,
        currentPolygon: null
      };

      // 初始显示第一个多边形
      if (polygons.length > 0) {
        this.currentAnimation.currentPolygon = polygons[0].addTo(this.map);
      }

      this.toggleAnimation();
    },
    playNextStep() {
      if (!this.isPlaying) return;

      const anim = this.currentAnimation;
      const interval = 1000; // 1秒间隔

      this.animationInterval = setInterval(() => {
        if (anim.currentIndex < anim.polygons.length - 1) {
          this.updateAnimationFrame(anim);
        } else {
          this.stopAnimation();
        }
      }, interval);
    },
    updateAnimationFrame(anim) {
      if (anim.currentPolygon) {
        this.map.removeLayer(anim.currentPolygon);
      }
      anim.currentIndex++;
      anim.currentPolygon = anim.polygons[anim.currentIndex].addTo(this.map);
      const point = anim.feature.properties.daily_info[anim.currentIndex].centroid;
      anim.marker.setLatLng([point.lat, point.lon]);
      this.animationProgress = (anim.currentIndex / (anim.polygons.length - 1)) * 100;
    },
   
   
    updateMarkerPosition() {
      const { currentIndex, feature } = this.currentAnimation;
      const point = feature.properties.daily_info[currentIndex].centroid;
      this.markerLayer.setLatLng([point.lat, point.lon]);
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

    // 数据加载方法重构
    async loadData() {
      try {
        const response = await fetch('/data/final_heatwaves.geojson');
        let rawData = await response.text();

        // 增强数据预处理
        rawData = this.fixGeoJSONStructure(rawData);
        
        // 调试输出
        console.log('预处理后的数据片段:', rawData.substring(0, 500));
        
        const data = JSON.parse(rawData);
        
        // 处理features
        this.allEvents = data.features.map(feature => {
          const props = feature.properties;
          
          // 转换daily_info
          const dailyInfo = this.parseDailyInfo(props.daily_info);
        const validDays = dailyInfo.filter(d => d.centroid);
        const speed = validDays.length > 1 ? 
            this.calculateSpeed(validDays, Number(props.duration)) : 0;  // 添加参数转换

          return {
            type: 'Feature',
            geometry: feature.geometry,
            properties: {
              event_id: props.event_id,
              start_date: new Date(props.start_date),
              duration: props.duration,
              daily_info: dailyInfo,
              speed: speed,
              centroid: validDays[0]?.centroid || null
            }
          };
        }).filter(event => 
          event.properties.daily_info?.length > 0
        );

        console.log('数据加载成功', this.allEvents);
        this.filterEvents();

      } catch (error) {
        console.error('数据加载失败:', error);
        this.$message.error('数据加载失败: ' + error.message);
      }
    },
    // 增强的GeoJSON修复方法
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
          // 解析daily_info数据
    parseDailyInfo(dailyInfo) {
      return dailyInfo.map(day => {
        try {
          // 转换坐标结构
          const coordinates = this.normalizeCoordinates(day.geometry?.coordinates);
          
          return {
            date: day.date,
            centroid: {
              lat: day.centroid.lat,
              lon: day.centroid.lon
            },
            geometry: coordinates.length > 0 ? {
              type: 'Polygon',
              coordinates: coordinates
            } : null
          };
        } catch (e) {
          console.warn('每日数据解析失败:', e);
          return null;
        }
      }).filter(Boolean);
    },
     // 标准化坐标格式
     normalizeCoordinates(coords) {
      const process = (arr, depth = 0) => {
        if (depth > 3) return arr; // 防止无限递归
        
        return arr.map(item => {
          if (Array.isArray(item)) {
            // 转换坐标顺序为 [lat, lng]
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
    initMap() {
      // 清理旧地图
      if (this.map) return;

      // 创建前强制重置容器
      const container = document.getElementById('map-container');
      container.style.width = '100%';
      container._leaflet_id = null; // 清除leaflet缓存
      // 创建新地图实例
      this.map = L.map('map-container', {
        renderer: L.canvas(), // 强制使用Canvas渲染
        zoomControl: false,
        preferCanvas: true,
        dragging: true, // 显式启用拖动
      }).setView([30, 140], 4);

      // 添加底图
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(this.map);
      // 添加事件监听
      this.map.on('moveend', this.updateTiles);
      this.map.on('zoomend', () => {
        this.currentZoom = this.map.getZoom();
        this.updateTiles();
      });
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
      if (this.isGlobalPlaying && this.currentAnimation) return; // 仅阻止动画播放时的渲染
      if (this.isGlobalPlaying) return; // 动态播放时不渲染静态层
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
          // 保存原始样式
          const originalStyle = {
            color: this.getSpeedColor(feature.properties.speed),
            weight: 2,
            opacity: 0.8
          };
          layer.setStyle(originalStyle);

          // 保存原始样式到图层属性
          layer.originalStyle = originalStyle;

          layer.on('click', () => {
            // 清除上一个高亮
            if (this.currentHighlight) {
              this.currentHighlight.setStyle(this.currentHighlight.originalStyle);
            }
            
            // 设置新高亮（使用原始颜色但加粗边框）
            layer.setStyle({
              color: layer.originalStyle.color,
              weight: 5,
              opacity: 1
            });
            
            // 更新当前高亮引用
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

      // 自适应视图
      this.safeFitBounds();
    },

    // 事件筛选
    filterEvents() {
      if (!this.allEvents.length) return;
      // 当动画停止时强制重新渲染
      if (!this.isGlobalPlaying) {
        if (this.geoJsonLayer) {
          this.geoJsonLayer.remove();
          this.geoJsonLayer = null;
        }
      }
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
          eventStart >= startDate && 
          eventEnd <= endDate &&
          !isNaN(eventStart.getTime())
        );
      });

      console.log('过滤结果:', {
        original: this.allEvents.length,
        filtered: this.filteredEvents.length
      });
        // 非播放状态时渲染静态视图
      if (!this.isGlobalPlaying) {
        this.renderEvents();
      }

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
    if (this.globalAnimationInterval) clearInterval(this.globalAnimationInterval);
    if (this.animationInterval) clearInterval(this.animationInterval);
    if (this.map) {
      this.map.eachLayer(layer => layer.remove());
      this.map.remove();
      this.map = null;
    }
    this.activeLayers.forEach(layer => layer.remove());
    this.activeLayers.clear();
    this.currentDate = null; // 清理 currentDate
  },
};
</script>

<style scoped>
.timeline-indicator {
  position: fixed;
  bottom: 20px;
  left: 20px; /* 移到左下角，避免被地图遮挡 */
  background: rgba(155, 140, 189, 0.9);
  color: #000;
  padding: 10px;
  border-radius: 5px;
  z-index: 2000; /* 确保在地图之上 */
  font-size: 16px;
}

.progress-bar {
  height: 4px;
  background: rgba(255,255,255,0.3);
  margin-top: 8px;
  border-radius: 2px;
}

.progress {
  height: 100%;
  background: #FFF;
  border-radius: 2px;
  transition: width 0.3s ease;
}
/* 确保多边形可见 */
.heatwave-polygon {
  stroke-width: 2px !important;
  stroke-opacity: 1 !important;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0% { transform: scale(0.8); }
  50% { transform: scale(1); box-shadow: 0 0 0 10px rgba(255,0,0,0); }
  100% { transform: scale(0.8); }
}


/* 添加多边形动画 */
.leaflet-polygon {
  transition: opacity 0.5s ease-in-out;
}

@keyframes trail {
  from { stroke-dashoffset: 1000; }
  to { stroke-dashoffset: 0; }
}

.animated-path {
  stroke-dasharray: 1000;
  animation: trail 3s linear infinite;
}

/* 添加多边形动画效果 */
.animated-polygon {
  animation: polygonPulse 2s infinite;
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

/* 控制面板动画控件 */
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
  touch-action: none; /* 禁用浏览器默认触摸行为 */
  z-index: 1; /* 确保地图在最上层 */
  pointer-events: auto !important; /* 强制启用交互 */
  height: 1000px; /* 确保明确的高度 */
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
  height: 100px; 
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



/* 动态图波浪按钮特效 */
.el-button--success.is-active {
  animation: wave 1.5s infinite;
}

@keyframes wave {
  0% { box-shadow: 0 0 0 0 rgba(103,194,58,0.4); }
  70% { box-shadow: 0 0 0 10px rgba(103,194,58,0); }
  100% { box-shadow: 0 0 0 0 rgba(103,194,58,0); }
}
</style>