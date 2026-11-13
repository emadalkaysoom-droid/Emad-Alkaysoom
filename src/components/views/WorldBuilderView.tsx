import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Compass, Globe, Navigation } from 'lucide-react';
import { useOmnix } from '../../contexts/OmnixContext';
import { generateWorldBlueprint, type ProceduralWorldBlueprint } from '../../../shared/procedural3d';
import { interpretWorldInstruction, type WorldParameterDiff } from '../../../shared/worldInterpreter';

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

interface InterpreterFeedback {
  status: 'accepted' | 'rejected';
  headline: string;
  reason: string;
  diffs: WorldParameterDiff[];
}

export function WorldBuilderView() {
  const {
    activeWorkspaceId,
    activeProjectId,
    activeWorldBlueprint,
    setActiveWorldBlueprint,
    language,
    triggerRefresh,
  } = useOmnix();
  const isAr = language === 'ar';
  const mountRef = useRef<HTMLDivElement>(null);

  const [prompt, setPrompt] = useState('Coastal island harbor at dusk with bridges and autonomous boats');
  const [world, setWorld] = useState<ProceduralWorldBlueprint>(() =>
    activeWorldBlueprint || generateWorldBlueprint('digital twin campus')
  );
  const [engineTag, setEngineTag] = useState<string>('omnix-procedural-world');
  const [generating, setGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<InterpreterFeedback | null>(null);
  const [timeOfDay, setTimeOfDay] = useState<'day' | 'dusk' | 'night'>(world.timeOfDay || 'day');
  const [cameraMode, setCameraMode] = useState<'overview' | 'follow' | 'street'>('overview');
  const [selectedActorId, setSelectedActorId] = useState<string | null>(null);
  const [selectedInfo, setSelectedInfo] = useState<string | null>(null);
  const [dockOpen, setDockOpen] = useState(true);

  useEffect(() => {
    if (activeWorldBlueprint) {
      setWorld(activeWorldBlueprint);
      setPrompt(activeWorldBlueprint.prompt || activeWorldBlueprint.title);
      setTimeOfDay(activeWorldBlueprint.timeOfDay || 'day');
      setSelectedActorId(activeWorldBlueprint.actors[0]?.id || null);
      setFeedback({
        status: 'accepted',
        headline: `Loaded World "${activeWorldBlueprint.title}"`,
        reason: `Active profile: ${activeWorldBlueprint.biome} (g=${activeWorldBlueprint.gravity} m/s², water=${activeWorldBlueprint.waterLevel} m).`,
        diffs: [],
      });
      setActiveWorldBlueprint(null);
    }
  }, [activeWorldBlueprint, setActiveWorldBlueprint]);

  const actorsRef = useRef(world.actors);
  actorsRef.current = world.actors;
  const cameraModeRef = useRef(cameraMode);
  cameraModeRef.current = cameraMode;
  const selectedActorIdRef = useRef(selectedActorId);
  selectedActorIdRef.current = selectedActorId;
  const worldRef = useRef(world);
  worldRef.current = world;

  const sceneRefs = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    renderer: THREE.WebGLRenderer;
    worldGroup: THREE.Group;
    keyLight: THREE.DirectionalLight;
    actorMeshes: Map<string, THREE.Group>;
  } | null>(null);

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
    renderer.toneMappingExposure = 1.05;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(world.skyColor);
    scene.fog = new THREE.FogExp2(world.fogColor, 0.015);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.2, 200);
    camera.position.set(28, 19, 32);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.target.set(0, 2, 0);

    const keyLight = new THREE.DirectionalLight('#fff5e1', 2.0);
    keyLight.position.set(25, 35, 20);
    keyLight.castShadow = !isSoftwareGl;
    scene.add(keyLight);
    scene.add(new THREE.HemisphereLight('#93c5fd', '#1e293b', 0.8));

    const worldGroup = new THREE.Group();
    scene.add(worldGroup);

    const actorMeshes = new Map<string, THREE.Group>();
    sceneRefs.current = { scene, camera, controls, renderer, worldGroup, keyLight, actorMeshes };

    // Raycaster to inspect buildings or actors on click
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downPos = { x: 0, y: 0 };
    const onPointerDown = (ev: PointerEvent) => {
      downPos = { x: ev.clientX, y: ev.clientY };
    };
    const onPointerUp = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - downPos.x, ev.clientY - downPos.y) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(worldGroup.children, true);
      for (const hit of hits) {
        let cur: THREE.Object3D | null = hit.object;
        while (cur && cur !== worldGroup) {
          if (cur.userData?.actorId) {
            setSelectedActorId(String(cur.userData.actorId));
            setSelectedInfo(`Tracking ${String(cur.userData.label)}`);
            return;
          }
          if (cur.userData?.buildingLabel) {
            setSelectedInfo(String(cur.userData.buildingLabel));
            return;
          }
          cur = cur.parent;
        }
      }
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    let frameId = 0;
    let t = 0;

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

    function tick() {
      t += 0.025;
      const waterY = worldRef.current.waterLevel > 0 ? worldRef.current.waterLevel + 0.15 : 0.35;
      actorsRef.current.forEach((act, idx) => {
        const mesh = actorMeshes.get(act.id);
        if (mesh) {
          const radius = 8 + idx * 4.5;
          const angle = t * (0.18 + act.speed * 0.06) + idx * 2.1;
          mesh.position.set(Math.cos(angle) * radius, waterY, Math.sin(angle) * radius);
          mesh.rotation.y = -angle;
        }
      });

      if (cameraModeRef.current === 'follow') {
        const targetId = selectedActorIdRef.current || actorsRef.current[0]?.id;
        const targetMesh = targetId ? actorMeshes.get(targetId) : undefined;
        if (targetMesh) {
          controls.target.lerp(targetMesh.position, isSoftwareGl ? 1 : 0.12);
          const followPos = new THREE.Vector3(
            targetMesh.position.x + 11,
            targetMesh.position.y + 9.5,
            targetMesh.position.z + 11
          );
          camera.position.lerp(followPos, isSoftwareGl ? 1 : 0.08);
        }
      }

      controls.update();
      renderer.render(scene, camera);
      if (isSoftwareGl) afterDraw(tick);
      else frameId = requestAnimationFrame(tick);
    }

    tick();

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || 960;
      const h = container.clientHeight || 540;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    return () => {
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      controls.dispose();
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switch camera preset cleanly when user changes cameraMode
  useEffect(() => {
    const refs = sceneRefs.current;
    if (!refs) return;
    if (cameraMode === 'overview') {
      refs.controls.target.set(0, 2, 0);
      refs.camera.position.set(28, 19, 32);
    } else if (cameraMode === 'street') {
      refs.controls.target.set(0, 2.2, 0);
      refs.camera.position.set(14, 3.2, 16);
    }
    refs.controls.update();
    refs.renderer.render(refs.scene, refs.camera);
  }, [cameraMode, world]);

  // Populate world geometry when world blueprint or timeOfDay changes
  useEffect(() => {
    const refs = sceneRefs.current;
    if (!refs) return;
    const { scene, worldGroup, keyLight, actorMeshes } = refs;

    while (worldGroup.children.length > 0) {
      const obj = worldGroup.children[0];
      obj.traverse((child) => {
        const m = child as THREE.Mesh;
        m.geometry?.dispose();
        if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
        else m.material?.dispose();
      });
      worldGroup.remove(obj);
    }
    actorMeshes.clear();

    const bgHex = timeOfDay === 'night' ? '#050811' : timeOfDay === 'dusk' ? '#241835' : world.skyColor;
    scene.background = new THREE.Color(bgHex);
    scene.fog = new THREE.FogExp2(bgHex, timeOfDay === 'night' ? 0.018 : 0.012);
    keyLight.intensity = timeOfDay === 'night' ? 0.75 : timeOfDay === 'dusk' ? 1.45 : 2.1;
    keyLight.color.set(timeOfDay === 'dusk' ? '#fb923c' : '#fff5e1');

    // Terrain with biome-aware elevation & central island relief for water worlds
    const terrainGeo = new THREE.PlaneGeometry(240, 240, 48, 48);
    terrainGeo.rotateX(-Math.PI / 2);
    const pos = terrainGeo.attributes.position;
    const hasWater = world.waterLevel > -0.5;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const dist = Math.hypot(x, z);
      if (hasWater) {
        const islandProfile = dist < 14 ? 0.9 : Math.max(-1.6, 0.9 - (dist - 14) * 0.12);
        const ripple = Math.sin(x * 0.16) * Math.cos(z * 0.16) * 0.25 * world.terrainAmplitude;
        pos.setY(i, islandProfile + ripple);
      } else {
        const rimLift = dist > 26 ? ((dist - 26) / 14) * world.terrainAmplitude : 0;
        const wave = (Math.sin(x * 0.14) * Math.cos(z * 0.14) + 1) * 0.35 * rimLift;
        pos.setY(i, wave);
      }
    }
    terrainGeo.computeVertexNormals();
    const terrain = new THREE.Mesh(
      terrainGeo,
      new THREE.MeshStandardMaterial({ color: world.terrainColor, roughness: 0.9, metalness: 0.05 })
    );
    terrain.receiveShadow = true;
    worldGroup.add(terrain);

    // Reflective Water Surface when waterLevel > -0.5
    if (hasWater) {
      const waterMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(240, 240),
        new THREE.MeshStandardMaterial({
          color: world.waterColor || '#0284c7',
          roughness: 0.38,
          metalness: 0.15,
          transparent: true,
          opacity: 0.86,
          envMapIntensity: 0.3,
        })
      );
      waterMesh.rotation.x = -Math.PI / 2;
      waterMesh.position.y = world.waterLevel;
      worldGroup.add(waterMesh);
    }

    // Paved Axial Roads / Bridges
    const isBridgeWorld = world.features?.includes('bridge') || hasWater;
    const roadMat = new THREE.MeshStandardMaterial({
      color: isBridgeWorld ? '#334155' : '#0f172a',
      roughness: 0.72,
      metalness: 0.2,
    });
    const roadY = hasWater ? Math.max(0.45, world.waterLevel + 0.55) : 0.03;
    const roadX = new THREE.Mesh(new THREE.BoxGeometry(90, isBridgeWorld ? 0.25 : 0.04, 3.2), roadMat);
    roadX.position.y = roadY;
    worldGroup.add(roadX);
    const roadZ = new THREE.Mesh(new THREE.BoxGeometry(3.2, isBridgeWorld ? 0.25 : 0.04, 90), roadMat);
    roadZ.position.y = roadY + 0.01;
    worldGroup.add(roadZ);

    // Solar Array Pads if featured
    if (world.features?.includes('solar_array')) {
      const solarMat = new THREE.MeshPhysicalMaterial({
        color: '#0f172a',
        roughness: 0.15,
        metalness: 0.8,
        clearcoat: 0.9,
      });
      for (let i = 0; i < 4; i++) {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 1.8), solarMat);
        panel.position.set(-7 + i * 4.5, 0.8, 6.5);
        panel.rotation.x = 0.28;
        worldGroup.add(panel);
      }
    }

    // Buildings (multi-part structures with clickable metadata)
    const accentHex = world.accentColor || '#38bdf8';
    const isGlowTime = timeOfDay === 'night' || timeOfDay === 'dusk' || world.biome === 'cyber_metropolis';
    for (const b of world.buildings) {
      const bGroup = new THREE.Group();
      const baseElevation = hasWater ? Math.max(0, world.waterLevel - 0.1) : 0;
      bGroup.position.set(b.x, baseElevation, b.z);
      bGroup.userData = {
        buildingLabel: `${b.name || b.id} · ${b.floors} floors · ${b.roofType} roof`,
      };

      const body = new THREE.Mesh(
        new THREE.BoxGeometry(b.width, b.height, b.depth),
        new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.52, metalness: 0.38 })
      );
      body.position.y = b.height / 2;
      body.castShadow = true;
      bGroup.add(body);

      const crown = new THREE.Mesh(
        b.roofType === 'dome'
          ? new THREE.SphereGeometry(b.width * 0.35, 16, 12)
          : b.roofType === 'spire'
            ? new THREE.ConeGeometry(b.width * 0.3, 2.4, 12)
            : new THREE.BoxGeometry(b.width * 0.85, 0.3, b.depth * 0.85),
        new THREE.MeshStandardMaterial({
          color: accentHex,
          roughness: 0.28,
          metalness: 0.7,
          emissive: isGlowTime ? accentHex : '#000000',
          emissiveIntensity: isGlowTime ? 0.65 : 0,
        })
      );
      crown.position.y = b.height + (b.roofType === 'spire' ? 1.2 : 0.25);
      bGroup.add(crown);
      worldGroup.add(bGroup);
    }

    // Instanced Trees / Foliage
    if (world.treePositions.length > 0) {
      const treeGeo = new THREE.ConeGeometry(0.85, 3.2, 8);
      const treeMat = new THREE.MeshStandardMaterial({
        color: world.foliageColor || (world.biome === 'desert_outpost' ? '#65a30d' : '#15803d'),
        roughness: 0.85,
      });
      const inst = new THREE.InstancedMesh(treeGeo, treeMat, world.treePositions.length);
      const dummy = new THREE.Object3D();
      world.treePositions.forEach((tp, idx) => {
        dummy.position.set(tp.x, 1.6 * tp.scale, tp.z);
        dummy.scale.setScalar(tp.scale);
        dummy.updateMatrix();
        inst.setMatrixAt(idx, dummy.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      worldGroup.add(inst);
    }

    // Autonomous Actors (clickable + trackable 3-part units)
    for (const act of world.actors) {
      const ag = new THREE.Group();
      ag.userData = { actorId: act.id, label: act.name };
      const chassis = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 0.35, 1.6),
        new THREE.MeshStandardMaterial({ color: act.color, roughness: 0.3, metalness: 0.7 })
      );
      const mast = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.14, 0.55, 10),
        new THREE.MeshStandardMaterial({ color: '#e2e8f0', roughness: 0.4, metalness: 0.8 })
      );
      mast.position.set(0, 0.4, 0.35);
      const beacon = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 12, 10),
        new THREE.MeshStandardMaterial({ color: act.color, emissive: act.color, emissiveIntensity: 0.85 })
      );
      beacon.position.set(0, 0.72, 0.35);
      ag.add(chassis, mast, beacon);
      ag.position.set(act.x, 0.35, act.z);
      worldGroup.add(ag);
      actorMeshes.set(act.id, ag);
    }

    refs.controls.update();
    refs.renderer.render(scene, refs.camera);
  }, [world, timeOfDay]);

  const submitWorldPrompt = async (targetPrompt: string) => {
    if (generating) return;
    setErrorMsg(null);
    setSelectedInfo(null);

    const interpretation = interpretWorldInstruction(targetPrompt, world);
    setFeedback({
      status: interpretation.status,
      headline: interpretation.headline,
      reason: interpretation.reason,
      diffs: interpretation.appliedChanges,
    });

    if (interpretation.status === 'rejected') {
      return;
    }

    if (interpretation.mode === 'contextual_update' && interpretation.updatedWorld) {
      setWorld(interpretation.updatedWorld);
      setTimeOfDay(interpretation.updatedWorld.timeOfDay || 'day');
      setEngineTag('omnix-world-interpreter');
      return;
    }

    setGenerating(true);
    try {
      const res = await fetch('/api/world/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          projectId: activeProjectId,
          prompt: targetPrompt.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.world) {
        throw new Error(data.error || 'World generation failed');
      }
      setWorld(data.world);
      setEngineTag(data.model || 'omnix-procedural-world');
      setTimeOfDay(data.world.timeOfDay || 'day');
      setSelectedActorId(data.world.actors?.[0]?.id || null);
      setCameraMode('overview');
      setFeedback({
        status: 'accepted',
        headline: interpretation.headline,
        reason: `Synthesized "${data.world.title}" (${data.world.biome}, g=${data.world.gravity} m/s², water=${data.world.waterLevel} m, relief=${data.world.terrainAmplitude} m).`,
        diffs: interpretation.appliedChanges,
      });
      triggerRefresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'World generation failed';
      setErrorMsg(msg);
      setFeedback({
        status: 'rejected',
        headline: 'Instruction Rejected — Synthesis Error',
        reason: msg,
        diffs: [],
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleTextToWorld = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitWorldPrompt(prompt);
  };

  const worldPresets = [
    'Coastal island harbor at dusk with bridges',
    'Mars crater research colony with solar arrays',
    'Set moon gravity 1.62 and scale 1.4x',
    'محطة أبحاث في جبال الألب مع نهر وثلوج',
  ];

  return (
    <div className="relative h-[calc(100vh-8rem)] w-full overflow-hidden rounded-xl border border-slate-800 bg-[#070b14]">
      <div
        ref={mountRef}
        data-testid="omni-world-canvas"
        data-world-biome={world.biome}
        data-world-title={world.title}
        data-world-gravity={world.gravity}
        className="h-full w-full"
      />

      {/* Top-Left World Telemetry Header + Contextual Interpreter Feedback */}
      <div className="pointer-events-none absolute start-4 top-4 z-10 max-w-md space-y-2">
        <div className="rounded-lg border border-slate-700/80 bg-[#0f141f]/90 px-4 py-2.5">
          <h1 className="font-display text-sm font-semibold text-slate-100">{world.title}</h1>
          <p className="mt-0.5 font-mono text-xs tabular-nums text-slate-400">
            {world.biome} · {world.buildings.length} structures · {world.actors.length} actors · g={world.gravity} m/s² ·{' '}
            {engineTag}
          </p>
          {selectedInfo && <p className="mt-1 text-xs text-sky-300">{selectedInfo}</p>}
          {errorMsg && <p className="mt-1 text-xs text-red-300">{errorMsg}</p>}
        </div>

        {feedback && (
          <div
            data-testid="world-interpreter-feedback"
            data-status={feedback.status}
            role={feedback.status === 'rejected' ? 'alert' : 'status'}
            className={`pointer-events-auto rounded-lg border px-3.5 py-2.5 text-xs space-y-1.5 ${
              feedback.status === 'accepted'
                ? 'border-emerald-500/40 bg-[#0b1915]/95 text-emerald-200'
                : 'border-rose-500/50 bg-[#1f0d14]/95 text-rose-200'
            }`}
          >
            <div className="flex items-center gap-1.5 font-semibold">
              {feedback.status === 'accepted' ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-400" />
              )}
              <span>{feedback.headline}</span>
            </div>
            <p className="text-[11px] leading-snug opacity-90">{feedback.reason}</p>
            {feedback.diffs.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-0.5">
                {feedback.diffs.map((d) => (
                  <span
                    key={`${d.parameter}-${d.to}`}
                    className="rounded border border-emerald-500/30 bg-[#08120f] px-1.5 py-0.5 font-mono text-[10px] text-emerald-300"
                  >
                    {d.parameter}: {d.from} → {d.to}
                  </span>
                ))}
              </div>
            )}
            {feedback.status === 'rejected' && (
              <div className="flex flex-wrap items-center gap-1 pt-0.5">
                <span className="text-[10px] text-rose-300/80">Try:</span>
                {['Set moon gravity 1.62', 'Scale 1.4x', 'Raise water level 1.2'].map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => {
                      setPrompt(example);
                      void submitWorldPrompt(example);
                    }}
                    className="rounded border border-rose-500/30 bg-[#14080d] px-1.5 py-0.5 font-mono text-[10px] text-rose-200 hover:border-rose-400"
                  >
                    {example}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Top-Right Camera & Actor Tracking Controls */}
      <div className="absolute end-4 top-4 z-10 w-60 max-w-[44vw] rounded-lg border border-slate-700/80 bg-[#0f141f]/95 p-2.5 space-y-2 text-xs">
        <div className="flex items-center gap-1.5 text-slate-200 font-semibold">
          <Compass className="h-3.5 w-3.5 text-sky-400" />
          <span>{isAr ? 'وضع الكاميرا والتتبع' : 'Camera & Actor Tracking'}</span>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {([
            ['overview', 'Overview'],
            ['follow', 'Follow'],
            ['street', 'Street'],
          ] as const).map(([m, lbl]) => (
            <button
              key={m}
              type="button"
              onClick={() => setCameraMode(m)}
              className={`rounded border px-2 py-1 text-[11px] transition-colors ${
                cameraMode === m
                  ? 'border-sky-500/60 bg-sky-500/20 text-sky-200'
                  : 'border-slate-800 bg-[#0B0F17] text-slate-400 hover:text-white'
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>

        <div className="space-y-1 pt-1 border-t border-slate-800">
          {world.actors.map((act) => {
            const active = selectedActorId === act.id;
            return (
              <button
                key={act.id}
                type="button"
                onClick={() => {
                  setSelectedActorId(act.id);
                  setCameraMode('follow');
                  setSelectedInfo(`Following ${act.name} (${act.speed} m/s)`);
                }}
                className={`flex w-full items-center justify-between rounded px-2 py-1 text-[11px] transition-colors ${
                  active ? 'bg-sky-500/15 text-sky-200 border border-sky-500/40' : 'text-slate-300 hover:bg-slate-800/70'
                }`}
              >
                <span className="flex items-center gap-1.5 truncate">
                  <Navigation className="h-3 w-3 shrink-0" style={{ color: act.color }} />
                  <span className="truncate">{act.name}</span>
                </span>
                <span className="font-mono text-[10px] text-slate-400">{act.speed}m/s</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom World Synthesis Dock */}
      <div className="absolute bottom-4 left-1/2 z-10 w-[min(920px,94%)] -translate-x-1/2 flex flex-col items-center">
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
            <form onSubmit={(e) => void handleTextToWorld(e)} className="flex flex-wrap gap-2">
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={
                  isAr
                    ? 'صف العالم أو عدّل الفيزياء: مثال "جزيرة ساحلية"، "جاذبية القمر 1.62"، "تكبير 1.4x"...'
                    : "Describe a world or physics edit: e.g. 'Coastal island harbor', 'set gravity 1.62', 'scale 1.4x'..."
                }
                aria-label="Text to World prompt"
                className="flex-1 min-w-[220px] rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-1.5 text-xs text-slate-100"
              />
              <button
                type="submit"
                disabled={generating}
                className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50 whitespace-nowrap"
              >
                <Globe className="h-3.5 w-3.5" />
                <span>{generating ? (isAr ? 'جاري البناء...' : 'Synthesizing...') : 'Generate World'}</span>
              </button>
            </form>

            <div className="flex flex-wrap items-center gap-1.5">
              {worldPresets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setPrompt(preset);
                    void submitWorldPrompt(preset);
                  }}
                  className="rounded border border-slate-800 bg-[#0B0F17] px-2 py-0.5 text-[11px] text-slate-400 hover:border-sky-500/40 hover:text-slate-200 truncate max-w-[240px]"
                >
                  {preset}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400">Time of Day:</span>
                {(['day', 'dusk', 'night'] as const).map((tod) => (
                  <button
                    key={tod}
                    type="button"
                    onClick={() => {
                      setTimeOfDay(tod);
                      setWorld((prev) => ({ ...prev, timeOfDay: tod }));
                    }}
                    className={`rounded px-2.5 py-1 capitalize ${
                      timeOfDay === tod
                        ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                        : 'bg-[#0B0F17] text-slate-400 border border-slate-800'
                    }`}
                  >
                    {tod}
                  </button>
                ))}
              </div>
              <span className="text-slate-400">
                Click building or actor to inspect · Drag to orbit · Scroll to zoom
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
