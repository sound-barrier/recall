import {createApp} from 'vue'
import {createPinia} from 'pinia'
import App from '@/App.vue'
import { installGlobalErrorHandler } from '@/error-handler'
import '@/style.css';

const app = createApp(App).use(createPinia())
installGlobalErrorHandler(app)
app.mount('#app')
