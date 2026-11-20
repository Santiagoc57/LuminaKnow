<p align="center">
  <img src="public/og.png" alt="LUMINA" width="720" />
</p>

<h1 align="center">LUMINA</h1>

<p align="center">
  <strong>Tu segunda mente, privada y local.</strong><br />
  Guarda lo que encuentras en la web y LUMINA lo resume, lo etiqueta y lo conecta. Después puedes preguntarle lo que quieras a tu biblioteca.
</p>

<p align="center">
  <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-black" />
  <img alt="React 19" src="https://img.shields.io/badge/React-19-149eca" />
  <img alt="SQLite" src="https://img.shields.io/badge/SQLite-local-003b57" />
  <img alt="macOS" src="https://img.shields.io/badge/macOS-13%2B-555" />
  <img alt="Privado" src="https://img.shields.io/badge/datos-100%25%20en%20tu%20Mac-e75e3a" />
</p>

---

## Qué es

LUMINA es un gestor de conocimiento personal en la línea de mymind. Todo vive en tu Mac: tus fuentes, tus notas, tus subrayados y la base de datos. Nada pasa por un servidor ajeno, salvo las llamadas a IA que tú decides hacer.

## Características

### Guardar
- **Cualquier fuente:** videos de YouTube, publicaciones e hilos de X, Reddit, Facebook, webs, artículos, imágenes, galerías, PDF, audio, notas y paletas de color.
- **Extensión para Chrome y Firefox:**
  - Un diálogo centrado con título editable, etiquetas sugeridas (que puedes quitar), espacio sugerido y nota.
  - Un botón en cada tweet y un icono discreto sobre imágenes, videos y posts.
  - Captura de la página como portada, como hace mymind.
- **Celular:** una app instalable (PWA) que aparece en «Compartir», con la biblioteca para leer sin conexión y un chat.
- **Telegram:** reenvía enlaces a tu bot y llegan a LUMINA.

### Entender
- **Resúmenes en español:** con ideas clave, títulos que dicen de qué trata cada cosa y un resumen minuto a minuto de los videos.
- **Visión local** (Apple Vision): texto dentro de imágenes, objetos y colores, sin enviar nada fuera.
- **Transcripciones** de videos y audio, descargables en `.txt`.

### Encontrar
- **Un buscador que entiende lo que escribes:** fechas habladas («en septiembre»), tipos (`tipo:pdf`), colores, objetos, texto dentro de imágenes y momentos dentro de los videos.
- **Espacios inteligentes:** tableros que se llenan solos con reglas. Cada uno tiene su chat, se puede ver como documento y como línea de tiempo.
- **«Más como esto»:** muestra imágenes que se ven parecidas.

### Conversar
- **Chat con toda tu biblioteca,** con un espacio o con una sola fuente. Las respuestas citan su origen y el segundo exacto en los videos.
- **Subrayados y recortes con nota,** que se resaltan cuando vuelves a visitar la página.

### Ordenar
- **Limpieza inteligente:** propone qué conservar y qué olvidar, une etiquetas parecidas y mejora los títulos.
- **«En mente»:** las fuentes que fijas para tenerlas a mano.
- **Grafo de conocimiento y revisión diaria:** están en el menú del perfil.

### Como app de Mac
- **`LUMINA.app` en Aplicaciones:** con su icono en el Dock, se abre en su propia ventana y puede arrancar sola al iniciar sesión.
- **Sincronización por turnos con iCloud Drive** entre tus Mac. Si hay un conflicto, la otra versión se guarda aparte y no se pierde nada.

## Inicio rápido

Requisitos: macOS 13 o posterior, Node.js 20 o posterior, `yt-dlp` y FFmpeg.

```bash
npm install
npm run dev -- --hostname 0.0.0.0
```

Abre `http://localhost:3000`. La primera pantalla crea tu perfil con su PIN y te pide la clave de IA (Gemini u OpenAI).

### Como app

```bash
./scripts/app/install-app.sh
```

Esto instala `LUMINA.app` en `/Applications`. Al abrirla, compila el servidor si hace falta, lo arranca y se actualiza sola cuando cambia el código.

### Extensión del navegador

```bash
npm run extension:build
```

- **Chrome:** abre `chrome://extensions`, activa el modo desarrollador y pulsa «Cargar descomprimida». Elige la carpeta `extension/dist/chrome`.
- **Firefox:** `npm run extension:sign` crea el `.xpi` firmado. Necesita tus claves de AMO en un archivo `.amo-keys` local, que no se versiona.

## Estructura

```
app/          Rutas de Next.js (interfaz y API)
components/   Interfaz en React
lib/          Lógica: base de datos, IA, búsqueda, espacios, sincronización…
extension/    Extensión para Chrome y Firefox
public/m/     App para el celular (PWA)
scripts/      App de Mac, copias de seguridad, utilidades
bin/          Ayudantes nativos (Vision, audio)
tests/        Pruebas
```

## Privacidad

- **Lo que nunca se versiona** (está en `.gitignore`): la base de datos (`data/`), las claves (`data/secrets.json`), las copias (`backups/`), las claves de firma (`.amo-keys`) y los paquetes compilados.
- **Las claves de IA** se guardan solo en tu Mac, con permisos de propietario.
- **El celular y la extensión** se vinculan con un código propio y hablan con tu Mac por la red de casa.
- **Copias de seguridad automáticas:** se conservan las siete más recientes. Para restaurar una:

```bash
npm run restore -- backups/lumina-FECHA.sqlite
```

## Desarrollo

```bash
npm test          # pruebas
npm run lint      # estilo
npm run build     # compilación de producción
```

---

<p align="center">Hecho para uso personal · Todos los datos se quedan contigo.</p>
