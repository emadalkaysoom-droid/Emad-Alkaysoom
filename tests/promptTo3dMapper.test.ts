import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generate3DBlueprint } from '../shared/procedural3d.ts';
import {
  buildPlaceholderSceneGraph,
  tryContextualPromptEdit,
} from '../src/services/promptTo3dMapper.ts';

describe('Prompt-to-3D Object Mapping Service', () => {
  const baseBlueprint = generate3DBlueprint('6-DOF robotic arm');

  it('builds wireframe placeholder scene nodes from current blueprint state', () => {
    const placeholders = buildPlaceholderSceneGraph(baseBlueprint);
    assert.equal(placeholders.length, baseBlueprint.parts.length);
    assert.ok(placeholders.every((node) => node.isPlaceholder === true));
    assert.ok(placeholders.every((node) => node.mappedFromKeyword === 'current-state-placeholder'));
  });

  it('translates contextual antenna prompt into identifiable primitive scene nodes and creative intent acknowledgment', () => {
    const res = tryContextualPromptEdit('Add glowing cyan antenna on top', baseBlueprint, null);
    assert.ok(res);
    assert.equal(res!.intent.mode, 'contextual_edit');
    assert.equal(res!.intent.agentName, 'OMNI 3D Architect');
    assert.match(res!.intent.acknowledgmentMessage, /antenna|beacon/i);
    assert.equal(res!.blueprint.parts.length, baseBlueprint.parts.length + 2);
    assert.ok(res!.sceneNodes.some((n) => n.primitive === 'cylinder'));
    assert.ok(res!.sceneNodes.some((n) => n.primitive === 'sphere'));
  });

  it('translates orbital ring and selected-part recolor directives using current placeholders', () => {
    const ringEdit = tryContextualPromptEdit('Add orbital ring around model', baseBlueprint, null);
    assert.ok(ringEdit);
    assert.ok(ringEdit!.sceneNodes.some((n) => n.primitive === 'torus'));

    const targetId = baseBlueprint.parts[0].id;
    const recolorEdit = tryContextualPromptEdit('Make selected part red', baseBlueprint, targetId);
    assert.ok(recolorEdit);
    const updatedPart = recolorEdit!.blueprint.parts.find((p) => p.id === targetId);
    assert.equal(updatedPart?.color, '#dc2626');
    assert.match(recolorEdit!.intent.acknowledgmentMessage, /#dc2626/i);
  });

  it('returns null for brand-new creative subjects so remote/full synthesis handles them', () => {
    const res = tryContextualPromptEdit('Gold and obsidian orbital rocket ship', baseBlueprint, null);
    assert.equal(res, null);
  });
});
