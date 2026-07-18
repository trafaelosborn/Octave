import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const parseOfficeMock = vi.fn();
vi.mock('officeparser', () => ({ parseOffice: parseOfficeMock }));

const { extractDocument } = await import('../src/core/extract.js');

describe('document extraction', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'octave-extract-'));
    parseOfficeMock.mockReset();
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('reads and bounds native text formats', async () => {
    const file = path.join(root, 'data.json');
    await fs.writeFile(file, '{"claim":"bounded context"}', 'utf8');
    const result = await extractDocument(file, { maxChars: 10 });

    expect(result).toMatchObject({ content: '{"claim":"', kind: 'text' });
    expect(result.warnings[0]).toContain('truncated');
  });

  it('extracts PDF and Office text through the structured parser', async () => {
    const file = path.join(root, 'paper.pdf');
    await fs.writeFile(file, '%PDF-test');
    parseOfficeMock.mockResolvedValue({
      toText: () => 'A selectable research result',
      warnings: [{ message: 'Page order inferred' }],
    });

    const result = await extractDocument(file);
    expect(result).toMatchObject({ content: 'A selectable research result', kind: 'pdf' });
    expect(result.warnings).toEqual(['Page order inferred']);
    expect(parseOfficeMock).toHaveBeenCalledWith(file, expect.objectContaining({ fileType: 'pdf', ocr: false }));
  });

  it('warns when a PDF has no selectable text', async () => {
    const file = path.join(root, 'scan.pdf');
    await fs.writeFile(file, '%PDF-scan');
    parseOfficeMock.mockResolvedValue({ toText: () => '', warnings: [] });

    const result = await extractDocument(file);
    expect(result.warnings.join(' ')).toContain('require OCR');
  });

  it('describes images without pretending to extract visual content', async () => {
    const file = path.join(root, 'figure.png');
    await fs.writeFile(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const result = await extractDocument(file);

    expect(result.kind).toBe('image');
    expect(result.content).toContain('image/png');
    expect(result.warnings.join(' ')).toContain('vision-capable provider');
  });

  it('rejects oversized inputs before parsing', async () => {
    const file = path.join(root, 'large.docx');
    await fs.writeFile(file, Buffer.alloc(32));
    await expect(extractDocument(file, { maxSourceBytes: 16 })).rejects.toThrow('extraction limit');
    expect(parseOfficeMock).not.toHaveBeenCalled();
  });
});
