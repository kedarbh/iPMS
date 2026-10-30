import ExcelJS from 'exceljs';
import {
  PublishableDocumentSchema, TEMPLATE_MAX_ITEMS, TemplateCodeSchema,
  type ImportRowError, type TemplateDocument, type TemplateMetadata,
} from '@ipms/contracts';
import {
  COLUMNS, REQUIRED_COLUMNS, SHEETS, headerOf, normalizeHeader,
  parseBoolean, parseCategory, parseResponseType, parseSeverity, type ColumnKey,
} from './columns.js';

export interface ParsedWorkbook {
  metadata: TemplateMetadata | null;
  document: TemplateDocument | null;
  errors: ImportRowError[];
}

type Cells = Partial<Record<ColumnKey, string>>;
type CellError = (key: ColumnKey, message: string) => void;
interface RowItem { row: number; values: Record<string, unknown> }
interface RowSection { row: number; number: string; title: string; items: RowItem[] }

const FIELD_COLUMNS: Record<string, ColumnKey> = {
  number: 'itemNo', requirementText: 'requirement', severity: 'severity', responseType: 'responseType',
  selectOptions: 'options', minPhotos: 'minPhotos', maxPhotos: 'maxPhotos', minVideos: 'minVideos', maxVideos: 'maxVideos', allowsNa: 'allowNa',
  isRequired: 'required', guidanceText: 'guidance',
};

const cellText = (cell: ExcelJS.Cell): string => {
  const text = String(cell.text ?? '').trim();
  return text.startsWith("'") && /^'[\=\+\-\@\t\r]/.test(text) ? text.slice(1) : text;
};

function findSheet(workbook: ExcelJS.Workbook, name: string): ExcelJS.Worksheet | undefined {
  return workbook.worksheets.find((sheet) => sheet.name.trim().toLowerCase() === name.toLowerCase());
}

export async function parseWorkbook(buffer: Buffer): Promise<ParsedWorkbook> {
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs ships an older, non-generic Buffer type; identical at runtime.
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    return { metadata: null, document: null, errors: [{ row: null, column: null, message: 'That file could not be read as an Excel workbook' }] };
  }
  const errors: ImportRowError[] = [];
  const metadata = readMetadata(workbook, errors);
  const sections = readChecklist(workbook, errors);
  if (errors.length > 0 || !metadata || !sections) return { metadata, document: null, errors };

  const checked = PublishableDocumentSchema.safeParse({
    sections: sections.map((section) => ({ number: section.number, title: section.title, items: section.items.map((item) => item.values) })),
  });
  if (!checked.success) {
    return { metadata, document: null, errors: checked.error.issues.map((issue) => locate(issue.path, issue.message, sections)) };
  }
  return { metadata, document: checked.data, errors: [] };
}

function readMetadata(workbook: ExcelJS.Workbook, errors: ImportRowError[]): TemplateMetadata | null {
  const sheet = findSheet(workbook, SHEETS.template);
  if (!sheet) { errors.push({ row: null, column: null, message: 'The workbook needs a "Template" sheet' }); return null; }
  const fields = new Map<string, { row: number; value: string }>();
  sheet.eachRow((row, rowNumber) => {
    const field = normalizeHeader(cellText(row.getCell(1)));
    if (field) fields.set(field, { row: rowNumber, value: cellText(row.getCell(2)) });
  });
  const required = (field: string, label: string) => {
    const found = fields.get(field);
    if (!found || !found.value) { errors.push({ row: found?.row ?? null, column: label, message: `${label} is required on the Template sheet` }); return null; }
    return found;
  };
  const code = required('code', 'Code');
  const name = required('name', 'Name');
  const category = required('category', 'Category');
  if (!code || !name || !category) return null;

  const parsedCode = TemplateCodeSchema.safeParse(code.value);
  if (!parsedCode.success) errors.push({ row: code.row, column: 'Code', message: 'Use upper case letters, digits, dash or underscore (at most 50)' });
  const nameTooLong = name.value.length > 250;
  if (nameTooLong) errors.push({ row: name.row, column: 'Name', message: 'At most 250 characters' });
  const parsedCategory = parseCategory(category.value);
  if (!parsedCategory) errors.push({ row: category.row, column: 'Category', message: 'Use one of: Quality, EHS, Other' });
  if (!parsedCode.success || nameTooLong || !parsedCategory) return null;
  return { code: parsedCode.data, name: name.value, category: parsedCategory };
}

