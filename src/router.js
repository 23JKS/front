import { createRouter, createWebHistory } from 'vue-router';
import Task1 from './views/Task1/Task1.vue';
import Task2 from './views/Task2/Task2.vue';
import Task3 from './views/Task3/Task3.vue';
import operation_record from './views/Task3/operation_record.vue';
import MainLayout from './layout/MainLayout.vue';
// import Task3 from './views/Task3/index.vue';
const routes = [
  { path: '/task1', component: Task1 },
  { path: '/task2', component: Task2 },
  // { path: '/task3', component: Task3 },
  { path: '/', redirect: '/task1' }, // 默认重定向到 Task1
  {
    path:'/',
    component:MainLayout,
    children: [
      {
        path: '/task3',
        name: 'Task3',
        component: Task3,
      },
      {
        path: '/operation_record',
        name: 'operation_record',
        component: operation_record,
      },
    
    ]
  },
 

];

const router = createRouter({
  history: createWebHistory(),
  routes,
});
router.beforeEach((to, from, next) => {
    console.log(`从 ${from.path} 跳转到 ${to.path}`);
    next();
  });
export default router;