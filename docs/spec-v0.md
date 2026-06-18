# readback-gate — v0 Spec (합의안)

> **상태:** 합의 100% 종료. 구현 착수 가능.
> **방식:** Codex ↔ Claude Code 교차검증으로 도출. 본 문서가 v0 단일 진실 소스(SSOT).
> **합의 시점:** 2026-06-18.

---

## 1. 제품 한 줄 (Positioning)

> **A runtime prompt gate for coding agents. It catches ambiguous tasks before your agent misunderstands them.**

보조 카피:
> tasklint은 브라우저에서 프롬프트를 검사하고, AgentLinter는 설정파일을 검사한다.
> **readback-gate는 방금 친 명령을 — 루프 안에서, 에이전트가 실행하기 전에 — 잡아낸다.**

"catches"는 hard block이 아니라 **inject/advisory까지 포함**하는 표현이다.

---

## 2. 핵심 결정 (Why this shape)

1. **본체는 점수기가 아니라 실행 직전 런타임 게이트다.** 점수는 가치의 본체가 아니라 *계량 인프라*(threshold·추세·before/after·정책에 필요). 되묻는 행위가 가치.
2. **기본 메커닉은 block이 아니라 inject다.** 사용자가 직접 친 명령을 막는 건 가부장적 → retention 하락. 컨텍스트에 "먼저 확인하라"를 주입하는 쪽이 우월. (현재 동작 중인 Prompt Sync Gate가 그 실증.)
3. **채점은 결정적·로컬이어야 한다.** LLM이 매번 다른 점수를 주면 gate 모드 신뢰가 깨진다.
4. **단순 명령은 즉시 통과.** `ls`/`git status` 같은 자명한 명령까지 채점하면 마찰·비용·지연·프라이버시 문제로 도구가 제거된다.
5. **포지셔닝 C: 실사용 도구 우선, 바이럴은 그 위에.** "만든 사람도 매일 쓴다"가 가장 강한 신뢰 신호.

---

## 3. 경쟁 분석 (검증 완료, 2026-06-18)

핵심 두 축: **언제(WHEN)** 검사하느냐 × **무엇(WHAT)**을 검사하느냐.

| 도구 | 실체 | 무엇을 | 언제 | 차단? | 빈틈 |
|---|---|---|---|---|---|
| tasklint.dev | 웹 붙여넣기 도구 | 프롬프트 텍스트 | 루프 밖(웹) | ❌ 리포트만 | 흐름 단절, 자동 개입 0, 실행시점 가로채기 없음 |
| AgentLinter 계열 / Codacy | npx CLI / CI | **정적 설정파일**(CLAUDE.md/AGENTS.md) | 커밋·CI | 파일 `--fix` | 방금 친 명령이 아니라 *상시 규칙*을 봄 (직교) |
| promptfoo | eval/red-team | 모델 출력/테스트셋 | 오프라인 | N/A | 프로덕션 전 테스트, 세션 내 게이팅 아님 |

**빈 사분면:** `런타임 × 프롬프트 단위 × 루프 안` — 비어 있음. 이것이 readback-gate의 자리.

**정직한 단서:**
- 훅 메커닉 자체는 진입장벽이 낮다(튜토리얼 다수). 해자는 훅이 아니라 → (1) 결정적 스코어러 품질·튜닝, (2) **타당성 데이터**(저점수↔재작업 상관), (3) **단일 core 크로스플랫폼**. 선점 + 완성도 + 데이터.
- Codacy(자금 보유)가 "에이전트 린팅" 카테고리에 진입. 현재는 설정파일이지만 런타임 피벗 가능 → 속도가 변수.
- **보너스:** Codex 훅은 Claude Code 훅의 "거의 직접 포팅"(같은 JSON-on-stdin, 같은 exit code, 같은 `additionalContext` 형태). → 크로스플랫폼 어댑터 비용이 크게 낮음. core 하나 + 거의 동일한 얇은 어댑터.

---

## 4. v0 범위 (최종 합의)

