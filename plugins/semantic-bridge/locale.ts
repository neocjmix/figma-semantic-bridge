export type PluginLocale = 'ko' | 'en';
export const isPluginLocale = (value: unknown): value is PluginLocale => value === 'ko' || value === 'en';
export const initialPluginLocale = (language?: string): PluginLocale => /^ko(?:-|$)/i.test(language ?? '') ? 'ko' : 'en';

const korean: Record<string, string> = {
  'Open Figma Semantic Bridge on this Mac. Copy the pairing token from its Bridge menu and connect below. Keep this plugin open while you work in the app.': '이 Mac에서 Figma Semantic Bridge 앱을 여세요. 브리지 메뉴에서 연결 토큰을 복사해 아래에 연결하세요. 앱에서 작업하는 동안 이 플러그인을 열어 두세요.',
  'Pairing token': '연결 토큰',
  'Bridge → Copy Pairing Token': '브리지 → 연결 토큰 복사',
  'Connect': '연결', 'Disconnect': '연결 끊기', 'Language': '언어',
  'Disconnected. Your Figma document remains unchanged.': '연결되지 않았습니다. Figma 원본 문서는 변경하지 않습니다.',
  'Disconnected. No source content is being sent.': '연결을 끊었습니다. 원본 콘텐츠를 전송하지 않습니다.',
  'Connecting to the local bridge…': '로컬 브리지에 연결하는 중…',
  'Reconnecting to the local bridge…': '로컬 브리지에 다시 연결하는 중…',
  'Connected. Capture a selected container from the local web app.': '연결되었습니다. Figma에서 프레임을 하나 선택한 뒤 앱으로 돌아가세요.',
  'Local bridge unavailable. Check that the server is running.': '앱에 연결할 수 없습니다. Figma Semantic Bridge가 실행 중인지 확인하세요.',
  'Another plugin connected. Connect explicitly to use this file again.': '다른 플러그인이 연결되었습니다. 이 파일을 사용하려면 다시 연결하세요.',
  'Pairing rejected or invalid bridge message. Verify the token and connect again.': '페어링이 거부되었거나 브리지 메시지가 유효하지 않습니다. 토큰을 확인한 뒤 다시 연결하세요.',
  'Paste the 32–1024 character pairing token printed by the local server.': '앱의 브리지 메뉴에서 연결 토큰을 다시 복사해 붙여넣으세요.',
  'Connection failed.': '연결하지 못했습니다.',
  'Language could not be saved. This choice applies until the plugin closes.': '언어 설정을 저장하지 못했습니다. 플러그인을 닫기 전까지만 적용됩니다.',
  'Saved language could not be loaded. Choose a language here.': '저장한 언어 설정을 불러오지 못했습니다. 여기에서 언어를 선택하세요.',
};

export function pluginText(locale: PluginLocale, english: string): string {
  if (locale === 'en') {
    if (english === 'Paste the 32–1024 character pairing token printed by the local server.') return 'Copy the pairing token again from the app’s Bridge menu, then paste it here.';
    if (english === 'Connected. Capture a selected container from the local web app.') return 'Connected. Select one frame in Figma, then return to the app.';
    if (english === 'Local bridge unavailable. Check that the server is running.') return 'Cannot connect to the app. Check that Figma Semantic Bridge is running.';
    return english;
  }
  const retry = /^Bridge disconnected\. Retrying in (\d+(?:\.\d+)?)s…$/.exec(english);
  if (retry) return `브리지 연결이 끊어졌습니다. ${retry[1]}초 후 다시 시도합니다…`;
  return korean[english] ?? english;
}
