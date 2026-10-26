import Foundation

enum DesktopPolicy {
    static let service = "figma-semantic-bridge"
    static let version = "0.3.0"
    static let schemaVersion = "1.0.0"
    static let releaseInfo = ["service": service, "version": version, "schemaVersion": schemaVersion]
    static let incompatibleServiceMessage = "Ports 4177/4178 are occupied by an unrecognized, HTTP-only or incompatible service. Quit or update its owning application or earlier development service, then choose Retry. The desktop requires pinned TLS, service version \(version) and schema \(schemaVersion)."
    static let bundleIdentifier = "com.neocjmix.figma-semantic-bridge.desktop"
    static let origin = "https://127.0.0.1:4178"
    static let mcpOrigin = origin
    static let home = URL(string: origin + "/")!
    static let maximumTransferBytes: Int64 = 15_000_000
    static let maximumSourceTransferBytes: Int64 = 80_000_000
    static let maximumSourceLineBytes = 13_000_000
    static func transferLimit(extension ext: String) -> Int64 { ext == "ndjson" ? maximumSourceTransferBytes : maximumTransferBytes }
    static func isImportName(_ name: String) -> Bool { ["json", "ndjson"].contains((name as NSString).pathExtension.lowercased()) }

    static func isLocal(_ url: URL) -> Bool {
        url.scheme == "https" && url.host == "127.0.0.1" && url.port == 4178 && url.user == nil && url.password == nil
    }

    static func isApplicationPage(_ url: URL) -> Bool {
        isLocal(url) && (url.path == "/" || url.path == "/index.html") && url.query == nil
    }

    static func isExportBlob(_ url: URL) -> Bool {
        let prefix = "blob:" + origin + "/"
        let value = url.absoluteString
        return value.hasPrefix(prefix) && UUID(uuidString: String(value.dropFirst(prefix.count))) != nil
    }

    static func safeExportName(_ suggested: String) -> String? {
        let ext = (suggested as NSString).pathExtension.lowercased()
        guard ["json", "md", "ndjson"].contains(ext), !suggested.contains("/"), !suggested.contains("\\"),
              !suggested.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { return nil }
        if suggested.count > 180 || suggested.hasPrefix(".") { return "export." + ext }
        return suggested
    }

    static func isExportMime(_ mime: String?, extension ext: String) -> Bool {
        let type = mime?.lowercased().split(separator: ";", maxSplits: 1).first.map(String.init)
        if ext == "json" { return type == "application/json" }
        if ext == "ndjson" { return ["application/x-ndjson", "application/ndjson"].contains(type ?? "") }
        return ext == "md" && ["text/markdown", "text/plain"].contains(type ?? "")
    }

    static func isInside(_ url: URL, directory: URL) -> Bool {
        let path = url.resolvingSymlinksInPath().standardizedFileURL.path
        let root = directory.resolvingSymlinksInPath().standardizedFileURL.path
        return path == root || path.hasPrefix(root + "/")
    }

    static func compatibleHealth(_ value: Any) -> Bool {
        guard let fields = value as? [String: Any] else { return false }
        return fields["ok"] as? Bool == true && fields["service"] as? String == service
            && fields["version"] as? String == version && fields["schemaVersion"] as? String == schemaVersion
    }

    static func runSelfTests() throws {
        func check(_ condition: Bool, _ name: String) throws {
            if !condition { throw HostFailure("Desktop policy self-test failed: " + name) }
        }
        try check(isApplicationPage(home), "local root")
        for value in ["https://127.0.0.1:4177/", "http://127.0.0.1:4177/", "https://localhost:4178/", "http://localhost:4177/", "http://127.0.0.1:4178/",
                      "http://127.0.0.1:4177.evil.example/", "http://user@127.0.0.1:4177/", "file:///etc/passwd",
                      origin + "/api/projects", origin + "/?token=secret", "data:text/html,hello", "javascript:alert(1)"] {
            try check(URL(string: value).map { !isApplicationPage($0) } ?? true, "deny navigation")
        }
        let id = "12345678-1234-4234-9234-123456789abc"
        try check(isExportBlob(URL(string: "blob:" + origin + "/" + id)!), "own blob")
        for value in ["blob:https://evil.example/" + id, "blob:" + origin + "/../../secret", "blob:null/" + id] {
            try check(!isExportBlob(URL(string: value)!), "deny foreign blob")
        }
        try check(safeExportName("capture.json") == "capture.json", "JSON export")
        try check(safeExportName("source.ndjson") == "source.ndjson" && isImportName("source.ndjson"), "NDJSON import/export")
        try check(!isImportName("source.md") && !isImportName("source.command"), "import formats")
        try check(transferLimit(extension: "ndjson") == 80_000_000 && transferLimit(extension: "json") == 15_000_000 && transferLimit(extension: "md") == 15_000_000, "per-format transfer budgets")
        try check(safeExportName("../capture.json") == nil && safeExportName("launch.command") == nil, "deny unsafe destination")
        try check(isExportMime("application/json", extension: "json") && !isExportMime("text/html", extension: "json"), "MIME")
        try check(isExportMime("application/x-ndjson", extension: "ndjson") && !isExportMime("application/json", extension: "ndjson") && !isExportMime("text/html", extension: "ndjson"), "NDJSON MIME")
        let base = URL(fileURLWithPath: "/tmp/desktop-policy")
        try check(isInside(base.appendingPathComponent("projects/a.json"), directory: base), "protected directory")
        try check(!isInside(URL(fileURLWithPath: "/tmp/desktop-policy-other/a.json"), directory: base), "directory boundary")
        let health: [String: Any] = ["ok": true, "service": service, "version": version, "schemaVersion": schemaVersion]
        try check(compatibleHealth(health), "matching release")
        var wrong = health; wrong["version"] = "0.0.0"
        try check(!compatibleHealth(wrong) && !compatibleHealth(["ok": true, "schemaVersion": schemaVersion]), "reject incompatible release")
        print("Desktop policy self-tests passed. No UI, credentials or network accessed.")
    }
}

struct HostFailure: Error, LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
