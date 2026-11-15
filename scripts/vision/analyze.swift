// Analiza una imagen en este Mac con Apple Vision: la imagen nunca sale del equipo.
// Uso: lumina-vision <ruta-imagen>   |   lumina-vision --labels
import AppKit
import Foundation
import PDFKit
import Vision

struct Label: Codable { let id: String; let confidence: Double }
struct Swatch: Codable { let hex: String; let share: Double }
struct Analysis: Codable {
  let text: String
  let labels: [Label]
  let colors: [Swatch]
  let width: Int
  let height: Int
  let featurePrint: String?
}

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data((message + "\n").utf8))
  exit(1)
}

func emit<T: Encodable>(_ value: T) {
  guard let data = try? JSONEncoder().encode(value) else { fail("No se pudo serializar el resultado.") }
  FileHandle.standardOutput.write(data)
}

// La huella visual resume el aspecto de la imagen; se guarda como Float32 para compararla sin volver a abrirla.
func featurePrintBase64(_ observation: VNFeaturePrintObservation?) -> String? {
  guard let observation else { return nil }
  let data = observation.data
  switch observation.elementType {
  case .float:
    return data.base64EncodedString()
  case .double:
    let floats = data.withUnsafeBytes { Array($0.bindMemory(to: Double.self)) }.map { Float($0) }
    return floats.withUnsafeBufferPointer { Data(buffer: $0) }.base64EncodedString()
  default:
    return nil
  }
}

// Agrupa los píxeles en una rejilla de color y devuelve los tonos con más presencia.
func dominantColors(_ image: CGImage, limit: Int = 5) -> [Swatch] {
  let side = 64
  var pixels = [UInt8](repeating: 0, count: side * side * 4)
  guard let context = CGContext(data: &pixels, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side * 4,
                                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return [] }
  context.interpolationQuality = .medium
  context.draw(image, in: CGRect(x: 0, y: 0, width: side, height: side))
  var buckets: [Int: (r: Int, g: Int, b: Int, count: Int)] = [:]
  var total = 0
  for index in stride(from: 0, to: pixels.count, by: 4) where pixels[index + 3] > 128 {
    let r = Int(pixels[index]), g = Int(pixels[index + 1]), b = Int(pixels[index + 2])
    let key = (r / 32) << 6 | (g / 32) << 3 | (b / 32)
    var bucket = buckets[key] ?? (0, 0, 0, 0)
    bucket.r += r; bucket.g += g; bucket.b += b; bucket.count += 1
    buckets[key] = bucket
    total += 1
  }
  guard total > 0 else { return [] }
  return buckets.values.sorted { $0.count > $1.count }.prefix(limit).map { bucket in
    Swatch(hex: String(format: "#%02x%02x%02x", bucket.r / bucket.count, bucket.g / bucket.count, bucket.b / bucket.count),
           share: (Double(bucket.count) / Double(total) * 1000).rounded() / 1000)
  }
}

// PDF: texto por página con PDFKit; las páginas sin texto (escaneadas) se leen con Vision.
struct PdfPageText: Codable { let text: String; let ocr: Bool }
struct PdfExtraction: Codable { let title: String; let author: String; let pageCount: Int; let truncated: Bool; let pages: [PdfPageText] }

func recognizeText(_ image: CGImage) -> String {
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = true
  request.recognitionLanguages = ["es-ES", "en-US"]
  guard (try? VNImageRequestHandler(cgImage: image, options: [:]).perform([request])) != nil else { return "" }
  return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}

