import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const LOCALES_ROOT = path.resolve(
  import.meta.dirname,
  '../libraries/react-shared-libraries/src/translation/locales'
);

const readLocale = (locale: string): Record<string, string> =>
  JSON.parse(
    readFileSync(path.resolve(LOCALES_ROOT, locale, 'translation.json'), 'utf8')
  );

const locales = readdirSync(LOCALES_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

describe('the made_with_ai copy', () => {
  it.each(locales)(
    '%s translates made_with_ai and no longer has video_made_with_ai',
    (locale) => {
      const translation = readLocale(locale);

      expect(typeof translation.made_with_ai).toBe('string');
      expect(translation.made_with_ai.trim().length).toBeGreaterThan(0);
      expect(translation.made_with_ai).not.toBe('made_with_ai');

      expect(translation).not.toHaveProperty('video_made_with_ai');
    }
  );

  it('uses the confirmed English source copy', () => {
    expect(readLocale('en').made_with_ai).toBe('Made with AI');
  });
});
