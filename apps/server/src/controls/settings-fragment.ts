import type { WarriorSettings } from '@ramesses/shared';

/**
 * The warrior's settings page is an HTML fragment, one `<li>` per setting with an `<input>` named
 * after the config key. After a rejected save the `<li>` carries `class="error"` and a
 * `<p class="error">` with the warrior's message; the HTTP status is 200 either way.
 */
export interface ParsedSettingsFragment {
  /** input value per config key, as the warrior rendered it */
  values: Record<string, string>;
  /** warrior message per rejected config key */
  errors: Record<string, string>;
}

const ITEM = /<li\b([^>]*)>([\s\S]*?)<\/li>/g;
const INPUT_NAME = /<input\b[^>]*\bname="([^"]*)"/;
const INPUT_VALUE = /<input\b[^>]*\bvalue="([^"]*)"/;
const ERROR = /<p class="error">([\s\S]*?)<\/p>/;

export function parseSettingsFragment(html: string): ParsedSettingsFragment {
  const values: Record<string, string> = {};
  const errors: Record<string, string> = {};
  for (const [, , body] of html.matchAll(ITEM)) {
    const name = INPUT_NAME.exec(body ?? '')?.[1];
    if (!name) continue;
    values[name] = unescapeHtml(INPUT_VALUE.exec(body ?? '')?.[1] ?? '');
    const error = ERROR.exec(body ?? '')?.[1];
    if (error !== undefined) errors[name] = unescapeHtml(error).trim();
  }
  return { values, errors };
}

/** The two settings Ramesses shows, typed. */
export function toWarriorSettings(values: Record<string, string>): WarriorSettings {
  const downloader = values['downloader']?.trim();
  const concurrent = values['concurrent_items']?.trim();
  return {
    downloader: downloader ? downloader : null,
    concurrentItems: concurrent && /^\d+$/.test(concurrent) ? Number(concurrent) : null,
  };
}

function unescapeHtml(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
