import Foundation
import Security
import Darwin

/// Immutable local pin shared by health probes, WebKit pages/subresources and downloads.
final class DesktopTrust: @unchecked Sendable {
    let certificateDER: Data
    let port: Int
    private let certificate: SecCertificate
    static let identityFailure = "The private desktop TLS identity could not be verified. Stop the owning service and check ~/.figma-semantic-bridge/desktop-tls; never accept a certificate supplied by another listener."

    init(certificateDER: Data, port: Int = 4178) throws {
        guard certificateDER.count > 0, certificateDER.count <= 16_384,
              let certificate = SecCertificateCreateWithData(nil, certificateDER as CFData) else { throw HostFailure(Self.identityFailure) }
        self.certificateDER = certificateDER; self.certificate = certificate; self.port = port
    }

    static func readIfPresent(dataDirectory: URL) throws -> DesktopTrust? {
        let root = Darwin.open(dataDirectory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard root >= 0 else { throw HostFailure(identityFailure) }
        defer { Darwin.close(root) }
        func privateOwned(_ fd: Int32, directory: Bool) -> Bool {
            var info = stat()
            return fstat(fd, &info) == 0 && (info.st_mode & S_IFMT) == (directory ? S_IFDIR : S_IFREG)
                && info.st_uid == getuid() && info.st_mode & 0o077 == 0 && (directory || info.st_nlink == 1)
        }
        guard privateOwned(root, directory: true) else { throw HostFailure(identityFailure) }
        let directory = openat(root, "desktop-tls", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        if directory < 0 { if errno == ENOENT { return nil }; throw HostFailure(identityFailure) }
        defer { Darwin.close(directory) }
        guard privateOwned(directory, directory: true) else { throw HostFailure(identityFailure) }
        let fd = openat(directory, "pin.der", O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        if fd < 0 { if errno == ENOENT { return nil }; throw HostFailure(identityFailure) }
        defer { Darwin.close(fd) }
        var info = stat()
        guard privateOwned(fd, directory: false), fstat(fd, &info) == 0, info.st_size > 0, info.st_size <= 16_384 else { throw HostFailure(identityFailure) }
        var bytes = [UInt8](repeating: 0, count: 16_385)
        let count = Darwin.read(fd, &bytes, bytes.count)
        guard count > 0, count <= 16_384 else { throw HostFailure(identityFailure) }
        return try DesktopTrust(certificateDER: Data(bytes.prefix(count)))
    }

    func credential(for challenge: URLAuthenticationChallenge) -> URLCredential? {
        let space = challenge.protectionSpace
        guard space.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              space.host == "127.0.0.1", space.port == port, space.protocol == "https",
              challenge.previousFailureCount == 0, let trust = space.serverTrust,
              let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
              let leaf = chain.first, (SecCertificateCopyData(leaf) as Data) == certificateDER else { return nil }
        guard SecTrustSetPolicies(trust, SecPolicyCreateSSL(true, "127.0.0.1" as CFString)) == errSecSuccess,
              SecTrustSetAnchorCertificates(trust, [certificate] as CFArray) == errSecSuccess,
              SecTrustSetAnchorCertificatesOnly(trust, true) == errSecSuccess,
              SecTrustSetNetworkFetchAllowed(trust, false) == errSecSuccess,
              SecTrustEvaluateWithError(trust, nil) else { return nil }
        return URLCredential(trust: trust)
    }
}

final class PinnedSessionDelegate: NSObject, URLSessionTaskDelegate {
    let trust: DesktopTrust
    init(trust: DesktopTrust) { self.trust = trust }
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        let credential = trust.credential(for: challenge)
        completionHandler(credential == nil ? .cancelAuthenticationChallenge : .useCredential, credential)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        let credential = trust.credential(for: challenge)
        completionHandler(credential == nil ? .cancelAuthenticationChallenge : .useCredential, credential)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
