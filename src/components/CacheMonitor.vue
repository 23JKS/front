<template>
    <div class="cache-monitor">
      <el-popover placement="bottom-end" width="300" trigger="hover">
        <template #reference>
          <el-badge :value="metrics.hitRate" class="badge">
            <el-button icon="el-icon-data-line" circle></el-button>
          </el-badge>
        </template>
  
        <div class="metrics-panel">
          <h4>缓存监控</h4>
          <el-descriptions :column="1" size="mini">
            <el-descriptions-item label="命中率">
              {{ (metrics.hitRate * 100).toFixed(1) }}%
            </el-descriptions-item>
            <el-descriptions-item label="缓存条目">
              {{ metrics.total }}
            </el-descriptions-item>
            <el-descriptions-item label="最后错误">
              {{ metrics.lastError || '无' }}
            </el-descriptions-item>
          </el-descriptions>
        </div>
      </el-popover>
    </div>
  </template>
  
  <script>
  export default {
    props: {
      cacheManager: {
        type: Object,
        required: true
      }
    },
  
    data() {
      return {
        metrics: {
          hitRate: 0,
          total: 0,
          lastError: null
        }
      };
    },
  
    mounted() {
      this.updateInterval = setInterval(async () => {
        // 新增数据库存在性检查
        if (!this.cacheManager?.db) {
          console.error('CacheManager database not initialized or not available');
          return
        }
        const metrics = this.cacheManager.getMetrics();
        // 修改后
        const tx = this.cacheManager.db.transaction('tileCache', 'readonly');
        const store = tx.objectStore('tileCache');
        const count = await store.count();
        
        this.metrics = {
          ...metrics,
          total: count,
          lastError: metrics.lastError?.message
        };
      }, 2000);
    },
  
    beforeUnmount() {
      if (this.updateInterval) {
        clearInterval(this.updateInterval);
      }
    }
  };
  </script>
  
  <style>
  .cache-monitor {
    position: fixed;
    bottom: 20px;
    left: 20px;
    z-index: 9999;
  }
  
  .metrics-panel {
    font-size: 12px;
  }
  
  .metrics-panel h4 {
    margin: 0 0 8px;
    color: #666;
  }
  
  .badge ::v-deep .el-badge__content {
    transform: scale(0.8);
    right: 8px;
  }
  </style>