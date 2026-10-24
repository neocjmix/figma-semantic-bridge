import AppKit

if CommandLine.arguments.contains("--self-test") {
    do { try DesktopPolicy.runSelfTests() }
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
