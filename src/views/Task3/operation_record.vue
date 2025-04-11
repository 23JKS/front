<template>    
      <div class="operation-history">
        <h3>操作历史记录</h3>
        <div v-if="operations.length === 0" class="no-records">
          暂无操作记录
        </div>
        <div v-else class="history-list">
          <div v-for="(op, index) in operations" :key="index" class="history-card">
            <div class="card-header">
              <span class="operation-type">{{ op.type || '系统操作' }}</span>
              <span class="operation-time">{{ formatDate(op.timestamp) }}</span>
            </div>
            <div class="card-content">
              {{ op.details }}
            </div>
          </div>
        </div>
      </div>
    
  </template>
  <script>
  import { mapState } from 'vuex';
  
  export default {
    computed: {
      ...mapState('history', ['operations'])
    },
    methods: {
      formatDate(timestamp) {
        if (!timestamp) return '';
        return new Date(timestamp).toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
      }
    }
  };
  </script>
  <style scoped>
  .operation-history {
    max-width: 800px;
    margin: 40px auto;
    padding: 20px;
    background: #f8f9fa;
    border-radius: 8px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.08);
  }
  
  .history-list {
    position: relative;
    padding-left: 40px;
  }
  
  .history-card {
    position: relative;
    margin-bottom: 20px;
    padding: 15px;
    background: white;
    border-radius: 6px;
    box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  }
  
  .history-card::before {
    content: '';
    position: absolute;
    left: -30px;
    top: 18px;
    width: 12px;
    height: 12px;
    background: #409eff;
    border-radius: 50%;
  }
  
  .card-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  
  .operation-type {
    color: #303133;
    font-weight: 500;
  }
  
  .operation-time {
    color: #909399;
    font-size: 0.9em;
  }
  
  .card-content {
    color: #606266;
    line-height: 1.6;
  }
  
  .no-records {
    padding: 20px;
    color: #909399;
    text-align: center;
  }
  
  @media (max-width: 768px) {
    .history-list {
      padding-left: 20px;
    }
    
    .history-card::before {
      left: -15px;
    }
  }
  </style>