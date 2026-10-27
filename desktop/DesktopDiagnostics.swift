import Foundation
import Darwin

/// Private metadata only. Never write console arguments, NSError text or process output.
final class DesktopDiagnostics {
    let directory: URL
    private let queue = DispatchQueue(label: "fsb.private-diagnostics", qos: .utility)
    private let session = UUID().uuidString
    private let pendingLock = NSLock()
    private var pending = 0
    private var count = 0
    private var errorCount = 0
    private var window = Date.distantPast
    init(dataDirectory: URL) { directory = dataDirectory.appendingPathComponent("logs", isDirectory: true) }

    func record(_ event: String, level: String = "info", fields: [String: Any] = [:]) {
        pendingLock.lock()
        guard pending < (level == "error" ? 320 : 256) else { pendingLock.unlock(); return }
        pending += 1; pendingLock.unlock()
        queue.async { [self] in
            defer { pendingLock.lock(); pending -= 1; pendingLock.unlock() }
            let now = Date()
            if now.timeIntervalSince(window) >= 60 { window = now; count = 0; errorCount = 0 }
            if level == "error" { guard errorCount < 240 else { return }; errorCount += 1 }
            else { guard count < 600 else { return }; count += 1 }
            let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            var row: [String: Any] = ["time": formatter.string(from: now), "version": DesktopPolicy.version,
                "sessionId": session, "source": "native", "event": event, "level": level]
            for key in ["status", "errorCode", "durationMs", "requestId", "action", "code", "argumentCount", "errorType", "resourceType", "frames"] {
                if let value = fields[key] { row[key] = value }
            }
            guard var bytes = try? JSONSerialization.data(withJSONObject: row), bytes.count < 16_384 else { return }
            bytes.append(10)
            do {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
                var directoryInfo = stat()
                guard lstat(directory.path, &directoryInfo) == 0, directoryInfo.st_mode & S_IFMT == S_IFDIR, directoryInfo.st_uid == getuid() else { return }
                guard chmod(directory.path, 0o700) == 0 else { return }
                let path = directory.appendingPathComponent("native.ndjson").path
                for index in 0..<5 {
                    let old = directory.appendingPathComponent(index == 0 ? "native.ndjson" : "native.\(index).ndjson").path
                    var info = stat()
                    if lstat(old, &info) == 0, info.st_mode & S_IFMT == S_IFREG, now.timeIntervalSince1970 - Double(info.st_mtimespec.tv_sec) > 7 * 86_400 { _ = unlink(old) }
                }
                var current = stat()
                if lstat(path, &current) == 0 {
                    guard current.st_mode & S_IFMT == S_IFREG, current.st_uid == getuid() else { return }
                    if current.st_size + Int64(bytes.count) > 5_000_000 {
                        _ = unlink(directory.appendingPathComponent("native.4.ndjson").path)
                        for index in stride(from: 3, through: 1, by: -1) { _ = rename(directory.appendingPathComponent("native.\(index).ndjson").path, directory.appendingPathComponent("native.\(index + 1).ndjson").path) }
                        _ = rename(path, directory.appendingPathComponent("native.1.ndjson").path)
                    }
                }
                let fd = Darwin.open(path, O_CREAT | O_WRONLY | O_APPEND | O_NOFOLLOW | O_CLOEXEC, S_IRUSR | S_IWUSR)
                guard fd >= 0 else { return }; defer { Darwin.close(fd) }
                var info = stat()
                guard fstat(fd, &info) == 0, info.st_mode & S_IFMT == S_IFREG, info.st_uid == getuid() else { return }
                _ = fchmod(fd, 0o600)
                bytes.withUnsafeBytes { buffer in
                    guard let start = buffer.baseAddress else { return }; var offset = 0
                    while offset < bytes.count { let written = Darwin.write(fd, start.advanced(by: offset), bytes.count - offset); if written <= 0 { break }; offset += written }
                }
            } catch { /* Logging is best effort and cannot interrupt the workspace. */ }
        }
    }

    static func validFrame(_ frame: String) -> Bool {
        guard frame.count <= 240,
              frame.range(of: "^(web/|src/|app/|assets/|server\\.mjs|mcp\\.mjs)[A-Za-z0-9_./-]*:[0-9]+:[0-9]+$", options: .regularExpression) != nil else { return false }
        return (frame.components(separatedBy: ":").first ?? "").components(separatedBy: "/").allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." }
    }

