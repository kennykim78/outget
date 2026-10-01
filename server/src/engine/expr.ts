// CompatibilityRule.expr 화이트리스트 미니 파서 + 3값 평가기(PRD 부록 A, R2 계획 §C.2).
//   eval·Function·동적 속성 접근 없음. 허용: 숫자·문자열·true/false/null·리스트, a.<ident>/b.<ident> 참조,
//   + - * /, < <= > >= == !=, in / not in [..], ! && ||, ?: , 괄호. 그 외(호출·계산된 멤버·다른 식별자·
//   대입 '='·백틱)는 ExprSyntaxError.
//   값 누락·타입 불일치·0 나눗셈 → UNKNOWN. UNKNOWN 에 대한 모든 연산은 UNKNOWN(삼항은 선택된 가지만 평가).
import type { SpecValue, SpecValues } from './types.js';

export class ExprSyntaxError extends Error {
  readonly pos: number;
  constructor(message: string, pos: number) {
    super(`${message} (at ${pos})`);
    this.name = 'ExprSyntaxError';
    this.pos = pos;
  }
}

export type BinaryOp = '+' | '-' | '*' | '/' | '<' | '<=' | '>' | '>=' | '==' | '!=' | '&&' | '||';

export type ExprNode =
  | { readonly t: 'num'; readonly v: number }
  | { readonly t: 'str'; readonly v: string }
  | { readonly t: 'bool'; readonly v: boolean }
  | { readonly t: 'null' }
  | { readonly t: 'ref'; readonly side: 'a' | 'b'; readonly key: string }
  | { readonly t: 'list'; readonly items: readonly ExprNode[] }
  | { readonly t: 'neg'; readonly arg: ExprNode }
  | { readonly t: 'not'; readonly arg: ExprNode }
  | { readonly t: 'bin'; readonly op: BinaryOp; readonly l: ExprNode; readonly r: ExprNode }
  | { readonly t: 'in'; readonly negated: boolean; readonly l: ExprNode; readonly list: ExprNode }
  | { readonly t: 'cond'; readonly test: ExprNode; readonly then: ExprNode; readonly else: ExprNode };

const MAX_SOURCE_LENGTH = 1000;
const MAX_DEPTH = 64;

// ── tokenizer ────────────────────────────────────────────────
type Tok =
  | { k: 'num'; v: number; pos: number }
  | { k: 'str'; v: string; pos: number }
  | { k: 'id'; v: string; pos: number }
  | { k: 'op'; v: string; pos: number }
  | { k: 'eof'; pos: number };

const TWO_CHAR_OPS = ['==', '!=', '<=', '>=', '&&', '||'];
const ONE_CHAR_OPS = '+-*/<>!?:()[],.';

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if (c >= '0' && c <= '9') {
      const m = /^\d+(?:\.\d+)?/.exec(src.slice(i));
      const text = m ? m[0] : c;
      out.push({ k: 'num', v: Number(text), pos: i });
      i += text.length;
      continue;
    }
    if (c === "'" || c === '"') {
      const start = i;
      let s = '';
      i++;
      let closed = false;
      while (i < src.length) {
        const d = src[i];
        if (d === '\\') {
          if (i + 1 >= src.length) break;
          s += src[i + 1];
          i += 2;
          continue;
        }
        if (d === c) {
          closed = true;
          i++;
          break;
        }
        s += d;
        i++;
      }
      if (!closed) throw new ExprSyntaxError('unterminated string', start);
      out.push({ k: 'str', v: s, pos: start });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
      const text = m ? m[0] : c;
      out.push({ k: 'id', v: text, pos: i });
      i += text.length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.includes(two)) {
      out.push({ k: 'op', v: two, pos: i });
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPS.includes(c)) {
      out.push({ k: 'op', v: c, pos: i });
      i++;
      continue;
    }
    throw new ExprSyntaxError(`unexpected character ${JSON.stringify(c)}`, i);
  }
  out.push({ k: 'eof', pos: src.length });
  return out;
}

// ── parser (recursive descent) ───────────────────────────────
function isForbiddenMember(name: string): boolean {
  return name === 'prototype' || name === '__proto__' || name in Object.prototype;
}

