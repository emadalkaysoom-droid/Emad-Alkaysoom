import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeDataset,
  interpretNaturalLanguageDataQuery,
  parseStructuredText,
} from '../shared/dataEngine';

test('parses CSV with quoted fields and numeric coercion', () => {
  const csv = 'node,rpm,status\n"Unit, A",1500,ok\nUnit B,1550,ok\nUnit C,2400,warn';
  const rows = parseStructuredText(csv, 'csv');
  assert.equal(rows.length, 3);
  assert.equal(rows[0].node, 'Unit, A');
  assert.equal(rows[0].rpm, 1500);
});

test('parses XML records cleanly', () => {
  const xml = '<records><row><sensor>S1</sensor><temp>42.5</temp></row><row><sensor>S2</sensor><temp>44.0</temp></row></records>';
  const rows = parseStructuredText(xml, 'xml');
  assert.equal(rows.length, 2);
  assert.equal(rows[1].temp, 44);
});

test('computes statistics, Z-score anomalies, and linear forecasts', () => {
  const rows = [
    { label: 'T1', val: 100 },
    { label: 'T2', val: 102 },
    { label: 'T3', val: 101 },
    { label: 'T4', val: 103 },
    { label: 'T5', val: 99 },
    { label: 'T6', val: 101 },
    { label: 'T7', val: 100 },
    { label: 'T8', val: 250 }, // clear outlier
  ];
  const analysis = analyzeDataset(rows);
  assert.equal(analysis.rowCount, 8);
  assert.equal(analysis.anomalies.length, 1);
  assert.equal(analysis.anomalies[0].value, 250);
  assert.equal(analysis.trends.length, 1);
  assert.equal(analysis.trends[0].nextPeriods.length, 3);
});

test('answers natural language queries in English and Arabic', () => {
  const rows = [
    { name: 'Alpha', score: 12 },
    { name: 'Beta', score: 88 },
    { name: 'Gamma', score: 45 },
  ];
  const analysis = analyzeDataset(rows);
  const en = interpretNaturalLanguageDataQuery('Show top 2 score values', rows, analysis);
  assert.equal(en.highlightedRows.length, 2);
  assert.equal(en.highlightedRows[0].label, 'Beta');

  const ar = interpretNaturalLanguageDataQuery('حدد أعلى 1', rows, analysis);
  assert.equal(ar.highlightedRows[0].value, 88);
});
