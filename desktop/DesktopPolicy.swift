import Foundation

enum DesktopPolicy {
    static let service = "figma-semantic-bridge"
    static let version = "0.1.0"
    static let schemaVersion = "1.0.0"
    static let bundleIdentifier = "com.neocjmix.figma-semantic-bridge.desktop"
    static let origin = "http://127.0.0.1:4177"
    static let home = URL(string: origin + "/")!
    static let maximumTransferBytes: Int64 = 15_000_000

    static func isLocal(_ url: URL) -> Bool {
        url.scheme == "http" && url.host == "127.0.0.1" && url.port == 4177 && url.user == nil && url.password == nil
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
        guard ["json", "md"].contains(ext), !suggested.contains("/"), !suggested.contains("\\"),
              !suggested.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { return nil }
        if suggested.count > 180 || suggested.hasPrefix(".") { return "export." + ext }
        return suggested
    }

    static func isExportMime(_ mime: String?, extension ext: String) -> Bool {
        let type = mime?.lowercased().split(separator: ";", maxSplits: 1).first.map(String.init)
        return ext == "json" ? type == "application/json" : ["text/markdown", "text/plain"].contains(type ?? "")
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
        for value in ["https://127.0.0.1:4177/", "http://localhost:4177/", "http://127.0.0.1:4178/",
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
        try check(safeExportName("../capture.json") == nil && safeExportName("launch.command") == nil, "deny unsafe destination")
        try check(isExportMime("application/json", extension: "json") && !isExportMime("text/html", extension: "json"), "MIME")
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
