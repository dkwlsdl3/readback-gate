# readback-gate

> 코딩 에이전트가 실행하기 **전에**, 자기가 이해한 내용을 먼저 되읽게 만든다.

[English](README.md) · **한국어**

AI 코딩 에이전트를 위한 런타임 프롬프트 게이트. 방금 입력한 저점수(모호) 명령을 —
루프 안에서 — 결정적으로 표시하고, 실행 전에 의도를 확인하도록 구조화된 되읽기를 주입한다.

![status: pre-release](https://img.shields.io/badge/status-v0%20pre--release-orange)
![license: MIT](https://img.shields.io/badge/license-MIT-blue)
![node](https://img.shields.io/badge/node-%3E%3D24-green)
![dependencies: none](https://img.shields.io/badge/deps-0-brightgreen)
![telemetry: local-only](https://img.shields.io/badge/telemetry-local--only-brightgreen)

데모 GIF 소스: [`assets/demo.tape`](assets/demo.tape). `vhs`와 `ffmpeg`가
있으면 `npm run demo`로 `assets/demo.gif`를 렌더할 수 있다.

---

## 문제

*"이거 알아서 다 처리해줘"* 라고 친다. 에이전트는 자신만만하게 엉뚱한 일을 하고,
당신은 파일 세 개가 바뀐 뒤에야 알아챈다.

다른 도구들은 브라우저에 붙여넣어 검사하거나 설정 파일을 린트한다. 하지만
**방금 친 그 명령을, 루프 안에서, 실행 직전에** 잡아주는 도구는 없었다.

## 무엇을 하나

**Before** — 모호한 프롬프트:

```text
이거 알아서 다 처리해줘
```

readback-gate가 저점수로 채점하고, 에이전트 컨텍스트에 짧은 지시를 주입한다:

```text
Readback-gate: clarity_score=16, risk_level=none, missing=goal_clarity, target_context, context_dependency, done_condition.
If the prompt is ambiguous, do not execute yet. First sync intent in this format:
1. State the understood goal in one sentence.
2. List 2-4 plausible interpretations as options.
3. Recommend one with a short reason.
4. Ask exactly one clarification question, then stop.
```

**After** — 명확한 프롬프트는 그대로 통과:

```text
src/core/scorer.ts에 risk_level 분류 테스트를 추가하고 npm test로 검증해줘
```

대상·범위·검증 명령이 다 있으니 통과한다.

## 무엇이 다른가

|  | 무엇을 검사 | 언제 | 차단? |
|---|---|---|---|
| 브라우저 붙여넣기 도구 | 프롬프트 텍스트 | 루프 밖 | 리포트만 |
| 설정 린터 | 정적 설정 파일 | 커밋 / CI | 파일 수정 |
| **readback-gate** | **방금 친 프롬프트** | **루프 안, 실행 직전** | **주입(기본) / 선택적 차단** |

- **결정적·로컬.** 채점 경로는 LLM·네트워크를 절대 호출하지 않는다 — 같은 입력, 같은 점수.
- **차단이 아니라 주입.** 내가 친 명령을 막는 건 가부장적이다. "먼저 되읽어라"를 주입하는 쪽이 우월하다. 하드 차단은 선택(`strict`).
- **비실행 인지.** 질문·수락·읽기 전용 조회는 건드리지 않고 통과시킨다.

## 설치

**Node ≥ 24** 필요.

```sh
npx readback-gate install
```

설치기는 기존 Codex와 Claude Code 설정 파일을 자동 감지한다. 대상을 강제하려면
`--codex` 또는 `--claude`, 미리보기는 `--dry-run`, 제거는 `--uninstall`을 쓴다.

## 사용법

### CLI

```sh
readback-gate "이거 알아서 다 처리해줘"
```

사람용 요약 + 리포트 JSON을 출력한다:

```json
{
  "version": "0.1.0",
  "clarity_score": 16,
  "risk_level": "none",
  "verdict": "inject",
  "axes": {
    "goal_clarity": 84,
    "target_context": 68,
    "scope_boundedness": 88,
    "done_condition": 90,
    "risk_side_effect": 100,
    "context_dependency": 88
  },
  "missing": ["goal_clarity", "target_context", "context_dependency", "done_condition"],
  "trigger_reasons": ["The requested action is vague or delegation-heavy."],
  "suggested_questions": ["What exact outcome should the agent produce?"]
}
```

### 훅으로 (Codex / Claude Code)

두 에이전트 모두 같은 `UserPromptSubmit` 프로토콜을 쓰므로 하나의 어댑터로
둘 다 된다. 한 명령으로 등록한다:

```sh
npx readback-gate install
```

대상별 옵션은 [install/README.md](install/README.md) 참조. 어댑터는:

- 주입 시 `{"hookSpecificOutput":{...,"additionalContext":"..."}}` 출력
- 통과 시 `{}` 출력
- `strict` 모드에서 저점수+고위험이면 stderr에 사유를 쓰고 `exit 2`로 차단

### 효과 측정용 dual-run (실험적)

`readback-gate-dual-run`은 같은 프롬프트에 대해 두 갈래 artifact를 남긴다:

- `gated_visible`: 프롬프트 + readback-gate가 주입한 컨텍스트
- `baseline_replica`: 같은 프롬프트/컨텍스트를 복제 워크스페이스에서
  `READBACK_GATE_DISABLE=1`로 실행

테스트 대상 agent는 Claude Code, Codex, 또는 다른 코딩 에이전트일 수 있다.
`--agent claude|codex|custom`은 나중에 분석할 때 층화하기 위한 메타데이터일 뿐이다.
비교 변수는 계속 readback-gate on/off 하나다. baseline은 `READBACK_GATE_DISABLE=1`로
돌고, gated만 readback-gate 주입을 받는다.

```sh
readback-gate-dual-run \
  --prompt "README.md 이거 좀 알아서 고쳐줘" \
  --context-file /tmp/full-transcript.txt \
  --context-fidelity full_transcript \
  --agent claude \
  --baseline-cmd "claude" \
  --gated-cmd "claude" \
  --require-primary
```

`claude` 자리는 해당 prompt를 한 번 실행하는 대상 agent 명령으로 바꾼다.
Codex라면 `codex exec`, custom wrapper라면 그 wrapper 명령을 넣으면 된다.
runner는 양쪽 branch에 같은 생성 input 파일을 stdin으로 넣는다.

기본 artifact 위치는 `/tmp/readback-gate-dualrun`이다. `summary.json`, 브랜치별
입력, stdout/stderr, git diff, status가 저장된다. `acceptance.primaryEligible=true`가
되려면 양쪽 브랜치가 모두 실행되고, 실제 readback-gate 처치가 있었고, 제공한
컨텍스트가 `--context-file`에서 온 `full_transcript`여야 한다. inline, 요약, 축약,
무컨텍스트 pair는 디버깅용으로는 보관하지만 primary 효과 주장에는 들어가지 않는다.

artifact는 기본 `--redaction basic`으로 흔한 token/key 패턴을 마스킹한다.
바이트 단위 원본 검토가 꼭 필요하고 artifact root를 안전하게 지킬 수 있을 때만
`--redaction off`를 쓴다.

accepted pair는 라벨 파일과 함께 집계한다:

```sh
readback-gate-dual-run-report \
  --artifacts-root /tmp/readback-gate-dualrun \
  --labels labels.jsonl \
  --min-labeled 30 \
  --require-ready
```

`labels.jsonl`은 줄마다 JSON 객체 하나를 둔다:

```json
{"pairId":"...","verdict":"gated_better","reviewer":"alice","confidence":"high"}
```

허용 verdict는 `gated_better`, `baseline_better`, `same`, `both_bad`, `exclude`다.
`--prepare-review <dir>`를 쓰면 primary-eligible이지만 아직 라벨이 없는 pair에 대해
블라인드 `arm_a` / `arm_b` 리뷰 패키지를 만든다.

블라인드 리뷰 패키지에는 AI 1차 라벨러를 돌릴 수 있다. 라벨러는 `arm_a`와 `arm_b`만
보고, `readback-gate-dual-run-label`이 나중에 `manifest.private.json`을 읽어
`gated_better` / `baseline_better` 라벨로 매핑해 `labels.jsonl`에 쓴다. 라벨링
프롬프트가 다시 queue에 들어가지 않도록 라벨러 subprocess는 `READBACK_GATE_DISABLE=1`로
실행된다:

```sh
readback-gate-dual-run-report \
  --artifacts-root /tmp/readback-gate-dualrun \
  --prepare-review /tmp/readback-gate-review

readback-gate-dual-run-label \
  --review-dir /tmp/readback-gate-review \
  --labels labels.jsonl \
  --audit audit.jsonl \
  --labeler-cmd "codex exec --sandbox read-only" \
  --reviewer ai-codex
```

AI 라벨은 1차 triage로 취급하고 최종 증거로 바로 쓰지 않는다. 공개 claim을 하려면
최소 10-20% 샘플과 `confidence=low`, `exclude`, `both_bad`, AI 라벨러끼리 갈린 케이스는
사람이 spot-check한다.

며칠 단위 live 실험은 훅 capture와 worker를 같이 켠다:

```sh
readback-gate install --codex --claude --dual-run-capture

readback-gate-dual-run-worker \
  --watch \
  --interval-sec 60 \
  --auth-bridge codex_symlink \
  --claude-cmd "claude" \
  --codex-cmd "codex exec"
```

훅은 prompt 후보를 queue에 남기기만 하고 live 세션 안에서 agent를 한 번 더 돌리지 않는다.
worker가 `/tmp/readback-gate-dualrun/<pair-id>/` 아래 artifact를 만들고, baseline과
gated를 각각 별도 replica 디렉터리에서 실행한다.

`--auth-bridge codex_symlink`는 선택 옵션이며 Codex queue 항목에만 적용된다.
격리된 branch HOME 안에 `.codex/auth.json` symlink를 만들어 `codex exec`가 전체 사용자
환경을 상속하지 않고도 인증할 수 있게 한다. 대신 로컬 Codex auth token을 branch agent에
의도적으로 노출하고 pair artifact 디렉터리 아래 symlink가 남으므로, artifact는 로컬에만
두고 검토 후 삭제해야 한다.

측정 기간이 끝나면 cleanup이 필수다. pair 디렉터리에는 전체 transcript, stdout/stderr,
diff, auth symlink가 남을 수 있다. 필요한 label/report를 뽑은 뒤 검토가 끝난 artifact는
삭제한다:

```sh
rm -rf /tmp/readback-gate-dualrun/<pair-id>
# 실험 전체가 끝난 뒤에는:
rm -rf /tmp/readback-gate-dualrun
```

중요한 한계: replica는 워크스페이스 스냅샷이지 OS 네트워크 샌드박스가 아니다.
baseline 환경변수는 기본적으로 최소화하고 `--command-guard remote_write`도 기본으로
켜서 `curl`, `wget`, `ssh`, `rsync`, `gh`, `git push` 같은 흔한 원격 명령은 막는다.
하지만 이것은 command shim이지 커널/네트워크 샌드박스가 아니다. 인식하지 못한 바이너리나
코드 레벨 네트워크 라이브러리로는 운영 API에 닿을 수 있으므로, 강한 격리가 필요하면
외부 샌드박스로 감싸야 한다. best-effort redaction 이후에도 artifact에는 프롬프트,
컨텍스트, diff, stdout, stderr, 시크릿이 남을 수 있으니 로컬에만 두고 검토 후 삭제해야 한다.

## 모드

| 모드 | 동작 |
|---|---|
| `silent` | 점수/결손 1줄만 주입. 지시 없음. |
| `inject` **(기본)** | 점수/신호 + 4단계 되읽기 지시 주입. |
| `advisory` | stderr에 리포트만 출력하고 계속. |
| `strict` | `clarity_score < 임계값` **그리고** `risk_level == high`일 때만 차단(`exit 2`), 아니면 `inject`처럼 동작. |

환경변수로 설정: `READBACK_GATE_MODE`, `READBACK_GATE_THRESHOLD`(기본 70),
`READBACK_GATE_TELEMETRY`.

## 채점 방식

`clarity_score`(0–100)는 6개 축의 결정적 감점을 `100`에서 뺀 값이다.
별도의 `risk_level`(`none`/`low`/`medium`/`high`)이 `strict` 차단을 결정한다.

| 축 | 감점 조건 |
|---|---|
| goal clarity | 모호 동사(처리해/알아서) 또는 동사 없음 |
| target/context | 구체적 파일·경로·심볼·모듈 없음 |
| scope boundedness | 범위 없음(전부/싹 다/모든) |
| done condition | 검증 가능한 완료 기준 없음 |
| risk / side-effect | 파괴·원격·운영 작업인데 확인 언급 없음 |
| context dependency | 미해결 참조·이전 대화 의존 |

한국어·영어 둘 다 감지한다. 전체 모델은 [docs/spec-v0.md](docs/spec-v0.md),
알려진 한계는 [§13](docs/spec-v0.md) 참조.

## 프라이버시

readback-gate는 **자체적인 데이터 전송이 전혀 없다**:

- **네트워크 호출·phone-home·기기 핑거프린트 없음.** 채점은 결정적·오프라인이며,
  readback-gate가 자기/제3자 서버로 보내는 것은 아무것도 없다.
- **원문 프롬프트는 절대 저장하지 않는다.** 텔레메트리는 `prompt_hash`, 길이, 점수,
  위험도, verdict, 결손 축만 **로컬 JSONL 파일**에 기록한다.
- 선택적 LLM 보조(설명/재작성)는 철저히 opt-in이다.

> 참고: readback-gate는 코딩 에이전트 *안에서* 동작한다. 회원님 에이전트는 프롬프트
> (+readback-gate가 주입한 짧은 줄)를 원래대로 자기 모델 제공자에게 전송한다.
> readback-gate는 **새로운 전송 목적지를 추가하지 않을** 뿐이다.

## 상태 & 정직성

readback-gate는 광고대로 동작한다: 결정적 채점 + 저점수 프롬프트에 구조화된
되읽기 주입. 하지만 **아직 없는 것**은 *이게 실제 실수를 줄인다는 증거*다 —
실데이터 ~3,700개 프롬프트 백테스트에서 점수와 이후 재작업 사이에 **상관이
없었다.** 그러니 지금은 *실행 전 한 번 멈춰 확인하게 하는 보조 도구*로 보는 게
맞고, 입증된 오류 방지기는 아니다. 개입이 실제로 도움이 되는지는 on/off A/B로
검증할 열린 질문이다.

## 로드맵

- [ ] A/B / accepted dual-run 데이터셋으로 개입이 실제로 재작업을 줄이는지 측정
- [ ] 전용 Claude Code 어댑터 (경계는 이미 분리돼 있음)
- [ ] 재작업을 실제로 예측하는 것에 맞춰 점수 재설계 (A/B가 긍정적이면)
- [ ] 변이 동사 denylist 보강 ([§13](docs/spec-v0.md))

## 개발

런타임 의존성 없음.

```sh
npm test
npm run demo
readback-gate "src/core/scorer.ts에 테스트 추가하고 npm test로 검증해줘"
READBACK_GATE_MODE=strict node src/adapters/codex.ts < test/fixtures/codex-ambiguous.json
```

## 라이선스

MIT
