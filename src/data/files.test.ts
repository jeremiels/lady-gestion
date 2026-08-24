import { describe, expect, it } from 'vitest';
import { formatFileKind, formatFileSize, isImage, isPdf } from './files.ts';

/** Intl uses a narrow no-break space as the thousands separator in fr-FR. */
const normalize = (value: string) => value.replace(/\s/g, ' ');

describe('formatFileSize', () => {
  it('formats bytes without a fraction', () => {
    expect(formatFileSize(0)).toBe('0 o');
    expect(formatFileSize(1)).toBe('1 o');
    expect(formatFileSize(512)).toBe('512 o');
  });

  it('steps up at 1024, not 1000', () => {
    expect(normalize(formatFileSize(1023))).toBe('1 023 o');
    expect(formatFileSize(1024)).toBe('1 Ko');
  });

  it('uses a French decimal comma', () => {
    // 1.2 MiB
    expect(formatFileSize(1_258_291)).toBe('1,2 Mo');
  });

  it('rounds to one decimal place', () => {
    expect(formatFileSize(1536)).toBe('1,5 Ko');
    expect(formatFileSize(1_500_000)).toBe('1,4 Mo');
  });

  it('climbs through the whole unit scale', () => {
    expect(formatFileSize(1024 ** 3)).toBe('1 Go');
    expect(formatFileSize(1024 ** 4)).toBe('1 To');
  });

  it('stops at the largest unit rather than inventing one', () => {
    expect(normalize(formatFileSize(1024 ** 5))).toBe('1 024 To');
  });

  it('returns a dash for a size that cannot be rendered', () => {
    expect(formatFileSize(-1)).toBe('—');
    expect(formatFileSize(Number.NaN)).toBe('—');
    expect(formatFileSize(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('isPdf / isImage', () => {
  it('recognises a PDF', () => {
    expect(isPdf('application/pdf')).toBe(true);
    expect(isPdf('image/png')).toBe(false);
  });

  it('recognises any image subtype', () => {
    expect(isImage('image/png')).toBe(true);
    expect(isImage('image/heic')).toBe(true);
    expect(isImage('application/pdf')).toBe(false);
  });
});

describe('formatFileKind', () => {
  it('names a PDF', () => {
    expect(formatFileKind('application/pdf')).toBe('PDF');
  });

  it('uses the mime subtype, not the file extension', () => {
    expect(formatFileKind('image/jpeg')).toBe('JPEG');
    expect(formatFileKind('image/png')).toBe('PNG');
  });

  it('takes the last segment of a compound subtype', () => {
    expect(
      formatFileKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).toBe('DOCUMENT');
    expect(formatFileKind('image/svg+xml')).toBe('XML');
  });

  it('falls back for the unknown-bytes type documentsRepo assigns', () => {
    // `documentsRepo.create` stores `application/octet-stream` when the Blob
    // carries no type, so this is a real value, not a hypothetical.
    expect(formatFileKind('application/octet-stream')).toBe('Fichier');
    expect(formatFileKind('')).toBe('Fichier');
  });
});