class Parser {
  private i = 0;
  private depth = 0;
  constructor(private readonly toks: Tok[]) {}

  private peek(): Tok {
    return this.toks[this.i];
  }
  private next(): Tok {
    const t = this.toks[this.i];
    if (t.k !== 'eof') this.i++;
    return t;
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return t.k === 'op' && t.v === v;
  }
  private isId(v: string): boolean {
    const t = this.peek();
    return t.k === 'id' && t.v === v;
  }
  private expectOp(v: string): void {
    const t = this.next();
    if (t.k !== 'op' || t.v !== v) throw new ExprSyntaxError(`expected '${v}'`, t.pos);
  }
  private enter(): void {
    if (++this.depth > MAX_DEPTH) throw new ExprSyntaxError('expression nested too deeply', this.peek().pos);
  }
  private leave(): void {
    this.depth--;
  }

  parseAll(): ExprNode {
    const n = this.ternary();
    const t = this.peek();
    if (t.k !== 'eof') throw new ExprSyntaxError('unexpected token', t.pos);
    return n;
  }

  private ternary(): ExprNode {
    this.enter();
    const test = this.or();
    let out: ExprNode = test;
    if (this.isOp('?')) {
      this.next();
      const then = this.ternary();
      this.expectOp(':');
      const els = this.ternary();
      out = { t: 'cond', test, then, else: els };
    }
    this.leave();
    return out;
  }

  private or(): ExprNode {
    let l = this.and();
    while (this.isOp('||')) {
      this.next();
      l = { t: 'bin', op: '||', l, r: this.and() };
    }
    return l;
  }

  private and(): ExprNode {
    let l = this.not();
    while (this.isOp('&&')) {
      this.next();
      l = { t: 'bin', op: '&&', l, r: this.not() };
    }
    return l;
  }

  private not(): ExprNode {
    if (this.isOp('!')) {
      this.next();
      this.enter();
      const arg = this.not();
      this.leave();
      return { t: 'not', arg };
    }
    return this.cmp();
  }

  private cmp(): ExprNode {
    const l = this.add();
    const t = this.peek();
    if (t.k === 'op' && ['==', '!=', '<=', '>=', '<', '>'].includes(t.v)) {
      this.next();
      return { t: 'bin', op: t.v as BinaryOp, l, r: this.add() };
    }
    if (this.isId('in')) {
      this.next();
      return { t: 'in', negated: false, l, list: this.listLiteral() };
    }
    if (this.isId('not')) {
      this.next();
      if (!this.isId('in')) throw new ExprSyntaxError("expected 'in' after 'not'", this.peek().pos);
      this.next();
      return { t: 'in', negated: true, l, list: this.listLiteral() };
    }
    return l;
  }

  private add(): ExprNode {
    let l = this.mul();
    for (;;) {
      const t = this.peek();
      if (t.k === 'op' && (t.v === '+' || t.v === '-')) {
        this.next();
        l = { t: 'bin', op: t.v, l, r: this.mul() };
      } else return l;
    }
  }

  private mul(): ExprNode {
    let l = this.unary();
    for (;;) {
      const t = this.peek();
      if (t.k === 'op' && (t.v === '*' || t.v === '/')) {
        this.next();
        l = { t: 'bin', op: t.v, l, r: this.unary() };
      } else return l;
    }
  }

  private unary(): ExprNode {
    if (this.isOp('-')) {
      this.next();
      this.enter();
      const arg = this.unary();
      this.leave();
      return { t: 'neg', arg };
    }
    return this.primary();
  }

  private listLiteral(): ExprNode {
    const t = this.peek();
    if (!(t.k === 'op' && t.v === '[')) throw new ExprSyntaxError("expected '[' list", t.pos);
    return this.primary();
  }

