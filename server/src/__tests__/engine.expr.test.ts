// E13 — CompatibilityRule.expr 화이트리스트 미니 파서(eval/Function 금지).
import { describe, expect, it } from 'vitest';
import { ExprSyntaxError, evalExpr, exprRefs, parseExpr } from '../engine/expr.js';

const run = (src: string, a: Record<string, unknown> = {}, b: Record<string, unknown> = {}) =>
  evalExpr(parseExpr(src), {
    a: a as Record<string, number | string | boolean>,
    b: b as Record<string, number | string | boolean>,
  });

describe('engine.expr — parse', () => {
  it('parses the 부록 A water example and evaluates both cage types', () => {
    const src = "b.type in ['LIVING_BOX','ACRYLIC'] ? a.mount != 'HANG' : true";
    expect(run(src, { mount: 'HANG' }, { type: 'LIVING_BOX' })).toBe(false);
    expect(run(src, { mount: 'STAND' }, { type: 'LIVING_BOX' })).toBe(true);
    expect(run(src, { mount: 'HANG' }, { type: 'WIRE' })).toBe(true);
    expect(exprRefs(parseExpr(src))).toEqual({ a: ['mount'], b: ['type'] });
  });

  it.each([
    'a.diameterCm + 4 <= b.heightCm',
    'a.diameterCm + 15 <= b.heightCm',
    "a.mount == 'HANG' ? b.type == 'WIRE' : true",
    'a.innerDiameterCm >= 6',
    'a.diameterCm + 4 <= b.heightCm', // 부록 A 첫 규칙과 동일
  ])('parses seed expr %s', (src) => {
    expect(() => parseExpr(src)).not.toThrow();
  });

  it.each([
    'a.constructor',
    'a.__proto__',
    "a['x']",
    'f(1)',
    'process.exit()',
    'c.x',
    'a.x = 1',
    '`a`',
    "'unterminated",
    'a.x ==',
    'a.x a.y',
    '(a.x',
    'a.',
    'a.x; b.y',
    'this.x',
    'a.x[0]',
    'globalThis',
    '',
  ])('rejects %j', (src) => {
    expect(() => parseExpr(src)).toThrow(ExprSyntaxError);
  });

  it('rejects absurd nesting depth', () => {
    expect(() => parseExpr('('.repeat(200) + '1' + ')'.repeat(200))).toThrow(ExprSyntaxError);
  });
});

describe('engine.expr — evaluate', () => {
  it('arithmetic + - * / with precedence and unary minus', () => {
    expect(run('1 + 2 * 3')).toBe(7);
    expect(run('(1 + 2) * 3')).toBe(9);
    expect(run('10 / 4 - 1')).toBe(1.5);
    expect(run('-a.x + 1', { x: 3 })).toBe(-2);
    expect(run('1 - -1')).toBe(2);
  });

  it('comparisons and equality', () => {
    expect(run('a.x <= 3', { x: 3 })).toBe(true);
    expect(run('a.x < 3', { x: 3 })).toBe(false);
    expect(run('a.x >= 3', { x: 2.5 })).toBe(false);
    expect(run('a.x > 2', { x: 2.5 })).toBe(true);
    expect(run("a.s == \"X\"", { s: 'X' })).toBe(true);
    expect(run('a.f != true', { f: false })).toBe(true);
  });

  it('in / not in', () => {
    expect(run("a.t in ['A','B']", { t: 'B' })).toBe(true);
    expect(run("a.t in ['A','B']", { t: 'C' })).toBe(false);
    expect(run("a.t not in ['A','B']", { t: 'C' })).toBe(true);
    expect(run('a.n in [1, 2, 3]', { n: 2 })).toBe(true);
  });

  it('logical && || ! and ternary', () => {
    expect(run('a.x > 1 && a.x < 5', { x: 3 })).toBe(true);
    expect(run('a.x > 4 || a.x < 2', { x: 3 })).toBe(false);
    expect(run('!(a.x > 4)', { x: 3 })).toBe(true);
    expect(run('a.x > 1 ? 10 : 20', { x: 0 })).toBe(20);
  });

  it('missing ref → UNKNOWN; any operation on UNKNOWN stays UNKNOWN', () => {
    expect(run('a.x + 4 <= b.h', { x: 30 }, {})).toBe('UNKNOWN');
    expect(run('!a.flag')).toBe('UNKNOWN');
    expect(run("a.t in ['A']")).toBe('UNKNOWN');
    expect(run('a.x > 1 && b.y > 1', { x: 3 })).toBe('UNKNOWN');
    expect(run('a.c ? 1 : 2')).toBe('UNKNOWN');
  });

  it('ternary evaluates only the taken branch', () => {
    const src = "a.mount == 'HANG' ? b.type == 'WIRE' : true";
    expect(run(src, { mount: 'STAND' }, {})).toBe(true);
    expect(run(src, { mount: 'HANG' }, {})).toBe('UNKNOWN');
  });

  it('type errors and division by zero → UNKNOWN (never throws, never coerces)', () => {
    expect(run("a.s + 1", { s: '1' })).toBe('UNKNOWN');
    expect(run('a.x / 0', { x: 1 })).toBe('UNKNOWN');
    expect(run("a.s < 'b'", { s: 'a' })).toBe('UNKNOWN');
    expect(run('a.b && true', { b: 1 })).toBe('UNKNOWN');
  });

  it('rejects Object.prototype member names at parse time', () => {
    expect(() => parseExpr('a.toString == 1')).toThrow(ExprSyntaxError);
    expect(() => parseExpr('b.hasOwnProperty')).toThrow(ExprSyntaxError);
    expect(() => parseExpr('a.prototype')).toThrow(ExprSyntaxError);
  });

  it('does not read inherited properties of the env', () => {
    const inherited = Object.create({ x: 5 }) as Record<string, number>;
    expect(evalExpr(parseExpr('a.x == 5'), { a: inherited, b: {} })).toBe('UNKNOWN');
  });

  it('values of a type outside SpecValue are UNKNOWN', () => {
    expect(run('a.x == 1', { x: { y: 1 } })).toBe('UNKNOWN');
    expect(run('a.x > 1', { x: Number.NaN })).toBe('UNKNOWN');
  });
});
