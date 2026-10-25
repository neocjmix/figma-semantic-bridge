import Foundation
import Darwin

enum DesktopTransfer {
    static let invalidMessage = "The export could not be saved as bounded JSON, Markdown or NDJSON. Choose a writable folder and try again."
    static func save(source: URL, destination: URL, fileExtension: String) throws {
        guard DesktopPolicy.safeExportName(destination.lastPathComponent) != nil,
              destination.pathExtension.lowercased() == fileExtension else { throw HostFailure(invalidMessage) }
        let input = try FileHandle(forReadingFrom: source)
        defer { try? input.close() }
        let limit = DesktopPolicy.transferLimit(extension: fileExtension)
        if fileExtension != "ndjson" {
            var bytes = Data()
            while let part = try input.read(upToCount: 65_536), !part.isEmpty {
                guard Int64(bytes.count + part.count) <= limit else { throw HostFailure(invalidMessage) }
                bytes.append(part)
            }
            guard !bytes.isEmpty, bytes.count <= limit, String(data: bytes, encoding: .utf8) != nil else { throw HostFailure(invalidMessage) }
            if fileExtension == "json" { _ = try JSONSerialization.jsonObject(with: bytes) }
            try bytes.write(to: destination, options: .atomic); return
        }
        let staged = destination.deletingLastPathComponent().appendingPathComponent(".fsb-export-" + UUID().uuidString)
        let fd = Darwin.open(staged.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, S_IRUSR | S_IWUSR)
        guard fd >= 0 else { throw HostFailure(invalidMessage) }
        let output = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        defer { try? output.close(); try? FileManager.default.removeItem(at: staged) }
        var total: Int64 = 0, line = Data(), lines = 0
        func checkLine(_ bytes: Data) throws {
            guard !bytes.isEmpty, bytes.count <= DesktopPolicy.maximumSourceLineBytes,
                  String(data: bytes, encoding: .utf8) != nil,
                  try JSONSerialization.jsonObject(with: bytes) is [String: Any] else { throw HostFailure(invalidMessage) }
        }
        while let bytes = try input.read(upToCount: 65_536), !bytes.isEmpty {
            total += Int64(bytes.count); guard total <= limit else { throw HostFailure(invalidMessage) }
            var start = bytes.startIndex
            while let newline = bytes[start...].firstIndex(of: 0x0a) {
                guard line.count + bytes.distance(from: start, to: newline) <= DesktopPolicy.maximumSourceLineBytes else { throw HostFailure(invalidMessage) }
                line.append(contentsOf: bytes[start..<newline]); try checkLine(line); lines += 1
                line.removeAll(keepingCapacity: false); start = bytes.index(after: newline)
            }
            guard line.count + bytes.distance(from: start, to: bytes.endIndex) <= DesktopPolicy.maximumSourceLineBytes else { throw HostFailure(invalidMessage) }
            line.append(contentsOf: bytes[start...]); try output.write(contentsOf: bytes)
        }
        if !line.isEmpty { try checkLine(line); lines += 1 }
        guard lines > 0 else { throw HostFailure(invalidMessage) }
        try output.synchronize(); try output.close()
        guard Darwin.rename(staged.path, destination.path) == 0 else { throw HostFailure(invalidMessage) }
    }

    static func runSelfTests() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("fsb-native-transfer-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: directory) }
        let source = directory.appendingPathComponent("source"), destination = directory.appendingPathComponent("result.ndjson")
        let record = Data(("{\"text\":\"" + String(repeating: "한글🙂", count: 256) + "\"}\n").utf8)
        let fd = Darwin.open(source.path, O_WRONLY | O_CREAT | O_EXCL, S_IRUSR | S_IWUSR)
        guard fd >= 0 else { throw HostFailure("Transfer fixture creation failed") }
        let writer = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        var bytes = 0
        while bytes <= DesktopPolicy.maximumTransferBytes { try writer.write(contentsOf: record); bytes += record.count }
        try writer.close(); try save(source: source, destination: destination, fileExtension: "ndjson")
        let size = try FileManager.default.attributesOfItem(atPath: destination.path)[.size] as? NSNumber
        guard size?.intValue == bytes, try Data(contentsOf: source) == Data(contentsOf: destination) else { throw HostFailure("Large NDJSON preservation failed") }
        let protected = Data("previous output".utf8); try protected.write(to: destination)
        for invalid in [Data([0xff, 0x0a]), Data("{invalid}\n".utf8), Data("[]\n".utf8), Data(repeating: 0x61, count: DesktopPolicy.maximumSourceLineBytes + 1)] {
            try invalid.write(to: source)
            do { try save(source: source, destination: destination, fileExtension: "ndjson"); throw HostFailure("Invalid NDJSON was accepted") }
            catch let error as HostFailure where error.message == "Invalid NDJSON was accepted" { throw error }
            catch { }
            guard try Data(contentsOf: destination) == protected else { throw HostFailure("Invalid export replaced the destination") }
        }
        print("Desktop transfer self-tests passed: large Unicode NDJSON and invalid-input destination preservation.")
    }
}
