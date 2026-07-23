import fs from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('desktop refresh workflow', () => {
  it('exposes a stable local desktop refresh script', async () => {
    const packageJson = JSON.parse(await fs.readFile('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const refreshScript = await fs.readFile('desktop/refresh.cjs', 'utf8');

    expect(packageJson.scripts?.['desktop:refresh']).toBe('node desktop/refresh.cjs');
    expect(packageJson.scripts?.['desktop:package:current']).toContain('desktop/app/current');
    expect(refreshScript).toContain('currentOutDirectory');
    expect(refreshScript).toContain('Octave.lnk');
  });
});
