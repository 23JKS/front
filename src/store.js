// store.js
import { createStore } from 'vuex';

export default createStore({
  state: {
    timeRange: null,
    spatialRegion: null,
    userHistory: []
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
      commit('addUserHistory', {
        type: 'TIME_RANGE_CHANGE',
        value: range
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