function readChecklist(workbook: ExcelJS.Workbook, errors: ImportRowError[]): RowSection[] | null {
  const sheet = findSheet(workbook, SHEETS.checklist);
  if (!sheet) { errors.push({ row: null, column: null, message: 'The workbook needs a "Checklist" sheet' }); return null; }

  const byHeader = new Map<string, ColumnKey>(COLUMNS.map((column) => [normalizeHeader(column.header), column.key]));
  const positions = new Map<number, ColumnKey>();
  sheet.getRow(1).eachCell((cell, colNumber) => {
    const key = byHeader.get(normalizeHeader(cellText(cell)));
    if (key) positions.set(colNumber, key);
  });
  const present = new Set(positions.values());
  const missing = REQUIRED_COLUMNS.filter((key) => !present.has(key));
  if (missing.length > 0) {
    for (const key of missing) errors.push({ row: 1, column: headerOf(key), message: `The Checklist sheet needs a "${headerOf(key)}" column` });
    return null;
  }

  const sections: RowSection[] = [];
  const seen = new Set<string>();
  let itemCount = 0;
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const cells: Cells = {};
    for (const [colNumber, key] of positions) {
      const value = cellText(row.getCell(colNumber));
      if (value) cells[key] = value;
    }
    if (Object.keys(cells).length === 0) continue;
    const error: CellError = (key, message) => { errors.push({ row: rowNumber, column: headerOf(key), message }); };

    let current = sections.at(-1);
    if (cells.sectionNo !== undefined || cells.sectionTitle !== undefined) {
      if (cells.sectionNo === undefined) { error('sectionNo', 'A section needs a number'); continue; }
      if (cells.sectionTitle === undefined) { error('sectionTitle', 'A section needs a title'); continue; }
      if (current && current.number === cells.sectionNo) {
        if (current.title !== cells.sectionTitle) error('sectionTitle', `Section ${cells.sectionNo} already has the title "${current.title}"`);
      } else if (seen.has(cells.sectionNo)) {
        error('sectionNo', `Sections must be contiguous: section ${cells.sectionNo} appeared earlier`);
        continue;
      } else {
        current = { row: rowNumber, number: cells.sectionNo, title: cells.sectionTitle, items: [] };
        sections.push(current);
        seen.add(cells.sectionNo);
      }
    }
    if (!current) { error('sectionNo', 'The first row must start a section'); continue; }
    // A heading row on its own: the section starts here, its items follow.
    if (cells.itemNo === undefined && cells.requirement === undefined) continue;
    itemCount += 1;
    if (itemCount > TEMPLATE_MAX_ITEMS) {
      errors.push({ row: rowNumber, column: null, message: `This file has more than ${TEMPLATE_MAX_ITEMS} items. Split the checklist into smaller templates.` });
      return null;
    }
    current.items.push({ row: rowNumber, values: readItem(cells, error) });
  }
  if (sections.length === 0 && errors.length === 0) {
    errors.push({ row: null, column: null, message: 'The Checklist sheet has a header row and no items' });
  }
  return sections;
}

function readItem(cells: Cells, error: CellError): Record<string, unknown> {
  const values: Record<string, unknown> = { number: cells.itemNo ?? '', requirementText: cells.requirement ?? '' };
  const pick = <T>(key: ColumnKey, parse: (text: string) => T | undefined, allowed: string, field: string): void => {
    const raw = cells[key];
    if (raw === undefined) return;
    const parsed = parse(raw);
    if (parsed === undefined) { error(key, `Use one of: ${allowed}`); return; }
    values[field] = parsed;
  };
  pick('severity', parseSeverity, 'Normal, Critical', 'severity');
  pick('responseType', parseResponseType, 'Result only, Text, Number, Yes/No, Select', 'responseType');
  pick('allowNa', parseBoolean, 'Yes, No', 'allowsNa');
  pick('required', parseBoolean, 'Yes, No', 'isRequired');
  for (const key of ['minPhotos', 'maxPhotos'] as const) {
    const raw = cells[key];
    if (raw === undefined) continue;
    const count = Number(raw);
    if (!Number.isInteger(count) || count < 0 || count > 20) { error(key, 'Must be a whole number from 0 to 20'); continue; }
    values[key] = count;
  }
  for (const key of ['minVideos', 'maxVideos'] as const) {
    const raw = cells[key];
    if (raw === undefined) continue;
    const count = Number(raw);
    if (!Number.isInteger(count) || count < 0 || count > 5) { error(key, 'Must be a whole number from 0 to 5'); continue; }
    values[key] = count;
  }
  if (cells.options !== undefined) values['selectOptions'] = cells.options.split(';').map((option) => option.trim()).filter(Boolean);
  if (cells.guidance !== undefined) values['guidanceText'] = cells.guidance;
  return values;
}

function locate(path: PropertyKey[], message: string, sections: RowSection[]): ImportRowError {
  const [, sectionIndex, part, itemIndex, field] = path;
  const section = typeof sectionIndex === 'number' ? sections[sectionIndex] : undefined;
  if (!section) return { row: null, column: null, message };
  if (part === 'items' && typeof itemIndex === 'number') {
    const key = typeof field === 'string' ? FIELD_COLUMNS[field] : undefined;
    return { row: section.items[itemIndex]?.row ?? section.row, column: key ? headerOf(key) : null, message };
  }
  if (part === 'items') return { row: section.row, column: null, message };
  return { row: section.row, column: part === 'title' ? 'Section Title' : 'Section No', message };
}
