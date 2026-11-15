// Convierte un color a su nombre en español para poder buscar con color:azul.
export function colorName(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  if (lightness < 0.13) return "negro";
  if (lightness > 0.92) return "blanco";
  if (saturation < 0.15) return "gris";
  const hue = (delta === 0 ? 0 : max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60;
  if (hue < 15 || hue >= 345) return lightness > 0.72 ? "rosa" : "rojo";
  if (hue < 40) return lightness < 0.42 ? "marron" : "naranja";
  if (hue < 68) return lightness < 0.36 ? "marron" : "amarillo";
  if (hue < 170) return "verde";
  if (hue < 255) return "azul";
  if (hue < 300) return "morado";
  return "rosa";
}
