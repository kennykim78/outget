# 비밀값 스캔 (gitleaks)

작업 247 / 계획 `_workspace/243_architect_gitleaks_plan.md`. 저장소에 비밀값(API 키·개인 키·서버 시크릿 env 실값)이 들어오지 않게 세 곳에서 막는다.

| 위치 | 무엇을 | 명령 |
|---|---|---|
| 로컬 pre-commit 훅 | staged 변경 | `gitleaks git --pre-commit --staged` (`.githooks/pre-commit`) |
| CI `ci` 잡 — Checkout 바로 뒤 | 전체 이력(모든 ref) | `gitleaks git --log-opts="--all"` |
| CI `ci` 잡 — Build 뒤 | `client/dist`·`server/dist` | `gitleaks dir` |

모든 호출에 `--config .gitleaks.toml --redact --no-banner --exit-code 1`. 배포 워크플로는 해당 커밋의 `ci.yml` 이 초록일 때만 진행하므로 스캔 실패는 배포도 막는다.
컴플라이언스 스캐너의 C7(작업 트리 시크릿 규칙)은 병행 기간 동안 그대로 둔다(축소는 별도 커밋 — 계획 4절).

## 버전 고정

- 핀 단일 원본: `scripts/gitleaks-pin.json` — `version` + 플랫폼별 sha256(`linux_x64`·`windows_x64`).
- CI 는 공식 릴리스 아카이브를 받아 `sha256sum -c` 로 핀과 대조한 뒤에만 푼다. 서드파티 액션·토큰·추가 권한 없음.
- 로컬도 같은 버전: 아래 설치 스크립트가 같은 핀으로 검증한다. 버전이 다르면 훅이 경고한다.

## 처음 한 번 (클론마다)

```sh
npm run gitleaks:install   # 핀 버전 공식 아카이브 → sha256 검증 → .tools/gitleaks/ (git 무시). 불일치면 아무것도 쓰지 않고 exit 1
npm run hooks:install      # git config core.hooksPath .githooks (저장소 로컬 설정, 멱등)
```

- `package.json` 의 `prepare` 에 넣지 않는다(컨테이너의 `npm ci` 는 `.git` 이 없는 곳에서 돈다).
- 설치 스크립트는 Windows x64·Linux x64 만 지원한다. 그 밖의 환경은 핀과 같은 버전을 수동으로 받아 `Get-FileHash -Algorithm SHA256`(PowerShell) 또는 `sha256sum` 으로 핀과 대조한 뒤 PATH 에 두거나 `GITLEAKS_BIN` 으로 경로를 지정한다.
- 훅 해제: `npm run hooks:install -- --uninstall`.

## 훅 동작

- 바이너리 탐색: `$GITLEAKS_BIN` → `.tools/gitleaks/gitleaks(.exe)` → PATH.
- **바이너리가 없으면 커밋을 막는다**(fail-closed, 설치 안내 출력).
- 찾으면 규칙 id·파일·줄만 출력한다(값 원문은 출력하지 않는다).
- `--no-verify` 로 우회하지 않는다. 우회해도 CI 이력 스캔이 같은 커밋을 다시 잡는다.

## 오탐 처리

순서대로 시도한다.

1. **값 쪽을 고친다**(우선). 테스트의 합성 값은 엔트로피가 낮은 값(`'test'.repeat(7)` 등)이나 실행 시 조각을 이어 붙인 값으로 바꾼다.
2. 그 줄만 인라인 `gitleaks:allow` — 테스트(`__tests__/`)·`e2e/` 안에서만.
3. 이미 커밋된 이력의 오탐은 `.gitleaksignore` 에 지문(`commit:file:rule:line`) 한 줄. 바로 위에 사유 한 줄과 `# 판정일 · 판정자` 한 줄을 반드시 단다.
4. 파일 단위 허용(`.gitleaks.toml` 의 `[[allowlists]] paths`)은 마지막 수단 — 파일 경로를 정확히(폴더 와일드카드 금지), 최대 3개, 사유 주석 필수.

지문은 리포트의 `Fingerprint` 필드에서 얻는다. 리포트는 저장소 밖(임시 폴더)에만 쓰고, 규칙·파일·커밋·줄 외 필드(값·작성자 이메일)는 옮겨 적지 않는다.

```sh
gitleaks git --config .gitleaks.toml --redact --no-banner --log-opts="--all" \
  --report-format json --report-path <저장소 밖 경로>/gl.json --exit-code 0 .
```

**실제 비밀(의심 포함)이 나오면** 지문 무시를 넣지 말고 즉시 Kenny 에게 규칙·파일·커밋·줄만 보고한다(값 미기재). 1차 해결은 키 교체다.

## 핀 갱신 (분기 1회)

1. gitleaks 릴리스 노트에서 하위 명령·플래그(`git`·`dir`·`--pre-commit --staged`·`--redact`·`[[allowlists]]`) 변경 여부를 확인한다.
2. 새 버전의 `linux_x64.tar.gz`·`windows_x64.zip` 을 받아 직접 sha256 을 계산하고 같은 릴리스의 `checksums.txt` 와 한 번 대조한다.
3. `scripts/gitleaks-pin.json` 의 `version`·두 sha256 을 바꾼다(CI 는 이 파일을 읽으므로 `ci.yml` 은 수정하지 않는다).
4. `npm run gitleaks:install` → 로컬 이력 스캔 exit 0 → PR CI 초록.

- 경로 허용(`.gitleaks.toml` 의 `^scripts/...`)은 **저장소 루트 기준** 상대 경로에만 걸린다. `gitleaks dir` 을 루트가 아닌 곳에서 절대 경로로 돌리면 허용이 적용되지 않는다 — CI·훅처럼 루트에서 실행한다(QA251).
