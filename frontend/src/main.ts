import {createApp} from 'vue'
import {createPinia} from 'pinia'
import { VueQueryPlugin } from '@tanstack/vue-query'
import App from '@/App.vue'
import { installGlobalErrorHandler } from '@/error-handler'
import { queryClient } from '@/queries/client'
import '@/style.css';

const app = createApp(App).use(createPinia()).use(VueQueryPlugin, { queryClient })
installGlobalErrorHandler(app)
app.mount('#app')
