import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      // MCP Server 代理：浏览器 → Vite → localhost:9527（避免跨域）
      '/mcp-api': {
        target: 'http://127.0.0.1:9527',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/mcp-api/, '/api'),
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // 代码分割：大依赖拆独立 chunk，便于浏览器缓存与并行加载
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('html2canvas')) return 'html2canvas'
          if (id.includes('jsbarcode')) return 'jsbarcode'
          if (id.includes('@huggingface') || id.includes('transformers') || id.includes('onnxruntime')) return 'transformers'
          if (id.includes('opencc-js')) return 'opencc' // 仅 ASR 时动态加载，不进首屏
          if (id.includes('react') || id.includes('react-dom') || id.includes('react-router') || id.includes('scheduler')) return 'react-vendor'
          return 'vendor'
        },
      },
    },
  },
})