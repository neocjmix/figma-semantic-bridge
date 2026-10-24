import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isLocale, renderMessage, resolveLocale, translate, type Locale, type MessageKey, type MessageParams, type UIMessage } from './locale.js';

declare global {
  interface Window {
    __FSB_DESKTOP_LOCALE__?: unknown;
    webkit?: { messageHandlers?: { fsbLocale?: { postMessage(value: { locale: Locale }): void } } };
  }
}
function storedLocale(): unknown { try { return window.localStorage.getItem('fsb-locale'); } catch { return undefined; } }
function persistLocale(locale: Locale) { try { window.localStorage.setItem('fsb-locale', locale); } catch { /* Session choice still works without storage. */ } }
function initialLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  return resolveLocale({ desktopLocale: window.__FSB_DESKTOP_LOCALE__, storedLocale: storedLocale(), language: navigator.language });
}
interface LocaleContextValue {
  locale: Locale;
  setLocale(value: Locale): void;
  t(key: MessageKey, params?: MessageParams): string;
  renderMessage(value: UIMessage): string;
  formatNumber(value: number): string;
  formatDate(value: string): string;
}
const LocaleContext = createContext<LocaleContextValue | null>(null);
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, updateLocale] = useState(initialLocale);
  const setLocale = useCallback((value: Locale) => {
    if (!isLocale(value)) return;
    updateLocale(value); persistLocale(value);
    try { window.webkit?.messageHandlers?.fsbLocale?.postMessage({ locale: value }); } catch { /* Native delivery must not discard the browser choice. */ }
  }, []);
  useEffect(() => {
    const nativeChange = (event: Event) => {
      const value: unknown = (event as CustomEvent<unknown>).detail;
      if (!isLocale(value)) return;
      window.__FSB_DESKTOP_LOCALE__ = value; updateLocale(value); persistLocale(value);
    };
    window.addEventListener('fsb-locale-change', nativeChange);
    return () => window.removeEventListener('fsb-locale-change', nativeChange);
  }, []);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  const value = useMemo<LocaleContextValue>(() => ({ locale, setLocale,
    t: (key, params) => translate(locale, key, params), renderMessage: value => renderMessage(locale, value),
    formatNumber: value => value.toLocaleString(locale === 'ko' ? 'ko-KR' : 'en-US'),
    formatDate: value => new Date(value).toLocaleString(locale === 'ko' ? 'ko-KR' : 'en-US'),
  }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('LocaleProvider is required.');
  return value;
}
export function LanguageSelector() {
  const { locale, setLocale } = useLocale();
  return <label className="language-selector" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, whiteSpace: 'nowrap' }}>
    <span>Language / 언어</span><select aria-label="Language / 언어" value={locale} style={{ width: 94, minWidth: 94, padding: '5px 7px' }} onChange={event => { if (isLocale(event.target.value)) setLocale(event.target.value); }}>
      <option value="ko">한국어</option><option value="en">English</option>
    </select>
  </label>;
}