    static func clientFields(_ body: Any) -> (String, String, [String: Any])? {
        guard let value = body as? [String: Any], value.count <= 12,
              let event = value["event"] as? String,
              ["web.console", "web.error", "web.unhandledrejection", "web.ready", "ui.action.start", "ui.action.complete", "ui.action.error", "ui.request.start", "ui.request.complete", "ui.request.error"].contains(event),
              let level = value["level"] as? String, ["debug", "info", "warn", "error"].contains(level) else { return nil }
        let allowed: Set<String> = ["event", "level", "requestId", "durationMs", "status", "code", "action", "argumentCount", "errorType", "resourceType", "frames"]
        guard value.keys.allSatisfy({ allowed.contains($0) }) else { return nil }
        var fields: [String: Any] = [:]
        if let id = value["requestId"] as? String, UUID(uuidString: id) != nil { fields["requestId"] = id }
        if let code = value["code"] as? String, code.range(of: "^[A-Z][A-Z0-9_]{0,79}$", options: .regularExpression) != nil { fields["code"] = code }
        if let action = value["action"] as? String, ["connect", "create_workspace", "import_source", "inspect_sources", "edit_region", "review_region", "edit_specification", "export", "undo", "redo", "settings", "refresh", "editor.action", "region.draw", "region.edit", "specification.begin", "workspace.switch", "unknown"].contains(action) { fields["action"] = action }
        if let resource = value["resourceType"] as? String, ["script", "style", "image", "unknown"].contains(resource) { fields["resourceType"] = resource }
        if let type = value["errorType"] as? String, ["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "URIError", "EvalError", "DOMException", "ApiError", "Unknown"].contains(type) { fields["errorType"] = type }
        for key in ["durationMs", "status", "argumentCount"] { if let number = value[key] as? Double, number.isFinite, number >= 0, number <= (key == "durationMs" ? 86_400_000 : key == "status" ? 599 : 1000) { fields[key] = number } }
        if let frames = value["frames"] as? [String], frames.count <= 20, frames.allSatisfy(validFrame) { fields["frames"] = frames }
        return (event, level, fields)
    }

    static func runSelfTests() throws {
        func check(_ condition: Bool) throws { if !condition { throw HostFailure("Diagnostic self-test failed.") } }
        try check(clientFields(["event": "web.error", "level": "error", "message": "private"]) == nil)
        let accepted = clientFields(["event": "web.error", "level": "error", "errorType": "TypeError", "frames": ["assets/index-abc.js:2:3"]])
        try check(accepted?.2["errorType"] as? String == "TypeError")
        let rejectedPath = clientFields(["event": "web.error", "level": "error", "frames": ["/Users/private/secret.js:1:1"]])
        try check(rejectedPath?.2["frames"] == nil)
        for frame in ["src/../../Users/private/file.js:1:2", "src/./file.ts:1:2", "src//file.ts:1:2"] {
            try check(!validFrame(frame))
            try check(clientFields(["event": "web.error", "level": "error", "frames": [frame]])?.2["frames"] == nil)
        }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("fsb-diagnostics-check-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let log = DesktopDiagnostics(dataDirectory: root)
        log.record("runtime.ready", fields: ["secret": "PRIVATE-SENTINEL", "status": 200])
        log.queue.sync {}
        let bytes = try String(contentsOf: log.directory.appendingPathComponent("native.ndjson"), encoding: .utf8)
        try check(bytes.contains("runtime.ready") && !bytes.contains("PRIVATE-SENTINEL"))
        var info = stat()
        try check(lstat(log.directory.appendingPathComponent("native.ndjson").path, &info) == 0 && info.st_mode & 0o777 == 0o600)
    }

    static let bootstrap = #"""
    (()=>{
      if(window.top!==window||location.origin!=='https://127.0.0.1:4178'||!['/','/index.html'].includes(location.pathname)||location.search||window.__FSB_DIAGNOSTICS__)return;
      window.__FSB_DIAGNOSTICS__=true;
      let count=0,errors=0,at=Date.now();
      const send=value=>{try{if(Date.now()-at>60000){at=Date.now();count=0;errors=0;}if(value.level==='error'?++errors<=120:++count<=180)window.webkit.messageHandlers.fsbDiagnostics.postMessage(value);}catch{}};
      const validFrame=value=>/^(?:web\/|src\/|app\/|assets\/|server\.mjs|mcp\.mjs)[A-Za-z0-9_./-]*:\d+:\d+$/.test(value)&&value.split(':')[0].split('/').every(part=>part!==''&&part!=='.'&&part!=='..');
      const frames=error=>{try{if(!(error instanceof Error)||typeof error.stack!=='string')return [];let stack=error.stack;const prefix=error.name+': '+error.message;if(stack.startsWith(prefix))stack=stack.slice(prefix.length);return stack.split('\n').slice(0,30).filter((line,index)=>index>0||!line.includes('Error:')).flatMap(line=>{const m=line.match(/(?:^|[/\\])((?:web|src|app|assets)\/[A-Za-z0-9_./-]+|server\.mjs|mcp\.mjs):(\d+):(\d+)(?:\)?$)/);const frame=m?m[1]+':'+m[2]+':'+m[3]:'';return frame.length<=240&&validFrame(frame)?[frame]:[];}).slice(0,20);}catch{return [];}};
      const type=error=>['Error','TypeError','RangeError','ReferenceError','SyntaxError','URIError','EvalError','DOMException','ApiError'].includes(error?.name)?error.name:'Unknown';
      for(const level of ['warn','error']){const original=console[level].bind(console);console[level]=(...args)=>{send({event:'web.console',level,argumentCount:Math.min(args.length,1000),frames:frames(new Error())});original(...args);};}
      window.addEventListener('error',e=>send({event:'web.error',level:'error',errorType:type(e.error),frames:frames(e.error),resourceType:e.target instanceof HTMLScriptElement?'script':e.target instanceof HTMLLinkElement?'style':e.target instanceof HTMLImageElement?'image':'unknown'}),true);
      window.addEventListener('unhandledrejection',e=>send({event:'web.unhandledrejection',level:'error',errorType:type(e.reason),frames:frames(e.reason)}));
      send({event:'web.ready',level:'info'});
    })();
    """#
}
