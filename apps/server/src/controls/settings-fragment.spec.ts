import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSettingsFragment, toWarriorSettings } from './settings-fragment';

const fixture = (name: string) =>
  readFileSync(path.resolve(__dirname, '../../test/fixtures/warrior', name), 'utf8');

describe('parseSettingsFragment', () => {
  it('reads every input by config key from a live fragment', () => {
    const parsed = parseSettingsFragment(fixture('settings.html'));
    expect(parsed.values).toEqual({
      downloader: 'example',
      concurrent_items: '3',
      http_username: '',
      http_password: '',
      'shared:rsync_threads': '20',
    });
    expect(parsed.errors).toEqual({});
  });

  it('pairs a rejected value with the warrior message', () => {
    const parsed = parseSettingsFragment(fixture('settings-error.html'));
    expect(parsed.values['concurrent_items']).toBe('7');
    expect(parsed.errors).toEqual({ concurrent_items: 'Number must be 6 or smaller.' });
  });

  it('unescapes HTML entities and ignores items without an input', () => {
    const parsed = parseSettingsFragment(
      '<li><p>The warrior must be configured.</p></li>' +
        '<li class=" error "><input type="text" value="a&quot;b&amp;c" name="downloader" />' +
        '<p class="error"> Invalid &lt;value&gt; </p></li>',
    );
    expect(parsed.values).toEqual({ downloader: 'a"b&c' });
    expect(parsed.errors).toEqual({ downloader: 'Invalid <value>' });
  });

  it('returns nothing for an empty or unrelated body', () => {
    expect(parseSettingsFragment('')).toEqual({ values: {}, errors: {} });
    expect(parseSettingsFragment('OK')).toEqual({ values: {}, errors: {} });
  });
});

describe('toWarriorSettings', () => {
  it('types the two settings Ramesses shows and nulls the rest', () => {
    expect(toWarriorSettings({ downloader: ' nick ', concurrent_items: '4' })).toEqual({
      downloader: 'nick',
      concurrentItems: 4,
    });
    expect(toWarriorSettings({ downloader: '', concurrent_items: 'seven' })).toEqual({
      downloader: null,
      concurrentItems: null,
    });
    expect(toWarriorSettings({})).toEqual({ downloader: null, concurrentItems: null });
  });
});
