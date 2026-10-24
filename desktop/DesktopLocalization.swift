import Foundation

enum DesktopLocale: String, CaseIterable {
    case ko, en
    static let preferenceKey = "fsb-locale"

    static func initial(saved: String?, preferredLanguages: [String]) -> DesktopLocale {
        if let saved, let value = DesktopLocale(rawValue: saved) { return value }
        let first = preferredLanguages.first?.lowercased().split(separator: "-").first.map(String.init)
        return first == "ko" ? .ko : .en
    }

    static func load(_ defaults: UserDefaults = .standard) -> DesktopLocale {
        initial(saved: defaults.string(forKey: preferenceKey), preferredLanguages: Locale.preferredLanguages)
    }

    func text(_ english: String) -> String { self == .ko ? Self.korean[english] ?? english : english }

    // Translate presentation only. Runtime error strings, exported data and source
    // content retain their original values.
    static let korean: [String: String] = [
        "About Figma Semantic Bridge": "Figma Semantic Bridge 정보",
        "Quit Figma Semantic Bridge": "Figma Semantic Bridge 종료",
        "Edit": "편집", "Undo": "실행 취소", "Cut": "잘라내기", "Copy": "복사", "Paste": "붙여넣기", "Select All": "모두 선택",
        "Bridge": "브리지", "Language": "언어", "Retry": "다시 시도", "OK": "확인", "Import": "가져오기", "Save": "저장",
        "Copy Pairing Token": "페어링 토큰 복사", "Clear Copied Token": "복사한 토큰 지우기",
        "Reveal Figma Plugin": "Figma 플러그인 폴더 보기", "Reveal Local Data": "로컬 데이터 폴더 보기",
        "Copy MCP Configuration": "MCP 설정 복사", "Setup Guide": "설치 가이드", "User Guide": "사용 가이드", "Reload Workspace": "작업 공간 새로고침",
        "Figma Semantic Bridge Setup Guide": "Figma Semantic Bridge 설치 가이드",
        "Figma Semantic Bridge User Guide": "Figma Semantic Bridge 사용 가이드",
        "Figma Semantic Bridge — Connected to Local Service": "Figma Semantic Bridge — 로컬 서비스에 연결됨",
        "Starting the local workspace…": "로컬 작업 공간을 시작하는 중…",
        "Import Capture Bundle": "캡처 묶음 가져오기", "Save Export": "내보낸 파일 저장",
        "The local service stopped. Saved work remains in ~/.figma-semantic-bridge. Choose Retry to start it again.": "로컬 서비스가 중지되었습니다. 저장한 작업은 ~/.figma-semantic-bridge에 남아 있습니다. 다시 시도를 눌러 시작하세요.",
        "The workspace could not start. Check local file access and whether another service owns port 4177, then choose Retry.": "작업 공간을 시작하지 못했습니다. 로컬 파일 접근 권한과 다른 서비스의 4177 포트 사용 여부를 확인한 뒤 다시 시도하세요.",
        "The local workspace could not be loaded. Check the local service and choose Retry.": "로컬 작업 공간을 불러오지 못했습니다. 로컬 서비스를 확인한 뒤 다시 시도하세요.",
        "The workspace renderer stopped. Choose Retry to reopen the saved local workspace.": "작업 공간 화면이 중지되었습니다. 다시 시도를 눌러 저장한 로컬 작업 공간을 여세요.",
        "The web content restrictions could not be enabled.": "웹 콘텐츠 접근 제한을 적용하지 못했습니다.",
        "The local pairing token is unavailable.": "로컬 페어링 토큰을 사용할 수 없습니다.",
        "Export exceeds the 15 MB desktop transfer limit.": "내보내기 파일이 데스크톱 전송 한도인 15 MB를 초과합니다.",
        "The export destination could not be prepared. Choose a writable folder outside application data.": "저장 위치를 준비하지 못했습니다. 앱 데이터 폴더 밖에서 쓸 수 있는 폴더를 선택하세요.",
        "The export could not be saved as bounded JSON or Markdown. Choose a writable folder and try again.": "내보내기 파일을 크기 제한 내의 JSON 또는 Markdown으로 저장하지 못했습니다. 쓸 수 있는 폴더를 선택한 뒤 다시 시도하세요.",
        "The export could not finish. Try exporting again.": "내보내기를 완료하지 못했습니다. 다시 내보내세요.",
        "Start the local service before copying its pairing token.": "페어링 토큰을 복사하기 전에 로컬 서비스를 시작하세요.",
        "The offline setup guide is missing or could not be loaded. Reinstall the complete application archive.": "오프라인 설치 가이드가 없거나 불러올 수 없습니다. 전체 앱 설치 파일로 다시 설치하세요.",
        "The offline user guide is missing or could not be loaded. Reinstall the complete application archive.": "오프라인 사용 가이드가 없거나 불러올 수 없습니다. 전체 앱 설치 파일로 다시 설치하세요.",
        "The desktop lock cannot be opened. Check access to ~/.figma-semantic-bridge.": "데스크톱 실행 잠금 파일을 열지 못했습니다. ~/.figma-semantic-bridge 접근 권한을 확인하세요.",
        "The desktop lock is not a regular file owned by this account.": "데스크톱 실행 잠금 파일이 이 계정 소유의 일반 파일이 아닙니다.",
        "Another Figma Semantic Bridge desktop instance is already running.": "다른 Figma Semantic Bridge 데스크톱 앱이 이미 실행 중입니다.",
        "The pairing-token file cannot be read safely. Check its owner and permissions in ~/.figma-semantic-bridge.": "페어링 토큰 파일을 안전하게 읽을 수 없습니다. ~/.figma-semantic-bridge에서 소유자와 권한을 확인하세요.",
        "The pairing-token file must be a private regular file owned by this account (mode 600).": "페어링 토큰은 이 계정 소유의 비공개 일반 파일이어야 합니다(권한 600).",
        "The local pairing-token file is invalid.": "로컬 페어링 토큰 파일이 유효하지 않습니다.",
        DesktopPolicy.incompatibleServiceMessage: "알 수 없거나 호환되지 않는 서비스가 4177 포트를 사용 중입니다. 해당 앱이나 이전 개발 서비스를 종료하거나 업데이트한 뒤 다시 시도하세요. 데스크톱 앱에는 서비스 \(DesktopPolicy.version)과 스키마 \(DesktopPolicy.schemaVersion)이 필요합니다.",
        "The application bundle is incomplete. Reinstall the complete macOS application archive.": "앱 번들이 완전하지 않습니다. 전체 macOS 앱 설치 파일로 다시 설치하세요.",
        "The bundled local service could not start. Another service may have taken port 4177. Check the earlier service, then choose Retry.": "내장 로컬 서비스를 시작하지 못했습니다. 다른 서비스가 4177 포트를 사용 중일 수 있습니다. 기존 서비스를 확인한 뒤 다시 시도하세요.",
        "The bundled service did not become ready within 12 seconds. Check access to ~/.figma-semantic-bridge, then choose Retry.": "내장 서비스가 12초 안에 준비되지 않았습니다. ~/.figma-semantic-bridge 접근 권한을 확인한 뒤 다시 시도하세요."
    ]

