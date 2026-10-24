import { koreanMessages } from './messages.js';

export type Locale = 'ko' | 'en';
export type MessageKey = keyof typeof koreanMessages;
export type MessageParams = Readonly<Record<string, string | number>>;
export type UIMessage = { key: MessageKey; params?: MessageParams } | { raw: string } | { parts: UIMessage[] };
export const catalogs: Readonly<Record<Locale, Readonly<Record<MessageKey, string>>>> = {
  ko: koreanMessages,
  en: Object.fromEntries(Object.keys(koreanMessages).map(key => [key, key])) as Record<MessageKey, string>,
};
export const isLocale = (value: unknown): value is Locale => value === 'ko' || value === 'en';
export function resolveLocale(input: { desktopLocale?: unknown; storedLocale?: unknown; language?: string }): Locale {
  if (isLocale(input.desktopLocale)) return input.desktopLocale;
  if (isLocale(input.storedLocale)) return input.storedLocale;
  return /^ko(?:-|$)/i.test(input.language ?? '') ? 'ko' : 'en';
}
export function translate(locale: Locale, key: MessageKey, params: MessageParams = {}): string {
  return catalogs[locale][key].replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (placeholder, name: string) => String(params[name] ?? placeholder));
}
export function message(key: MessageKey, params?: MessageParams): UIMessage { return params ? { key, params } : { key }; }
export function renderMessage(locale: Locale, value: UIMessage): string {
  if ('raw' in value) return value.raw;
  if ('parts' in value) return value.parts.map(part => renderMessage(locale, part)).join(' ');
  return translate(locale, value.key, value.params);
}
export class UIError extends Error {
  constructor(readonly uiMessage: UIMessage) { super(renderMessage('en', uiMessage)); }
}
export function errorMessage(cause: unknown, fallback: MessageKey = 'The request could not be completed.'): UIMessage {
  return cause instanceof UIError ? cause.uiMessage : cause instanceof Error ? { raw: cause.message } : message(fallback);
}
