export interface RuleMatch {
  matched: boolean;
  reasons: string[];
}

export const vagueGoalPatterns = [
  /\b(handle|fix|improve|clean\s*up|do\s+it|make\s+it\s+better|sort\s+it\s+out)\b/i,
  /(처리해|알아서|다\s*해놔|해결해|고쳐줘|개선해|정리해|봐줘|해줘)\b/i
];

export const actionVerbPatterns = [
  /\b(add|build|create|write|implement|fix|remove|delete|rename|update|refactor|test|run|check|review|explain|summarize|install|deploy|push|commit|list|show|print|open|read|find|search)\b/i,
  /(추가|생성|작성|구현|수정|삭제|제거|이름\s*변경|업데이트|리팩터|리팩토|테스트|실행|확인|검토|설명|요약|설치|배포|푸시|커밋|목록|보여|출력|열어|읽어|찾아|검색)/i
];

export const concreteTargetPatterns = [
  /(?:^|\s)(?:\.{0,2}\/)?[\w.-]+\/[\w./-]+/i,
  /\b[\w.-]+\.(?:ts|tsx|js|jsx|json|md|toml|yaml|yml|rs|py|go|java|css|html|sh|mjs|cjs)\b/i,
  /\b[A-Z][A-Za-z0-9_]*[A-Z][A-Za-z0-9_]*\b/,
  /\b[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z0-9_]+\b/,
  /`[^`]+`/,
  /(파일|경로|함수|클래스|모듈|패키지|레포|프로젝트|README|AGENTS\.md|package\.json)/i
];

export const unresolvedReferencePatterns = [
  /\b(this|that|it|those|these|previous|earlier|above|same thing|stuff)\b/i,
  /(이거|그거|저거|아까|이전|지난번|(?<!맨\s)위에|방금|같은\s*거|그\s*부분|저\s*부분)/i
];

export const unboundedScopePatterns = [
  /\b(all|everything|entire|whole|everywhere|whatever|full cleanup|complete rewrite)\b/i,
  /(전부|전체|싹\s*다|몽땅|모든|아무거나|완전히|통째로|다\s*갈아엎)/i
];

export const doneConditionPatterns = [
  /\b(test|tests|lint|typecheck|build|verify|acceptance|done when|success|expected output|exit code|snapshot|e2e|smoke)\b/i,
  /(테스트|검증|확인|완료\s*조건|성공\s*기준|기대\s*출력|빌드|린트|스냅샷|스모크|통과)/i
];

export const riskAcknowledgementPatterns = [
  /\b(confirm|ask first|dry[-\s]?run|backup|safe|careful|review before|do not submit|do not push|do not deploy|no deploy|no remote|local only)\b/i,
  /(확인\s*받|물어보고|드라이런|백업|안전|주의|검토\s*후|제출하지\s*마|푸시하지\s*마|배포하지\s*마|로컬만|원격\s*금지)/i
];

export const highRiskPatterns = [
  /\b(rm\s+-rf|delete|deletion|destroy|drop|truncate|reset\s+--hard|force\s+push|deploy|release|publish|production|prod|migrate|chmod\s+-R|chown\s+-R)\b/i,
  /(삭제|초기화|폐기|드롭|강제\s*푸시|배포|릴리스|프로덕션|운영|마이그레이션|권한\s*변경)/i
];

export const mediumRiskPatterns = [
  /\b(push|commit|install|upgrade|write|edit|modify|replace|move|rename|restart|stop service|start service)\b/i,
  /(푸시|커밋|설치|업그레이드|작성|편집|수정|교체|이동|이름\s*변경|재시작|중지|시작)/i
];

export const lowRiskPatterns = [
  /\b(ls|pwd|date|status|show|read|cat|rg|grep|find|list|explain|summarize)\b/i,
  /(목록|상태|읽어|보여|설명|요약|찾아|검색|시간|날짜)/i
];

export const simpleReadOnlyPatterns = [
  /^\s*(ls|pwd|date|git\s+status|whoami|hostname)\b/i,
  /^\s*run\s+(git\s+status|ls|pwd|date)\b/i,
  /^\s*(현재\s*)?(시간|날짜|상태|목록)\s*(알려|보여|확인)?/i
];

export function matchesAny(prompt: string, patterns: RegExp[]): RuleMatch {
  const reasons = patterns
    .filter((pattern) => pattern.test(prompt))
    .map((pattern) => pattern.source);
  return { matched: reasons.length > 0, reasons };
}

export function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function hasConcreteTarget(prompt: string): boolean {
  return matchesAny(prompt, concreteTargetPatterns).matched;
}

export function hasActionVerb(prompt: string): boolean {
  return matchesAny(prompt, actionVerbPatterns).matched;
}

export function isSimpleReadOnly(prompt: string): boolean {
  return matchesAny(prompt, simpleReadOnlyPatterns).matched;
}
