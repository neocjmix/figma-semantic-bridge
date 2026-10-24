import Foundation
import Darwin

private final class NoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

@MainActor
final class RuntimeController {
    let resources: URL
    let dataDirectory = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".figma-semantic-bridge", isDirectory: true)
    private var lockDescriptor: Int32 = -1
    private(set) var child: Process?
    private(set) var token: String?
    private(set) var reusedService = false
    var onUnexpectedExit: (() -> Void)?
    private var stopping = false
    private var ready = false

    init(resources: URL) { self.resources = resources }

    func acquireInstanceLock() throws {
        if lockDescriptor >= 0 { return }
        try FileManager.default.createDirectory(at: dataDirectory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let path = dataDirectory.appendingPathComponent("desktop-host.lock").path
        let fd = Darwin.open(path, O_CREAT | O_RDWR | O_NOFOLLOW | O_CLOEXEC, S_IRUSR | S_IWUSR)
        guard fd >= 0 else { throw HostFailure("The desktop lock cannot be opened. Check access to ~/.figma-semantic-bridge.") }
        var info = stat()
        guard fstat(fd, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG, info.st_uid == getuid() else {
            Darwin.close(fd); throw HostFailure("The desktop lock is not a regular file owned by this account.")
        }
        guard flock(fd, LOCK_EX | LOCK_NB) == 0 else { Darwin.close(fd); throw HostFailure("Another Figma Semantic Bridge desktop instance is already running.") }
        lockDescriptor = fd
    }

    func readTokenIfPresent() throws -> String? {
        let path = dataDirectory.appendingPathComponent("pairing-token").path
        let fd = Darwin.open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        if fd < 0 {
            if errno == ENOENT { return nil }
            throw HostFailure("The pairing-token file cannot be read safely. Check its owner and permissions in ~/.figma-semantic-bridge.")
        }
        defer { Darwin.close(fd) }
        var info = stat()
        guard fstat(fd, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG, info.st_uid == getuid(),
              info.st_mode & 0o077 == 0, info.st_size >= 32, info.st_size <= 1025 else {
            throw HostFailure("The pairing-token file must be a private regular file owned by this account (mode 600).")
        }
        var bytes = [UInt8](repeating: 0, count: 1026)
        let count = Darwin.read(fd, &bytes, bytes.count)
        guard count >= 0, count <= 1025, let text = String(bytes: bytes.prefix(count), encoding: .utf8) else {
            throw HostFailure("The local pairing-token file is invalid.")
        }
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.utf8.count >= 32, value.utf8.count <= 1024,
              value.unicodeScalars.allSatisfy({ $0.value >= 33 && $0.value <= 126 }) else { throw HostFailure("The local pairing-token file is invalid.") }
        return value
    }

    private func probe(token: String?) async throws -> Bool {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 2; config.timeoutIntervalForResource = 3
        config.urlCache = nil; config.httpCookieStorage = nil; config.urlCredentialStorage = nil
        let session = URLSession(configuration: config, delegate: NoRedirect(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: URL(string: DesktopPolicy.origin + "/api/health")!)
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        if let token { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        do {
            let (bytes, response) = try await session.bytes(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200, token != nil,
                  response.expectedContentLength <= 16_384 else { throw HostFailure(Self.conflictMessage) }
            var data = Data()
            for try await byte in bytes {
                guard data.count < 16_384 else { throw HostFailure(Self.conflictMessage) }
                data.append(byte)
            }
            guard let value = try? JSONSerialization.jsonObject(with: data), DesktopPolicy.compatibleHealth(value) else { throw HostFailure(Self.conflictMessage) }
            return true
        } catch let error as URLError where error.code == .cannotConnectToHost { return false }
    }

    private static let conflictMessage = "Port 4177 is occupied by an unrecognized or incompatible service. Quit or update its owning application or your earlier development service, then choose Retry. The desktop requires service version 0.1.0 and schema 1.0.0."

    func start() async throws {
        stopping = false; ready = false
        try acquireInstanceLock()
        token = try readTokenIfPresent()
        if try await probe(token: token) { reusedService = true; ready = true; return }
        let executable = resources.appendingPathComponent("runtime/node")
        let server = resources.appendingPathComponent("app/server.mjs")
        let web = resources.appendingPathComponent("app/web")
        guard FileManager.default.isExecutableFile(atPath: executable.path), FileManager.default.fileExists(atPath: server.path),
              FileManager.default.fileExists(atPath: web.appendingPathComponent("index.html").path) else {
            throw HostFailure("The application bundle is incomplete. Reinstall the complete macOS application archive.")
        }
        let process = Process()
        process.executableURL = executable; process.arguments = [server.path]
        process.currentDirectoryURL = resources
        process.environment = ["HOME": FileManager.default.homeDirectoryForCurrentUser.path, "PATH": "/usr/bin:/bin", "TMPDIR": NSTemporaryDirectory(),
            "LANG": "en_US.UTF-8", "FSB_PORT": "4177", "FSB_DATA_DIR": dataDirectory.path, "FSB_WEB_DIR": web.path, "FSB_DESKTOP": "1"]
        process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
        process.terminationHandler = { [weak self, weak process] _ in Task { @MainActor in
            guard let self, let process, self.child === process, !self.stopping, self.ready else { return }
            self.ready = false; self.onUnexpectedExit?()
        } }
        try process.run(); child = process; reusedService = false
        let deadline = Date().addingTimeInterval(12)
        do {
            while Date() < deadline {
                guard process.isRunning else { throw HostFailure("The bundled local service could not start. Another service may have taken port 4177. Check the earlier service, then choose Retry.") }
                token = try readTokenIfPresent()
                if try await probe(token: token) { ready = true; return }
                try await Task.sleep(nanoseconds: 200_000_000)
            }
            throw HostFailure("The bundled service did not become ready within 12 seconds. Check access to ~/.figma-semantic-bridge, then choose Retry.")
        } catch { await stopOwnedChild(); throw error }
    }

    func stopOwnedChild() async {
        stopping = true; ready = false
        guard let process = child else { return }
        if process.isRunning {
            process.terminate()
            let deadline = Date().addingTimeInterval(3)
            while process.isRunning && Date() < deadline { try? await Task.sleep(nanoseconds: 50_000_000) }
            if process.isRunning { _ = Darwin.kill(process.processIdentifier, SIGKILL) }
        }
        child = nil
    }

    func releaseLock() {
        if lockDescriptor >= 0 { _ = flock(lockDescriptor, LOCK_UN); Darwin.close(lockDescriptor); lockDescriptor = -1 }
    }
}