func extractPdf(path: String, thumbnailPath: String) {
  let maxPages = 1500
  let maxOcrPages = 60
  guard let document = PDFDocument(url: URL(fileURLWithPath: path)) else { fail("No se pudo abrir este PDF.") }
  if document.isLocked { fail("Este PDF está protegido con contraseña.") }
  if let first = document.page(at: 0) {
    let bounds = first.bounds(for: .cropBox)
    let scale = 900 / max(bounds.width, bounds.height, 1)
    let image = first.thumbnail(of: CGSize(width: bounds.width * scale, height: bounds.height * scale), for: .cropBox)
    if let tiff = image.tiffRepresentation, let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
      try? png.write(to: URL(fileURLWithPath: thumbnailPath))
    }
  }
  var pages: [PdfPageText] = []
  var ocrUsed = 0
  for index in 0..<min(document.pageCount, maxPages) {
    guard let page = document.page(at: index) else { pages.append(PdfPageText(text: "", ocr: false)); continue }
    let text = (page.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if text.count >= 20 { pages.append(PdfPageText(text: text, ocr: false)); continue }
    guard ocrUsed < maxOcrPages else { pages.append(PdfPageText(text: text, ocr: false)); continue }
    ocrUsed += 1
    let bounds = page.bounds(for: .cropBox)
    let scale = 2000 / max(bounds.width, bounds.height, 1)
    let rendered = page.thumbnail(of: CGSize(width: bounds.width * scale, height: bounds.height * scale), for: .cropBox)
    if let image = rendered.cgImage(forProposedRect: nil, context: nil, hints: nil) {
      let recognized = recognizeText(image)
      pages.append(recognized.count > text.count ? PdfPageText(text: recognized, ocr: true) : PdfPageText(text: text, ocr: false))
    } else { pages.append(PdfPageText(text: text, ocr: false)) }
  }
  let attributes = document.documentAttributes ?? [:]
  emit(PdfExtraction(title: attributes[PDFDocumentAttribute.titleAttribute] as? String ?? "", author: attributes[PDFDocumentAttribute.authorAttribute] as? String ?? "", pageCount: document.pageCount, truncated: document.pageCount > maxPages, pages: pages))
}

let arguments = CommandLine.arguments
if arguments.count == 4, arguments[1] == "--pdf" {
  extractPdf(path: arguments[2], thumbnailPath: arguments[3])
  exit(0)
}

guard arguments.count == 2 else { fail("Uso: lumina-vision <ruta-imagen> | --labels | --pdf <ruta> <portada>") }

if arguments[1] == "--labels" {
  guard let known = try? VNClassifyImageRequest().supportedIdentifiers() else { fail("Vision no devolvió su catálogo.") }
  emit(known.sorted())
  exit(0)
}

guard let source = NSImage(contentsOfFile: arguments[1]),
      let image = source.cgImage(forProposedRect: nil, context: nil, hints: nil) else { fail("No se pudo abrir la imagen.") }

let textRequest = VNRecognizeTextRequest()
textRequest.recognitionLevel = .accurate
textRequest.usesLanguageCorrection = true
textRequest.recognitionLanguages = ["es-ES", "en-US"]
let classifyRequest = VNClassifyImageRequest()

do {
  try VNImageRequestHandler(cgImage: image, options: [:]).perform([textRequest, classifyRequest])
} catch {
  fail("Vision no pudo analizar la imagen: \(error.localizedDescription)")
}

// La huella se pide aparte: si falla, el texto y las etiquetas siguen siendo válidos.
func generateFeaturePrint(_ image: CGImage) -> VNFeaturePrintObservation? {
  for attempt in 0..<2 {
    let request = VNGenerateImageFeaturePrintRequest()
    if (try? VNImageRequestHandler(cgImage: image, options: [:]).perform([request])) != nil, let result = request.results?.first { return result }
    if attempt == 0 { Thread.sleep(forTimeInterval: 1) }
  }
  return nil
}

let lines = (textRequest.results ?? []).compactMap { $0.topCandidates(1).first }.filter { $0.confidence >= 0.3 }.map { $0.string }
let labels = (classifyRequest.results ?? []).filter { $0.confidence >= 0.2 }.prefix(25)
  .map { Label(id: $0.identifier, confidence: (Double($0.confidence) * 1000).rounded() / 1000) }

emit(Analysis(text: lines.joined(separator: "\n"), labels: Array(labels), colors: dominantColors(image), width: image.width, height: image.height, featurePrint: featurePrintBase64(generateFeaturePrint(image))))