    static func validatedMessage(_ body: Any, isMainFrame: Bool, frameURL: URL?, currentURL: URL?,
                                 originProtocol: String, originHost: String, originPort: Int) -> DesktopLocale? {
        guard isMainFrame, originProtocol == "http", originHost == "127.0.0.1", originPort == 4177,
              let frameURL, DesktopPolicy.isApplicationPage(frameURL), let currentURL, DesktopPolicy.isApplicationPage(currentURL),
              let body = body as? [String: Any], body.count == 1, let raw = body["locale"] as? String else { return nil }
        return DesktopLocale(rawValue: raw)
    }

    static func runSelfTests() throws {
        func check(_ condition: Bool, _ name: String) throws { if !condition { throw HostFailure("Desktop locale self-test failed: " + name) } }
        try check(initial(saved: nil, preferredLanguages: ["ko-KR", "en-US"]) == .ko, "Korean default")
        try check(initial(saved: nil, preferredLanguages: ["en-US", "ko-KR"]) == .en, "first preference only")
        try check(initial(saved: nil, preferredLanguages: []) == .en && initial(saved: "invalid", preferredLanguages: ["fr"]) == .en, "English fallback")
        try check(initial(saved: "en", preferredLanguages: ["ko"]) == .en && initial(saved: "ko", preferredLanguages: ["en"]) == .ko, "stored override")
        func message(_ body: Any = ["locale": "ko"], main: Bool = true, frame: URL? = DesktopPolicy.home, current: URL? = DesktopPolicy.home,
                     proto: String = "http", host: String = "127.0.0.1", port: Int = 4177) -> DesktopLocale? {
            validatedMessage(body, isMainFrame: main, frameURL: frame, currentURL: current, originProtocol: proto, originHost: host, originPort: port)
        }
        try check(message() == .ko && message(["locale": "en"]) == .en, "trusted locale message")
        try check(message(["locale": "fr"]) == nil && message(["locale": 1]) == nil && message(["locale": "ko", "extra": true]) == nil, "strict payload")
        try check(message(main: false) == nil && message(host: "localhost") == nil && message(proto: "https") == nil && message(port: 4178) == nil, "origin boundary")
        for value in ["https://evil.example/", DesktopPolicy.origin + "/api/projects", DesktopPolicy.origin + "/?token=no", "file:///tmp/guide.html"] {
            try check(message(frame: URL(string: value)) == nil && message(current: URL(string: value)) == nil, "root boundary")
        }
        try check(DesktopLocale.ko.text("Retry") == "다시 시도" && DesktopLocale.en.text("Retry") == "Retry", "translated notice")
        let conflict = DesktopLocale.ko.text(DesktopPolicy.incompatibleServiceMessage)
        try check(conflict.contains("서비스 \(DesktopPolicy.version)") && conflict.contains("스키마 \(DesktopPolicy.schemaVersion)"), "current release in translated conflict")
        try check(DesktopLocale.ko.text("SOURCE_CHANGED: exact source text") == "SOURCE_CHANGED: exact source text", "unknown machine data preserved")
        print("Desktop locale self-tests passed. No UI, credentials, preferences or network accessed.")
    }
}
