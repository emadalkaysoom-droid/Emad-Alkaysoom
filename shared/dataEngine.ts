export type DataRow = Record<string, string | number | boolean | null>;

export interface ColumnStats {
  column: string;
  type: 'numeric' | 'categorical';
  count: number;
  missing: number;
  min?: number;
  max?: number;
  mean?: number;
  median?: number;
  variance?: number;
  stdDev?: number;
  q1?: number;
  q3?: number;
  uniqueValues?: number;
  topCategories?: Array<{ value: string; count: number }>;
}

export interface AnomalyRecord {
  rowIndex: number;
  column: string;
  value: number;
  zScore: number;
  direction: 'high' | 'low';
  label?: string;
}

export interface TrendForecast {
  column: string;
  slope: number;
  intercept: number;
  rSquared: number;
  direction: 'upward' | 'downward' | 'flat';
  nextPeriods: Array<{ step: number; predicted: number }>;
}

export interface DatasetAnalysis {
  rowCount: number;
  columnCount: number;
  columns: string[];
  stats: ColumnStats[];
  anomalies: AnomalyRecord[];
  trends: TrendForecast[];
  topRecords: Array<{ column: string; rows: Array<{ rowIndex: number; label: string; value: number }> }>;
  correlations: Array<{ colA: string; colB: string; pearsonR: number }>;
}

export function parseCSV(csvText: string): DataRow[] {
  const lines = csvText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const splitLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = splitLine(lines[0]).map((h, idx) => h || `column_${idx + 1}`);
  const rows: DataRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = splitLine(lines[i]);
    const row: DataRow = {};
    for (let c = 0; c < headers.length; c++) {
      const raw = values[c] ?? '';
      if (raw === '') {
        row[headers[c]] = null;
      } else if (/^-?\d+(\.\d+)?$/.test(raw)) {
        row[headers[c]] = Number(raw);
      } else if (raw.toLowerCase() === 'true') {
        row[headers[c]] = true;
      } else if (raw.toLowerCase() === 'false') {
        row[headers[c]] = false;
      } else {
        row[headers[c]] = raw;
      }
    }
    rows.push(row);
  }
  return rows;
}

