import React, { useCallback, useEffect, useState } from 'react';
import { Atom, FlaskConical, Layers, Play, Ruler } from 'lucide-react';
import { useOmnix } from '../../contexts/OmnixContext';
import { apiFetch } from '../../lib/apiClient';
import type { MaterialSpec } from '../../../shared/labEngine';

export function LabView() {
  const { activeWorkspaceId, language } = useOmnix();
  const isAr = language === 'ar';

  const [domain, setDomain] = useState<'numerical' | 'physics' | 'materials' | 'engineering'>('physics');
  const [materials, setMaterials] = useState<MaterialSpec[]>([]);
  const [experiments, setExperiments] = useState<Array<{ id: string; domain: string; title: string; equations_json: string; results_json: string; created_at: string }>>([]);
  const [output, setOutput] = useState<{ equations: string[]; results: Record<string, unknown> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Domain params
  const [numMode, setNumMode] = useState<'linear_system' | 'ode' | 'stats'>('linear_system');
  const [odeModel, setOdeModel] = useState<'damped_oscillator' | 'exponential_decay' | 'logistic_growth' | 'rc_charging'>('damped_oscillator');
  const [physType, setPhysType] = useState<'projectile' | 'collision_1d' | 'thermodynamics_carnot' | 'harmonic_pendulum'>('projectile');
  const [v0, setV0] = useState(40);
  const [angleDeg, setAngleDeg] = useState(45);
  const [gravity, setGravity] = useState(9.81);
  const [matId, setMatId] = useState('mat-steel-a36');
  const [forceN, setForceN] = useState(28000);
  const [areaMm2, setAreaMm2] = useState(140);
  const [engType, setEngType] = useState<'beam_bending' | 'thermal_conduction'>('beam_bending');
  const [beamLength, setBeamLength] = useState(3.2);
  const [beamLoad, setBeamLoad] = useState(6500);

  const loadOverview = useCallback(async () => {
    const res = await apiFetch(`/api/lab/overview?workspaceId=${encodeURIComponent(activeWorkspaceId)}`);
    if (res.ok) {
      const data = await res.json();
      setMaterials(data.materials || []);
      setExperiments(data.experiments || []);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const runExperiment = async () => {
    setError(null);
    let params: Record<string, unknown> = {};
    let title = '';
    if (domain === 'numerical') {
      title = `Numerical: ${numMode}`;
      params = numMode === 'ode'
        ? { mode: 'ode', model: odeModel, y0: 2.0, v0: 0, paramA: 3.0, paramB: 0.18, tEnd: 10 }
        : numMode === 'stats'
          ? { mode: 'stats', xs: [1, 2, 3, 4, 5, 6], ys: [2.1, 4.0, 5.9, 8.2, 10.1, 12.0] }
          : { mode: 'linear_system', matrixA: [[4, 1], [2, 3]], vectorB: [9, 7] };
    } else if (domain === 'physics') {
      title = `Physics: ${physType}`;
      params = { experimentType: physType, v0, angleDeg, gravity };
    } else if (domain === 'materials') {
      title = `Materials: ${matId}`;
      params = { materialId: matId, appliedForceN: forceN, crossSectionAreaMm2: areaMm2 };
    } else {
      title = `Engineering: ${engType}`;
      params = { analysisType: engType, lengthM: beamLength, loadN: beamLoad };
    }

    const res = await apiFetch('/api/lab/run', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: activeWorkspaceId, domain, title, params }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Experiment error');
      return;
    }
    setOutput({ equations: data.equations, results: data.results });
    void loadOverview();
  };

  // Helper to plot series in SVG cleanly
  const chartPoints = (() => {
    if (!output) return [];
    const r = output.results as {
      trajectory?: Array<{ x: number; y: number }>;
      series?: Array<{ t: number; y: number }>;
      stressStrainCurve?: Array<{ strainPct: number; stressMPa: number }>;
      profileSeries?: Array<{ position: number; value: number }>;
    };
    if (r.trajectory?.length) return r.trajectory.map((p) => ({ x: p.x, y: p.y }));
    if (r.series?.length) return r.series.map((p) => ({ x: p.t, y: p.y }));
    if (r.stressStrainCurve?.length) return r.stressStrainCurve.map((p) => ({ x: p.strainPct, y: p.stressMPa }));
    if (r.profileSeries?.length) return r.profileSeries.map((p) => ({ x: p.position, y: p.value }));
    return [];
  })();

  const svgPolyline = (() => {
    if (chartPoints.length < 2) return '';
    const xs = chartPoints.map((p) => p.x);
    const ys = chartPoints.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs) || minX + 1;
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys) || minY + 1;
    const dx = maxX - minX || 1;
    const dy = maxY - minY || 1;
    return chartPoints
      .map((p) => {
        const sx = 24 + ((p.x - minX) / dx) * 452;
        const sy = 196 - ((p.y - minY) / dy) * 168;
        return `${sx.toFixed(1)},${sy.toFixed(1)}`;
      })
      .join(' ');
  })();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-100 flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-sky-400" />
            <span>OMNI LAB · {isAr ? 'المختبر العلمي والهندسي الافتراضي' : 'Virtual Scientific & Engineering Lab'}</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            {isAr
              ? 'حسابات علمية ومصفوفات ومعادلات تفاضلية RK4، محاكاة فيزيائية، منحنيات إجهاد-انفعال للمواد، وتحليل إنشائي وحراري.'
              : 'Linear algebra & RK4 ODE solvers, classical physics, verified materials stress-strain curves, and Euler-Bernoulli / Fourier engineering.'}
          </p>
        </div>

        <div className="flex rounded-md border border-slate-800 bg-[#0F141F] p-0.5 text-xs">
          {([
            ['physics', Atom, isAr ? 'الفيزياء' : 'Physics'],
            ['materials', Layers, isAr ? 'المواد' : 'Materials'],
            ['engineering', Ruler, isAr ? 'الهندسة' : 'Engineering'],
            ['numerical', FlaskConical, isAr ? 'الحسابات والـ ODE' : 'Numerical / ODE'],
          ] as const).map(([id, Icon, lbl]) => (
            <button
              key={id}
              type="button"
              onClick={() => setDomain(id)}
              className={`flex items-center gap-1.5 rounded px-3 py-1.5 font-medium transition-colors ${
                domain === id ? 'bg-sky-500/20 text-sky-300' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{lbl}</span>
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-4 space-y-3 text-xs">
          <h2 className="font-semibold text-slate-200 border-b border-slate-800 pb-2">
            {isAr ? 'متغيرات التجربة' : 'Experiment Parameters'}
          </h2>

          {domain === 'physics' && (
            <div className="space-y-2.5">
              <label className="block text-slate-400">Model</label>
              <select value={physType} onChange={(e) => setPhysType(e.target.value as typeof physType)} className="w-full rounded border border-slate-800 bg-[#0B0F17] p-2 text-slate-200">
                <option value="projectile">Projectile Motion (w/ Quadratic Drag)</option>
                <option value="collision_1d">1D Momentum & Collision</option>
                <option value="thermodynamics_carnot">Thermodynamics Carnot Cycle</option>
                <option value="harmonic_pendulum">Harmonic Pendulum</option>
              </select>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">v₀ (m/s)</label>
                  <input type="number" value={v0} onChange={(e) => setV0(Number(e.target.value))} className="w-full rounded border border-slate-800 bg-[#0B0F17] p-1.5 font-mono text-slate-200" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Angle (°)</label>
                  <input type="number" value={angleDeg} onChange={(e) => setAngleDeg(Number(e.target.value))} className="w-full rounded border border-slate-800 bg-[#0B0F17] p-1.5 font-mono text-slate-200" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">g (m/s²)</label>
                  <input type="number" step="0.01" value={gravity} onChange={(e) => setGravity(Number(e.target.value))} className="w-full rounded border border-slate-800 bg-[#0B0F17] p-1.5 font-mono text-slate-200" />
                </div>
              </div>
            </div>
          )}

          {domain === 'materials' && (
            <div className="space-y-2.5">
              <label className="block text-slate-400">Reference Material</label>
              <select value={matId} onChange={(e) => setMatId(e.target.value)} className="w-full rounded border border-slate-800 bg-[#0B0F17] p-2 text-slate-200">
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>{m.name} (E={m.youngsModulusGPa} GPa)</option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Applied Force (N)</label>
                  <input type="number" value={forceN} onChange={(e) => setForceN(Number(e.target.value))} className="w-full rounded border border-slate-800 bg-[#0B0F17] p-1.5 font-mono text-slate-200" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Area (mm²)</label>
                  <input type="number" value={areaMm2} onChange={(e) => setAreaMm2(Number(e.target.value))} className="w-full rounded border border-slate-800 bg-[#0B0F17] p-1.5 font-mono text-slate-200" />
                </div>
              </div>
            </div>
          )}

          {domain === 'engineering' && (
            <div className="space-y-2.5">
              <label className="block text-slate-400">Engineering Solver</label>
              <select value={engType} onChange={(e) => setEngType(e.target.value as typeof engType)} className="w-full rounded border border-slate-800 bg-[#0B0F17] p-2 text-slate-200">
                <option value="beam_bending">Euler-Bernoulli Structural Beam Deflection</option>
                <option value="thermal_conduction">1D Fourier Thermal Conduction</option>
              </select>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Length (m)</label>
                  <input type="number" step="0.1" value={beamLength} onChange={(e) => setBeamLength(Number(e.target.value))} className="w-full rounded border border-slate-800 bg-[#0B0F17] p-1.5 font-mono text-slate-200" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Load (N)</label>
                  <input type="number" value={beamLoad} onChange={(e) => setBeamLoad(Number(e.target.value))} className="w-full rounded border border-slate-800 bg-[#0B0F17] p-1.5 font-mono text-slate-200" />
                </div>
              </div>
            </div>
          )}

          {domain === 'numerical' && (
            <div className="space-y-2.5">
              <label className="block text-slate-400">Computation Engine</label>
              <select value={numMode} onChange={(e) => setNumMode(e.target.value as typeof numMode)} className="w-full rounded border border-slate-800 bg-[#0B0F17] p-2 text-slate-200">
                <option value="linear_system">Linear Algebra Matrix Solver (Ax=b)</option>
                <option value="ode">Differential Equations (RK4 ODE · Pro)</option>
                <option value="stats">Statistics & Linear Regression</option>
              </select>
              {numMode === 'ode' && (
                <select value={odeModel} onChange={(e) => setOdeModel(e.target.value as typeof odeModel)} className="w-full rounded border border-slate-800 bg-[#0B0F17] p-2 text-slate-200">
                  <option value="damped_oscillator">Damped Harmonic Oscillator</option>
                  <option value="exponential_decay">Exponential Decay</option>
                  <option value="logistic_growth">Logistic Population Growth</option>
                  <option value="rc_charging">RC Circuit Transient</option>
                </select>
              )}
              <p className="text-[11px] text-slate-500">
                Deterministic TypeScript numerical kernels (Python NumPy/SciPy optional container not attached).
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={() => void runExperiment()}
            className="w-full flex items-center justify-center gap-1.5 rounded-md bg-sky-600 px-3 py-2 font-semibold text-white hover:bg-sky-500"
          >
            <Play className="h-3.5 w-3.5" />
            <span>{isAr ? 'تشغيل وحفظ التجربة' : 'Execute & Record Experiment'}</span>
          </button>
        </div>

        <div className="lg:col-span-2 rounded-lg border border-slate-800 bg-[#0F141F] p-4 space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            {isAr ? 'المعادلات والنتائج والمنحنى العلمي' : 'Equations, Outputs & Response Curve'}
          </h2>
          {output ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {output.equations.map((eq) => (
                  <span key={eq} className="rounded border border-slate-700 bg-[#0B0F17] px-2.5 py-1 font-mono text-[11px] text-sky-300">
                    {eq}
                  </span>
                ))}
              </div>
              {svgPolyline && (
                <svg viewBox="0 0 500 220" className="w-full h-52 rounded border border-slate-800 bg-[#0B0F17]">
                  <line x1="24" y1="196" x2="476" y2="196" stroke="#334155" strokeWidth="1" />
                  <line x1="24" y1="20" x2="24" y2="196" stroke="#334155" strokeWidth="1" />
                  <polyline fill="none" stroke="#38bdf8" strokeWidth="2.2" points={svgPolyline} />
                </svg>
              )}
              <pre className="max-h-44 overflow-auto rounded bg-[#0B0F17] p-3 font-mono text-[11px] text-slate-200">
                {JSON.stringify(output.results, null, 2)}
              </pre>
            </div>
          ) : (
            <p className="text-xs text-slate-400 py-8">Configure parameters and execute an experiment to inspect equations, curves, and saved telemetry.</p>
          )}
        </div>
      </div>

      {experiments.length > 0 && (
        <div className="rounded-lg border border-slate-800 bg-[#0F141F] p-4 text-xs">
          <h2 className="font-semibold text-slate-300 mb-2">{isAr ? 'سجل التجارب القابلة لإعادة التشغيل' : 'Reproducible Experiment Log'}</h2>
          <div className="divide-y divide-slate-800/80">
            {experiments.slice(0, 6).map((exp) => (
              <div key={exp.id} className="flex items-center justify-between py-2">
                <div>
                  <span className="font-semibold text-slate-200">{exp.title}</span>
                  <span className="ms-2 font-mono text-[11px] text-slate-400">{exp.domain}</span>
                </div>
                <span className="font-mono text-[11px] text-slate-500">{exp.created_at}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
