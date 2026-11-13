import crypto from 'node:crypto';

export type SupportedCodexLanguage =
  | 'Python'
  | 'JavaScript'
  | 'TypeScript'
  | 'Java'
  | 'C'
  | 'C++'
  | 'C#'
  | 'Go'
  | 'Rust'
  | 'PHP'
  | 'HTML'
  | 'CSS'
  | 'SQL'
  | 'Swift'
  | 'Kotlin';

export type AnalysisLayer =
  | 'Syntax'
  | 'Semantic'
  | 'Dependency'
  | 'Static'
  | 'Quality'
  | 'Security'
  | 'Performance'
  | 'DeadCode'
  | 'DuplicateCode'
  | 'Architecture';

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface CodexFinding {
  id: string;
  file: string;
  line: number;
  column: number;
  language: SupportedCodexLanguage | 'Unknown';
  layer: AnalysisLayer;
  type: string;
  severity: FindingSeverity;
  title: string;
  cause: string;
  impact: string;
  proposedFix: string;
  originalSnippet: string;
  replacementCode: string;
  autoFixable: boolean;
}

export interface FileInput {
  path: string;
  content: string;
}

export interface FileMetric {
  path: string;
  language: SupportedCodexLanguage | 'Unknown';
  loc: number;
  blankLines: number;
  commentLines: number;
  functions: number;
  cyclomaticComplexity: number;
  imports: string[];
  exports: string[];
  isEntryPoint: boolean;
}

export interface ProjectAnalysisReport {
  analyzedAt: string;
  fileCount: number;
  totalLoc: number;
  languages: Record<string, number>;
  entryPoints: string[];
  unusedFiles: string[];
  duplicateBlocks: Array<{
    hash: string;
    occurrences: Array<{ file: string; startLine: number }>;
    preview: string;
  }>;
  dependencyEdges: Array<{ from: string; to: string; spec: string }>;
  fileMetrics: FileMetric[];
  findings: CodexFinding[];
  layerSummary: Record<AnalysisLayer, number>;
  severitySummary: Record<FindingSeverity, number>;
  qualityScore: number;
  securityScore: number;
  architectureScore: number;
}

const EXT_LANG_MAP: Record<string, SupportedCodexLanguage> = {
  '.py': 'Python',
  '.js': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.jsx': 'JavaScript',
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.java': 'Java',
  '.c': 'C',
  '.h': 'C',
  '.cpp': 'C++',
  '.cc': 'C++',
  '.hpp': 'C++',
  '.cs': 'C#',
  '.go': 'Go',
  '.rs': 'Rust',
  '.php': 'PHP',
  '.html': 'HTML',
  '.htm': 'HTML',
  '.css': 'CSS',
  '.sql': 'SQL',
  '.swift': 'Swift',
  '.kt': 'Kotlin',
  '.kts': 'Kotlin',
};

export const SUPPORTED_LANGUAGES: SupportedCodexLanguage[] = [
  'Python',
  'JavaScript',
  'TypeScript',
  'Java',
  'C',
  'C++',
  'C#',
  'Go',
  'Rust',
  'PHP',
  'HTML',
  'CSS',
  'SQL',
  'Swift',
  'Kotlin',
];

