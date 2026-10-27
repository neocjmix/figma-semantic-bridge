import { koreanMessages } from './messages.js';
import { diagnosticKeys, errorKeys } from './diagnostics.js';
import { ApiError } from './api.js';
import { reportUiFailure } from './observability.js';

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
/** Only app-generated vocabulary is translated. Unknown/source content is verbatim. */
export function systemMessage(value: string): UIMessage {
  const limited = /^Spatial candidate limit exceeded\. Only the first (\d+) candidate diagnostics are shown; search all captured nodes or narrow the region to inspect more candidates\.$/.exec(value);
  if (limited) return message('Only the first {count} matching candidates are shown. Search source nodes or make the region smaller to inspect more.', { count: Number(limited[1]) });
  const key = diagnosticKeys[value] ?? (Object.hasOwn(koreanMessages, value) ? value as MessageKey : undefined);
  return key ? message(key) : { raw: value };
}
export function apiErrorMessage(code: string, detail: string): UIMessage {
  if (code === 'INVALID_PROJECT' && detail === 'Annotation lies outside its captured image bounds.')
    return message('Keep the whole region inside the design image. Move it or adjust its size, then save again.');
  if (code === 'INVALID_PROJECT' && detail === 'Parent graph contains a cycle.')
    return message('Choose a parent outside this region’s own children, then save again.');
  const key = errorKeys[code];
  return key ? { parts: [message(key), { raw: `(${code})` }] } : systemMessage(detail);
}
export function errorMessage(cause: unknown, fallback: MessageKey = 'The request could not be completed.'): UIMessage {
  reportUiFailure(cause);
  if (cause instanceof UIError) return cause.uiMessage;
  if (cause instanceof ApiError) return apiErrorMessage(cause.code, cause.message);
  if (cause instanceof SyntaxError) return message('The draft is not valid JSON. Check its format before submitting.');
  if (cause instanceof TypeError && /fetch|network|load failed/i.test(cause.message)) return message('The connection failed. Check that the desktop app is running, then try again.');
  if (cause instanceof Error && cause.name === 'ZodError') return message('The received data could not be read. Refresh the workspace and try again.');
  return cause instanceof Error ? systemMessage(cause.message) : message(fallback);
}
