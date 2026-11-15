# Lúmina Companion

Una única extensión con paquetes para Firefox y Chrome. Guarda la pestaña actual en Lúmina, propone etiquetas del catálogo cerrado y muestra fuentes relacionadas mientras navegas.

## Construir los paquetes

```bash
npm run extension:build
```

Los ZIP y paquetes `.xpi` quedan en `public/downloads/` y las carpetas descomprimidas en `extension/dist/`.

## Vincular

1. En Lúmina, abre Ajustes → Extensión del navegador.
2. Genera y copia un código de conexión.
3. Abre las opciones de Lúmina Companion, pega el código y prueba la conexión.

## Instalar en Firefox

La opción “Cargar complemento temporal” de `about:debugging` solo sirve para probar: Firefox lo retira al cerrar o reiniciar el navegador.

Para que permanezca instalado, usa el ZIP de `public/downloads/lumina-companion-firefox.zip` como paquete `.xpi` en una instalación de Firefox que acepte complementos firmados. En Firefox normal, el paquete debe estar firmado por Mozilla (Firefox Developer Edition/Nightly permiten instalarlo localmente con la preferencia de firma desactivada). Una vez instalado de forma permanente, el token y la dirección de Lúmina quedan guardados en el almacenamiento local de la extensión y sobreviven a los reinicios.

Si solo estás desarrollando, vuelve a `about:debugging` → “Este Firefox” → “Cargar complemento temporal” y selecciona `extension/dist/firefox/manifest.json`; tendrás que repetirlo después de cada reinicio.

## Instalar en Chrome

Abre `chrome://extensions`, activa el modo desarrollador, elige “Cargar descomprimida” y selecciona la carpeta de Chrome.