  private primary(): ExprNode {
    const t = this.next();
    switch (t.k) {
      case 'num':
        return { t: 'num', v: t.v };
      case 'str':
        return { t: 'str', v: t.v };
      case 'id': {
        if (t.v === 'true') return { t: 'bool', v: true };
        if (t.v === 'false') return { t: 'bool', v: false };
        if (t.v === 'null') return { t: 'null' };
        if (t.v === 'a' || t.v === 'b') {
          this.expectOp('.');
          const k = this.next();
          if (k.k !== 'id') throw new ExprSyntaxError('expected field name after "."', k.pos);
          if (isForbiddenMember(k.v)) throw new ExprSyntaxError(`forbidden field name ${k.v}`, k.pos);
          const after = this.peek();
          if (after.k === 'op' && (after.v === '.' || after.v === '(' || after.v === '[')) {
            throw new ExprSyntaxError('member access, calls and indexing are not allowed', after.pos);
          }
          return { t: 'ref', side: t.v, key: k.v };
        }
        throw new ExprSyntaxError(`unknown identifier ${t.v}`, t.pos);
      }
      case 'op': {
        if (t.v === '(') {
          const inner = this.ternary();
          this.expectOp(')');
          return inner;
        }
        if (t.v === '[') {
          const items: ExprNode[] = [];
          if (!this.isOp(']')) {
            items.push(this.ternary());
            while (this.isOp(',')) {
              this.next();
              items.push(this.ternary());
            }
          }
          this.expectOp(']');
          return { t: 'list', items };
        }
        throw new ExprSyntaxError(`unexpected '${t.v}'`, t.pos);
      }
      case 'eof':
        throw new ExprSyntaxError('unexpected end of expression', t.pos);
    }
  }
}

/** 문자열 → AST. 화이트리스트 밖이면 ExprSyntaxError. */
export function parseExpr(src: string): ExprNode {
  if (typeof src !== 'string') throw new ExprSyntaxError('expression must be a string', 0);
  if (src.length > MAX_SOURCE_LENGTH) throw new ExprSyntaxError('expression too long', MAX_SOURCE_LENGTH);
  return new Parser(tokenize(src)).parseAll();
}

/** 식이 참조하는 a.*, b.* 키(등장 순서, 중복 제거). */
export function exprRefs(n: ExprNode): { a: string[]; b: string[] } {
  const out = { a: [] as string[], b: [] as string[] };
  const walk = (x: ExprNode): void => {
    switch (x.t) {
      case 'ref':
        if (!out[x.side].includes(x.key)) out[x.side].push(x.key);
        return;
      case 'list':
        x.items.forEach(walk);
        return;
      case 'neg':
      case 'not':
        walk(x.arg);
        return;
      case 'bin':
        walk(x.l);
        walk(x.r);
        return;
      case 'in':
        walk(x.l);
        walk(x.list);
        return;
      case 'cond':
        walk(x.test);
        walk(x.then);
        walk(x.else);
        return;
      default:
        return;
    }
  };
  walk(n);
  return out;
}

/** 식이 쓰는 문자열 리터럴과, 그 리터럴이 비교되는 참조(a.k/b.k). 시드 검증(R07 enum 리터럴)용. */
export function exprComparedLiterals(
  n: ExprNode,
): Array<{ side: 'a' | 'b'; key: string; literal: string }> {
  const out: Array<{ side: 'a' | 'b'; key: string; literal: string }> = [];
  const lits = (x: ExprNode): string[] =>
    x.t === 'str' ? [x.v] : x.t === 'list' ? x.items.flatMap(lits) : [];
  const pair = (ref: ExprNode, other: ExprNode): void => {
    if (ref.t !== 'ref') return;
    for (const literal of lits(other)) out.push({ side: ref.side, key: ref.key, literal });
  };
  const walk = (x: ExprNode): void => {
    if (x.t === 'bin' && (x.op === '==' || x.op === '!=')) {
      pair(x.l, x.r);
      pair(x.r, x.l);
    }
    if (x.t === 'in') pair(x.l, x.list);
    switch (x.t) {
      case 'list':
        x.items.forEach(walk);
        return;
      case 'neg':
      case 'not':
        walk(x.arg);
        return;
      case 'bin':
        walk(x.l);
        walk(x.r);
        return;
      case 'in':
        walk(x.l);
        walk(x.list);
        return;
      case 'cond':
        walk(x.test);
        walk(x.then);
        walk(x.else);
        return;
      default:
        return;
    }
  };
  walk(n);
  return out;
}

