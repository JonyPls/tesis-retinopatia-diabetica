// Test-only launcher: real React sources, no application .env, no production changes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const front = path.join(root,'frontend');
process.chdir(front); // Tailwind/PostCSS resolve the existing frontend configuration here.
const run = JSON.parse(fs.readFileSync(path.join(root,'docs/tesis/pruebas/ejecucion_caja_negra_actual.json'),'utf8').replace(/^\uFEFF/,''));
const {createServer} = await import(pathToFileURL(path.join(front,'node_modules/vite/dist/node/index.js')));
const {default:react} = await import(pathToFileURL(path.join(front,'node_modules/@vitejs/plugin-react-swc/index.js')));
const emptyEnv = path.join(root,'tmp/codn-cn-empty-env'); fs.mkdirSync(emptyEnv,{recursive:true});
const server = await createServer({configFile:false,root:front,envDir:emptyEnv,cacheDir:path.join(root,'tmp/codn-cn-vite-cache'),
  plugins:[react(),{name:'cn-test-scope-label',transformIndexHtml(html){return html.replace('</body>',
    `<div style="position:fixed;bottom:0;left:0;right:0;z-index:999999;background:#fff0c2;color:#332400;border-top:2px solid #876900;padding:7px;text-align:center;font:12px Arial">CODN · ENTORNO DE PRUEBAS · API SIMULADA · DATOS SINTÉTICOS · ${run.run_id}</div></body>`);}}],
  resolve:{alias:{'@':path.join(front,'src')},dedupe:['react','react-dom','@tanstack/react-query']},
  define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('http://127.0.0.1:4188/api'),
    'import.meta.env.VITE_DIAGNOSIS_DISCARD_ENABLED':JSON.stringify('false')},
  server:{host:'127.0.0.1',port:4187,strictPort:true,hmr:{overlay:true}},
});
await server.listen(); console.log('CN TEST React listening only on http://127.0.0.1:4187; API SIMULATED 4188');