- deterministic local scorer (채점 경로에 네트워크/LLM 호출 **금지**)
- Codex-first UserPromptSubmit hook
- default mode = **inject**
- optional modes = silent, advisory, strict
- LLM은 설명/재작성/질문 생성에만 **opt-in**. 기본 채점에는 안 씀
- validity 신호는 v0부터 로컬 로그로 **적재만**. 상관분석/통계/UI는 v1
- 아키텍처: **core + adapter를 day-1부터 분리.** v0는 Codex 어댑터만, Claude 어댑터는 v1(단 경계는 깨끗이 유지)

---

## 5. 점수 모델 (6축, 감점식, 결정적)

한국어 + 영어 동시 감지.

```
clarity_score = 100 - missing_goal - missing_target - unbounded_scope
                    - missing_done - risk_unacknowledged - context_dependency
```

- 각 감점항은 결정적 룰(정규식/키워드/구조)로 계산. 결과는 **0~100으로 클램프**.
- 별도로 **`risk_level`(none|low|medium|high)** 분류기를 둔다 → strict 게이팅 트리거용.
  - ⚠️ `risk_unacknowledged`(위험한데 확인/주의 언급 없음 = 감점항)와 `risk_level`(원시 위험도)은 **서로 다른 값**. 둘 다 유지한다.

| # | 축 | 무엇을 보나 | 감점 트리거 (KO/EN) |
|---|---|---|---|
| 1 | goal clarity | 동사+목적어 명확? | 모호동사(처리해/알아서/다 해놔), 동사 없음 |
| 2 | target/context clarity | 대상 구체적(파일/경로/심볼)? | 미해결 대명사(이거/그거/저번 거) |
| 3 | scope boundedness | 범위 닫힘? | 전부/싹 다/모든/경계 없음 |
| 4 | done condition | 검증 가능한 완료 기준? | 성공 기준 미명시 |
| 5 | risk / side-effect | 파괴·비가역·외부 작업 | delete/deploy/push/drop/rm/force/배포/삭제/초기화 |
| 6 | context dependency | 이전 대화 의존 | 아까/이전에, 대명사 참조 |

**산식 주체:** 위 감점식은 Codex 제안. 세부 가중치/임계값은 구현 단계에서 픽스처로 튜닝.

---

## 6. 모드 → 훅 액션

검증된 프로토콜: `hookSpecificOutput.additionalContext` = 주입, `exit 2` = 차단.

| 모드 | 동작 | 훅 출력 |
|---|---|---|
| `silent` | 점수/결손만 조용히 | `hookSpecificOutput.additionalContext`: 1줄 노트, 행동 지시 없음 |
| `inject` **(기본)** | 점수/결손 + 확인 지시 | `hookSpecificOutput.additionalContext`: 노트 + "실행 전 사용자에게 확인 질문하라" + `suggested_questions` |
| `advisory` | 사용자에게 리포트, 계속 | stderr 리포트 출력 후 `exit 0` |
| `strict` (opt-in) | 저점수+고위험만 차단 | `clarity < threshold && risk_level==high` → `exit 2`(사유 포함), 아니면 inject 폴백 |

**기본값을 inject로 둔 이유:** 실사용 가치 최대, strict보다 마찰 낮음, silent보다 효과가 보임.

---

## 7. 출력 (Report JSON)

```json
{
  "version": "0.1.0",
  "clarity_score": 38,
  "risk_level": "high",
  "verdict": "gate",
  "axes": {
    "goal_clarity": 30, "target_context": 20, "scope_boundedness": 40,
    "done_condition": 25, "risk_side_effect": 80, "context_dependency": 35
  },
  "missing": ["target file", "done condition", "scope boundary"],
  "trigger_reasons": ["vague verb '처리해'", "unresolved pronoun '이거'", "destructive verb '삭제'"],
  "suggested_questions": ["어떤 파일을 대상으로 할까요?"],
  "better_prompt_example": null
}
```

- `verdict`: `pass | inject | gate`
- `suggested_questions`: 룰 템플릿 기본, LLM opt-in 시 보강
- `better_prompt_example`: LLM opt-in일 때만 채움

---

## 8. 텔레메트리 (v0 = 적재만)

로컬 JSONL. 이벤트 6종:

```
prompt_scored
clarification_injected
clarification_asked
followup_prompt_seen
undo_or_revert_seen
strict_blocked
```

