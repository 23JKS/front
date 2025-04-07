// store.js
import { createStore } from 'vuex';
import history from './modules/history'; // 导入模块
export default createStore({
  modules: {  // 注册模块
    history
  },
  state: {
    timeRange: null,
    spatialRegion: null,
    // userHistory: []
  },
  mutations: {
    setTimeRange(state, range) {
      state.timeRange = range;
    },
    setSpatialRegion(state, region) {
      state.spatialRegion = region;
    },
    addUserHistory(state, action) {
      state.userHistory.push({
        ...action,
        timestamp: new Date().toISOString()
      });
    }
  },
  actions: {
    updateTimeRange({ commit }, range) {
      commit('setTimeRange', range);
       // 跨模块调用示例
       commit('history/ADD_OPERATION', {
        type: 'TIME_RANGE_CHANGE',
        value: range,
        timestamp: new Date().toISOString()
      });
    },
    updateSpatialRegion({ commit }, region) {
      commit('setSpatialRegion', region);
    },
    logUserAction({ commit }, action) {
      commit('addUserHistory', action);
    }
  },
  getters: {
    getTimeRange: state => state.timeRange,
    getUserHistory: state => state.userHistory
  }
});