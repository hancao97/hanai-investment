import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/dashboard', name: 'dashboard', component: () => import('../views/DashboardView.vue') },
    { path: '/watch', name: 'watch', component: () => import('../views/WatchView.vue') },
    { path: '/stock/:secId', name: 'stock', component: () => import('../views/StockDetailView.vue') },
    { path: '/judgements', name: 'judgements', component: () => import('../views/JudgementsView.vue') },
    {
      path: '/judgements/:id',
      name: 'judgement-detail',
      component: () => import('../views/JudgementDetailView.vue')
    },
    { path: '/personas', name: 'personas', component: () => import('../views/PersonasView.vue') },
    { path: '/chat/:pathMatch(.*)*', redirect: '/judgements' },
    { path: '/committee/:pathMatch(.*)*', redirect: '/judgements' },
    { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue') }
  ]
})