export function detectLanguage(filePath: string, content = ''): SupportedCodexLanguage | 'Unknown' {
  const lower = filePath.toLowerCase();
  const dotIdx = lower.lastIndexOf('.');
  if (dotIdx !== -1) {
    const ext = lower.slice(dotIdx);
    if (EXT_LANG_MAP[ext]) return EXT_LANG_MAP[ext];
  }
  if (/^\s*def\s+\w+\s*\(/m.test(content) || /^\s*import\s+[\w.]+$/m.test(content)) return 'Python';
  if (/^\s*package\s+main\b/m.test(content) && /\bfunc\s+\w+/m.test(content)) return 'Go';
  if (/\bfn\s+\w+\s*\(/m.test(content) && /\blet\s+mut\b/m.test(content)) return 'Rust';
  if (/^\s*CREATE\s+TABLE\b/im.test(content) || /^\s*SELECT\s+.+\s+FROM\b/im.test(content)) return 'SQL';
  if (/^\s*<\?php/m.test(content)) return 'PHP';
  if (/^\s*<!doctype html>/im.test(content)) return 'HTML';
  return 'Unknown';
}

function extractImports(content: string, lang: SupportedCodexLanguage | 'Unknown'): string[] {
  const imports = new Set<string>();
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const esMatch = line.match(/^\s*import\s+(?:.+?\s+from\s+)?['"]([^'"]+)['"]/);
    if (esMatch) imports.add(esMatch[1]);
    const reqMatch = line.match(/require\(['"]([^'"]+)['"]\)/);
    if (reqMatch) imports.add(reqMatch[1]);
    if (lang === 'Python') {
      const pyMatch = line.match(/^\s*(?:from|import)\s+([a-zA-Z0-9_.]+)/);
      if (pyMatch) imports.add(pyMatch[1]);
    }
    if (lang === 'Go') {
      const goMatch = line.match(/^\s*import\s+"([^"]+)"/);
      if (goMatch) imports.add(goMatch[1]);
    }
    if (lang === 'C' || lang === 'C++') {
      const cMatch = line.match(/^\s*#include\s+[<"]([^>"]+)[>"]/);
      if (cMatch) imports.add(cMatch[1]);
    }
  }
  return Array.from(imports);
}

function extractExports(content: string): string[] {
  const exports = new Set<string>();
  const re = /\bexport\s+(?:async\s+)?(?:function|class|const|let|type|interface|enum)\s+([A-Za-z0-9_$]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    exports.add(m[1]);
  }
  return Array.from(exports);
}

function checkDelimiterBalance(content: string): { line: number; issue: string } | null {
  const stack: Array<{ ch: string; line: number }> = [];
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  const closeToOpen: Record<string, string> = { ')': '(', '}': '{', ']': '[' };
  const lines = content.split(/\r?\n/);
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('--')) continue;
    for (let ci = 0; ci < line.length; ci++) {
      const ch = line[ci];
      const prev = ci > 0 ? line[ci - 1] : '';
      if (ch === "'" && !inDouble && !inTemplate && prev !== '\\') inSingle = !inSingle;
      else if (ch === '"' && !inSingle && !inTemplate && prev !== '\\') inDouble = !inDouble;
      else if (ch === '`' && !inSingle && !inDouble && prev !== '\\') inTemplate = !inTemplate;
      if (inSingle || inDouble || inTemplate) continue;
      if (pairs[ch]) stack.push({ ch, line: li + 1 });
      else if (closeToOpen[ch]) {
        const top = stack.pop();
        if (!top || top.ch !== closeToOpen[ch]) {
          return { line: li + 1, issue: `Unmatched closing delimiter '${ch}'` };
        }
      }
    }
  }
  if (stack.length > 0) {
    const last = stack[stack.length - 1];
    return { line: last.line, issue: `Unclosed delimiter '${last.ch}'` };
  }
  return null;
}

function makeFinding(params: Omit<CodexFinding, 'id'>): CodexFinding {
  const hash = crypto
    .createHash('sha1')
    .update(`${params.file}:${params.line}:${params.layer}:${params.type}`)
    .digest('hex')
    .slice(0, 8);
  return { id: `fnd-${hash}`, ...params };
}

