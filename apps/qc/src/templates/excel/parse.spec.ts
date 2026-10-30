import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { TemplateDocumentSchema, type TemplateDocument } from '@ipms/contracts';
import { COLUMNS } from './columns.js';
import { EXAMPLE_DOCUMENT, buildWorkbook } from './workbook.js';
import { parseWorkbook } from './parse.js';

const META_ROWS = [['Field', 'Value'], ['Code', 'AI-RRU'], ['Name', 'Antenna + RRU'], ['Category', 'Quality']];
const HEADER = ['Section No', 'Section Title', 'Item No', 'Requirement'];

async function workbookOf(rows: (string | number)[][], header: string[] = HEADER, meta: string[][] = META_ROWS): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const template = workbook.addWorksheet('Template');
  meta.forEach((row) => template.addRow(row));
  const checklist = workbook.addWorksheet('Checklist');
  checklist.addRow(header);
  rows.forEach((row) => checklist.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const FULL: TemplateDocument = TemplateDocumentSchema.parse({
  sections: [
    { number: '1', title: 'EHS On Site', items: [
      { number: '1.1', requirementText: 'PPE worn', severity: 'CRITICAL', minPhotos: 1, maxPhotos: 3, guidanceText: 'Helmet, harness, boots' },
      { number: '1.2', requirementText: 'Barricaded', responseType: 'BOOLEAN', minPhotos: 1, maxPhotos: 2, minVideos: 0, maxVideos: 1 },
      { number: '1.3', requirementText: 'Remarks', responseType: 'TEXT', isRequired: false },
    ] },
    { number: '2', title: 'Antenna', items: [
      { number: '2.1', requirementText: 'Azimuth', responseType: 'NUMBER', allowsNa: true, maxPhotos: 1, minPhotos: 1 },
      { number: '2.2', requirementText: 'Mount type', responseType: 'SELECT', selectOptions: ['Pole', 'Wall', 'Tower'] },
    ] },
  ],
});

describe('round-trip', () => {
  it('exporting a version and importing the file unchanged yields the same document', async () => {
    const file = await buildWorkbook({
      metadata: { code: 'AI-RRU', name: 'Antenna + RRU', category: 'EHS' },
      version: { version: 3, status: 'PUBLISHED', publishedAt: new Date('2026-09-01T00:00:00Z') },
      document: FULL,
    });
    const parsed = await parseWorkbook(file);
    expect(parsed.errors).toEqual([]);
    expect(parsed.metadata).toEqual({ code: 'AI-RRU', name: 'Antenna + RRU', category: 'EHS' });
    expect(parsed.document).toEqual(FULL);
  });

  it('the blank workbook carries the example rows and asks for metadata', async () => {
    const parsed = await parseWorkbook(await buildWorkbook({ metadata: null, version: null, document: EXAMPLE_DOCUMENT }));
    expect(parsed.errors.map((e) => e.column)).toEqual(['Code', 'Name', 'Category']);
    const filled = await buildWorkbook({ metadata: { code: 'X', name: 'X', category: 'OTHER' }, version: null, document: EXAMPLE_DOCUMENT });
    expect((await parseWorkbook(filled)).document).toEqual(EXAMPLE_DOCUMENT);
  });

  it('escapes and round-trips potential formula injection characters', async () => {
    const injectionDoc: TemplateDocument = TemplateDocumentSchema.parse({
      sections: [
        {
          number: '1',
          title: '=SUM(1,2)',
          items: [
            { number: '1.1', requirementText: '+45 degrees azimuth', guidanceText: '@check antenna tilt' },
          ],
        },
      ],
    });
    const file = await buildWorkbook({
      metadata: { code: 'FORMULA-TEST', name: '-Formula Test', category: 'OTHER' },
      version: null,
      document: injectionDoc,
    });
    const parsed = await parseWorkbook(file);
    expect(parsed.errors).toEqual([]);
    expect(parsed.document?.sections[0]?.title).toBe('=SUM(1,2)');
    expect(parsed.document?.sections[0]?.items[0]?.requirementText).toBe('+45 degrees azimuth');
    expect(parsed.document?.sections[0]?.items[0]?.guidanceText).toBe('@check antenna tilt');
  });
});

describe('sections', () => {
  it('continues a section across blank section cells, and across repeated identical ones', async () => {
    const parsed = await parseWorkbook(await workbookOf([
      ['1', 'EHS', '1.1', 'PPE'], ['', '', '1.2', 'Barricade'], ['1', 'EHS', '1.3', 'Signage'], ['2', 'Antenna', '2.1', 'Azimuth'],
    ]));
    expect(parsed.errors).toEqual([]);
    expect(parsed.document!.sections.map((s) => [s.number, s.items.length])).toEqual([['1', 3], ['2', 1]]);
  });

  it('reports a section number that reappears with a different title', async () => {
    const parsed = await parseWorkbook(await workbookOf([['1', 'EHS', '1.1', 'PPE'], ['1', 'Safety', '1.2', 'Barricade']]));
    expect(parsed.errors).toEqual([{ row: 3, column: 'Section Title', message: 'Section 1 already has the title "EHS"' }]);
  });

  it('reports a section that is not contiguous', async () => {
    const parsed = await parseWorkbook(await workbookOf([['1', 'EHS', '1.1', 'PPE'], ['2', 'Antenna', '2.1', 'Az'], ['1', 'EHS', '1.2', 'Barricade']]));
    expect(parsed.errors).toEqual([{ row: 4, column: 'Section No', message: 'Sections must be contiguous: section 1 appeared earlier' }]);
  });

  it('reports a first row that starts no section', async () => {
    const parsed = await parseWorkbook(await workbookOf([['', '', '1.1', 'PPE']]));
    expect(parsed.errors).toEqual([{ row: 2, column: 'Section No', message: 'The first row must start a section' }]);
  });

  it('reports an empty section at its heading row', async () => {
    const parsed = await parseWorkbook(await workbookOf([['1', 'EHS', '', ''], ['2', 'Antenna', '2.1', 'Az']]));
    expect(parsed.errors).toEqual([{ row: 2, column: null, message: 'Every section needs at least one item' }]);
  });
});

describe('values', () => {
  const FULL_HEADER = ['Section No', 'Section Title', 'Item No', 'Requirement', 'Severity', 'Response Type', 'Options', 'Min Photos', 'Max Photos', 'Allow N/A', 'Required', 'Guidance'];

  it('is lenient about case and synonyms', async () => {
    const parsed = await parseWorkbook(await workbookOf([
      ['1', 'EHS', '1.1', 'Barricaded', 'critical', 'boolean', '', '0', '0', 'y', 'FALSE', ''],
      ['', '', '1.2', 'Mount', 'NORMAL', 'select', 'Pole ; Wall', '0', '0', '1', 'true', ''],
    ], FULL_HEADER));
    expect(parsed.errors).toEqual([]);
    expect(parsed.document!.sections[0]!.items[0]).toMatchObject({ severity: 'CRITICAL', responseType: 'BOOLEAN', allowsNa: true, isRequired: false });
    expect(parsed.document!.sections[0]!.items[1]).toMatchObject({ responseType: 'SELECT', selectOptions: ['Pole', 'Wall'], allowsNa: true });
  });

  it('takes defaults when optional columns are absent', async () => {
    const parsed = await parseWorkbook(await workbookOf([['1', 'EHS', '1.1', 'PPE']]));
    expect(parsed.document!.sections[0]!.items[0]).toEqual({
      number: '1.1', requirementText: 'PPE', severity: 'NORMAL', responseType: 'RESULT_ONLY',
      selectOptions: [], minPhotos: 0, maxPhotos: 0, minVideos: 0, maxVideos: 0, allowsNa: false, isRequired: true,
    });
  });

  it('reports an unknown value at its cell', async () => {
    const parsed = await parseWorkbook(await workbookOf([['1', 'EHS', '1.1', 'PPE', 'Severe']], [...HEADER, 'Severity']));
    expect(parsed.errors).toEqual([{ row: 2, column: 'Severity', message: 'Use one of: Normal, Critical' }]);
  });

  it('maps a schema error back to its row and column', async () => {
    const parsed = await parseWorkbook(await workbookOf([['1', 'EHS', '1.1', 'PPE', '2', '1']], [...HEADER, 'Min Photos', 'Max Photos']));
    expect(parsed.errors).toEqual([{ row: 2, column: 'Max Photos', message: 'Must be at least Min Photos (2)' }]);
  });

  it('skips blank rows', async () => {
    const parsed = await parseWorkbook(await workbookOf([['1', 'EHS', '1.1', 'PPE'], ['', '', '', ''], ['', '', '1.2', 'Barricade']]));
    expect(parsed.document!.sections[0]!.items).toHaveLength(2);
  });
});

describe('number columns stay text', () => {
  it('keeps item numbers like "1.10" as text, and formats the Item No and Section No columns as text', async () => {
    const doc: TemplateDocument = TemplateDocumentSchema.parse({
      sections: [{
        number: '1', title: 'Section',
        items: Array.from({ length: 10 }, (_, i) => ({ number: `1.${i + 1}`, requirementText: `Item ${i + 1}` })),
      }],
    });
    const file = await buildWorkbook({ metadata: { code: 'X', name: 'X', category: 'OTHER' }, version: null, document: doc });

    const parsed = await parseWorkbook(file);
    expect(parsed.errors).toEqual([]);
    expect(parsed.document!.sections[0]!.items.map((item) => item.number)).toEqual(doc.sections[0]!.items.map((item) => item.number));
    expect(parsed.document!.sections[0]!.items.map((item) => item.number)).toContain('1.10');

    const workbook = new ExcelJS.Workbook();
    // exceljs ships an older, non-generic Buffer type; identical at runtime.
    await workbook.xlsx.load(file as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.getWorksheet('Checklist')!;
    const itemNoColumn = COLUMNS.findIndex((column) => column.key === 'itemNo') + 1;
    const sectionNoColumn = COLUMNS.findIndex((column) => column.key === 'sectionNo') + 1;
    expect(sheet.getCell(2, itemNoColumn).numFmt).toBe('@');
    expect(sheet.getCell(2, sectionNoColumn).numFmt).toBe('@');
  });
});

describe('file-level problems', () => {
  it('reports a missing required column', async () => {
    const parsed = await parseWorkbook(await workbookOf([['1', 'EHS', '1.1']], ['Section No', 'Section Title', 'Item No']));
    expect(parsed.errors).toEqual([{ row: 1, column: 'Requirement', message: 'The Checklist sheet needs a "Requirement" column' }]);
  });

  it('reports a bad code on the Template sheet', async () => {
    const parsed = await parseWorkbook(await workbookOf([['1', 'EHS', '1.1', 'PPE']], HEADER, [['Field', 'Value'], ['Code', 'ai rru'], ['Name', 'X'], ['Category', 'Quality']]));
    expect(parsed.errors).toEqual([{ row: 2, column: 'Code', message: 'Use upper case letters, digits, dash or underscore (at most 50)' }]);
  });

  it('reports a file that is not a workbook', async () => {
    expect((await parseWorkbook(Buffer.from('not a workbook'))).errors[0]!.message).toBe('That file could not be read as an Excel workbook');
  });

  it('refuses more than 1,000 items', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => (i === 0 ? ['1', 'EHS', 'x0', 'r'] : ['', '', `x${i}`, 'r']));
    const parsed = await parseWorkbook(await workbookOf(rows));
    expect(parsed.errors[0]!.message).toContain('more than 1000 items');
  });
});

