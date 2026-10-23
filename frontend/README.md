# React + TypeScript + Vite

## Desarrollo local de CODN (Windows)

- Puertos habituales: Vite `http://localhost:8080` y Flask `http://127.0.0.1:5000`.
- Antes de iniciar otra sesión, comprobar los oyentes con
  `Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 5000,5001,8080,5173 }`.
  Inspeccionar sus PID y comandos con `Get-CimInstance Win32_Process`; no detener procesos ajenos.
- Desde `backend/`, conservar en la sesión `RETINOGRAPH_PRIVATE_DIR` con la ruta privada
  local **ya autorizada** (sin copiarla a Git) y ejecutar `./venv/Scripts/python.exe run_local.py`.
  Este arranque conserva las banderas locales de informes, usa solo `127.0.0.1:5000`,
  no activa debug y se niega a arrancar sin carpeta privada configurada.
- Desde `frontend/`, ejecutar `npm run dev -- --host localhost --port 8080 --strictPort`.
  No establecer `VITE_API_BASE_URL` para este par: el valor por defecto es
  `http://localhost:5000/api` (misma máquina que `127.0.0.1:5000`). Si existía
  una variable temporal apuntando a `5001`, retirarla **solo de esta terminal**
  antes de iniciar Vite (`Remove-Item Env:VITE_API_BASE_URL`).
- Tras cambios en Flask o en la configuración del servidor, detener el proceso
  de desarrollo CODN identificado y reiniciar el comando anterior; Vite actualiza
  frontend normalmente sin reinicio, salvo cambios en sus variables de entorno.
  Reutilizar el par existente en vez de abrir servidores adicionales. No cambiar
  las banderas de informes ni la ubicación privada del retinógrafo al reiniciar.
- Comprobar `GET http://127.0.0.1:5000/` (200) y
  `GET http://127.0.0.1:5000/api/dashboard/clinico` sin Bearer (401),
  después abrir `http://localhost:8080/dashboard` con la sesión autorizada.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
