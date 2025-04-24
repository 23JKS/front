<template>
    <div class="app-container">
      <!-- 左侧导航栏 -->
      <nav class="sidebar">
        <div class="logo">气象分析系统</div>
        <ul class="menu">
          <router-link 
            to="/task3" 
            class="menu-item"
            active-class="active">
            <li>热浪事件分析看板</li>
          </router-link>
          <router-link 
            to="/operation_record" 
            class="menu-item"
            active-class="active">
            <li>操作记录 </li>
          </router-link>

          <router-link 
            to="/development" 
            class="menu-item"
            active-class="active">
            <li>待开发功能 </li>
          </router-link>

        </ul>

      </nav>
      
      <!-- 右侧内容区 -->
      <main class="main-content">
        <router-view></router-view>
      </main>
    </div>
  </template>
  
  <script>
  export default {
    name: 'MainLayout'
  }
  </script>
  
  <style scoped>
  /* 保持原有导航栏样式不变 */
  .app-container {
    display: flex;
    min-height: 100vh;
    background: #f5f7fa;
  }
  
  .sidebar {
    width: 240px;
    background: #304156;
    color: #fff;
    padding: 20px 0;
    box-shadow: 2px 0 6px rgba(0,21,41,.35);
  }
  
  .logo {
    font-size: 20px;
    font-weight: 600;
    text-align: center;
    padding: 15px 0;
    margin-bottom: 20px;
    border-bottom: 1px solid rgba(255,255,255,.1);
  }
  
  .menu {
    list-style: none;
    padding: 0;
  }
  
  .menu-item {
    display: block;
    color: rgba(255,255,255,.65);
    padding: 12px 24px;
    transition: all .3s;
    text-decoration: none;
  }
  
  .menu-item:hover {
    background: #263445;
    color: #fff;
  }
  
  .menu-item.active {
    background: #1890ff;
    color: #fff;
  }
  
  .main-content {
    flex: 1;
    overflow: auto;
    padding: 20px;
  }
  </style>