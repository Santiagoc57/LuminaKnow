// Divide un audio en tramos .m4a usando AVFoundation (incluido en macOS, sin ffmpeg).
// Uso: lumina-audio-split <entrada> <carpeta-salida> <segundos-por-tramo>
// Imprime en stdout la ruta de cada tramo, una por línea.
import AVFoundation
import Foundation

let args = CommandLine.arguments
guard args.count == 4, let seconds = Double(args[3]), seconds > 0 else {
  FileHandle.standardError.write("uso: lumina-audio-split <entrada> <salida> <segundos>\n".data(using: .utf8)!)
  exit(2)
}
let input = URL(fileURLWithPath: args[1])
let outputDir = URL(fileURLWithPath: args[2], isDirectory: true)
let asset = AVURLAsset(url: input)

func duration() async throws -> Double {
  let value = try await asset.load(.duration)
  return CMTimeGetSeconds(value)
}

func export(start: Double, length: Double, to url: URL) async throws {
  guard let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
    throw NSError(domain: "lumina", code: 1, userInfo: [NSLocalizedDescriptionKey: "No se pudo preparar la exportación de audio."])
  }
  session.outputURL = url
  session.outputFileType = .m4a
  session.timeRange = CMTimeRange(start: CMTime(seconds: start, preferredTimescale: 600), duration: CMTime(seconds: length, preferredTimescale: 600))
  await session.export()
  if session.status != .completed {
    throw session.error ?? NSError(domain: "lumina", code: 2, userInfo: [NSLocalizedDescriptionKey: "Falló la exportación de un tramo."])
  }
}

let semaphore = DispatchSemaphore(value: 0)
var failure: Error?
Task {
  do {
    let total = try await duration()
    guard total > 0 else { throw NSError(domain: "lumina", code: 3, userInfo: [NSLocalizedDescriptionKey: "El audio no tiene duración."]) }
    try FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)
    var start = 0.0
    var index = 0
    while start < total {
      let url = outputDir.appendingPathComponent(String(format: "segment-%03d.m4a", index))
      try? FileManager.default.removeItem(at: url)
      try await export(start: start, length: min(seconds, total - start), to: url)
      print(url.path)
      start += seconds
      index += 1
    }
  } catch { failure = error }
  semaphore.signal()
}
semaphore.wait()
if let failure {
  FileHandle.standardError.write("\(failure.localizedDescription)\n".data(using: .utf8)!)
  exit(1)
}
