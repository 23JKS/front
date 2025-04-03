<template>
  <div>
    <el-menu mode="horizontal" :default-active="activeIndex" @select="handleSelect"
    style="height: 80px">
      <el-menu-item index="1" @click="goToTask1">时空分析</el-menu-item>
      <el-menu-item index="2" @click="goToTask2">统计分析</el-menu-item>
      <el-menu-item index="3" @click="goToTask3">关联分析</el-menu-item>
    </el-menu>
    <router-view v-slot="{ Component }">
      <transition name="fade" mode="out-in">
        <component :is="Component" />
      </transition>
    </router-view>
  </div>
</template>

<script>
export default {
  data() {
    return {
      activeIndex: '1',
    };
  },
  methods: {
    goToTask1() {
      this.$router.push('/task1');
    },
    goToTask2() {
      this.$router.push('/task2');
    },
    goToTask3() {
      this.$router.push('/task3');
    },
    handleSelect(index) {
      this.activeIndex = index;
    },
  },
};
</script>

<style>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.5s;
}
.fade-enter,
.fade-leave-to {
  opacity: 0;
}
</style>