export function analyzeProjectFiles(files: FileInput[]): ProjectAnalysisReport {
  const languages: Record<string, number> = {};
  const fileMetrics: FileMetric[] = [];
  const findings: CodexFinding[] = [];
  const entryPoints: string[] = [];
  const dependencyEdges: Array<{ from: string; to: string; spec: string }> = [];
  const pathSet = new Set(files.map((f) => f.path));

  // Duplicate 4-line window tracker
  const blockMap = new Map<string, { preview: string; occurrences: Array<{ file: string; startLine: number }> }>();

  for (const file of files) {
    const lang = detectLanguage(file.path, file.content);
    languages[lang] = (languages[lang] || 0) + 1;

    const lines = file.content.split(/\r?\n/);
    let blankLines = 0;
    let commentLines = 0;
    let functions = 0;
    let complexity = 1;

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      const trimmed = line.trim();
      const lineNum = idx + 1;

      if (!trimmed) blankLines++;
      if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('--')) {
        commentLines++;
      }
      if (/\b(function|def|fn|func|sub|class)\b|=>\s*\{/.test(trimmed)) functions++;
      const branchMatches = trimmed.match(/\b(if|else if|elif|for|while|case|catch|&&|\|\||\?)\b/g);
      if (branchMatches) complexity += branchMatches.length;

      const isRegexRuleDef = /\/[^/]+\/[gimuy]*\.test\(/.test(trimmed);

      // Security Layer Checks
      if (!isRegexRuleDef && (/\beval\s*\(/.test(trimmed) || /new\s+Function\s*\(/.test(trimmed))) {
        findings.push(
          makeFinding({
            file: file.path,
            line: lineNum,
            column: line.indexOf('eval') + 1 || 1,
            language: lang,
            layer: 'Security',
            type: 'dynamic-code-execution',
            severity: 'critical',
            title: 'Dynamic code execution via eval/Function',
            cause: 'Direct runtime evaluation of strings exposes arbitrary code execution vectors.',
            impact: 'Remote Code Execution (RCE) or XSS if untrusted input reaches this call.',
            proposedFix: 'Replace eval() with a deterministic parser or JSON.parse().',
            originalSnippet: line,
            replacementCode: line.replace(/\beval\s*\(/, 'JSON.parse('),
            autoFixable: false,
          })
        );
      }

      if (!isRegexRuleDef && (/dangerouslySetInnerHTML|\.innerHTML\s*=/.test(trimmed))) {
        findings.push(
          makeFinding({
            file: file.path,
            line: lineNum,
            column: 1,
            language: lang,
            layer: 'Security',
            type: 'xss-dom-sink',
            severity: 'high',
            title: 'Unsafe raw HTML assignment sink',
            cause: 'Assigning unescaped HTML strings directly into DOM nodes bypasses escaping.',
            impact: 'Stored or reflected Cross-Site Scripting (XSS) vulnerability.',
            proposedFix: 'Use textContent or React declarative JSX text interpolation.',
            originalSnippet: line,
            replacementCode: line.replace(/\.innerHTML\s*=/, '.textContent ='),
            autoFixable: trimmed.includes('.innerHTML ='),
          })
        );
      }

      if (
        !isRegexRuleDef &&
        (/['"`]\s*(SELECT\s+.+\s+FROM|INSERT\s+INTO|UPDATE\s+[A-Za-z_]+\s+SET|DELETE\s+FROM)\b[^'"`]*\$\{[^}]+\}/i.test(trimmed) ||
          /['"`]\s*(SELECT\s+.+\s+FROM|INSERT\s+INTO|UPDATE\s+[A-Za-z_]+\s+SET|DELETE\s+FROM)\b[^'"`]*['"`]\s*\+\s*[a-zA-Z_]/i.test(trimmed))
      ) {
        findings.push(
          makeFinding({
            file: file.path,
            line: lineNum,
            column: 1,
            language: lang,
            layer: 'Security',
            type: 'sql-injection-risk',
            severity: 'critical',
            title: 'String-interpolated SQL query construction',
            cause: 'Concatenating or interpolating variables directly into SQL text instead of bound parameters.',
            impact: 'SQL Injection allowing unauthorized read/write/drop of database records.',
            proposedFix: 'Convert to parameterized prepared statement placeholders (?, $1).',
            originalSnippet: line,
            replacementCode: '// Use parameterized query: db.prepare("... WHERE id = ?").get(param)',
            autoFixable: false,
          })
        );
      }

      if (!isRegexRuleDef && /(api_key|secret|password|private_key)\s*[:=]\s*['"][A-Za-z0-9_\-]{12,}['"]/i.test(trimmed) && !/example|placeholder|test|MY_|omnix-local/i.test(trimmed)) {
        findings.push(
          makeFinding({
            file: file.path,
            line: lineNum,
            column: 1,
            language: lang,
            layer: 'Security',
            type: 'hardcoded-secret',
            severity: 'high',
            title: 'Potential hardcoded credential literal',
            cause: 'Secret or key string literal committed directly inside source code.',
            impact: 'Credential leakage across repository clones and build artifacts.',
            proposedFix: 'Read secret from process.env or environment secret manager.',
            originalSnippet: line,
            replacementCode: line.replace(/['"][A-Za-z0-9_\-]{12,}['"]/, 'process.env.SECRET_KEY || ""'),
            autoFixable: true,
          })
        );
      }

      // Quality & Static Checks
      if (/\bconsole\.log\s*\(/.test(trimmed) && !file.path.endsWith('server.ts') && !file.path.includes('test')) {
        findings.push(
          makeFinding({
            file: file.path,
            line: lineNum,
            column: line.indexOf('console.log') + 1,
            language: lang,
            layer: 'Quality',
            type: 'debug-console-log',
            severity: 'low',
            title: 'Unstructured console.log diagnostic left in module',
            cause: 'Ad-hoc stdout debug log remains in runtime code path.',
            impact: 'Noisy telemetry and potential exposure of internal values in logs.',
            proposedFix: 'Remove debug log or route through structured audit logger.',
            originalSnippet: line,
            replacementCode: '',
            autoFixable: true,
          })
        );
      }

      if (/:\s*any\b|\bas\s+any\b/.test(trimmed) && lang === 'TypeScript') {
        findings.push(
          makeFinding({
            file: file.path,
            line: lineNum,
            column: 1,
            language: lang,
            layer: 'Static',
            type: 'typescript-any-escape',
            severity: 'low',
            title: 'Explicit TypeScript `any` type assertion',
            cause: 'Bypassing structural type checking weakens compile-time guarantees.',
            impact: 'Latent runtime property errors undetected by tsc.',
            proposedFix: 'Replace `any` with `unknown` and narrow with type guards.',
            originalSnippet: line,
            replacementCode: line.replace(/:\s*any\b/g, ': unknown').replace(/\bas\s+any\b/g, 'as unknown'),
            autoFixable: true,
          })
        );
      }

      if (/\bSELECT\s+\*\s+FROM\b/i.test(trimmed)) {
        findings.push(
          makeFinding({
            file: file.path,
            line: lineNum,
            column: 1,
            language: lang,
            layer: 'Performance',
            type: 'sql-select-star',
            severity: 'medium',
            title: 'Unbounded SELECT * projection',
            cause: 'Query fetches every column including large TEXT/BLOB payloads unnecessarily.',
            impact: 'Increased memory allocation and disk/network I/O on hot paths.',
            proposedFix: 'Project only required columns explicitly.',
            originalSnippet: line,
            replacementCode: line.replace(/SELECT\s+\*/i, 'SELECT id, created_at /* specify columns */'),
            autoFixable: false,
          })
        );
      }

      if (/\bfs\.(readFileSync|writeFileSync)\b/.test(trimmed) && file.path.includes('routes')) {
        findings.push(
          makeFinding({
            file: file.path,
            line: lineNum,
            column: 1,
            language: lang,
            layer: 'Performance',
            type: 'blocking-sync-io',
            severity: 'medium',
            title: 'Synchronous filesystem I/O inside request handler',
            cause: 'Sync file call blocks the single-threaded Node event loop during I/O.',
            impact: 'Degraded concurrent tail latency across all API requests.',
            proposedFix: 'Switch to fs.promises async I/O.',
            originalSnippet: line,
            replacementCode: line.replace(/fs\.readFileSync/g, 'await fs.promises.readFile'),
            autoFixable: false,
          })
        );
      }

      // Dead code: simple unreachable line immediately after return inside same block
      if (/^\s*return\b.*;\s*$/.test(line) && idx + 1 < lines.length) {
        const nextTrimmed = lines[idx + 1].trim();
        if (nextTrimmed && !nextTrimmed.startsWith('}') && !nextTrimmed.startsWith('//') && !nextTrimmed.startsWith('case ') && !nextTrimmed.startsWith('default:')) {
          findings.push(
            makeFinding({
              file: file.path,
              line: lineNum + 1,
              column: 1,
              language: lang,
              layer: 'DeadCode',
              type: 'unreachable-statement',
              severity: 'medium',
              title: 'Unreachable statement after return',
              cause: 'Control flow exits function on preceding line before executing this line.',
              impact: 'Dead code increases cognitive load and masks logic errors.',
              proposedFix: 'Remove unreachable statement or fix branching condition.',
              originalSnippet: lines[idx + 1],
              replacementCode: '',
              autoFixable: true,
            })
          );
        }
      }
    }

    // Syntax delimiter balance check (for brace languages)
    if (['JavaScript', 'TypeScript', 'Java', 'C', 'C++', 'C#', 'Go', 'Rust', 'PHP', 'CSS', 'Swift', 'Kotlin'].includes(lang)) {
      const syntaxIssue = checkDelimiterBalance(file.content);
      if (syntaxIssue) {
        findings.push(
          makeFinding({
            file: file.path,
            line: syntaxIssue.line,
            column: 1,
            language: lang,
            layer: 'Syntax',
            type: 'delimiter-mismatch',
            severity: 'critical',
            title: syntaxIssue.issue,
            cause: 'Mismatched parenthesis, brace, or bracket in source token stream.',
            impact: 'File will fail to parse or compile.',
            proposedFix: 'Balance the opening/closing delimiters around the flagged line.',
            originalSnippet: lines[syntaxIssue.line - 1] || '',
            replacementCode: lines[syntaxIssue.line - 1] || '',
            autoFixable: false,
          })
        );
      }
    }

    // Semantic: unused ES imports check
    const imports = extractImports(file.content, lang);
    const namedImportRegex = /^\s*import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"]/gm;
    let im: RegExpExecArray | null;
    while ((im = namedImportRegex.exec(file.content)) !== null) {
      const lineNumber = file.content.slice(0, im.index).split(/\r?\n/).length;
      const specifiers = im[1]
        .split(',')
        .map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop() || '')
        .filter(Boolean);
      const bodyWithoutImport = file.content.slice(0, im.index) + file.content.slice(im.index + im[0].length);
      for (const spec of specifiers) {
        const usageRegex = new RegExp(`\\b${spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
        if (!usageRegex.test(bodyWithoutImport)) {
          findings.push(
            makeFinding({
              file: file.path,
              line: lineNumber,
              column: 1,
              language: lang,
              layer: 'Semantic',
              type: 'unused-import',
              severity: 'low',
              title: `Unused imported symbol '${spec}'`,
              cause: `'${spec}' is imported at module header but never referenced in file body.`,
              impact: 'Dead dependency edge and unnecessary bundle weight.',
              proposedFix: `Remove unused specifier '${spec}' from import list.`,
              originalSnippet: im[0],
              replacementCode: `// Remove unused symbol ${spec}`,
              autoFixable: false,
            })
          );
        }
      }
    }

    // Architecture: large monolithic file check
    if (lines.length > 650) {
      findings.push(
        makeFinding({
          file: file.path,
          line: 1,
          column: 1,
          language: lang,
          layer: 'Architecture',
          type: 'oversized-module',
          severity: 'medium',
          title: `Large module (${lines.length} LOC)`,
          cause: 'Single file exceeds 650 lines, concentrating multiple responsibilities.',
          impact: 'Harder test isolation, higher merge conflict rate, and coupling.',
          proposedFix: 'Split domain services or UI subpanels into cohesive modules.',
          originalSnippet: `// ${file.path}: ${lines.length} lines`,
          replacementCode: '// Extract sub-modules into dedicated files',
          autoFixable: false,
        })
      );
    }

    // Duplicate 4-line rolling hash
    const normLines = lines.map((l) => l.trim()).filter((l) => l.length > 18 && !l.startsWith('//') && !l.startsWith('import '));
    for (let i = 0; i <= normLines.length - 4; i++) {
      const windowStr = normLines.slice(i, i + 4).join('\n');
      const h = crypto.createHash('sha1').update(windowStr).digest('hex').slice(0, 10);
      const entry = blockMap.get(h) || { preview: windowStr.slice(0, 140), occurrences: [] };
      if (!entry.occurrences.some((o) => o.file === file.path && Math.abs(o.startLine - (i + 1)) < 4)) {
        entry.occurrences.push({ file: file.path, startLine: i + 1 });
      }
      blockMap.set(h, entry);
    }

    const exportsList = extractExports(file.content);
    const isEntryPoint =
      /(?:^|\/)(?:main|index|server|app)\.(ts|tsx|js|py|go|rs|java|c|cpp)$/i.test(file.path) ||
      /\bapp\.listen\s*\(/.test(file.content);
    if (isEntryPoint) entryPoints.push(file.path);

    fileMetrics.push({
      path: file.path,
      language: lang,
      loc: lines.length,
      blankLines,
      commentLines,
      functions,
      cyclomaticComplexity: complexity,
      imports,
      exports: exportsList,
      isEntryPoint,
    });
  }

  // Resolve dependency edges & detect circular dependencies
  const adj = new Map<string, Set<string>>();
  const importedFiles = new Set<string>();
  for (const fm of fileMetrics) {
    adj.set(fm.path, new Set());
    for (const spec of fm.imports) {
      if (spec.startsWith('.')) {
        const dir = fm.path.includes('/') ? fm.path.slice(0, fm.path.lastIndexOf('/')) : '';
        const joined = normalizeRelativePath(dir, spec);
        const candidates = [joined, `${joined}.ts`, `${joined}.tsx`, `${joined}.js`, `${joined}/index.ts`];
        const match = candidates.find((c) => pathSet.has(c));
        if (match) {
          dependencyEdges.push({ from: fm.path, to: match, spec });
          adj.get(fm.path)!.add(match);
          importedFiles.add(match);
        } else {
          findings.push(
            makeFinding({
              file: fm.path,
              line: 1,
              column: 1,
              language: fm.language,
              layer: 'Dependency',
              type: 'unresolved-relative-import',
              severity: 'medium',
              title: `Unresolved relative module '${spec}'`,
              cause: 'Relative import target was not found in scanned project file set.',
              impact: 'Potential module resolution failure at compile/runtime.',
              proposedFix: 'Verify file path or restore missing module.',
              originalSnippet: `import ... from '${spec}'`,
              replacementCode: `// Verify module path: ${spec}`,
              autoFixable: false,
            })
          );
        }
      }
    }
  }

  // Circular dependency 2-cycle check
  for (const edge of dependencyEdges) {
    if (adj.get(edge.to)?.has(edge.from) && edge.from < edge.to) {
      findings.push(
        makeFinding({
          file: edge.from,
          line: 1,
          column: 1,
          language: detectLanguage(edge.from),
          layer: 'Architecture',
          type: 'circular-dependency',
          severity: 'medium',
          title: `Bidirectional dependency cycle with ${edge.to}`,
          cause: `${edge.from} and ${edge.to} directly import one another.`,
          impact: 'Initialization ordering risk and tight module coupling.',
          proposedFix: 'Extract shared types/interfaces into a neutral shared module.',
          originalSnippet: `// ${edge.from} <-> ${edge.to}`,
          replacementCode: '// Extract shared contract into /shared/',
          autoFixable: false,
        })
      );
    }
  }

  const unusedFiles = fileMetrics
    .filter((f) => !f.isEntryPoint && !importedFiles.has(f.path) && !f.path.includes('test') && !f.path.endsWith('.html') && !f.path.endsWith('.css'))
    .map((f) => f.path);

  const duplicateBlocks: ProjectAnalysisReport['duplicateBlocks'] = [];
  for (const [hash, entry] of blockMap.entries()) {
    if (entry.occurrences.length >= 2) {
      duplicateBlocks.push({ hash, occurrences: entry.occurrences.slice(0, 6), preview: entry.preview });
      const first = entry.occurrences[0];
      findings.push(
        makeFinding({
          file: first.file,
          line: first.startLine,
          column: 1,
          language: detectLanguage(first.file),
          layer: 'DuplicateCode',
          type: 'repeated-block',
          severity: 'low',
          title: `Repeated code block detected across ${entry.occurrences.length} locations`,
          cause: 'Identical multi-line logic block duplicated instead of factored into a helper.',
          impact: 'Divergent bug fixes across duplicate copies.',
          proposedFix: 'Extract shared utility function and import where needed.',
          originalSnippet: entry.preview,
          replacementCode: '// Extract shared helper function',
          autoFixable: false,
        })
      );
    }
  }

  const layerSummary: Record<AnalysisLayer, number> = {
    Syntax: 0,
    Semantic: 0,
    Dependency: 0,
    Static: 0,
    Quality: 0,
    Security: 0,
    Performance: 0,
    DeadCode: 0,
    DuplicateCode: 0,
    Architecture: 0,
  };
  const severitySummary: Record<FindingSeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const f of findings) {
    layerSummary[f.layer]++;
    severitySummary[f.severity]++;
  }

  const totalLoc = fileMetrics.reduce((s, f) => s + f.loc, 0);
  const penalty =
    severitySummary.critical * 14 +
    severitySummary.high * 8 +
    severitySummary.medium * 3 +
    severitySummary.low * 0.7;
  const qualityScore = Math.max(10, Math.min(100, Math.round(100 - penalty / Math.max(1, files.length / 4))));
  const secPenalty = findings
    .filter((f) => f.layer === 'Security')
    .reduce((acc, f) => acc + (f.severity === 'critical' ? 20 : f.severity === 'high' ? 12 : 4), 0);
  const securityScore = Math.max(5, Math.min(100, Math.round(100 - secPenalty)));
  const archPenalty = (layerSummary.Architecture * 8 + unusedFiles.length * 2 + duplicateBlocks.length * 1.5);
  const architectureScore = Math.max(15, Math.min(100, Math.round(100 - archPenalty)));

  return {
    analyzedAt: new Date().toISOString(),
    fileCount: files.length,
    totalLoc,
    languages,
    entryPoints,
    unusedFiles,
    duplicateBlocks: duplicateBlocks.slice(0, 12),
    dependencyEdges,
    fileMetrics,
    findings: findings.slice(0, 150),
    layerSummary,
    severitySummary,
    qualityScore,
    securityScore,
    architectureScore,
  };
}

function normalizeRelativePath(baseDir: string, rel: string): string {
  const parts = (baseDir ? baseDir.split('/') : []).concat(rel.split('/'));
  const stack: string[] = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') stack.pop();
    else stack.push(p);
  }
  return stack.join('/');
}

export function applyPatchToSource(source: string, finding: CodexFinding): { patched: string; unifiedDiff: string } {
  const lines = source.split(/\r?\n/);
  const idx = finding.line - 1;
  if (idx < 0 || idx >= lines.length) {
    throw new Error(`Line ${finding.line} out of bounds for ${finding.file}`);
  }
  const before = lines[idx];
  const updatedLines = [...lines];
  if (finding.replacementCode === '') {
    updatedLines.splice(idx, 1);
  } else {
    updatedLines[idx] = finding.replacementCode;
  }
  const unifiedDiff = [
    `--- a/${finding.file}`,
    `+++ b/${finding.file}`,
    `@@ -${finding.line},1 +${finding.line},${finding.replacementCode === '' ? 0 : 1} @@`,
    `-${before}`,
    ...(finding.replacementCode === '' ? [] : [`+${finding.replacementCode}`]),
  ].join('\n');

  return { patched: updatedLines.join('\n'), unifiedDiff };
}

export function generateCodeArtifact(params: {
  prompt: string;
  language: SupportedCodexLanguage;
  artifactType: 'api' | 'model' | 'class' | 'test' | 'config' | 'docs';
}): { fileName: string; code: string; notes: string } {
  const p = params.prompt.toLowerCase();
  const isLoginPostgres = /login|auth|تسجيل دخول|postgres/i.test(p);

  if (isLoginPostgres && params.language === 'TypeScript') {
    return {
      fileName: 'authPostgresService.ts',
      notes: 'Generated PostgreSQL credential auth service with bcrypt hashing, parameterized SQL, and session tokens.',
      code: `import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { Pool } from 'pg';

export interface UserRecord {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  role: string;
}

export async function registerUserPostgres(
  pool: Pool,
  input: { email: string; username: string; password: string }
): Promise<{ id: string; email: string; username: string }> {
  const passwordHash = await bcrypt.hash(input.password, 12);
  const id = crypto.randomUUID();
  const result = await pool.query<UserRecord>(
    \`INSERT INTO users (id, email, username, password_hash, role)
     VALUES ($1, $2, $3, $4, 'FREE_USER')
     RETURNING id, email, username\`,
    [id, input.email.trim().toLowerCase(), input.username.trim(), passwordHash]
  );
  return result.rows[0];
}

export async function loginUserPostgres(
  pool: Pool,
  identifier: string,
  password: string
): Promise<{ token: string; userId: string } | null> {
  const res = await pool.query<UserRecord>(
    \`SELECT id, email, username, password_hash, role FROM users
     WHERE email = $1 OR username = $1 LIMIT 1\`,
    [identifier.trim().toLowerCase()]
  );
  const user = res.rows[0];
  if (!user) return null;
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return null;
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    \`INSERT INTO sessions (token, user_id, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '7 days')\`,
    [token, user.id]
  );
  return { token, userId: user.id };
}
`,
    };
  }

  const extMap: Record<SupportedCodexLanguage, string> = {
    Python: 'py',
    JavaScript: 'js',
    TypeScript: 'ts',
    Java: 'java',
    C: 'c',
    'C++': 'cpp',
    'C#': 'cs',
    Go: 'go',
    Rust: 'rs',
    PHP: 'php',
    HTML: 'html',
    CSS: 'css',
    SQL: 'sql',
    Swift: 'swift',
    Kotlin: 'kt',
  };
  const ext = extMap[params.language] || 'ts';

  if (params.language === 'Python') {
    return {
      fileName: `omnix_${params.artifactType}.${ext}`,
      notes: `Generated Python ${params.artifactType} scaffold for: ${params.prompt}`,
      code: `"""OMNIX Codex Generated Module (${params.artifactType})"""
from dataclasses import dataclass
from typing import Dict, Any

@dataclass
class GeneratedService:
    name: str = "${params.prompt.replace(/"/g, "'").slice(0, 48)}"

    def execute(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(payload, dict):
            raise ValueError("Payload must be a dictionary")
        return {"status": "ok", "service": self.name, "keys": list(payload.keys())}
`,
    };
  }

  if (params.language === 'SQL') {
    return {
      fileName: `migration_${params.artifactType}.sql`,
      notes: `Generated relational SQL schema for: ${params.prompt}`,
      code: `-- OMNIX Codex SQL Blueprint: ${params.prompt.slice(0, 60)}
CREATE TABLE IF NOT EXISTS domain_entities (
  id UUID PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_domain_entities_status ON domain_entities(status);
`,
    };
  }

  return {
    fileName: `omnix_${params.artifactType}.${ext}`,
    notes: `Generated ${params.language} ${params.artifactType} implementation.`,
    code: `// OMNIX Codex Generated ${params.language} (${params.artifactType})
// Directive: ${params.prompt.slice(0, 80)}

export interface ServiceResult<T> {
  ok: boolean;
  data: T;
  timestamp: string;
}

export function executeGeneratedService<T extends Record<string, unknown>>(input: T): ServiceResult<T> {
  if (!input || typeof input !== 'object') {
    throw new Error('Structured input object is required');
  }
  return {
    ok: true,
    data: input,
    timestamp: new Date().toISOString(),
  };
}
`,
  };
}
