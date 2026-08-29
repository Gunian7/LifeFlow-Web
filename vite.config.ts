import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // GitHub Pages serves this project at /LifeFlow-Web/ rather than /.
  base: '/LifeFlow-Web/',
  plugins: [react()],
})
