import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorldBlueprint } from '../shared/procedural3d.ts';
import { interpretWorldInstruction } from '../shared/worldInterpreter.ts';

describe('Contextual World Interpreter', () => {
  const baseWorld = generateWorldBlueprint('digital twin campus');

  it('accepts valid gravity and scale contextual updates in English and returns parameter diffs', () => {
    const res = interpretWorldInstruction('Set moon gravity 1.62 and scale 1.5x', baseWorld);
    assert.equal(res.status, 'accepted');
    assert.equal(res.mode, 'contextual_update');
    assert.equal(res.shouldCallRemoteGenerator, false);
    assert.ok(res.updatedWorld);
    assert.equal(res.updatedWorld!.gravity, 1.62);
    assert.ok(res.appliedChanges.some((c) => c.parameter === 'gravity' && c.to === '1.62 m/s²'));
    assert.ok(res.appliedChanges.some((c) => c.parameter === 'worldScale'));
  });

  it('accepts valid Arabic contextual physics and hydrology updates', () => {
    const res = interpretWorldInstruction('اجعل جاذبية المريخ مع رفع الماء ليلاً', baseWorld);
    assert.equal(res.status, 'accepted');
    assert.equal(res.mode, 'contextual_update');
    assert.ok(res.updatedWorld);
    assert.equal(res.updatedWorld!.gravity, 3.72);
    assert.equal(res.updatedWorld!.timeOfDay, 'night');
    assert.ok(res.updatedWorld!.waterLevel > baseWorld.waterLevel);
  });

  it('rejects out-of-bounds gravity, zero gravity, extreme scale, empty input, and gibberish', () => {
    const negG = interpretWorldInstruction('set gravity -5', baseWorld);
    assert.equal(negG.status, 'rejected');
    assert.equal(negG.mode, 'rejected');
    assert.match(negG.headline, /Gravity Out of Bounds/i);

    const zeroG = interpretWorldInstruction('zero gravity please', baseWorld);
    assert.equal(zeroG.status, 'rejected');
    assert.match(zeroG.headline, /Zero Gravity Unsupported/i);

    const hugeScale = interpretWorldInstruction('scale 25x', baseWorld);
    assert.equal(hugeScale.status, 'rejected');
    assert.match(hugeScale.headline, /Scale Factor Out of Range/i);

    const empty = interpretWorldInstruction('   ', baseWorld);
    assert.equal(empty.status, 'rejected');

    const symbolsOnly = interpretWorldInstruction('12345 !!!', baseWorld);
    assert.equal(symbolsOnly.status, 'rejected');

    const singleNoise = interpretWorldInstruction('asdfgh', baseWorld);
    assert.equal(singleNoise.status, 'rejected');
  });

  it('routes descriptive world prompts to full_generation with accepted feedback', () => {
    const res = interpretWorldInstruction('Coastal island harbor at dusk with bridges', baseWorld);
    assert.equal(res.status, 'accepted');
    assert.equal(res.mode, 'full_generation');
    assert.equal(res.shouldCallRemoteGenerator, true);
    assert.ok(res.appliedChanges.some((c) => c.parameter === 'biome' && c.to === 'coastal_port'));
  });
});
