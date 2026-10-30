import ExcelJS from 'exceljs';
import type { TemplateDocument, TemplateMetadata } from '@ipms/contracts';
import { CATEGORY_LABELS, COLUMNS, RESPONSE_TYPE_LABELS, SEVERITY_LABELS, SHEETS, yesNo, type ColumnKey } from './columns.js';

export interface WorkbookSource {
  metadata: TemplateMetadata | null;
  version: { version: number; status: string; publishedAt: Date | null } | null;
  document: TemplateDocument;
}

export const EXAMPLE_DOCUMENT: TemplateDocument = {
  sections: [
    { number: '1', title: 'EHS On Site', items: [
      { number: '1.1', requirementText: 'All crew wear helmet, harness and safety boots', severity: 'CRITICAL', responseType: 'RESULT_ONLY', selectOptions: [], minPhotos: 1, maxPhotos: 3, minVideos: 0, maxVideos: 0, allowsNa: false, isRequired: true, guidanceText: 'Show every crew member in frame' },
      { number: '1.2', requirementText: 'Work area barricaded', severity: 'NORMAL', responseType: 'BOOLEAN', selectOptions: [], minPhotos: 1, maxPhotos: 2, minVideos: 0, maxVideos: 1, allowsNa: false, isRequired: true },
    ] },
    { number: '2', title: 'Antenna Installation', items: [
      { number: '2.1', requirementText: 'Azimuth (degrees)', severity: 'NORMAL', responseType: 'NUMBER', selectOptions: [], minPhotos: 1, maxPhotos: 1, minVideos: 0, maxVideos: 0, allowsNa: true, isRequired: true },
      { number: '2.2', requirementText: 'Mount type', severity: 'NORMAL', responseType: 'SELECT', selectOptions: ['Pole', 'Wall', 'Tower'], minPhotos: 0, maxPhotos: 0, minVideos: 0, maxVideos: 0, allowsNa: false, isRequired: true },
      { number: '2.3', requirementText: 'Installer remarks', severity: 'NORMAL', responseType: 'TEXT', selectOptions: [], minPhotos: 0, maxPhotos: 0, minVideos: 0, maxVideos: 0, allowsNa: false, isRequired: false },
    ] },
  ],
};

const INSTRUCTIONS = [
  'One row per checklist item, in the order the field engineer should see them.',
  'Fill Section No and Section Title on the first row of a section. Leave them blank on the rows below to stay in that section.',
  'Section numbers must be unique, and a section\'s rows must be together. Item numbers must be unique within their section.',
  'Item No and Requirement are required on every item row.',
  'Section No and Item No are text: 1.10 stays 1.10.',
  'Severity: Normal or Critical. Blank means Normal.',
  'Response Type: Result only, Text, Number, Yes/No or Select. Blank means Result only.',
  'Options: only for Select items. Separate 2 to 50 choices with a semicolon, e.g. "Pole; Wall; Tower".',
  'Min Photos / Max Photos: 0 to 20. Min 0 makes photos optional up to Max; Max 0 means no photos.',
  'Min Videos / Max Videos: 0 to 5. Blank means 0. Videos are recorded at 720p, up to 100 MB each.',
  'Allow N/A: Yes or No (blank means No). Required: Yes or No (blank means Yes).',
  'Guidance: optional instructions shown to the field engineer.',
  'On the Template sheet, Code (upper case letters, digits, dash, underscore), Name and Category (Quality, EHS, Other) are required.',
  'Importing a file whose Code already exists makes it the next draft of that template. Nothing is saved until you confirm the preview.',
];

const VALIDATED_ROWS = 1000;
const listOf = (values: string[]) => ({ type: 'list' as const, allowBlank: true, formulae: [`"${values.join(',')}"`] });
const columnNumber = (key: ColumnKey): number => COLUMNS.findIndex((column) => column.key === key) + 1;

/** Escapes leading characters that Excel parses as formula execution triggers. */
export function sanitizeCell(value: string): string {
  return /^[\=\+\-\@\t\r]/.test(value) ? `'${value}` : value;
}

export async function buildWorkbook(source: WorkbookSource): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  const meta = workbook.addWorksheet(SHEETS.template);
  meta.addRow(['Field', 'Value']);
  meta.getRow(1).font = { bold: true };
  meta.addRow(['Code', source.metadata?.code ?? '']);
  meta.addRow(['Name', source.metadata?.name ? sanitizeCell(source.metadata.name) : '']);
  meta.addRow(['Category', source.metadata ? CATEGORY_LABELS[source.metadata.category] : '']);
  meta.getCell('B4').dataValidation = listOf(Object.values(CATEGORY_LABELS));
  if (source.version) {
    meta.addRow(['Version', source.version.version]);
    meta.addRow(['Status', source.version.status]);
    meta.addRow(['Published At', source.version.publishedAt?.toISOString() ?? '']);
  }
  meta.getColumn(1).width = 14;
  meta.getColumn(2).width = 50;

  const sheet = workbook.addWorksheet(SHEETS.checklist);
  sheet.addRow(COLUMNS.map((column) => column.header));
  sheet.getRow(1).font = { bold: true };
  COLUMNS.forEach((column, index) => { sheet.getColumn(index + 1).width = column.width; });
  for (const section of source.document.sections) {
    // A draft may hold an empty section; it exports as a heading row so it survives the round-trip.
    if (section.items.length === 0) sheet.addRow([section.number, sanitizeCell(section.title)]);
    section.items.forEach((item, index) => {
      sheet.addRow([
        index === 0 ? section.number : '', index === 0 ? sanitizeCell(section.title) : '',
        item.number, sanitizeCell(item.requirementText), SEVERITY_LABELS[item.severity], RESPONSE_TYPE_LABELS[item.responseType],
        item.selectOptions.map(sanitizeCell).join('; '), item.minPhotos, item.maxPhotos, item.minVideos, item.maxVideos, yesNo(item.allowsNa), yesNo(item.isRequired),
        item.guidanceText ? sanitizeCell(item.guidanceText) : '',
      ]);
    });
  }
  for (let row = 2; row <= VALIDATED_ROWS + 1; row += 1) {
    // '@' keeps values like "1.10" as text so Excel doesn't coerce them to the number 1.1.
    sheet.getCell(row, columnNumber('sectionNo')).numFmt = '@';
    sheet.getCell(row, columnNumber('itemNo')).numFmt = '@';
    sheet.getCell(row, columnNumber('severity')).dataValidation = listOf(Object.values(SEVERITY_LABELS));
    sheet.getCell(row, columnNumber('responseType')).dataValidation = listOf(Object.values(RESPONSE_TYPE_LABELS));
    sheet.getCell(row, columnNumber('allowNa')).dataValidation = listOf(['Yes', 'No']);
    sheet.getCell(row, columnNumber('required')).dataValidation = listOf(['Yes', 'No']);
  }

  const help = workbook.addWorksheet(SHEETS.instructions);
  for (const line of INSTRUCTIONS) help.addRow([line]);
  help.getColumn(1).width = 120;

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
