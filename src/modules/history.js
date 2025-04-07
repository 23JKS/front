// store/modules/history.js
export default {
    namespaced: true,
    state: {
      operations: JSON.parse(localStorage.getItem('heatmap_operations') || '[]')
    },
    mutations: {
      ADD_OPERATION(state, payload) {
        state.operations.unshift(payload);
        localStorage.setItem('heatmap_operations', JSON.stringify(state.operations));
      },
      CLEAR_HISTORY(state) {
        state.operations = [];
        localStorage.removeItem('heatmap_operations');
      }
    }
  };