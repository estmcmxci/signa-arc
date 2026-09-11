import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins:[react(),tailwindcss(),{
    name:'public-architecture',
    configureServer(server){server.middlewares.use('/architecture.html',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(readFileSync(resolve(import.meta.dirname,'../../ARC-ARCHITECTURE.html')));});},
    generateBundle(){this.emitFile({type:'asset',fileName:'architecture.html',source:readFileSync(resolve(import.meta.dirname,'../../ARC-ARCHITECTURE.html'),'utf8')});},
  }],
  build:{rollupOptions:{input:{landing:resolve(import.meta.dirname,'index.html'),dashboard:resolve(import.meta.dirname,'app/index.html'),security:resolve(import.meta.dirname,'security/index.html')}}},
});
