// Writes every frame of a video as PNG files (frame0000.png, frame0001.png, …) into a folder.
// Used by scripts/logo-frames.py on macOS when ffmpeg is not installed: AVFoundation comes
// with the system, so only the Xcode command line tools are needed to run it.
//
// Usage: swift scripts/video-frames.swift <video> <output folder>

import AVFoundation
import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers

let arguments = CommandLine.arguments
guard arguments.count == 3 else {
  FileHandle.standardError.write("usage: swift video-frames.swift <video> <output folder>\n".data(using: .utf8)!)
  exit(2)
}

let asset = AVURLAsset(url: URL(fileURLWithPath: arguments[1]))
let output = URL(fileURLWithPath: arguments[2], isDirectory: true)
guard let track = asset.tracks(withMediaType: .video).first else {
  FileHandle.standardError.write("no video track in \(arguments[1])\n".data(using: .utf8)!)
  exit(1)
}

let reader = try AVAssetReader(asset: asset)
let trackOutput = AVAssetReaderTrackOutput(
  track: track,
  outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
)
reader.add(trackOutput)
reader.startReading()

let context = CIContext()
let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!
var index = 0
while let sample = trackOutput.copyNextSampleBuffer() {
  guard let pixels = CMSampleBufferGetImageBuffer(sample) else { continue }
  let image = CIImage(cvPixelBuffer: pixels)
  guard let frame = context.createCGImage(image, from: image.extent, format: .RGBA8, colorSpace: sRGB) else { continue }
  let url = output.appendingPathComponent(String(format: "frame%04d.png", index))
  let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(destination, frame, nil)
  CGImageDestinationFinalize(destination)
  index += 1
}

guard reader.status == .completed else {
  FileHandle.standardError.write("could not read \(arguments[1]): \(String(describing: reader.error))\n".data(using: .utf8)!)
  exit(1)
}
print("\(index) frames")