// ── evaluator ────────────────────────────────────────────────
const UNK: unique symbol = Symbol('UNKNOWN');
type Val = number | string | boolean | null | Val[] | typeof UNK;

function lookup(env: SpecValues, key: string): Val {
  if (env === null || typeof env !== 'object') return UNK;
  if (!Object.prototype.hasOwnProperty.call(env, key)) return UNK;
  const v: unknown = env[key];
  if (typeof v === 'number') return Number.isFinite(v) ? v : UNK;
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  return UNK;
}

function num(v: Val): v is number {
  return typeof v === 'number';
}
function prim(v: Val): v is number | string | boolean | null {
  return v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean';
}
function finite(x: number): Val {
  return Number.isFinite(x) ? x : UNK;
}

function ev(n: ExprNode, env: { a: SpecValues; b: SpecValues }): Val {
  switch (n.t) {
    case 'num':
    case 'str':
    case 'bool':
      return n.v;
    case 'null':
      return null;
    case 'ref':
      return lookup(env[n.side], n.key);
    case 'list': {
      const items: Val[] = [];
      for (const it of n.items) {
        const v = ev(it, env);
        if (v === UNK) return UNK;
        items.push(v);
      }
      return items;
    }
    case 'neg': {
      const v = ev(n.arg, env);
      return num(v) ? finite(-v) : UNK;
    }
    case 'not': {
      const v = ev(n.arg, env);
      return typeof v === 'boolean' ? !v : UNK;
    }
    case 'cond': {
      const c = ev(n.test, env);
      if (typeof c !== 'boolean') return UNK;
      return c ? ev(n.then, env) : ev(n.else, env);
    }
    case 'in': {
      const l = ev(n.l, env);
      const list = ev(n.list, env);
      if (l === UNK || list === UNK || !Array.isArray(list) || !prim(l)) return UNK;
      const has = list.some((x) => prim(x) && x === l);
      return n.negated ? !has : has;
    }
    case 'bin': {
      const l = ev(n.l, env);
      const r = ev(n.r, env);
      if (l === UNK || r === UNK) return UNK;
      switch (n.op) {
        case '+':
          return num(l) && num(r) ? finite(l + r) : UNK;
        case '-':
          return num(l) && num(r) ? finite(l - r) : UNK;
        case '*':
          return num(l) && num(r) ? finite(l * r) : UNK;
        case '/':
          return num(l) && num(r) && r !== 0 ? finite(l / r) : UNK;
        case '<':
          return num(l) && num(r) ? l < r : UNK;
        case '<=':
          return num(l) && num(r) ? l <= r : UNK;
        case '>':
          return num(l) && num(r) ? l > r : UNK;
        case '>=':
          return num(l) && num(r) ? l >= r : UNK;
        case '==':
          return prim(l) && prim(r) ? l === r : UNK;
        case '!=':
          return prim(l) && prim(r) ? l !== r : UNK;
        case '&&':
          return typeof l === 'boolean' && typeof r === 'boolean' ? l && r : UNK;
        case '||':
          return typeof l === 'boolean' && typeof r === 'boolean' ? l || r : UNK;
      }
    }
  }
}

function toPublic(v: Val): SpecValue | SpecValue[] | 'UNKNOWN' {
  if (v === UNK || v === null) return 'UNKNOWN';
  if (Array.isArray(v)) {
    const out: SpecValue[] = [];
    for (const x of v) {
      if (x === UNK || x === null || Array.isArray(x)) return 'UNKNOWN';
      out.push(x);
    }
    return out;
  }
  return v;
}

/**
 * AST 평가. 결정적·부작용 없음. 판정 불가(값 누락·타입 불일치·0 나눗셈·null 결과) → 'UNKNOWN'.
 * 호출자는 결과가 정확히 true/false 인지로 통과/실패를 판단하고, 그 밖은 모두 CHECK 로 다룬다.
 */
export function evalExpr(
  n: ExprNode,
  env: { a: SpecValues; b: SpecValues },
): SpecValue | SpecValue[] | 'UNKNOWN' {
  return toPublic(ev(n, env));
}
