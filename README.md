# BFK Ltda — Ventas Mercado Público

App de gestión de ventas, gastos y reventa, conectada a Supabase.

## Cómo desplegar (desde el celular, sin computador)

1. Sube todos estos archivos a un repositorio nuevo en GitHub (público o privado).
2. Ve a [vercel.com](https://vercel.com) → inicia sesión con tu cuenta de GitHub.
3. "Add New" → "Project" → selecciona este repositorio.
4. Vercel detecta automáticamente que es un proyecto Vite + React. No necesitas cambiar nada.
5. Toca "Deploy" y espera 1-2 minutos.
6. Listo: tendrás una URL pública (ej. `bfk-ventas.vercel.app`) que funciona en cualquier dispositivo, sin restricciones de red, para todos tus usuarios.

## Estructura de archivos

```
bfk-app/
├── index.html
├── package.json
├── vite.config.js
├── .gitignore
└── src/
    ├── main.jsx
    └── App.jsx       ← toda la lógica de la app
```

## Conexión a Supabase

Las credenciales de Supabase (URL y anon key) ya están dentro de `src/App.jsx`.
Si alguna vez necesitas cambiarlas, búscalas cerca del inicio del archivo:

```js
const SUPABASE_URL = "https://gypywxaugwuxbgmcqntp.supabase.co";
const SUPABASE_ANON_KEY = "...";
```

## Primer uso

El primer usuario que se registre con "Crear cuenta" queda automáticamente
como **admin** (gracias al trigger SQL configurado en Supabase). Los
siguientes usuarios entran con rol "usuario" y el admin puede cambiarles
el rol desde el panel "👥 Usuarios" dentro de la app.
