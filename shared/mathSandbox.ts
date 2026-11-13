export interface MathEvalResult {
  expression: string;
  value: number;
  formatted: string;
}

type Token =
  | { type: 'number'; value: number }
  | { type: 'ident'; value: string }
  | { type: 'op'; value: string }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'comma' };

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
};

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sqrt: (x) => {
    if (x < 0) throw new Error('Square root of negative number');
    return Math.sqrt(x);
  },
  abs: Math.abs,
  log: (x) => {
    if (x <= 0) throw new Error('Logarithm of non-positive number');
    return Math.log10(x);
  },
  ln: (x) => {
    if (x <= 0) throw new Error('Natural logarithm of non-positive number');
    return Math.log(x);
  },
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  pow: Math.pow,
  min: (...args) => Math.min(...args),
  max: (...args) => Math.max(...args),
};

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = expr.trim();
  if (!s) throw new Error('Empty expression');
  if (s.length > 512) throw new Error('Expression exceeds maximum length (512)');

  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let numStr = '';
      let dotCount = 0;
      while (i < s.length && /[0-9.]/.test(s[i])) {
        if (s[i] === '.') dotCount++;
        if (dotCount > 1) throw new Error(`Invalid number format near '${numStr}'`);
        numStr += s[i++];
      }
      if (s[i] === 'e' || s[i] === 'E') {
        numStr += s[i++];
        if (s[i] === '+' || s[i] === '-') numStr += s[i++];
        let expDigits = '';
        while (i < s.length && /[0-9]/.test(s[i])) {
          expDigits += s[i++];
        }
        if (!expDigits) throw new Error('Invalid scientific notation exponent');
        numStr += expDigits;
      }
      const val = Number(numStr);
      if (!Number.isFinite(val)) throw new Error(`Invalid numeric literal '${numStr}'`);
      tokens.push({ type: 'number', value: val });
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = '';
      while (i < s.length && /[a-zA-Z0-9_]/.test(s[i])) {
        ident += s[i++];
      }
      tokens.push({ type: 'ident', value: ident.toLowerCase() });
      continue;
    }
    if ('+-*/^%'.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen' });
      i++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'comma' });
      i++;
      continue;
    }
    throw new Error(`Disallowed or unrecognized character '${ch}'`);
  }
  return tokens;
}

export function evaluateMathExpression(expression: string): MathEvalResult {
  const tokens = tokenize(expression);
  let pos = 0;

  const peek = (): Token | undefined => tokens[pos];
  const consume = (): Token => tokens[pos++];

  function parseExpression(): number {
    let left = parseTerm();
    while (true) {
      const t = peek();
      if (t?.type === 'op' && (t.value === '+' || t.value === '-')) {
        consume();
        const right = parseTerm();
        left = t.value === '+' ? left + right : left - right;
      } else {
        break;
      }
    }
    return left;
  }

  function parseTerm(): number {
    let left = parsePower();
    while (true) {
      const t = peek();
      if (t?.type === 'op' && (t.value === '*' || t.value === '/' || t.value === '%')) {
        consume();
        const right = parsePower();
        if (t.value === '*') left *= right;
        else if (t.value === '/') {
          if (right === 0) throw new Error('Division by zero');
          left /= right;
        } else {
          if (right === 0) throw new Error('Modulo by zero');
          left %= right;
        }
      } else {
        break;
      }
    }
    return left;
  }

  function parsePower(): number {
    const base = parseUnary();
    const t = peek();
    if (t?.type === 'op' && t.value === '^') {
      consume();
      const exp = parsePower();
      return Math.pow(base, exp);
    }
    return base;
  }

  function parseUnary(): number {
    const t = peek();
    if (t?.type === 'op' && (t.value === '+' || t.value === '-')) {
      consume();
      const val = parseUnary();
      return t.value === '-' ? -val : val;
    }
    return parsePrimary();
  }

  function parsePrimary(): number {
    const t = peek();
    if (!t) throw new Error('Unexpected end of expression');

    if (t.type === 'number') {
      consume();
      return t.value;
    }

    if (t.type === 'lparen') {
      consume();
      const val = parseExpression();
      const close = peek();
      if (close?.type !== 'rparen') throw new Error('Missing closing parenthesis');
      consume();
      return val;
    }

    if (t.type === 'ident') {
      consume();
      if (peek()?.type === 'lparen') {
        const fn = FUNCTIONS[t.value];
        if (!fn) throw new Error(`Unknown function '${t.value}'`);
        consume();
        const args: number[] = [];
        if (peek()?.type !== 'rparen') {
          args.push(parseExpression());
          while (peek()?.type === 'comma') {
            consume();
            args.push(parseExpression());
          }
        }
        if (peek()?.type !== 'rparen') throw new Error(`Missing ')' after '${t.value}' arguments`);
        consume();
        const res = fn(...args);
        if (!Number.isFinite(res)) throw new Error(`Function '${t.value}' produced non-finite value`);
        return res;
      }
      if (t.value in CONSTANTS) {
        return CONSTANTS[t.value];
      }
      throw new Error(`Unknown identifier '${t.value}'`);
    }

    throw new Error(`Unexpected token in expression`);
  }

  const value = parseExpression();
  if (pos < tokens.length) {
    throw new Error('Unexpected trailing tokens in expression');
  }
  if (!Number.isFinite(value)) {
    throw new Error('Result is not a finite number');
  }

  const formatted = Number.isInteger(value)
    ? value.toString()
    : Number(value.toPrecision(10)).toString();

  return { expression, value, formatted };
}
