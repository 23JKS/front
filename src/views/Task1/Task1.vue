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
      isGlobalPlaying: false,
      globalAnimationInterval: null,
      currentStep: 0,
      maxSteps: 0,
      timelineDates: [],
      activeLayers: [],
      animationSpeed: 1, 
      currentAnimation: null,
      currentHighlight: null, // 新增当前高亮要素的引用
      isPlaying: false,
      animationProgress: 0,
      animationInterval: null,
      pathLayer: null,
      markerLayer: null,
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
        // 全局动画控制
  toggleGlobalAnimation() {
    this.isGlobalPlaying = !this.isGlobalPlaying;
    if (this.isGlobalPlaying) {
      this.startGlobalAnimation();
    } else {
      this.pauseGlobalAnimation();
    }
  },

  // 增强的startGlobalAnimation方法
startGlobalAnimation() {
  if (!this.filteredEvents.length) {
    this.$message.warning('没有符合筛选条件的热浪事件');
    return;
  }

  // 生成精确时间线（基于筛选后的事件）
  const allDates = this.filteredEvents.flatMap(event => 
    event.properties.daily_info
      .map(d => {
        try {
          return new Date(d.date).toISOString().split('T')[0]; // 标准化日期
        } catch {
          return null;
        }
      })
      .filter(Boolean)
  );
  
  // 去重排序并过滤无效日期
  this.timelineDates = [...new Set(allDates)]
    .map(d => new Date(d))
    .sort((a, b) => a - b)
    .filter(date => !isNaN(date.getTime()));

  if (this.timelineDates.length === 0) {
    this.$message.error('时间线数据异常');
    return;
  }

  this.maxSteps = this.timelineDates.length;
  this.currentStep = 0;
  
  console.log('生成时间线:', {
    start: this.timelineDates[0].toISOString(),
    end: this.timelineDates.slice(-1)[0].toISOString(),
    steps: this.timelineDates.length
  });

  // 清除旧动画
  this.resetGlobalAnimation();
  
  // 启动动画
  const baseInterval = 1000;
  this.globalAnimationInterval = setInterval(
    this.updateGlobalAnimation,
    baseInterval / this.animationSpeed
  );
  this.isGlobalPlaying = true;
},
  // 增强的updateGlobalAnimation方法
    updateGlobalAnimation() {
      if (this.currentStep >= this.maxSteps) {
        this.resetGlobalAnimation();
        return;
      }

      const currentDate = this.timelineDates[this.currentStep];
      const currentDateString = currentDate.toISOString().split('T')[0];
      
      console.log(`进度 ${this.currentStep+1}/${this.maxSteps}`, currentDateString);

      // 清除旧图层
      this.activeLayers.forEach(layer => layer.remove());
      this.activeLayers = [];

      // 绘制当前帧
      this.filteredEvents.forEach((event, eventIndex) => {
    const dayInfo = event.properties.daily_info.find(d => 
      new Date(d.date).toISOString().split('T')[0] === currentDateString
    );
          // 调试输出
        console.log(`事件#${eventIndex} (${event.properties.event_id})`, {
          匹配日期: currentDateString,
          是否存在: !!dayInfo,
          boundary数据: dayInfo?.boundary?.coordinates?.[0]?.slice(0,2) || '无'
        });


        if (dayInfo?.boundary?.coordinates?.[0]) {
          try {
            // 转换坐标并验证
            const polygonCoords = dayInfo.boundary.coordinates[0].map(coord => {
              const lng = parseFloat(coord[0]);
              const lat = parseFloat(coord[1]);
              return [lat, lng]; // Leaflet格式
            });

            // 创建带高亮效果的多边形
            const polygon = L.polygon(polygonCoords, {
              color: '#ff4444',
              weight: 2,
              fillColor: this.getSpeedColor(event.properties.speed),
              fillOpacity: 0.7,
              className: 'heatwave-polygon'
            }).addTo(this.map);

            // 添加呼吸动画
            polygon.animate({
              fillOpacity: 0.3
            }, {
              duration: 1500,
              easing: 'ease-in-out'
            });

            this.activeLayers.push(polygon);
          } catch (e) {
            console.error(`事件#${event.properties.event_id} 渲染失败:`, e);
          }
        }
      });

      // 自动调整视口
      if (this.activeLayers.length > 0) {
        const bounds = L.featureGroup(this.activeLayers).getBounds();
        this.map.flyToBounds(bounds, {
          padding: [100, 100],
          duration: 0.8
        });
      }

      this.currentStep++;
    },

  pauseGlobalAnimation() {
    clearInterval(this.globalAnimationInterval);
    this.isGlobalPlaying = false;
  },

  resetGlobalAnimation() {
    this.pauseGlobalAnimation();
    this.activeLayers.forEach(layer => layer.remove());
    this.activeLayers = [];
    this.currentStep = 0;
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
          // 移除旧多边形
          if (anim.currentPolygon) {
            this.map.removeLayer(anim.currentPolygon);
          }
          
          // 更新索引
          anim.currentIndex++;
          
          // 添加新多边形
          anim.currentPolygon = anim.polygons[anim.currentIndex].addTo(this.map);
          
          // 移动标记
          const point = anim.feature.properties.daily_info[anim.currentIndex].centroid;
          anim.marker.setLatLng([point.lat, point.lon]);
          
          // 更新进度条
          this.animationProgress = (anim.currentIndex / (anim.polygons.length - 1)) * 100;
        } else {
          this.stopAnimation();
        }
      }, interval);
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
          //layer.bindPopup(this.createPopupContent(feature.properties));
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
            
            // this.showMovementAnimation(feature);
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
          eventStart >= startDate && 
          eventEnd <= endDate &&
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

/* 确保多边形可见 */
.heatwave-polygon {
  stroke-width: 2px !important;
  stroke-opacity: 1 !important;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0% { filter: brightness(1); }
  50% { filter: brightness(1.15); }
  100% { filter: brightness(1); }
}

/* 时间轴指示器 */
.timeline-indicator {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 8px 20px;
  border-radius: 20px;
  font-size: 14px;
  z-index: 1000;
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

@keyframes polygonPulse {
  0% { 
    filter: brightness(1);
    transform: scale(1);
  }
  50% {
    filter: brightness(1.2);
    transform: scale(1.02);
  }
  100% {
    filter: brightness(1);
    transform: scale(1);
  }
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



/* 动态图时间轴指示器 */
.timeline-indicator {
  position: fixed;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(255,255,255,0.9);
  padding: 8px 20px;
  border-radius: 20px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  z-index: 1000;
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