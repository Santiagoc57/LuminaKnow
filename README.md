# Lúmina

Biblioteca web privada para guardar videos de YouTube y publicaciones públicas de X, resumirlos, organizarlos y conversar con el conocimiento indexado usando citas verificables.

## Fuentes compatibles

- YouTube y Shorts: guarda solo el enlace o procesa subtítulos, resumen, entidades y citas temporales.
- Publicaciones públicas de X: pega una URL de `x.com` o `twitter.com`; Lúmina obtiene el texto mediante el oEmbed público oficial, conserva una copia local y permite guardarlo o analizarlo.
- X funciona sin clave ni API de X. Por ahora no importa Favoritos/Bookmarks automáticamente ni reconstruye hilos o respuestas completas.

## Conocimiento conectado

- El inicio funciona como un asistente: primero eliges colecciones o fuentes y luego preguntas.
- Cada colección conserva un chat independiente por perfil y permite excluir fuentes antes de consultar.
- La recuperación combina transcripciones, resúmenes y notas; cada mensaje guarda una copia de las fuentes usadas.
- Las respuestas incluyen la fuente y el tipo de evidencia; los videos añaden el segundo verificable y las publicaciones enlazan al post original. Si la cuota de IA falla, se usa una respuesta extractiva local.
- El grafo global en `/graph` conecta fuentes, colecciones, etiquetas, entidades e ideas. Las conexiones sugeridas pueden confirmarse u ocultarse.
- Las colecciones recuerdan la vista de tarjetas o lista en cada dispositivo.

Las rutas principales son `POST /api/chat`, `GET /api/models`, `GET /api/collections/:id`, `GET /api/graph` y `PATCH /api/graph/edges/:id`. La ruta anterior de chat por video sigue funcionando como adaptador.

## Inicio rápido

Requisitos: macOS, Node.js 20+, Homebrew, `yt-dlp` y FFmpeg.

```bash
npm install
npm run dev -- --hostname 0.0.0.0
```

Abre `http://localhost:3000`. La primera pantalla crea los dos perfiles, sus PIN y permite guardar una clave gratuita de Gemini. OpenAI permanece disponible como respaldo opcional.

### Abrir con doble clic

En Finder, abre `ABRIR_LUMINA.command`. El lanzador inicia Lúmina y abre el navegador automáticamente. La ventana de Terminal puede permanecer minimizada; al cerrarla se detiene la aplicación.

La primera vez que lo uses puede tardar un poco más mientras prepara los componentes necesarios.

Para acceder desde otro dispositivo conectado a la misma red, usa `http://nombre-del-mac.local:3000`.

## Instalación permanente en macOS

```bash
chmod +x scripts/install-local.sh
./scripts/install-local.sh
```

El instalador actualiza `yt-dlp`, construye la aplicación y registra un LaunchAgent que inicia Lúmina automáticamente al entrar en macOS.

## Datos y privacidad

- Base de datos: `data/lumina.sqlite`.
- Claves de Gemini/OpenAI y firma de sesión: `data/secrets.json`, con permisos de propietario.
- Gemini 3.5 Flash-Lite es el proveedor principal; si no hay clave de Gemini, Lúmina puede usar OpenAI como respaldo.
- En el nivel gratuito de Gemini, Google puede utilizar el contenido enviado para mejorar sus productos.
- Copias automáticas y manuales: `backups/`, conservando las siete más recientes.
- Audio temporal: se elimina inmediatamente después de la transcripción.
- Los archivos de video nunca se conservan. De X solo se guarda la URL, sus metadatos y una copia del texto público disponible al momento de añadirlo.

Para restaurar una copia, detén Lúmina y ejecuta:

```bash
npm run restore -- backups/lumina-FECHA.sqlite
```

La copia se valida antes de reemplazar la base y la versión anterior se conserva como `backups/pre-restore-*.sqlite`.

## Verificación

```bash
npm test
npm run lint
npm run build
```
