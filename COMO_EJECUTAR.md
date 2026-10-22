# Arranque rápido

Guía corta para levantar la app. La documentación completa (instalación,
Docker, proxies, arquitectura) está en el [README](README.md).

## Requisitos

- **Node.js 20+** (`node -v` para verificar)
- **Docker Desktop** en estado `Running` (solo lo necesita el botón Buscar)
- Puerto `3000` libre

## Opción 1 — Atajo (Windows)

Doble clic en **`INICIAR_MAPS_V2.bat`** (en la raíz del repo).

Levanta el dev server, chequea si Docker está corriendo y abre el navegador
en http://localhost:3000. Para detenerlo: `Ctrl + C` en la ventana negra.

## Opción 2 — Manual

```bash
cd apps/web
npm install   # solo la primera vez
npm run dev
```

Abrí http://localhost:3000.

> Sin Docker abierto, el botón Buscar falla, pero Enriquecer, Auditar y el
> chequeo de emails funcionan igual.

## Flujo de uso

1. **1 nicho + 1 área + 1 oferta.** No mezcles nichos.
2. Marcá el centro en el mapa → ajustá radio y filtros (min/max reviews,
   min rating, excluir cadenas) → **Buscar** (requiere Docker).
3. **Enriquecer**: detecta dueño + email (waterfall) + intent score + dato local.
4. **Chequeo de emails** y **Auditoría web**.
5. Trabajá las vistas **resultados / calling / copy**, marcá **Contactado**
   (supresión) y exportá **CRM / Excel / PDF / KML**.
6. Re-pull cada 90 días. Expandí áreas antes que nichos.

## Si la búsqueda se corta

El output parcial **queda guardado**. La próxima vez que hagas exactamente la
misma búsqueda, la app la reanuda sola. Marcá **"Buscar desde cero"** si
querés arrancar de cero.

## Solución de problemas

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| `Docker error` / búsqueda vacía | Docker cerrado | Abrí Docker Desktop, esperá `Running`, reintentá |
| `Port 3000 is in use` | Otro dev server corriendo | Cerrá la otra ventana o usá `npm run dev -- -p 3001` |
| `Cannot find module` | Falta `npm install` | Corré `npm install` en `apps/web` |
| Build falla con Turbopack y `spawn` | Limitación de Turbopack con rutas relativas | Usá `npx next build --webpack` o `npm run dev` |
| `Ya hay una búsqueda en curso` (409) | La corrida anterior sigue viva | Cancelala o esperá a que termine |
| Búsqueda lentísima | `depth` alto + emails activados | Bajá `depth`, apagá el flag de emails o corré Enriquecer después |

## Estructura del repo

| Carpeta | Qué es |
|---|---|
| `apps/web` | La app (Next.js). Acá va `npm install` y `npm run dev` |
| `services/scraper` | Invocación a Docker. Sin dependencias: no se instala nada |
| `packages/shared` | Catálogo de tipos de Google Places (475) |
| `docs` | Documentación adicional |
