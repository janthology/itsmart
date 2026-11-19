import { describe, expect, it } from 'vitest';
import writeExcelFile from 'write-excel-file/node';
import readExcelFile from 'read-excel-file/node';
import { spreadsheetRows } from './spreadsheet';

describe('spreadsheet export', () => {
  it('preserves text, numbers, blanks and notes without treating text as formulas', async () => {
    const rows = spreadsheetRows([{ Name: '=1+1', Count: 3, Notes: '<a & b>' }, { Name: '+2', Count: null, Extra: '✓' }]);
    const buffer = await writeExcelFile([
      { sheet: 'Report', data: rows },
      { sheet: 'Notes', data: [['SLA report notes']] },
    ]).toBuffer();
    const workbook = await readExcelFile(buffer);
    expect(workbook.map(sheet => sheet.sheet)).toEqual(['Report', 'Notes']);
    expect(workbook[0].data).toEqual([
      ['Name', 'Count', 'Notes', 'Extra'],
      ['=1+1', 3, '<a & b>', null],
      ['+2', null, null, '✓'],
    ]);
  });
  it('handles empty reports and rejects invalid numeric cells', () => {
    expect(spreadsheetRows([])).toEqual([]);
    expect(() => spreadsheetRows([{ Value: Number.NaN }])).toThrow(/Unsupported spreadsheet value/);
  });
});
