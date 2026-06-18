export interface PromptFixture {
  name: string;
  prompt: string;
  min: number;
  max: number;
  verdict: 'pass' | 'inject' | 'gate';
  risk: 'none' | 'low' | 'medium' | 'high';
}

export const fixtures: PromptFixture[] = [
  { name: 'ko clear test target', prompt: 'src/core/scorer.ts에서 risk_level 분류 테스트를 추가하고 npm test로 검증해줘', min: 85, max: 100, verdict: 'pass', risk: 'none' },
  { name: 'en clear file test', prompt: 'Add tests for classifyRisk in src/core/risk.ts and verify them with npm test.', min: 85, max: 100, verdict: 'pass', risk: 'none' },
  { name: 'ko clear read only', prompt: 'git status 확인하고 변경 파일 목록만 요약해줘', min: 85, max: 100, verdict: 'pass', risk: 'low' },
  { name: 'en clear read only', prompt: 'Run git status and summarize the changed files only.', min: 85, max: 100, verdict: 'pass', risk: 'low' },
  { name: 'ko clear docs', prompt: 'README.md 맨 위에 제품 한 줄 소개를 추가하고 npm test로 확인해줘', min: 85, max: 100, verdict: 'pass', risk: 'none' },
  { name: 'en clear docs', prompt: 'Update README.md with the one-line product pitch and run npm test.', min: 85, max: 100, verdict: 'pass', risk: 'none' },
  { name: 'ko clear explain', prompt: 'src/core/modes.ts의 decideVerdict 동작을 예시 3개로 설명해줘', min: 85, max: 100, verdict: 'pass', risk: 'low' },
  { name: 'en clear explain', prompt: 'Explain src/core/modes.ts decideVerdict with three examples.', min: 85, max: 100, verdict: 'pass', risk: 'low' },
  { name: 'ko clear bounded refactor', prompt: 'src/cli.ts의 인자 파싱만 리팩터링하고 기존 npm test가 통과하는지 확인해줘', min: 85, max: 100, verdict: 'pass', risk: 'none' },
  { name: 'en clear bounded refactor', prompt: 'Refactor only argument parsing in src/cli.ts and verify npm test still passes.', min: 85, max: 100, verdict: 'pass', risk: 'none' },

  { name: 'ko vague this', prompt: '이거 알아서 다 처리해줘', min: 0, max: 69, verdict: 'inject', risk: 'none' },
  { name: 'en vague it', prompt: 'Handle this and make it better.', min: 0, max: 69, verdict: 'inject', risk: 'none' },
  { name: 'ko vague previous', prompt: '아까 말한 그거 고쳐줘', min: 0, max: 69, verdict: 'inject', risk: 'none' },
  { name: 'en vague previous', prompt: 'Fix the previous thing from above.', min: 0, max: 69, verdict: 'inject', risk: 'none' },
  { name: 'ko no target', prompt: '테스트 추가하고 검증해줘', min: 0, max: 69, verdict: 'inject', risk: 'none' },
  { name: 'en no target', prompt: 'Add tests and verify them.', min: 0, max: 69, verdict: 'inject', risk: 'none' },
  { name: 'ko unbounded', prompt: '프로젝트 전체를 싹 다 정리해줘', min: 0, max: 69, verdict: 'inject', risk: 'none' },
  { name: 'en unbounded', prompt: 'Clean up the entire project and improve everything.', min: 0, max: 69, verdict: 'inject', risk: 'none' },
  { name: 'ko missing done', prompt: 'src/core/scorer.ts를 개선해줘', min: 50, max: 69, verdict: 'inject', risk: 'none' },
  { name: 'en missing done', prompt: 'Improve src/core/scorer.ts.', min: 50, max: 69, verdict: 'inject', risk: 'none' },

  { name: 'ko high delete vague', prompt: '이거 전부 삭제하고 초기화해줘', min: 0, max: 69, verdict: 'gate', risk: 'high' },
  { name: 'en high rm vague', prompt: 'Delete everything and reset hard.', min: 0, max: 69, verdict: 'gate', risk: 'high' },
  { name: 'ko high deploy unacked', prompt: '운영에 바로 배포해줘', min: 0, max: 69, verdict: 'gate', risk: 'high' },
  { name: 'en high deploy unacked', prompt: 'Deploy this to production now.', min: 0, max: 69, verdict: 'gate', risk: 'high' },
  { name: 'ko high acknowledged', prompt: 'README.md 변경만 확인하고, 배포는 하지 말고 필요하면 먼저 물어봐줘', min: 70, max: 100, verdict: 'pass', risk: 'high' },
  { name: 'en high acknowledged', prompt: 'Review README.md changes only; do not deploy or push, ask before any risky action.', min: 70, max: 100, verdict: 'pass', risk: 'high' },
  { name: 'ko medium push', prompt: '수정 끝나면 커밋하고 푸시해줘', min: 0, max: 69, verdict: 'inject', risk: 'medium' },
  { name: 'en medium install', prompt: 'Install the package and update the config.', min: 0, max: 79, verdict: 'inject', risk: 'medium' },
  { name: 'ko medium bounded', prompt: 'package.json의 scripts만 수정하고 npm test로 확인해줘', min: 70, max: 100, verdict: 'pass', risk: 'medium' },
  { name: 'en medium bounded', prompt: 'Edit only package.json scripts and verify with npm test.', min: 70, max: 100, verdict: 'pass', risk: 'medium' },

  { name: 'ko context only', prompt: '아까 그 방식대로 이어서 해줘', min: 0, max: 69, verdict: 'inject', risk: 'none' },
  { name: 'en context only', prompt: 'Continue with the same approach as before.', min: 0, max: 69, verdict: 'inject', risk: 'none' },
  { name: 'ko scope and context', prompt: '저번 거 포함해서 전체 다 고쳐줘', min: 0, max: 69, verdict: 'inject', risk: 'none' },
  { name: 'en scope and context', prompt: 'Fix all of that stuff from earlier.', min: 0, max: 69, verdict: 'inject', risk: 'none' },
  { name: 'ko output format', prompt: 'src/core/types.ts의 Report 타입에 mode 필드를 추가하고 JSON 출력 예시도 README에 반영해줘', min: 85, max: 100, verdict: 'pass', risk: 'none' },
  { name: 'en output format', prompt: 'Add a mode field to Report in src/core/types.ts and update the README JSON example.', min: 85, max: 100, verdict: 'pass', risk: 'none' },
  { name: 'ko test command done', prompt: 'src/adapters/codex.ts가 빈 입력을 안전하게 처리하는 테스트를 추가하고 npm test를 실행해줘', min: 85, max: 100, verdict: 'pass', risk: 'none' },
  { name: 'en test command done', prompt: 'Add a test for empty input handling in src/adapters/codex.ts and run npm test.', min: 85, max: 100, verdict: 'pass', risk: 'none' },
  { name: 'ko simple date', prompt: '현재 시간 알려줘', min: 85, max: 100, verdict: 'pass', risk: 'low' },
  { name: 'en simple date', prompt: 'date', min: 85, max: 100, verdict: 'pass', risk: 'low' },

  { name: 'ko ambiguous review', prompt: '이 부분 리뷰해줘', min: 0, max: 69, verdict: 'inject', risk: 'none' },
  { name: 'en ambiguous review', prompt: 'Review this part.', min: 0, max: 69, verdict: 'inject', risk: 'none' },
  { name: 'ko clear review target', prompt: 'src/core/rules.ts의 정규식 목록을 검토하고 false positive 위험만 요약해줘', min: 85, max: 100, verdict: 'pass', risk: 'low' },
  { name: 'en clear review target', prompt: 'Review regex lists in src/core/rules.ts and summarize false-positive risk only.', min: 85, max: 100, verdict: 'pass', risk: 'low' },
  { name: 'ko no done risky', prompt: 'src/cli.ts를 수정해줘', min: 50, max: 89, verdict: 'pass', risk: 'medium' },
  { name: 'en no done risky', prompt: 'Modify src/cli.ts.', min: 50, max: 69, verdict: 'inject', risk: 'medium' },
  { name: 'ko bounded no risk', prompt: 'test/fixtures/prompts.ts에 한국어 모호 프롬프트 케이스 3개를 추가해줘', min: 70, max: 100, verdict: 'pass', risk: 'none' },
  { name: 'en bounded no risk', prompt: 'Add three English ambiguous prompt cases to test/fixtures/prompts.ts.', min: 70, max: 100, verdict: 'pass', risk: 'none' },
  { name: 'ko strict safe boundary', prompt: '삭제가 필요하면 먼저 물어보고, 지금은 src/core만 읽어서 삭제 후보를 목록화해줘', min: 70, max: 100, verdict: 'pass', risk: 'high' },
  { name: 'en strict safe boundary', prompt: 'If deletion is needed, ask first; for now only read src/core and list deletion candidates.', min: 70, max: 100, verdict: 'pass', risk: 'high' },

  { name: 'ko install vague', prompt: '설치 좀 해줘', min: 0, max: 69, verdict: 'inject', risk: 'medium' },
  { name: 'en install vague', prompt: 'Install it.', min: 0, max: 69, verdict: 'inject', risk: 'medium' },
  { name: 'ko publish risky', prompt: 'npm publish 바로 해줘', min: 0, max: 69, verdict: 'gate', risk: 'high' },
  { name: 'en publish risky', prompt: 'Publish the package now.', min: 0, max: 69, verdict: 'gate', risk: 'high' },
  { name: 'ko local only', prompt: '원격 전송 없이 로컬에서만 test/fixtures를 읽고 누락된 케이스를 요약해줘', min: 85, max: 100, verdict: 'pass', risk: 'low' },
  { name: 'en local only', prompt: 'Without remote calls, read only local test/fixtures and summarize missing cases.', min: 85, max: 100, verdict: 'pass', risk: 'low' }
];
