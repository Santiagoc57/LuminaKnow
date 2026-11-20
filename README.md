<p align="center">
  <img src="public/og.png" alt="LUMINA" width="720" />
</p>

<h1 align="center">LUMINA</h1>

<p align="center">
  <strong>Tu segunda mente, privada y en tu propio Mac.</strong><br />
  Guarda lo que encuentras en internet (videos, tweets, webs, imágenes, PDF) y LUMINA lo resume, lo ordena y te deja preguntarle lo que quieras.
</p>

<p align="center">
  <img alt="macOS 13+" src="https://img.shields.io/badge/macOS-13%2B-555" />
  <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-black" />
  <img alt="React 19" src="https://img.shields.io/badge/React-19-149eca" />
  <img alt="SQLite" src="https://img.shields.io/badge/SQLite-local-003b57" />
  <img alt="Licencia MIT" src="https://img.shields.io/badge/licencia-MIT-green" />
</p>

---

## ¿De qué va esto? (explicado en un minuto)

¿Te pasa que guardas cosas interesantes (un video, un hilo de X, un artículo, una imagen) y después no las encuentras o no recuerdas qué decían? LUMINA es **una biblioteca personal** para eso.

1. **Guardas.** Mientras navegas, haces clic en el botón de LUMINA en tu navegador o en tu celular.
2. **LUMINA trabaja por ti.** Lee la fuente, escribe un resumen en español, le pone un título claro, la etiqueta por temas y la conecta con cosas parecidas que ya tenías.
3. **Encuentras y preguntas.** Lo buscas como hablarías («lo de diseño que guardé en septiembre») o le haces preguntas a tu biblioteca: *«¿Qué dicen mis videos sobre productividad?»*. Las respuestas te dicen de dónde salen y, en los videos, el minuto exacto.

Se inspira en apps como **mymind**, con una diferencia importante: **todo vive en tu Mac**. No hay cuenta en la nube ni servidor de otra empresa guardando tus cosas.

## ¿Para quién es?

- Para quien guarda mucho contenido y quiere **encontrarlo y aprovecharlo** después.
- Para quien quiere **privacidad**: tus datos no salen de tu computadora.
- Para quien usa **Mac**. Es lo único necesario; además se puede usar desde el celular y desde otros Mac de tu casa.

## Qué puede hacer

| | |
|---|---|
| 📥 **Guardar casi cualquier cosa** | Videos de YouTube, tweets e hilos de X, Reddit, Facebook, webs, artículos, imágenes, galerías, PDF, audios, notas y paletas de color. |
| 🧩 **Extensión para Chrome y Firefox** | Un botón en cada tweet y un icono discreto sobre imágenes y videos. Al guardar se abre una ventanita para cambiar el título, elegir etiquetas y espacio y escribir una nota. En las webs toma una captura como portada. |
| 📱 **Desde el celular** | Una app que se instala desde el navegador y aparece en el menú «Compartir». Permite leer tu biblioteca sin conexión y usar el chat. También puedes enviar enlaces por Telegram. |
| ✨ **Resúmenes con IA** | Ideas clave en español, títulos que explican de qué trata cada cosa y un resumen minuto a minuto de los videos. |
| 👁️ **Lee imágenes en tu Mac** | Con la visión de Apple reconoce el texto dentro de las fotos, los objetos y los colores, sin enviar nada fuera. |
| 🔎 **Buscador que entiende** | Fechas habladas («ayer», «en marzo»), tipos (`tipo:pdf`), colores, texto dentro de imágenes y momentos dentro de los videos. |
| 🗂️ **Espacios inteligentes** | Tableros que se llenan solos según reglas, como «todo lo de diseño web». Cada espacio tiene su chat y se puede ver como documento o como línea de tiempo. |
| 💬 **Chat con tu biblioteca** | Pregúntale a todo, a un espacio o a una sola fuente. Las respuestas siempre citan de dónde salen. |
| 🖍️ **Subrayados y recortes** | Subraya frases y añade notas; cuando vuelves a visitar esa web, se ven resaltadas. |
| 🧹 **Limpieza inteligente** | Te propone qué conservar y qué olvidar, une etiquetas repetidas y mejora los títulos. |
| 🖥️ **App de Mac** | `LUMINA.app` con su icono en el Dock. Se abre en su propia ventana y, si quieres, arranca sola al encender el Mac. |
| ☁️ **Varios Mac con iCloud** | Sincroniza tu biblioteca entre tus Mac por iCloud Drive. Si hay un conflicto, nada se pierde: la otra versión se guarda aparte. |

## Cómo funciona por dentro (sin tecnicismos)

