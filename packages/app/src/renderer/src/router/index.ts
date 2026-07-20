import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/dashboard', name: 'dashboard', component: () => import('../views/DashboardView.vue') },
    { path: '/watch', name: 'watch', component: () => import('../views/WatchView.vue') },
    { path: '/stock/:secId', name: 'stock', component: () => import('../views/StockDetailView.vue') },
    { path: '/committee', name: 'committee', component: () => import('../views/CommitteeView.vue') },
    {
      path: '/committee/:hash',
      name: 'committee-detail',
      component: () => import('../views/CommitteeDetailView.vue')
    },
    { path: '/personas', name: 'personas', component: () => import('../views/PersonasView.vue') },
    { path: '/chat/:conversationId?', name: 'chat', component: () => import('../views/ChatView.vue') },
    { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue') }
  ]
})
