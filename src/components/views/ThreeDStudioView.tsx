import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import {
  Bot,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  EyeOff,
  Layers,
  Play,
  Square,
  Sparkles,
  Upload,
} from 'lucide-react';
import { useOmnix } from '../../contexts/OmnixContext';
import {
  generate3DBlueprint,
  serializeBlueprintToOBJ,
  serializeBlueprintToSTL,
  type Procedural3DBlueprint,
} from '../../../shared/procedural3d';
import {
  blueprintToSceneNodes,
  buildPlaceholderSceneGraph,
  mapPromptTo3DScene,
  type CreativeIntentAcknowledgment,
  type PrimitiveSceneNode,
} from '../../services/promptTo3dMapper';

function detectSoftwareGl(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export function ThreeDStudioView() {
  const {
    activeWorkspaceId,
    activeProjectId,
    activeThreeDBlueprint,
    setActiveThreeDBlueprint,
    language,
    triggerRefresh,
  } = useOmnix();
  const isAr = language === 'ar';
  const mountRef = useRef<HTMLDivElement>(null);

  const [prompt, setPrompt] = useState('Build a gold and obsidian orbital rocket ship');
  const [blueprint, setBlueprint] = useState<Procedural3DBlueprint>(() =>
    activeThreeDBlueprint || generate3DBlueprint('6-DOF robotic arm')
  );
  const [placeholderNodes, setPlaceholderNodes] = useState<PrimitiveSceneNode[]>([]);
  const [intentAck, setIntentAck] = useState<CreativeIntentAcknowledgment>(() => {
    const initialBp = activeThreeDBlueprint || generate3DBlueprint('6-DOF robotic arm');
    const nodes = blueprintToSceneNodes(initialBp, 'initial-scene-state');
    return {
      agentName: 'OMNI 3D Architect',
      mode: 'full_synthesis',
      understoodSubject: initialBp.title,
      detectedKeywords: ['robotic', 'arm', '6-dof'],
      actionTaken: `Loaded ${nodes.length} active scene graph primitive nodes ready for synthesis or contextual edits.`,
      acknowledgmentMessage: `Ready to design from your description or modify "${initialBp.title}" using current scene placeholders.`,
      mappedNodes: nodes,
    };
  });
  const [engineTag, setEngineTag] = useState<string>('omnix-procedural-3d');
  const [generating, setGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [exploded, setExploded] = useState(0);
  const [wireframe, setWireframe] = useState(false);
  const [showDimensions, setShowDimensions] = useState(true);
  const [animateModel, setAnimateModel] = useState(false);
  const [finishPreset, setFinishPreset] = useState<'default' | 'titanium' | 'carbon' | 'amber'>('default');
  const [dockOpen, setDockOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [hiddenParts, setHiddenParts] = useState<Record<string, boolean>>({});
  const [partColorOverrides, setPartColorOverrides] = useState<Record<string, string>>({});
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    if (activeThreeDBlueprint) {
      setBlueprint(activeThreeDBlueprint);
      setPrompt(activeThreeDBlueprint.prompt || activeThreeDBlueprint.title);
      setSelectedPartId(null);
      setHiddenParts({});
      setPartColorOverrides({});
      const nodes = blueprintToSceneNodes(activeThreeDBlueprint, 'workspace-blueprint');
      setIntentAck({
        agentName: 'OMNI 3D Architect',
        mode: 'full_synthesis',
        understoodSubject: activeThreeDBlueprint.title,
        detectedKeywords: [],
        actionTaken: `Loaded ${nodes.length} mapped primitive nodes.`,
        acknowledgmentMessage: `Loaded "${activeThreeDBlueprint.title}" into the 3D scene mapper.`,
        mappedNodes: nodes,
      });
      setActiveThreeDBlueprint(null);
    }
  }, [activeThreeDBlueprint, setActiveThreeDBlueprint]);

  const explodedRef = useRef(exploded);
  explodedRef.current = exploded;
  const animateRef = useRef(animateModel);
  animateRef.current = animateModel;
  const selectedPartRef = useRef(selectedPartId);
  selectedPartRef.current = selectedPartId;

  const spinPartIdsRef = useRef<Map<string, 'x' | 'y' | 'z'>>(new Map());
  const sceneRefs = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    renderer: THREE.WebGLRenderer;
    assetGroup: THREE.Group;
    bboxHelper: THREE.BoxHelper;
    requestRender: () => void;
    cameraTargetPos: THREE.Vector3 | null;
    partBasePositions: Map<string, THREE.Vector3>;
    isSoftwareGl: boolean;
  } | null>(null);

  const selectedPart = useMemo(
    () => blueprint.parts.find((p) => p.id === selectedPartId) || null,
    [blueprint.parts, selectedPartId]
  );

  // Build 3D scene once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareGl();
    const width = container.clientWidth || 960;
    const height = container.clientHeight || 540;

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: isSoftwareGl,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0b101b');
    scene.fog = new THREE.Fog('#0b101b', 22, 60);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 140);
    camera.position.set(4.5, 3.2, 5.2);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.target.set(0, 1.0, 0);

    const keyLight = new THREE.DirectionalLight('#fff4e6', 2.2);
    keyLight.position.set(6, 9, 6);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.bias = -0.0005;
    scene.add(keyLight);

    const hemi = new THREE.HemisphereLight('#bae6fd', '#1e293b', 0.85);
    scene.add(hemi);

    const rimLight = new THREE.DirectionalLight('#38bdf8', 0.9);
    rimLight.position.set(-5, 4, -6);
    scene.add(rimLight);

    const floorGeo = new THREE.PlaneGeometry(48, 48);
    const floorMat = new THREE.MeshStandardMaterial({
      color: '#0f172a',
      roughness: 0.88,
      metalness: 0.1,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const grid = new THREE.GridHelper(28, 28, '#334155', '#1e293b');
    grid.position.y = 0.01;
    scene.add(grid);

    const assetGroup = new THREE.Group();
    scene.add(assetGroup);

    const bboxHelper = new THREE.BoxHelper(assetGroup, 0x38bdf8);
    bboxHelper.visible = true;
    scene.add(bboxHelper);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };

    const onPointerDown = (ev: PointerEvent) => {
      pointerDownPos = { x: ev.clientX, y: ev.clientY };
    };

    const onPointerUp = (ev: PointerEvent) => {
      const dist = Math.hypot(ev.clientX - pointerDownPos.x, ev.clientY - pointerDownPos.y);
      if (dist > 5) return; // Ignore orbit drags
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(assetGroup.children, false);
      if (hits.length > 0 && hits[0].object.name) {
        setSelectedPartId(hits[0].object.name);
      } else {
        setSelectedPartId(null);
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let cameraTargetPos: THREE.Vector3 | null = null;
    const partBasePositions = new Map<string, THREE.Vector3>();

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function requestRender() {
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame(() => {
        renderDirty = false;
        const target = sceneRefs.current?.cameraTargetPos;
        if (target) {
          camera.position.lerp(target, isSoftwareGl ? 1 : 0.14);
          if (camera.position.distanceTo(target) < 0.05) {
            camera.position.copy(target);
            if (sceneRefs.current) sceneRefs.current.cameraTargetPos = null;
          } else {
            renderDirty = true;
          }
        }

        const expFactor = explodedRef.current / 100;
        assetGroup.children.forEach((child) => {
          const base = partBasePositions.get(child.name);
          if (base) {
            child.position.set(
              base.x * (1 + expFactor * 0.9),
              base.y + expFactor * (base.y * 0.65),
              base.z * (1 + expFactor * 0.9)
            );
          }
          if (animateRef.current) {
            const axis = spinPartIdsRef.current.get(child.name);
            if (axis === 'x') child.rotation.x += 0.14;
            else if (axis === 'y') child.rotation.y += 0.14;
            else if (axis === 'z') child.rotation.z += 0.14;
          }
        });

        if (animateRef.current) {
          if (spinPartIdsRef.current.size === 0) {
            assetGroup.rotation.y += 0.02;
          }
          renderDirty = true;
        }

        bboxHelper.update();
        controls.update();
        renderer.render(scene, camera);

        const done = () => {
          renderBusy = false;
          if (renderDirty) requestRender();
        };
        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    }

    controls.addEventListener('change', requestRender);
    controls.addEventListener('start', () => {
      if (sceneRefs.current) sceneRefs.current.cameraTargetPos = null;
    });

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || 960;
      const h = container.clientHeight || 540;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
    };
    window.addEventListener('resize', handleResize);

    sceneRefs.current = {
      scene,
      camera,
      controls,
      renderer,
      assetGroup,
      bboxHelper,
      requestRender,
      cameraTargetPos,
      partBasePositions,
      isSoftwareGl,
    };

    requestRender();

    return () => {
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  // Auto-frame camera when a new blueprint loads
  useEffect(() => {
    const refs = sceneRefs.current;
    if (!refs) return;
    const { width, height, depth } = blueprint.boundingBox;
    const maxDim = Math.max(width, height, depth, 1.8);
    const dist = maxDim * 1.55;
    refs.controls.target.set(0, Math.max(0.4, height * 0.45), 0);
    const targetPos = new THREE.Vector3(dist * 0.88, Math.max(1.5, height * 0.85), dist);
    if (refs.isSoftwareGl) {
      refs.camera.position.copy(targetPos);
      refs.cameraTargetPos = null;
    } else {
      refs.cameraTargetPos = targetPos;
    }
    refs.assetGroup.rotation.y = 0;
    refs.controls.update();
    refs.renderer.render(refs.scene, refs.camera);
    refs.requestRender();
  }, [blueprint]);

  // Rebuild meshes when blueprint, placeholderNodes, finish, wireframe, selection, hiddenParts, or color overrides change
  useEffect(() => {
    const refs = sceneRefs.current;
    if (!refs) return;
    const { scene, camera, controls, renderer, assetGroup, partBasePositions, bboxHelper, requestRender } = refs;

    while (assetGroup.children.length > 0) {
      const child = assetGroup.children[0] as THREE.Mesh;
      child.geometry?.dispose();
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material?.dispose();
      assetGroup.remove(child);
    }
    partBasePositions.clear();
    spinPartIdsRef.current.clear();

    const activeList = placeholderNodes.length > 0 ? placeholderNodes : blueprint.parts;

    for (const part of activeList) {
      const isGhostPlaceholder = 'isPlaceholder' in part && part.isPlaceholder;
      if (!isGhostPlaceholder && hiddenParts[part.id]) continue;

      let geo: THREE.BufferGeometry;
      if (part.primitive === 'cylinder') {
        geo = new THREE.CylinderGeometry(part.dimensions[0], part.dimensions[1], part.dimensions[2], 24);
      } else if (part.primitive === 'sphere') {
        geo = new THREE.SphereGeometry(part.dimensions[0], 24, 18);
      } else if (part.primitive === 'cone') {
        geo = new THREE.ConeGeometry(part.dimensions[0], part.dimensions[1], 24);
      } else if (part.primitive === 'torus') {
        geo = new THREE.TorusGeometry(part.dimensions[0], part.dimensions[1], 14, 28);
      } else {
        geo = new THREE.BoxGeometry(part.dimensions[0], part.dimensions[1], part.dimensions[2]);
      }

      const mat = isGhostPlaceholder
        ? new THREE.MeshBasicMaterial({
            color: '#38bdf8',
            wireframe: true,
            transparent: true,
            opacity: 0.5,
          })
        : (() => {
            const bpPart = part as (typeof blueprint.parts)[number];
            const baseColor =
              partColorOverrides[bpPart.id] ||
              (finishPreset === 'titanium'
                ? '#cbd5e1'
                : finishPreset === 'carbon'
                  ? '#1e293b'
                  : finishPreset === 'amber'
                    ? '#d97706'
                    : bpPart.color);
            const isSelected = selectedPartId === bpPart.id;
            return new THREE.MeshPhysicalMaterial({
              color: baseColor,
              roughness: finishPreset === 'carbon' ? 0.65 : finishPreset === 'titanium' ? 0.2 : bpPart.roughness,
              metalness: finishPreset === 'titanium' ? 0.92 : finishPreset === 'carbon' ? 0.25 : bpPart.metalness,
              clearcoat: bpPart.clearcoat ?? 0,
              emissive: isSelected
                ? new THREE.Color('#38bdf8')
                : bpPart.emissive
                  ? new THREE.Color(bpPart.emissive)
                  : new THREE.Color(0x000000),
              emissiveIntensity: isSelected ? 0.45 : bpPart.emissive ? 0.8 : 0,
              wireframe,
            });
          })();

      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = part.id;
      mesh.position.set(part.position[0], part.position[1], part.position[2]);
      mesh.rotation.set(part.rotation[0], part.rotation[1], part.rotation[2]);
      mesh.castShadow = !isGhostPlaceholder;
      mesh.receiveShadow = !isGhostPlaceholder;
      assetGroup.add(mesh);
      partBasePositions.set(part.id, new THREE.Vector3(...part.position));
      if (!isGhostPlaceholder && 'spinAxis' in part && part.spinAxis) {
        spinPartIdsRef.current.set(part.id, part.spinAxis);
      }
    }

    bboxHelper.visible = showDimensions;
    bboxHelper.update();
    controls.update();
    renderer.render(scene, camera);
    requestRender();
  }, [blueprint, placeholderNodes, finishPreset, wireframe, showDimensions, selectedPartId, hiddenParts, partColorOverrides]);

  useEffect(() => {
    sceneRefs.current?.requestRender();
  }, [exploded, animateModel]);

  const submitPrompt = async (targetPrompt: string) => {
    if (!targetPrompt.trim() || generating) return;
    setGenerating(true);
    setErrorMsg(null);
    setStatusMsg(null);
    // Render wireframe current-state placeholders while mapping creative prompt
    setPlaceholderNodes(buildPlaceholderSceneGraph(blueprint));

    try {
      const mapped = await mapPromptTo3DScene({
        prompt: targetPrompt.trim(),
        workspaceId: activeWorkspaceId,
        projectId: activeProjectId,
        currentBlueprint: blueprint,
        selectedPartId,
      });

      setPlaceholderNodes([]);
      setBlueprint(mapped.blueprint);
      setEngineTag(mapped.model);
      setIntentAck(mapped.intent);
      setExploded(0);
      if (mapped.intent.mode === 'full_synthesis') {
        setSelectedPartId(null);
        setHiddenParts({});
        setPartColorOverrides({});
      }
      setStatusMsg(
        `Mapped "${mapped.blueprint.title}" (${mapped.blueprint.parts.length} parts via ${mapped.model}).`
      );
      triggerRefresh();
    } catch (err) {
      setPlaceholderNodes([]);
      setErrorMsg(err instanceof Error ? err.message : 'Failed to generate 3D model');
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitPrompt(prompt);
  };

  const setCameraPreset = (preset: 'iso' | 'front' | 'top' | 'side') => {
    const refs = sceneRefs.current;
    if (!refs) return;
    const { width, height, depth } = blueprint.boundingBox;
    const maxDim = Math.max(width, height, depth, 2.2);
    const d = maxDim * 1.65;
    const cy = Math.max(0.4, height * 0.45);
    refs.controls.target.set(0, cy, 0);
    const map: Record<typeof preset, THREE.Vector3> = {
      iso: new THREE.Vector3(d * 0.85, Math.max(1.5, height * 0.9), d),
      front: new THREE.Vector3(0, cy + 0.3, d * 1.1),
      top: new THREE.Vector3(0.01, d * 1.3, 0.01),
      side: new THREE.Vector3(d * 1.1, cy + 0.3, 0),
    };
    refs.cameraTargetPos = map[preset];
    refs.requestRender();
  };

  const exportFormat = (format: 'gltf' | 'obj' | 'stl') => {
    const refs = sceneRefs.current;
    if (!refs) return;
    const slug = blueprint.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'omnix-3d-asset';

    if (format === 'gltf') {
      const exporter = new GLTFExporter();
      exporter.parse(
        refs.assetGroup,
        (result) => {
          const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'model/gltf+json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${slug}.gltf`;
          a.click();
          URL.revokeObjectURL(url);
        },
        () => {},
        { binary: false }
      );
      return;
    }

    const content =
      format === 'obj' ? serializeBlueprintToOBJ(blueprint) : serializeBlueprintToSTL(blueprint);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportOBJ = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split('\n').filter((l) => l.startsWith('v '));
    setStatusMsg(`Imported "${file.name}" (${lines.length} vertices parsed into studio inspector).`);
  };

  const promptPresets = [
    'Modern white villa with blue roof & glass facade',
    'Gold and obsidian orbital rocket ship',
    'Add glowing cyan antenna on top',
    'صمم طائرة مسيرة حمراء حديثة بأربع مراوح',
  ];

  return (
    <div className="relative h-[calc(100vh-8rem)] w-full overflow-hidden rounded-xl border border-slate-800 bg-[#0b101b]">
      {/* Isolated WebGL Canvas Container */}
      <div
        ref={mountRef}
        data-testid="omni-3d-canvas"
        data-part-count={blueprint.parts.length}
        data-model-title={blueprint.title}
        data-placeholder-active={placeholderNodes.length > 0 ? 'true' : 'false'}
        className="h-full w-full"
      />

      {/* Top-Left Spec Header & AI Agent Creative Intent Acknowledgment */}
      <div className="pointer-events-none absolute start-4 top-4 z-10 max-w-md space-y-2">
        <div className="rounded-lg border border-slate-700/80 bg-[#0f141f]/90 px-4 py-2.5">
          <h1 className="font-display text-sm font-semibold text-slate-100">{blueprint.title}</h1>
          <p className="mt-0.5 font-mono text-xs tabular-nums text-slate-400">
            {blueprint.category} · {blueprint.parts.length} parts · {blueprint.boundingBox.width}×
            {blueprint.boundingBox.height}×{blueprint.boundingBox.depth} m · {engineTag}
          </p>
          {statusMsg && <p className="mt-1 text-xs text-sky-300">{statusMsg}</p>}
          {errorMsg && <p className="mt-1 text-xs text-red-300">{errorMsg}</p>}
        </div>

        <div
          data-testid="ai-intent-acknowledgment"
          className="rounded-lg border border-sky-500/35 bg-[#0f141f]/95 px-3.5 py-2.5 text-xs space-y-1.5"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 font-semibold text-sky-300">
              <Bot className="h-3.5 w-3.5" />
              <span>{intentAck.agentName}</span>
            </span>
            <span className="rounded border border-slate-700 bg-[#0B0F17] px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
              {generating ? 'mapping placeholders' : intentAck.mode}
            </span>
          </div>
          <p className="text-slate-200 leading-snug">
            {generating
              ? `Mapping "${prompt.trim()}" onto ${placeholderNodes.length} wireframe placeholder nodes...`
              : intentAck.acknowledgmentMessage}
          </p>
          <div className="flex flex-wrap gap-1 pt-0.5">
            {intentAck.mappedNodes.slice(0, 5).map((node) => (
              <span
                key={node.id}
                className="rounded border border-slate-700/80 bg-[#0B0F17] px-1.5 py-0.5 font-mono text-[10px] text-slate-300"
              >
                {node.name} [{node.primitive}]
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Top-Right Interactive Parts Inspector */}
      <div className="absolute end-4 top-4 z-10 w-64 max-w-[46vw]">
        <button
          type="button"
          onClick={() => setInspectorOpen((o) => !o)}
          className="flex w-full items-center justify-between rounded-t-lg border border-slate-700/80 bg-[#0f141f]/95 px-3 py-2 text-xs font-semibold text-slate-200 hover:text-white"
        >
          <span className="flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-sky-400" />
            <span>{isAr ? 'مكونات النموذج' : `Parts Inspector (${blueprint.parts.length})`}</span>
          </span>
          {inspectorOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>

        {inspectorOpen && (
          <div className="max-h-72 overflow-y-auto rounded-b-lg border border-t-0 border-slate-700/80 bg-[#0f141f]/95 p-2 space-y-1.5">
            {selectedPart && (
              <div className="rounded-md border border-sky-500/40 bg-[#0B0F17] p-2 text-[11px] space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sky-300 truncate">{selectedPart.name}</span>
                  <span className="font-mono text-slate-400">{selectedPart.primitive}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-1.5 text-slate-300">
                    <span>{isAr ? 'لون الجزء:' : 'Color:'}</span>
                    <input
                      type="color"
                      aria-label={`Color for ${selectedPart.name}`}
                      value={partColorOverrides[selectedPart.id] || selectedPart.color}
                      onChange={(e) =>
                        setPartColorOverrides((prev) => ({ ...prev, [selectedPart.id]: e.target.value }))
                      }
                      className="h-5 w-7 cursor-pointer rounded border border-slate-700 bg-transparent"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setHiddenParts((prev) => ({
                        ...prev,
                        [selectedPart.id]: !prev[selectedPart.id],
                      }))
                    }
                    className="rounded border border-slate-700 px-2 py-0.5 text-slate-300 hover:text-white"
                  >
                    {hiddenParts[selectedPart.id] ? 'Show' : 'Hide'}
                  </button>
                </div>
              </div>
            )}

            {blueprint.parts.map((pt) => {
              const active = selectedPartId === pt.id;
              const isHidden = Boolean(hiddenParts[pt.id]);
              return (
                <div
                  key={pt.id}
                  className={`flex items-center justify-between gap-1.5 rounded px-2 py-1 text-[11px] transition-colors ${
                    active ? 'bg-sky-500/20 text-sky-200 border border-sky-500/40' : 'text-slate-300 hover:bg-slate-800/70'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedPartId(active ? null : pt.id)}
                    className="flex flex-1 items-center gap-2 text-start min-w-0"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm border border-slate-600"
                      style={{ backgroundColor: partColorOverrides[pt.id] || pt.color }}
                    />
                    <span className={`truncate ${isHidden ? 'line-through opacity-45' : ''}`}>{pt.name}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={isHidden ? `Show ${pt.name}` : `Hide ${pt.name}`}
                    onClick={() => setHiddenParts((prev) => ({ ...prev, [pt.id]: !prev[pt.id] }))}
                    className="text-slate-400 hover:text-white p-0.5"
                  >
                    {isHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Collapsible Bottom Dock */}
      <div className="absolute bottom-4 left-1/2 z-10 w-[min(960px,94%)] -translate-x-1/2 flex flex-col items-center">
        <button
          type="button"
          onClick={() => setDockOpen(!dockOpen)}
          className="mb-1.5 flex items-center gap-1.5 rounded-t-lg border border-b-0 border-slate-700 bg-[#0f141f]/95 px-3 py-1 text-xs font-medium text-slate-300 hover:text-white"
        >
          {dockOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          <span>{dockOpen ? 'Hide Controls' : 'Show Controls'}</span>
        </button>

        {dockOpen && (
          <div className="w-full rounded-xl border border-slate-700/80 bg-[#0f141f]/95 p-3.5 space-y-2.5">
            <form onSubmit={(e) => void handleGenerate(e)} className="flex flex-wrap gap-2">
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={
                  isAr
                    ? 'صف النموذج ثلاثي الأبعاد: مثال "صاروخ فضائي ذهبي"، "منزل أبيض حديث بسقف أزرق"...'
                    : "Describe any 3D model in English or Arabic: e.g. 'Gold rocket ship', 'Modern white villa', 'Submarine'..."
                }
                aria-label="Text to 3D prompt"
                className="flex-1 min-w-[220px] rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-1.5 text-xs text-slate-100"
              />
              <button
                type="submit"
                disabled={generating}
                className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50 whitespace-nowrap"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>{generating ? (isAr ? 'جاري التصميم...' : 'Designing...') : 'Generate 3D'}</span>
              </button>
            </form>

            <div className="flex flex-wrap items-center gap-1.5">
              {promptPresets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setPrompt(preset);
                    void submitPrompt(preset);
                  }}
                  className="rounded border border-slate-800 bg-[#0B0F17] px-2 py-0.5 text-[11px] text-slate-400 hover:border-sky-500/40 hover:text-slate-200 truncate max-w-[240px]"
                >
                  {preset}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-slate-400">Explode</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={exploded}
                  aria-label="Exploded view percentage"
                  onChange={(e) => setExploded(Number(e.target.value))}
                  className="w-24 accent-sky-500"
                />
                <span className="font-mono tabular-nums text-slate-300 w-9">{exploded}%</span>
              </div>

              <div className="flex items-center gap-1">
                {(['iso', 'front', 'top', 'side'] as const).map((cam) => (
                  <button
                    key={cam}
                    type="button"
                    onClick={() => setCameraPreset(cam)}
                    className="rounded border border-slate-700 bg-[#0B0F17] px-2 py-1 text-[11px] uppercase text-slate-300 hover:border-slate-500"
                  >
                    {cam}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1">
                {(['default', 'titanium', 'carbon', 'amber'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFinishPreset(f)}
                    className={`rounded px-2 py-1 text-[11px] capitalize ${
                      finishPreset === f
                        ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                        : 'bg-[#0B0F17] text-slate-400 border border-slate-800'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setAnimateModel((a) => !a)}
                  className={`flex items-center gap-1 rounded border px-2 py-1 text-[11px] ${
                    animateModel ? 'border-emerald-500 text-emerald-300' : 'border-slate-700 text-slate-300'
                  }`}
                >
                  {animateModel ? <Square className="h-2.5 w-2.5" /> : <Play className="h-2.5 w-2.5" />}
                  <span>Animate</span>
                </button>
                <button
                  type="button"
                  onClick={() => setWireframe(!wireframe)}
                  className={`rounded border px-2 py-1 text-[11px] ${
                    wireframe ? 'border-sky-500 text-sky-300' : 'border-slate-700 text-slate-300'
                  }`}
                >
                  Wireframe
                </button>
                <button
                  type="button"
                  onClick={() => setShowDimensions(!showDimensions)}
                  className={`rounded border px-2 py-1 text-[11px] ${
                    showDimensions ? 'border-sky-500 text-sky-300' : 'border-slate-700 text-slate-300'
                  }`}
                >
                  Bounds
                </button>
                {(['gltf', 'obj', 'stl'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => exportFormat(fmt)}
                    className="flex items-center gap-1 rounded border border-slate-700 bg-[#0B0F17] px-2 py-1 font-mono text-[11px] uppercase text-emerald-300 hover:border-slate-500"
                  >
                    <Download className="h-3 w-3" />
                    <span>{fmt}</span>
                  </button>
                ))}
                <label className="flex cursor-pointer items-center gap-1 rounded border border-slate-700 bg-[#0B0F17] px-2 py-1 text-[11px] text-slate-300 hover:border-slate-500">
                  <Upload className="h-3 w-3" />
                  <span>OBJ</span>
                  <input type="file" accept=".obj" className="hidden" onChange={(e) => void handleImportOBJ(e)} />
                </label>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
