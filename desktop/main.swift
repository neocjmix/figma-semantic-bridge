import AppKit

if CommandLine.arguments.contains("--release-info") {
    do {
        let data = try JSONSerialization.data(withJSONObject: DesktopPolicy.releaseInfo, options: [.sortedKeys])
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0a]))
    } catch { fputs("Desktop release identity could not be encoded.\n", stderr); exit(1) }
} else if CommandLine.arguments.contains("--self-test") {
    do { try DesktopPolicy.runSelfTests(); try DesktopLocale.runSelfTests(); try DesktopTransfer.runSelfTests(); try DesktopDiagnostics.runSelfTests() }
    catch { fputs("Desktop policy self-test failed.\n", stderr); exit(1) }
} else {
    MainActor.assumeIsolated {
        let app = NSApplication.shared
        let host = AppHost()
        app.delegate = host
        app.setActivationPolicy(.regular)
        withExtendedLifetime(host) { app.run() }
    }
}
