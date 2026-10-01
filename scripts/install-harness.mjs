#!/usr/bin/env node
// harness-config/ → .claude/ (agents, skills, settings.json). Cowork는 .claude/에 직접 쓸 수 없어 설정을 harness-config/로 배송하고 이 스크립트가 설치한다.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = process.cwd(), src = join(root, "harness-config"), dst = join(root, ".claude");
if (!existsSync(src)) { console.error("harness-config/ not found — run from repo root"); process.exit(1); }
mkdirSync(dst, { recursive: true });
for (const d of ["agents", "skills"]) { cpSync(join(src, d), join(dst, d), { recursive: true, force: true }); console.log(`installed .claude/${d}/`); }
const sPath = join(dst, "settings.json");
const incoming = JSON.parse(readFileSync(join(src, "settings.json"), "utf8"));
let current = {}; try { current = JSON.parse(readFileSync(sPath, "utf8")); } catch {}
const allow = new Set([...(current.permissions?.allow ?? []), ...(incoming.permissions?.allow ?? [])]);
writeFileSync(sPath, JSON.stringify({ ...current, ...incoming, permissions: { ...(current.permissions ?? {}), ...(incoming.permissions ?? {}), allow: [...allow] } }, null, 2));
console.log("settings.json merged (model=opus). Restart Claude Code so withsmall-build + 9 agents register.");