describe('video counts', () => {
  it('reads Min Videos / Max Videos', async () => {
    const parsed = await parseWorkbook(await workbookOf([['1', 'EHS', '1.1', 'PPE', 1, 2]], [...HEADER, 'Min Videos', 'Max Videos']));
    expect(parsed.errors).toEqual([]);
    expect(parsed.document!.sections[0]!.items[0]).toMatchObject({ minVideos: 1, maxVideos: 2 });
  });

  it('defaults them to 0 in workbooks made before videos existed', async () => {
    const parsed = await parseWorkbook(await workbookOf([['1', 'EHS', '1.1', 'PPE']]));
    expect(parsed.document!.sections[0]!.items[0]).toMatchObject({ minVideos: 0, maxVideos: 0 });
  });

  it('refuses a count above 5', async () => {
    const parsed = await parseWorkbook(await workbookOf([['1', 'EHS', '1.1', 'PPE', 0, 6]], [...HEADER, 'Min Videos', 'Max Videos']));
    expect(parsed.errors.map((e) => e.message)).toContain('Must be a whole number from 0 to 5');
  });

  it('the example rows include an item that allows a video', () => {
    expect(EXAMPLE_DOCUMENT.sections.flatMap((s) => s.items).some((item) => item.maxVideos > 0)).toBe(true);
  });
});
