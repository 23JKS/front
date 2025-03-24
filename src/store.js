import { createStore } from 'vuex';

export default createStore({
  state: {
    timeRange: null, // 时间范围
    spatialRegion: null, // 空间区域
    userHistory: [], // 用户操作历史记录
  },
  mutations: {
    setTimeRange(state, range) {
      state.timeRange = range;
    },
    setSpatialRegion(state, region) {
      state.spatialRegion = region;
    },
    addUserHistory(state, action) {
      state.userHistory.push(action);
    },
  },
  actions: {
    updateTimeRange({ commit }, range) {
      commit('setTimeRange', range);
    },
    updateSpatialRegion({ commit }, region) {
      commit('setSpatialRegion', region);
    },
    logUserAction({ commit }, action) {
      commit('addUserHistory', action);
    },
  },
});