```
 Navegador / celular / Telegram
            │  guardas algo
            ▼
   ┌───────────────────────┐
   │   LUMINA en tu Mac    │  ← un pequeño servidor que solo vive en tu computadora
   │  • base de datos      │     (los datos quedan en la carpeta data/)
   │  • visión de Apple    │
   └──────────┬────────────┘
              │ solo el texto necesario, cuando pides un resumen o haces una pregunta
              ▼
     IA (Gemini u OpenAI, con tu propia clave)
```

La IA es lo único externo. Usa **tu propia clave** y solo recibe el texto necesario para resumir o responder. Todo lo demás (guardar, buscar, leer imágenes, ordenar) ocurre en tu Mac.

## Instalación paso a paso

> Si nunca has usado la Terminal, no te preocupes: son unos pocos comandos para copiar y pegar.

**1. Lo que necesitas antes**
- Un Mac con macOS 13 (Ventura) o posterior.
- [Node.js](https://nodejs.org) 20 o posterior: descárgalo e instálalo como cualquier programa.
- [Homebrew](https://brew.sh) y, con él, las herramientas de video: `brew install yt-dlp ffmpeg`
- Una clave de IA. Sirve la de [Google Gemini](https://aistudio.google.com/apikey), que tiene un plan gratuito, o la de OpenAI.

**2. Descarga LUMINA**

```bash
git clone https://github.com/Santiagoc57/LuminaKnow.git
cd LuminaKnow
npm install
```

**3. Instálala como app de Mac** (recomendado)

```bash
./scripts/app/install-app.sh
```

Aparece **LUMINA** en tu carpeta Aplicaciones. Ábrela: la primera vez tarda un poco porque se prepara.

*¿Solo quieres probarla?* También puedes arrancarla con `npm run dev` y abrir `http://localhost:3000` en tu navegador.

**4. Primeros pasos dentro de la app**
1. Crea tu perfil y tu PIN.
2. Pega tu clave de IA cuando te la pida.
3. Pulsa **+** para guardar tu primer enlace.

**5. Instala la extensión del navegador** (opcional, pero es lo más cómodo)

```bash
npm run extension:build
```

- **Chrome:** entra en `chrome://extensions`, activa el *Modo desarrollador* (arriba a la derecha), pulsa **Cargar descomprimida** y elige la carpeta `extension/dist/chrome`.
- **Firefox:** necesita una versión firmada por Mozilla. Ejecuta `npm run extension:sign`, que pide tus claves de desarrollador de Mozilla en un archivo `.amo-keys`.

Después, en los ajustes de la extensión, vincúlala con el código que aparece en LUMINA → Ajustes.

## Preguntas frecuentes

**¿Mis datos se suben a algún lado?**
No. Se guardan en la carpeta `data/` de tu Mac, y esa carpeta nunca se sube a GitHub. Lo único que sale es el texto que se manda a la IA cuando pides un resumen o haces una pregunta.

**¿Cuánto cuesta?**
LUMINA es gratis. Solo pagas la IA si superas el plan gratuito de tu proveedor. En Ajustes ves cuánto llevas gastado en el mes.

**¿Funciona en Windows o Linux?**
La biblioteca web sí podría, pero la app, la lectura de imágenes y la sincronización con iCloud están hechas para Mac.

**¿Y si borro algo sin querer?**
Archivar no borra: puedes restaurarlo. Además LUMINA hace copias de seguridad automáticas y guarda las siete más recientes. Para volver a una copia:

```bash
npm run restore -- backups/lumina-FECHA.sqlite
```

## Estructura del proyecto (para quien quiera curiosear el código)

```
app/          Pantallas y API (Next.js)
components/   Piezas de la interfaz (React)
lib/          El cerebro: base de datos, IA, búsqueda, espacios, sincronización
extension/    Extensión para Chrome y Firefox
public/m/     App para el celular
scripts/      App de Mac, copias de seguridad y utilidades
bin/          Ayudantes nativos de macOS (visión, audio)
tests/        Pruebas automáticas
```

**Para desarrollar:**

```bash
npm test          # pruebas
npm run lint      # revisa el estilo del código
npm run build     # versión de producción
```

## Privacidad y seguridad

Nunca se suben al repositorio (están en `.gitignore`):

- La base de datos y tus archivos (`data/`).
- Tus claves de IA (`data/secrets.json`).
- Las copias de seguridad (`backups/`).
- Las claves de firma de la extensión (`.amo-keys`).
- Los paquetes compilados.

La extensión y el celular se conectan a tu Mac con un código de vinculación propio y solo dentro de tu red.

## Licencia

[MIT](LICENSE): puedes usarlo, modificarlo y compartirlo libremente.

---

<p align="center">Hecho con cariño para uso personal · Tus ideas se quedan contigo.</p>
