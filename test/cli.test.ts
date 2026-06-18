import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePrompt } from '../src/cli.ts';

test('resolvePrompt returns argv prompt without reading stdin', () => {
  const prompt = resolvePrompt(['이거', '알아서', '다', '처리해줘'], () => {
    throw new Error('stdin should not be read when argv prompt exists');
  }, false);

  assert.equal(prompt, '이거 알아서 다 처리해줘');
});

test('resolvePrompt reads stdin only when argv prompt is empty and stdin is not TTY', () => {
  const prompt = resolvePrompt([], () => '  src/core/scorer.ts 테스트 추가하고 npm test로 검증  \n', false);

  assert.equal(prompt, 'src/core/scorer.ts 테스트 추가하고 npm test로 검증');
});

test('resolvePrompt returns empty string when argv is empty and stdin is TTY', () => {
  const prompt = resolvePrompt([], () => {
    throw new Error('stdin should not be read for TTY input');
  }, true);

  assert.equal(prompt, '');
});

test('resolvePrompt ignores stdin failures when argv prompt exists', () => {
  const prompt = resolvePrompt(['src/core/scorer.ts', '테스트'], () => {
    throw new Error('EAGAIN');
  }, false);

  assert.equal(prompt, 'src/core/scorer.ts 테스트');
});

test('resolvePrompt returns empty string when stdin read fails without argv prompt', () => {
  const prompt = resolvePrompt([], () => {
    throw new Error('EAGAIN');
  }, false);

  assert.equal(prompt, '');
});
