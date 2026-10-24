import AppKit
import WebKit
import UniformTypeIdentifiers

@MainActor
private final class GuideNavigation: NSObject, WKNavigationDelegate, WKUIDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(action.request.url?.absoluteString == "about:blank" && action.targetFrame?.isMainFrame == true ? .allow : .cancel)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }
}

@MainActor
private final class ExportTransfer {
    let download: WKDownload
    let directory: URL
    let temporary: URL
    let destination: URL
    let fileExtension: String
    var observation: NSKeyValueObservation?
    init(download: WKDownload, directory: URL, destination: URL, fileExtension: String) {
        self.download = download; self.directory = directory; self.temporary = directory.appendingPathComponent("download")
        self.destination = destination; self.fileExtension = fileExtension
    }
}

@MainActor
final class AppHost: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private var window: NSWindow!
    private var webView: WKWebView?
    private var runtime: RuntimeController!
    private var starting = false
    private var terminating = false
    private var copiedTokenChangeCount: Int?
    private var guideWindow: NSWindow?
    private let guideDelegate = GuideNavigation()
    private var pendingBlobDownloads = Set<String>()
    private var transfers: [ObjectIdentifier: ExportTransfer] = [:]
    private var savePanelPending = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let resources = Bundle.main.resourceURL else { NSApp.terminate(nil); return }
        runtime = RuntimeController(resources: resources)
        installMenus()
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1360, height: 860), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Figma Semantic Bridge"; window.minSize = NSSize(width: 1000, height: 640)
        window.delegate = self; window.isReleasedWhenClosed = false; window.center(); window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        runtime.onUnexpectedExit = { [weak self] in self?.showStartupError("The local service stopped. Saved work remains in ~/.figma-semantic-bridge. Choose Retry to start it again.") }
        retry()
    }

    private func installMenus() {
        let bar = NSMenu()
        let app = NSMenuItem(); bar.addItem(app)
        let appMenu = NSMenu(); app.submenu = appMenu
        appMenu.addItem(withTitle: "About Figma Semantic Bridge", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Figma Semantic Bridge", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let edit = NSMenuItem(); bar.addItem(edit); edit.submenu = NSMenu(title: "Edit")
        for (title, selector, key) in [("Undo", "undo:", "z"), ("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            edit.submenu?.addItem(withTitle: title, action: Selector(selector), keyEquivalent: key)
        }
        let bridge = NSMenuItem(); bar.addItem(bridge); let menu = NSMenu(title: "Bridge"); bridge.submenu = menu
        for (title, action) in [("Copy Pairing Token", #selector(copyPairingToken)), ("Clear Copied Token", #selector(clearCopiedToken)),
                                ("Reveal Figma Plugin", #selector(revealPlugin)), ("Reveal Local Data", #selector(revealData)),
                                ("Copy MCP Configuration", #selector(copyMCPConfiguration)), ("Setup Guide", #selector(showGuide)),
                                ("Reload Workspace", #selector(reloadWorkspace))] {
            let item = NSMenuItem(title: title, action: action, keyEquivalent: ""); item.target = self; menu.addItem(item)
        }
        NSApp.mainMenu = bar
    }

    @objc private func retry() {
        guard !starting, !terminating else { return }
        starting = true
        showStatus("Starting the local workspace…", retry: false)
        Task { @MainActor in
            defer { starting = false }
            do {
                try await runtime.start()
                guard !terminating else { return }
                try await installWorkspace()
            } catch {
                guard !terminating else { return }
                let others = NSRunningApplication.runningApplications(withBundleIdentifier: DesktopPolicy.bundleIdentifier).filter { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }
                if let other = others.first {
                    other.activate(options: [.activateAllWindows, .activateIgnoringOtherApps]); NSApp.terminate(nil); return
                }
                showStartupError((error as? HostFailure)?.message ?? "The workspace could not start. Check local file access and whether another service owns port 4177, then choose Retry.")
            }
        }
    }

    private func showStatus(_ message: String, retry: Bool) {
        webView?.stopLoading(); webView = nil
        let title = NSTextField(labelWithString: "Figma Semantic Bridge")
        title.font = .systemFont(ofSize: 26, weight: .semibold)
        let text = NSTextField(wrappingLabelWithString: message); text.font = .systemFont(ofSize: 15)
        text.maximumNumberOfLines = 10
        let stack = NSStackView(views: [title, text]); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 20
        if retry { stack.addArrangedSubview(NSButton(title: "Retry", target: self, action: #selector(self.retry))) }
        stack.addArrangedSubview(NSButton(title: "Setup Guide", target: self, action: #selector(showGuide)))
        let view = NSView(); stack.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(stack)
        NSLayoutConstraint.activate([stack.centerXAnchor.constraint(equalTo: view.centerXAnchor), stack.centerYAnchor.constraint(equalTo: view.centerYAnchor), stack.widthAnchor.constraint(equalToConstant: 660)])
        window.contentView = view
    }

    private func showStartupError(_ message: String) { showStatus(message, retry: true) }

    private func contentRules(_ json: String, name: String) async throws -> WKContentRuleList {
        try await withCheckedThrowingContinuation { continuation in
            WKContentRuleListStore.default().compileContentRuleList(forIdentifier: name, encodedContentRuleList: json) { list, error in
                if let list { continuation.resume(returning: list) }
                else { continuation.resume(throwing: error ?? HostFailure("The web content restrictions could not be enabled.")) }
            }
        }
    }

    private func installWorkspace() async throws {
        guard let token = runtime.token else { throw HostFailure("The local pairing token is unavailable.") }
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent(); config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.applicationNameForUserAgent = "FigmaSemanticBridge/0.1.0"
        let rules = #"[{"trigger":{"url-filter":".*"},"action":{"type":"block"}},{"trigger":{"url-filter":"^http://127\\.0\\.0\\.1:4177/"},"action":{"type":"ignore-previous-rules"}},{"trigger":{"url-filter":"^data:image/png[;,]"},"action":{"type":"ignore-previous-rules"}},{"trigger":{"url-filter":"^blob:http://127\\.0\\.0\\.1:4177/"},"action":{"type":"ignore-previous-rules"}}]"#
        config.userContentController.add(try await contentRules(rules, name: "fsb-local-only-0.1.0"))
        guard !terminating else { return }
        let encoded = String(data: try JSONEncoder().encode(token), encoding: .utf8)!
        let bootstrap = "if(window.top===window&&location.origin==='\(DesktopPolicy.origin)'&&(location.pathname==='/'||location.pathname==='/index.html')&&!location.search){sessionStorage.setItem('fsb-token',\(encoded));}"
        config.userContentController.addUserScript(WKUserScript(source: bootstrap, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let view = WKWebView(frame: window.contentView?.bounds ?? .zero, configuration: config)
        view.navigationDelegate = self; view.uiDelegate = self
        view.allowsBackForwardNavigationGestures = false
        webView = view; window.contentView = view
        window.title = runtime.reusedService ? "Figma Semantic Bridge — Connected to Local Service" : "Figma Semantic Bridge"
        view.load(URLRequest(url: DesktopPolicy.home))
    }

    private func trustedFrame(_ frame: WKFrameInfo) -> Bool {
        let origin = frame.securityOrigin
        return frame.isMainFrame && origin.protocol == "http" && origin.host == "127.0.0.1" && origin.port == 4177
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if action.shouldPerformDownload && DesktopPolicy.isExportBlob(url) && trustedFrame(action.sourceFrame) {
            pendingBlobDownloads.insert(url.absoluteString); decisionHandler(.download); return
        }
        decisionHandler(action.targetFrame?.isMainFrame == true && DesktopPolicy.isApplicationPage(url) ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        guard response.isForMainFrame, let url = response.response.url, DesktopPolicy.isApplicationPage(url),
              response.response.mimeType == "text/html" else { decisionHandler(.cancel); return }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didReceiveServerRedirectForProvisionalNavigation navigation: WKNavigation!) {
        if let url = webView.url, !DesktopPolicy.isApplicationPage(url) { webView.stopLoading() }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard webView === self.webView, !terminating else { return }
        if (error as NSError).code != NSURLErrorCancelled { showStartupError("The local workspace could not be loaded. Check the local service and choose Retry.") }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard webView === self.webView, !terminating else { return }
        showStartupError("The workspace renderer stopped. Choose Retry to reopen the saved local workspace.")
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }

    func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) { completionHandler(.cancelAuthenticationChallenge, nil) }

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) { decisionHandler(.deny) }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        guard trustedFrame(frame), webView === self.webView else { completionHandler(nil); return }
        let panel = NSOpenPanel(); panel.title = "Import Capture Bundle"; panel.allowedContentTypes = [.json]
        panel.canChooseFiles = true; panel.canChooseDirectories = false; panel.allowsMultipleSelection = false
        panel.beginSheetModal(for: window) { [weak self] response in
            guard let self, response == .OK, let url = panel.url, url.pathExtension.lowercased() == "json",
                  !self.protectedLocation(url), let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey]),
                  values.isRegularFile == true, let size = values.fileSize, size <= DesktopPolicy.maximumTransferBytes else { completionHandler(nil); return }
            completionHandler([url])
        }
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        guard webView === self.webView, let url = download.originalRequest?.url, DesktopPolicy.isExportBlob(url),
              pendingBlobDownloads.remove(url.absoluteString) != nil else { download.cancel(nil); return }
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.cancel(nil) }

    private func protectedLocation(_ url: URL) -> Bool {
        DesktopPolicy.isInside(url, directory: runtime.dataDirectory) || DesktopPolicy.isInside(url, directory: Bundle.main.bundleURL)
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        guard !savePanelPending, transfers.isEmpty, let original = download.originalRequest?.url, DesktopPolicy.isExportBlob(original),
              let name = DesktopPolicy.safeExportName(suggestedFilename), response.expectedContentLength <= DesktopPolicy.maximumTransferBytes,
              DesktopPolicy.isExportMime(response.mimeType, extension: (name as NSString).pathExtension.lowercased()) else { completionHandler(nil); return }
        savePanelPending = true
        let ext = (name as NSString).pathExtension.lowercased(), panel = NSSavePanel()
        panel.title = "Save Export"; panel.nameFieldStringValue = name
        panel.allowedContentTypes = [ext == "json" ? .json : (UTType(filenameExtension: "md") ?? .plainText)]
        panel.allowsOtherFileTypes = false
        panel.beginSheetModal(for: window) { [weak self] result in
            guard let self else { completionHandler(nil); return }
            self.savePanelPending = false
            guard result == .OK, let destination = panel.url, destination.pathExtension.lowercased() == ext, !self.protectedLocation(destination) else { completionHandler(nil); return }
            do {
                let directory = self.runtime.dataDirectory.appendingPathComponent("desktop-export-" + UUID().uuidString, isDirectory: true)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
                let transfer = ExportTransfer(download: download, directory: directory, destination: destination, fileExtension: ext)
                self.transfers[ObjectIdentifier(download)] = transfer
                transfer.observation = download.progress.observe(\.completedUnitCount, options: [.new]) { [weak self, weak download] _, _ in
                    Task { @MainActor in
                        guard let self, let download else { return }
                        if download.progress.completedUnitCount > DesktopPolicy.maximumTransferBytes || download.progress.totalUnitCount > DesktopPolicy.maximumTransferBytes {
                            download.cancel(nil); self.removeTransfer(download); self.alert("Export exceeds the 15 MB desktop transfer limit.")
                        }
                    }
                }
                completionHandler(transfer.temporary)
            } catch { completionHandler(nil); self.alert("The export destination could not be prepared. Choose a writable folder outside application data.") }
        }
    }

    func download(_ download: WKDownload, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, decisionHandler: @escaping (WKDownload.RedirectPolicy) -> Void) { decisionHandler(.cancel) }
    func download(_ download: WKDownload, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) { completionHandler(.cancelAuthenticationChallenge, nil) }

    private func removeTransfer(_ download: WKDownload) {
        if let transfer = transfers.removeValue(forKey: ObjectIdentifier(download)) {
            transfer.observation = nil; try? FileManager.default.removeItem(at: transfer.directory)
        }
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let transfer = transfers[ObjectIdentifier(download)] else { return }
        defer { removeTransfer(download) }
        do {
            let attributes = try FileManager.default.attributesOfItem(atPath: transfer.temporary.path)
            guard let size = attributes[.size] as? NSNumber, size.int64Value <= DesktopPolicy.maximumTransferBytes, !protectedLocation(transfer.destination) else { throw HostFailure("Invalid export.") }
            let data = try Data(contentsOf: transfer.temporary)
            guard String(data: data, encoding: .utf8) != nil else { throw HostFailure("Invalid text export.") }
            if transfer.fileExtension == "json" { _ = try JSONSerialization.jsonObject(with: data) }
            try data.write(to: transfer.destination, options: .atomic)
        } catch { alert("The export could not be saved as bounded JSON or Markdown. Choose a writable folder and try again.") }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) { removeTransfer(download); alert("The export could not finish. Try exporting again.") }

    @objc private func copyPairingToken() {
        guard let token = runtime.token else { alert("Start the local service before copying its pairing token."); return }
        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(token, forType: .string)
        copiedTokenChangeCount = NSPasteboard.general.changeCount
    }
    @objc private func clearCopiedToken() {
        if let count = copiedTokenChangeCount, NSPasteboard.general.changeCount == count { NSPasteboard.general.clearContents() }
        copiedTokenChangeCount = nil
    }
    @objc private func revealPlugin() { NSWorkspace.shared.activateFileViewerSelecting([runtime.resources.appendingPathComponent("plugins/semantic-bridge/manifest.json")]) }
    @objc private func revealData() { NSWorkspace.shared.activateFileViewerSelecting([runtime.dataDirectory]) }
    @objc private func copyMCPConfiguration() {
        let value: [String: Any] = ["mcpServers": ["figma-semantic-bridge": ["command": runtime.resources.appendingPathComponent("runtime/node").path,
            "args": [runtime.resources.appendingPathComponent("app/mcp.mjs").path], "env": ["FSB_DATA_DIR": runtime.dataDirectory.path, "FSB_SERVER_URL": DesktopPolicy.origin]]]]
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]), let text = String(data: data, encoding: .utf8) else { return }
        clearCopiedToken(); NSPasteboard.general.clearContents(); NSPasteboard.general.setString(text, forType: .string)
    }
    @objc private func reloadWorkspace() { webView?.reload() }

    @objc private func showGuide() {
        if let guideWindow { guideWindow.makeKeyAndOrderFront(nil); return }
        Task { @MainActor in
            do {
                let guide = runtime.resources.appendingPathComponent("setup-guide.html")
                let data = try Data(contentsOf: guide)
                guard data.count <= 256_000, let html = String(data: data, encoding: .utf8) else { throw HostFailure("Invalid setup guide.") }
                let config = WKWebViewConfiguration(); config.websiteDataStore = .nonPersistent()
                config.defaultWebpagePreferences.allowsContentJavaScript = false; config.preferences.javaScriptCanOpenWindowsAutomatically = false
                config.userContentController.add(try await contentRules(#"[{"trigger":{"url-filter":".*"},"action":{"type":"block"}}]"#, name: "fsb-guide-no-network"))
                let view = WKWebView(frame: .zero, configuration: config); view.navigationDelegate = guideDelegate; view.uiDelegate = guideDelegate
                let guideWindow = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 800, height: 700), styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
                guideWindow.title = "Figma Semantic Bridge Setup Guide"; guideWindow.isReleasedWhenClosed = false
                guideWindow.contentView = view; guideWindow.center(); self.guideWindow = guideWindow
                view.loadHTMLString(html, baseURL: nil); guideWindow.makeKeyAndOrderFront(nil)
            } catch { alert("The offline setup guide is missing or could not be loaded. Reinstall the complete application archive.") }
        }
    }

    private func alert(_ message: String) {
        guard !terminating else { return }
        let alert = NSAlert(); alert.messageText = "Figma Semantic Bridge"; alert.informativeText = message
        alert.beginSheetModal(for: window)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { window.makeKeyAndOrderFront(nil); return true }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if terminating { return .terminateLater }
        terminating = true; clearCopiedToken(); webView?.stopLoading()
        for transfer in transfers.values { transfer.download.cancel(nil) }
        Task { @MainActor in
            await runtime.stopOwnedChild()
            for transfer in Array(transfers.values) { removeTransfer(transfer.download) }
            runtime.releaseLock(); NSApp.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }
}
