# readback-gate

> 코딩 에이전트가 실행하기 **전에**, 자기가 이해한 내용을 먼저 되읽게 만든다.

[English](README.md) · **한국어**

AI 코딩 에이전트를 위한 런타임 프롬프트 게이트. 방금 입력한 저점수(모호) 명령을 —
루프 안에서 — 결정적으로 표시하고, 실행 전에 의도를 확인하도록 구조화된 되읽기를 주입한다.

![status: pre-release](https://img.shields.io/badge/status-v0%20pre--release-orange)
![license: MIT](https://img.shields.io/badge/license-MIT-blue)
![node](https://img.shields.io/badge/node-%3E%3D24-green)
![dependencies: none](https://img.shields.io/badge/deps-0-brightgreen)
![privacy: 100% local](https://img.shields.io/badge/privacy-100%25%20local-brightgreen)

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

readback-gate는 설계상 **100% 로컬**이다:

- **기본 경로에 네트워크 없음.** 채점은 결정적·오프라인 — LLM·API·phone-home·기기
  핑거프린트 전부 없다. 프롬프트에 관한 어떤 것도 기기를 떠나지 않는다.
- **원문 프롬프트는 절대 저장하지 않는다.** 텔레메트리는 `prompt_hash`, 길이, 점수,
  위험도, verdict, 결손 축만 **로컬 JSONL 파일**에 기록하며, 전송하지 않는다.
- 선택적 LLM 보조(설명/재작성)는 철저히 opt-in이다.

## 상태 & 정직성

readback-gate는 광고대로 동작한다: 결정적 채점 + 저점수 프롬프트에 구조화된
되읽기 주입. 하지만 **아직 없는 것**은 *이게 실제 실수를 줄인다는 증거*다 —
실데이터 ~3,700개 프롬프트 백테스트에서 점수와 이후 재작업 사이에 **상관이
없었다.** 그러니 지금은 *실행 전 한 번 멈춰 확인하게 하는 보조 도구*로 보는 게
맞고, 입증된 오류 방지기는 아니다. 개입이 실제로 도움이 되는지는 on/off A/B로
검증할 열린 질문이다.

## 로드맵

- [ ] A/B(게이트 on vs off)로 개입이 실제로 재작업을 줄이는지 측정
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
