import AppKit
import CoreImage
import Foundation
import Vision

enum BackgroundReplacementError: Error, CustomStringConvertible {
    case usage
    case cannotLoadImage(String)
    case noPerson(String)

    var description: String {
        switch self {
        case .usage:
            return "用法：replace_video_background <输入帧目录> <背景图片> <输出帧目录>"
        case .cannotLoadImage(let path):
            return "无法读取图片：\(path)"
        case .noPerson(let path):
            return "未识别到人物：\(path)"
        }
    }
}

func loadImage(_ path: String) throws -> CIImage {
    guard let image = CIImage(contentsOf: URL(fileURLWithPath: path), options: [.applyOrientationProperty: true]) else {
        throw BackgroundReplacementError.cannotLoadImage(path)
    }
    return image
}

func aspectFill(_ image: CIImage, into extent: CGRect) -> CIImage {
    let scale = max(extent.width / image.extent.width, extent.height / image.extent.height)
    let scaled = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    let x = scaled.extent.midX - extent.midX
    let y = scaled.extent.midY - extent.midY
    return scaled.transformed(by: CGAffineTransform(translationX: -x, y: -y)).cropped(to: extent)
}

func replaceBackground(framePath: String, background: CIImage, outputPath: String, context: CIContext) throws {
    let frame = try loadImage(framePath)
    let request = VNGenerateForegroundInstanceMaskRequest()
    let handler = VNImageRequestHandler(ciImage: frame)
    try handler.perform([request])
    guard let observation = request.results?.first, !observation.allInstances.isEmpty else {
        throw BackgroundReplacementError.noPerson(framePath)
    }

    let maskBuffer = try observation.generateScaledMaskForImage(
        forInstances: observation.allInstances,
        from: handler
    )
    let softMask = CIImage(cvPixelBuffer: maskBuffer)
        .applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: 0.7])
        .cropped(to: frame.extent)
    let room = aspectFill(background, into: frame.extent)
    let composite = frame.applyingFilter("CIBlendWithMask", parameters: [
        kCIInputBackgroundImageKey: room,
        kCIInputMaskImageKey: softMask,
    ]).cropped(to: frame.extent)

    let outputURL = URL(fileURLWithPath: outputPath)
    try context.writePNGRepresentation(
        of: composite,
        to: outputURL,
        format: .RGBA8,
        colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
        options: [:]
    )
}

do {
    guard CommandLine.arguments.count == 4 else { throw BackgroundReplacementError.usage }
    let inputDirectory = CommandLine.arguments[1]
    let backgroundPath = CommandLine.arguments[2]
    let outputDirectory = CommandLine.arguments[3]
    let manager = FileManager.default
    try manager.createDirectory(atPath: outputDirectory, withIntermediateDirectories: true)
    let background = try loadImage(backgroundPath)
    let frames = try manager.contentsOfDirectory(atPath: inputDirectory)
        .filter { $0.lowercased().hasSuffix(".png") }
        .sorted()
    let context = CIContext(options: [.cacheIntermediates: false])

    for (index, filename) in frames.enumerated() {
        try autoreleasepool {
            let input = (inputDirectory as NSString).appendingPathComponent(filename)
            let output = (outputDirectory as NSString).appendingPathComponent(filename)
            try replaceBackground(framePath: input, background: background, outputPath: output, context: context)
        }
        if (index + 1) % 25 == 0 || index + 1 == frames.count {
            print("已处理 \(index + 1)/\(frames.count) 帧")
        }
    }
} catch {
    FileHandle.standardError.write(Data("\(error)\n".utf8))
    exit(1)
}