**프라이버시:** 원문 프롬프트 저장 **금지**. 해시/요약/점수/타임스탬프만 기록. 원격 전송 금지.

**목적:** v1에서 "낮은 점수가 실제 재작업/실패/되돌림과 상관 있나?"(타당성)를 분석할 데이터를 v0부터 축적. v0에서는 **분석 엔진/통계/UI를 만들지 않는다.**

---

## 9. 신뢰성 = 두 층

- **재현성(consistency):** 같은 입력 → 같은 점수. → 스냅샷 테스트(픽스처 ≥50개, KO+EN, good/bad, 기대 점수)로 보장. **v0 범위.**
- **타당성(validity):** 낮은 점수가 실제 재작업/실패/되돌림과 상관 있는가. → 텔레메트리 데이터로 측정. **v1 범위.**

스냅샷은 재현성을 증명할 뿐 타당성을 증명하지 않는다. 둘을 혼동하지 말 것.

---

## 10. 산출물 (파일 트리)

```
readback-gate/
  package.json
  README.md            # 포지셔닝 1줄 + 32→89점 before/after 예시(맨 위)
  src/
    core/
      types.ts         # Report JSON 스키마
      rules.ts         # KO+EN 키워드/정규식 테이블
      scorer.ts        # 6축 감점식, 결정적
      risk.ts          # risk_level 분류기
      modes.ts         # silent/inject/advisory/strict → 훅 액션
      telemetry.ts     # JSONL append, 6 이벤트, 해시 전용
      llm.ts           # opt-in: 설명/재작성/질문 보강
    adapters/
      codex.ts         # UserPromptSubmit: stdin JSON → core → additionalContext/exit2
      # claude.ts 는 v1 — 만들지 말 것. 단 어댑터 인터페이스 경계는 잡아둘 것
    cli.ts             # npx readback-gate: argv/stdin 프롬프트 채점 후 리포트 출력
  test/
    fixtures/          # good/bad 프롬프트 50~100개(KO+EN) + 기대 점수
    scorer.test.ts     # 스냅샷 테스트 = 재현성 보장
  install/             # Codex 훅 등록 안내/스크립트
  docs/
    spec-v0.md         # 본 문서
```

**구현 언어(권장):** Node + TypeScript (npx 배포 용이, JSON 네이티브, 훅 stdin 처리 쉬움). 강한 반대 이유 있으면 스캐폴드 전에 제기.

---

## 11. 완료 조건 (검증 가능 — 전부 충족해야 완료)

- [ ] `npx readback-gate "<프롬프트>"` → Report JSON + 사람용 요약 출력
- [ ] Codex UserPromptSubmit 훅 설치 가능; 모호 프롬프트→inject, 명확 프롬프트→pass 실제 확인
- [ ] strict + 저점수 + 고위험 → `exit 2` + 사유 출력
- [ ] 스냅샷 테스트 통과(재현성), 픽스처 ≥50개
- [ ] 텔레메트리 JSONL에 6개 이벤트 기록 + 원문 미저장 확인
- [ ] README 최상단에 포지셔닝 1줄 + before/after 예시

> "빌드 됨"만으로 완료 선언 금지. 실제 훅 동작과 테스트 통과를 보여야 함.

---

## 12. 비목표 (v0에서 만들지 않음 — 스코프 폭발 방지)

- validity 상관분석 엔진 / 통계 / 대시보드 → v1
- Claude 어댑터 → v1 (단 core/adapter 경계는 깨끗이)
- 채점 경로의 LLM / 네트워크 호출
- 원격 텔레메트리
- "AGI 심판자" 류 거창한 포지셔닝 (README 한 줄 농담까지만 허용)

---

## 부록 — 출처 (경쟁 분석 검증, 2026-06-18)

- tasklint.dev — https://www.tasklint.dev/
- AgentLinter (seojoonkim) — https://github.com/seojoonkim/agentlinter
- Codacy AgentLinter — https://blog.codacy.com/introducing-agentlinter-codacy-now-scans-your-ai-agent-config-files
- Claude Code Hooks — https://code.claude.com/docs/en/hooks
- Codex≈Claude hooks port — https://www.morphllm.com/claude-code-hooks
- promptfoo — https://github.com/promptfoo/promptfoo