export function parseXMLRows(xmlText: string): DataRow[] {
  const rows: DataRow[] = [];
  const rowMatches = xmlText.match(/<(row|record|item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi);
  if (!rowMatches) return rows;

  for (const block of rowMatches) {
    const inner = block.replace(/^<[^>]+>|<\/[^>]+>$/g, '');
    const fieldRegex = /<([a-zA-Z0-9_:-]+)>([\s\S]*?)<\/\1>/g;
    const row: DataRow = {};
    let m: RegExpExecArray | null;
    while ((m = fieldRegex.exec(inner)) !== null) {
      const key = m[1];
      const raw = m[2].trim();
      if (raw === '') row[key] = null;
      else if (/^-?\d+(\.\d+)?$/.test(raw)) row[key] = Number(raw);
      else row[key] = raw;
    }
    if (Object.keys(row).length > 0) rows.push(row);
  }
  return rows;
}

export function parseStructuredText(content: string, format: 'csv' | 'json' | 'xml'): DataRow[] {
  if (format === 'csv') return parseCSV(content);
  if (format === 'xml') return parseXMLRows(content);
  const parsed = JSON.parse(content);
  if (Array.isArray(parsed)) {
    return parsed.filter((r) => r && typeof r === 'object') as DataRow[];
  }
  if (parsed && typeof parsed === 'object') {
    const firstArray = Object.values(parsed).find((v) => Array.isArray(v));
    if (Array.isArray(firstArray)) {
      return firstArray.filter((r) => r && typeof r === 'object') as DataRow[];
    }
    return [parsed as DataRow];
  }
  return [];
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

export function analyzeDataset(rows: DataRow[], forecastHorizon = 3): DatasetAnalysis {
  if (rows.length === 0) {
    return {
      rowCount: 0,
      columnCount: 0,
      columns: [],
      stats: [],
      anomalies: [],
      trends: [],
      topRecords: [],
      correlations: [],
    };
  }

  const columnSet = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) columnSet.add(k);
  }
  const columns = Array.from(columnSet);

  const labelCol =
    columns.find((c) => /name|label|id|date|time|month|region|device|node|title/i.test(c)) ??
    columns[0];

  const stats: ColumnStats[] = [];
  const anomalies: AnomalyRecord[] = [];
  const trends: TrendForecast[] = [];
  const topRecords: DatasetAnalysis['topRecords'] = [];
  const numericSeriesMap = new Map<string, number[]>();

  for (const col of columns) {
    const rawValues = rows.map((r) => r[col]);
    const nonNull = rawValues.filter((v) => v !== null && v !== undefined && v !== '');
    const missing = rows.length - nonNull.length;

    const numericValues = nonNull
      .map((v) => (typeof v === 'number' ? v : Number(v)))
      .filter((n) => Number.isFinite(n));

    if (nonNull.length > 0 && numericValues.length >= nonNull.length * 0.75) {
      const sorted = [...numericValues].sort((a, b) => a - b);
      const count = numericValues.length;
      const sum = numericValues.reduce((acc, v) => acc + v, 0);
      const mean = sum / count;
      const variance =
        count > 1
          ? numericValues.reduce((acc, v) => acc + (v - mean) ** 2, 0) / count
          : 0;
      const stdDev = Math.sqrt(variance);

      stats.push({
        column: col,
        type: 'numeric',
        count,
        missing,
        min: sorted[0],
        max: sorted[count - 1],
        mean: Number(mean.toFixed(4)),
        median: Number(quantile(sorted, 0.5).toFixed(4)),
        variance: Number(variance.toFixed(4)),
        stdDev: Number(stdDev.toFixed(4)),
        q1: Number(quantile(sorted, 0.25).toFixed(4)),
        q3: Number(quantile(sorted, 0.75).toFixed(4)),
      });

      numericSeriesMap.set(col, numericValues);

      // Z-score anomaly detection (|z| >= 2.0)
      if (stdDev > 1e-9) {
        rows.forEach((row, idx) => {
          const raw = row[col];
          const num = typeof raw === 'number' ? raw : Number(raw);
          if (Number.isFinite(num)) {
            const z = (num - mean) / stdDev;
            if (Math.abs(z) >= 2.0) {
              anomalies.push({
                rowIndex: idx,
                column: col,
                value: num,
                zScore: Number(z.toFixed(2)),
                direction: z > 0 ? 'high' : 'low',
                label: String(row[labelCol] ?? `Row ${idx + 1}`),
              });
            }
          }
        });
      }

      // Linear regression trend & forecast
      if (numericValues.length >= 3) {
        const n = numericValues.length;
        let sumX = 0;
        let sumY = 0;
        let sumXY = 0;
        let sumXX = 0;
        for (let i = 0; i < n; i++) {
          sumX += i;
          sumY += numericValues[i];
          sumXY += i * numericValues[i];
          sumXX += i * i;
        }
        const denom = n * sumXX - sumX * sumX;
        const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
        const intercept = (sumY - slope * sumX) / n;

        const meanY = sumY / n;
        let ssTot = 0;
        let ssRes = 0;
        for (let i = 0; i < n; i++) {
          const pred = slope * i + intercept;
          ssTot += (numericValues[i] - meanY) ** 2;
          ssRes += (numericValues[i] - pred) ** 2;
        }
        const rSquared = ssTot > 1e-9 ? Math.max(0, 1 - ssRes / ssTot) : 0;

        const nextPeriods = [];
        for (let h = 1; h <= forecastHorizon; h++) {
          nextPeriods.push({
            step: n + h,
            predicted: Number((slope * (n - 1 + h) + intercept).toFixed(3)),
          });
        }

        trends.push({
          column: col,
          slope: Number(slope.toFixed(4)),
          intercept: Number(intercept.toFixed(4)),
          rSquared: Number(rSquared.toFixed(4)),
          direction: Math.abs(slope) < 1e-4 ? 'flat' : slope > 0 ? 'upward' : 'downward',
          nextPeriods,
        });
      }

      // Top 5 values for this numeric column
      const indexed = rows
        .map((row, idx) => {
          const val = typeof row[col] === 'number' ? (row[col] as number) : Number(row[col]);
          return {
            rowIndex: idx,
            label: String(row[labelCol] ?? `Row ${idx + 1}`),
            value: val,
          };
        })
        .filter((item) => Number.isFinite(item.value))
        .sort((a, b) => b.value - a.value)
        .slice(0, 5);

      topRecords.push({ column: col, rows: indexed });
    } else {
      const counts = new Map<string, number>();
      for (const v of nonNull) {
        const key = String(v);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const topCategories = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([value, count]) => ({ value, count }));

      stats.push({
        column: col,
        type: 'categorical',
        count: nonNull.length,
        missing,
        uniqueValues: counts.size,
        topCategories,
      });
    }
  }

  // Pairwise Pearson correlations between numeric columns
  const correlations: DatasetAnalysis['correlations'] = [];
  const numCols = Array.from(numericSeriesMap.keys());
  for (let i = 0; i < numCols.length; i++) {
    for (let j = i + 1; j < numCols.length; j++) {
      const a = numericSeriesMap.get(numCols[i])!;
      const b = numericSeriesMap.get(numCols[j])!;
      const len = Math.min(a.length, b.length);
      if (len < 3) continue;
      const meanA = a.slice(0, len).reduce((s, v) => s + v, 0) / len;
      const meanB = b.slice(0, len).reduce((s, v) => s + v, 0) / len;
      let num = 0;
      let denA = 0;
      let denB = 0;
      for (let k = 0; k < len; k++) {
        const da = a[k] - meanA;
        const db = b[k] - meanB;
        num += da * db;
        denA += da * da;
        denB += db * db;
      }
      const den = Math.sqrt(denA * denB);
      if (den > 1e-9) {
        correlations.push({
          colA: numCols[i],
          colB: numCols[j],
          pearsonR: Number((num / den).toFixed(4)),
        });
      }
    }
  }

  return {
    rowCount: rows.length,
    columnCount: columns.length,
    columns,
    stats,
    anomalies,
    trends,
    topRecords,
    correlations,
  };
}

