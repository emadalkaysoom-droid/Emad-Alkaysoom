import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ONBOARDING_STEPS,
  calculateOnboardingCompletionPercent,
  createInitialOnboardingProgress,
  markOnboardingStepComplete,
} from '../shared/onboardingGuide';

test('onboarding steps cover core multimodal OMNIX systems and guided sample pipeline', () => {
  const systems = ONBOARDING_STEPS.map((s) => s.systemName);
  assert.ok(systems.includes('OMNI BRAIN'));
  assert.ok(systems.includes('OMNI VISION'));
  assert.ok(systems.includes('OMNI VOICE'));
  assert.ok(systems.includes('OMNI AGENT'));
  assert.ok(systems.some((s) => s.includes('OMNI VISION') && s.includes('OMNI DATA')));
});

test('onboarding progress tracking calculates completion percentage deterministically', () => {
  let state = createInitialOnboardingProgress();
  assert.equal(calculateOnboardingCompletionPercent(state), 0);

  state = markOnboardingStepComplete(state, 'brain');
  state = markOnboardingStepComplete(state, 'vision');
  assert.equal(calculateOnboardingCompletionPercent(state), 40);

  // Idempotent on repeat completion
  state = markOnboardingStepComplete(state, 'vision');
  assert.equal(calculateOnboardingCompletionPercent(state), 40);

  state = markOnboardingStepComplete(state, 'voice');
  state = markOnboardingStepComplete(state, 'agent');
  state = markOnboardingStepComplete(state, 'guided_task');
  assert.equal(calculateOnboardingCompletionPercent(state), 100);
});
