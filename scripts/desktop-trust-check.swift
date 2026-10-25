import Foundation
import AppKit
import WebKit

@MainActor
private final class WorkspaceProbe: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    let trust: DesktopTrust
    var view: WKWebView?
    var continuation: CheckedContinuation<Bool, Never>?
    init(trust: DesktopTrust) { self.trust = trust }
    func finish(_ result: Bool) { guard let done = continuation else { return }; continuation = nil; view?.stopLoading(); done.resume(returning: result) }
    func run(port: Int) async -> Bool {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            let config = WKWebViewConfiguration(); config.websiteDataStore = .nonPersistent()
            config.userContentController.addUserScript(WKUserScript(source: "sessionStorage.setItem('fsb-token','synthetic-native-trust-token');", injectionTime: .atDocumentStart, forMainFrameOnly: true))
            config.userContentController.add(self, name: "done")
            config.userContentController.add(self, name: "ready")
            let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 200, height: 100), configuration: config)
            self.view = view; view.navigationDelegate = self
            view.load(URLRequest(url: URL(string: "https://127.0.0.1:\(port)/")!))
            Task { try? await Task.sleep(nanoseconds: 8_000_000_000); self.finish(false) }
        }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "ready" {
            FileHandle.standardOutput.write(Data("REPLACE_ASSETS_NOW\n".utf8))
            _ = FileHandle.standardInput.readData(ofLength: 1)
            view?.evaluateJavaScript("const script=document.createElement('script');script.src='/asset.js';script.onerror=()=>window.webkit.messageHandlers.done.postMessage('blocked');document.head.append(script);", completionHandler: nil)
            return
        }
        finish(message.body as? String == "ok")
    }
    func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        let credential = trust.credential(for: challenge)
        completionHandler(credential == nil ? .cancelAuthenticationChallenge : .useCredential, credential)
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { finish(false) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finish(false) }
}

@main
struct DesktopTrustCheck {
    @MainActor
    static func main() async {
        do {
            let args = CommandLine.arguments
            guard args.count == 4, let port = Int(args[3]),
                  let saved = try DesktopTrust.readIfPresent(dataDirectory: URL(fileURLWithPath: args[2])) else { throw HostFailure("Invalid test identity") }
            let trust = try DesktopTrust(certificateDER: saved.certificateDER, port: port)
            let config = URLSessionConfiguration.ephemeral; config.timeoutIntervalForRequest = 3; config.timeoutIntervalForResource = 4
            config.urlCache = nil; config.httpCookieStorage = nil; config.urlCredentialStorage = nil
            let session = URLSession(configuration: config, delegate: PinnedSessionDelegate(trust: trust), delegateQueue: nil)
            defer { session.invalidateAndCancel() }
            var request = URLRequest(url: URL(string: "https://127.0.0.1:\(port)/api/health")!)
            request.setValue("Bearer synthetic-native-trust-token", forHTTPHeaderField: "Authorization")
            do {
                let (_, response) = try await session.data(for: request)
                guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw HostFailure("Rejected response") }
            } catch { print("PROBE_REJECTED: \((error as NSError).code)"); return }
            if args[1] == "probe" { print("PROBE_ACCEPTED"); return }
            if args[1] == "replace" {
                FileHandle.standardOutput.write(Data("REPLACE_NOW\n".utf8))
                _ = FileHandle.standardInput.readData(ofLength: 1)
            }
            _ = NSApplication.shared
            let result = await WorkspaceProbe(trust: trust).run(port: port)
            print(result ? "WORKSPACE_ACCEPTED" : "WORKSPACE_REJECTED")
        } catch { print("IDENTITY_REJECTED") }
    }
}