export interface NLDataQueryResult {
  summary: string;
  focusColumn?: string;
  highlightedRows: Array<{ rowIndex: number; label: string; value: number }>;
  chartSeries: Array<{ label: string; value: number }>;
}

export function interpretNaturalLanguageDataQuery(
  query: string,
  rows: DataRow[],
  analysis: DatasetAnalysis
): NLDataQueryResult {
  const q = query.toLowerCase();
  const numericCols = analysis.stats.filter((s) => s.type === 'numeric').map((s) => s.column);
  const matchedCol =
    numericCols.find((c) => q.includes(c.toLowerCase())) ?? numericCols[0];

  if (!matchedCol || rows.length === 0) {
    return {
      summary: 'Dataset has no numeric columns available for quantitative evaluation.',
      highlightedRows: [],
      chartSeries: [],
    };
  }

  const labelCol =
    analysis.columns.find((c) => /name|label|id|date|time|month|region|node/i.test(c)) ??
    analysis.columns[0];

  const colStat = analysis.stats.find((s) => s.column === matchedCol)!;
  const isTopQuery = /top|highest|max|largest|أعلى|أكبر|أهم/.test(q);
  const isBottomQuery = /bottom|lowest|min|smallest|أدنى|أقل/.test(q);
  const isAnomalyQuery = /anomal|outlier|spike|weird|شاذ|شذوذ|تطرف/.test(q);
  const isForecastQuery = /forecast|predict|trend|future|تنبؤ|اتجاه|توقع/.test(q);

  const countMatch = q.match(/\b(\d+)\b/);
  const limit = countMatch ? Math.min(20, Math.max(1, Number(countMatch[1]))) : 5;

  const chartSeries = rows.slice(0, 24).map((r, idx) => ({
    label: String(r[labelCol] ?? `#${idx + 1}`),
    value: Number(r[matchedCol] ?? 0) || 0,
  }));

  if (isAnomalyQuery) {
    const colAnomalies = analysis.anomalies.filter((a) => a.column === matchedCol);
    return {
      focusColumn: matchedCol,
      summary:
        colAnomalies.length > 0
          ? `Detected ${colAnomalies.length} statistical outlier(s) in "${matchedCol}" (|Z-score| >= 2.0, mean=${colStat.mean}, stdDev=${colStat.stdDev}).`
          : `No statistical outliers (|Z-score| >= 2.0) detected in "${matchedCol}" (mean=${colStat.mean}, stdDev=${colStat.stdDev}).`,
      highlightedRows: colAnomalies.map((a) => ({
        rowIndex: a.rowIndex,
        label: a.label ?? `Row ${a.rowIndex + 1}`,
        value: a.value,
      })),
      chartSeries,
    };
  }

  if (isForecastQuery) {
    const trend = analysis.trends.find((t) => t.column === matchedCol);
    if (trend) {
      const nextText = trend.nextPeriods
        .map((p) => `Step ${p.step}: ${p.predicted}`)
        .join(', ');
      return {
        focusColumn: matchedCol,
        summary: `Linear regression on "${matchedCol}" shows a ${trend.direction} trend (slope=${trend.slope}, R²=${trend.rSquared}). Forecast -> ${nextText}.`,
        highlightedRows: [],
        chartSeries: [
          ...chartSeries,
          ...trend.nextPeriods.map((p) => ({
            label: `Forecast +${p.step - rows.length}`,
            value: p.predicted,
          })),
        ],
      };
    }
  }

  const sortedRows = rows
    .map((r, idx) => ({
      rowIndex: idx,
      label: String(r[labelCol] ?? `Row ${idx + 1}`),
      value: Number(r[matchedCol]),
    }))
    .filter((item) => Number.isFinite(item.value))
    .sort((a, b) => (isBottomQuery ? a.value - b.value : b.value - a.value))
    .slice(0, limit);

  if (isTopQuery || isBottomQuery) {
    const dirLabel = isBottomQuery ? 'Lowest' : 'Top';
    return {
      focusColumn: matchedCol,
      summary: `${dirLabel} ${sortedRows.length} records for "${matchedCol}": ${sortedRows
        .map((r) => `${r.label} (${r.value})`)
        .join(', ')}.`,
      highlightedRows: sortedRows,
      chartSeries,
    };
  }

  return {
    focusColumn: matchedCol,
    summary: `Analysis of "${matchedCol}" across ${colStat.count} rows: Mean=${colStat.mean}, Median=${colStat.median}, Min=${colStat.min}, Max=${colStat.max}, StdDev=${colStat.stdDev}.`,
    highlightedRows: sortedRows,
    chartSeries,
  };
}
