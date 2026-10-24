import AppKit

let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
for (name, size) in [("icon_16x16", 16), ("icon_16x16@2x", 32), ("icon_32x32", 32), ("icon_32x32@2x", 64), ("icon_128x128", 128), ("icon_128x128@2x", 256), ("icon_256x256", 256), ("icon_256x256@2x", 512), ("icon_512x512", 512), ("icon_512x512@2x", 1024)] {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    let context = NSGraphicsContext(bitmapImageRep: bitmap)!
    NSGraphicsContext.current = context
    context.cgContext.scaleBy(x: CGFloat(size) / 1024, y: CGFloat(size) / 1024)
    NSColor(calibratedRed: 0.20, green: 0.16, blue: 0.40, alpha: 1).setFill()
    NSBezierPath(roundedRect: NSRect(x: 40, y: 40, width: 944, height: 944), xRadius: 214, yRadius: 214).fill()
    NSColor(calibratedRed: 0.65, green: 0.54, blue: 1, alpha: 1).setStroke()
    let source = NSBezierPath(roundedRect: NSRect(x: 195, y: 375, width: 285, height: 385), xRadius: 42, yRadius: 42)
    source.lineWidth = 34; source.stroke()
    NSColor.white.setStroke()
    let semantic = NSBezierPath(roundedRect: NSRect(x: 540, y: 260, width: 285, height: 385), xRadius: 42, yRadius: 42)
    semantic.lineWidth = 34; semantic.stroke()
    NSColor(calibratedRed: 0.53, green: 0.90, blue: 0.76, alpha: 1).setStroke()
    let connection = NSBezierPath()
    connection.move(to: NSPoint(x: 365, y: 510)); connection.line(to: NSPoint(x: 655, y: 510))
    connection.move(to: NSPoint(x: 590, y: 575)); connection.line(to: NSPoint(x: 655, y: 510)); connection.line(to: NSPoint(x: 590, y: 445))
    connection.lineWidth = 38; connection.lineCapStyle = .round; connection.lineJoinStyle = .round; connection.stroke()
    NSGraphicsContext.restoreGraphicsState()
    try bitmap.representation(using: .png, properties: [:])!.write(to: directory.appendingPathComponent(name + ".png"))
}
