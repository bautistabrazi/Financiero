# Flujo claro

Aplicación web para analizar reportes CSV de Mercado Pago de forma local en el navegador.

## Tecnología

- JavaScript/TypeScript
- React
- Vite
- CSS

No usa Next.js ni requiere un servidor Python. Los CSV se procesan en el dispositivo del usuario.

## Desarrollo

```bash
pnpm install
pnpm dev
```

## Compilación

```bash
pnpm build
```

La salida estática queda en `dist/`, lista para Vercel.

## Vercel

- Framework Preset: Vite
- Build Command: `pnpm build`
- Output Directory: `dist`
