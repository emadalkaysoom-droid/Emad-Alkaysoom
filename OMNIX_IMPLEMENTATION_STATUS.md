# OMNIX — Implementation Status & Engineering Audit

## 1. Architecture Overview (Unified 6-Layer Design)
- **Layer 1 — User Interface (`src/components/`)**: Modular dark-slate studio interface with bilingual English (`LTR`) and Arabic (`RTL`) support, tabular numerals, responsive sidebar, global search, and WebGL-safe viewports.
- **Layer 2 — Orchestration Engine (`server/core/omniBrain.ts`)**: Decomposes complex multi-step directives into sequential agent workflows, routes to 12 specialized domain agents, enforces approval gates, and verifies outputs via QA Agent.
- **Layer 3 — AI Intelligence & Model Gateway (`server/core/modelGateway.ts`)**: Unified Gateway supporting Cloud Gemini (`@google/genai` `gemini-4-hydrogen`) when `GEMINI_API_KEY` is configured on the server, with automatic deterministic local hybrid fallback (`omnix-local-core`) and per-call latency/token telemetry.
- **Layer 4 — Execution Engine (`server/core/executionEngine.ts`, `shared/`)**: Safe recursive-descent math parser, isolated `node:vm` JavaScript sandbox (500ms timeout, no `process`/`require`), CSV/XLSX/JSON/XML parser, Z-score anomaly detector, linear regression forecaster, and multi-format report compiler (`PDF`, `DOCX`, `XLSX`, `CSV`, `HTML`).
- **Layer 5 — Data & Memory Engine (`server/db/schema.ts`)**: Relational SQLite (`node:sqlite`, WAL mode, foreign keys enforced) with 29 tables, versioned migrations, separate `short_term` and `long_term` memory tiers, Knowledge Graph nodes/relations, and live backup snapshots.
- **Layer 6 — Security & Permissions (`server/core/security.ts`)**: `bcryptjs` password hashing, session tokens, RBAC role permissions (`admin`, `engineer`, `analyst`, `viewer`), rate limiting, filename sanitization, immutable `audit_logs`, and `AI Action Approval` queue.

## 2. Implemented Subsystems
- **OMNI BRAIN**: Multi-step task decomposition, tool routing, QA verification, persisted conversations.
- **OMNI VISION**: Image upload, webcam capture, pixel luminance/edge telemetry, two-image change detection diffing, and multimodal VQA/OCR via Gemini Vision when `GEMINI_API_KEY` is configured.
- **OMNI VOICE**: Browser `SpeechRecognition` STT, interruptible `SpeechSynthesis` TTS with language/voice/rate controls, Web Audio API VAD waveform meter, and voice command routing.
- **OMNI MEMORY & OMNI LEARN**: Short-term vs. Long-term memory management, Knowledge Graph visualization, and non-weight-mutating adaptive retrieval/workflow preferences.
- **OMNI AGENT**: 12 specialized agents, task scheduler, queue runner, isolated execution, and execution logs.
- **OMNI 3D**: Three.js PBR studio (`RoomEnvironment`, software-WebGL guard, on-demand rendering), Text-to-3D composite assemblies (3–12 parts), exploded view, camera presets, material finishes, bounding box dimensions, and `GLTF` / `OBJ` / `STL` export.
- **OMNI SIM**: Interactive rigid-body physics engine (gravity, Coulomb friction, restitution, sphere collisions, particle bursts, energy telemetry) with explicit engineering disclaimer separating visual rigid-body physics from certified FEA solvers.
- **OMNI WORLD**: Procedural heightmap terrain, multi-part buildings, `InstancedMesh` trees, autonomous moving actors, day/dusk/night laws, and Text-to-World generator.
- **OMNI DATA & Reports**: CSV/XLSX/JSON/XML ingestion, descriptive statistics, Z-score anomaly detection, linear trend forecasting, Natural Language data queries (EN/AR), and downloadable `PDF`, `DOCX`, `XLSX`, `CSV`, `HTML` reports.
- **OMNI CONNECT**: Extensible connector registry (REST, WebSocket, OAuth 2.0, Webhook, File) plus a typed Plugin Runtime (`shared/pluginContract.ts`, `server/plugins/pluginManager.ts`) supporting built-in modules, filesystem JSON manifest discovery, custom manifest installation, least-privilege permission grants, RBAC/approval gating, audit logging, and example `TaskFlow PM` and `NebulaVault Cloud Storage` plugins.
- **Interactive Onboarding Flow**: 6-step interactive walkthrough (`src/components/views/OnboardingView.tsx`) introducing `OMNI BRAIN`, `OMNI VISION`, `OMNI VOICE`, `OMNI AGENT`, live text/image/voice input labs, and an end-to-end `OMNI VISION -> OMNI DATA -> PDF Report` guided pipeline with persistent completion tracking.
- **OMNI SECURITY**: Approval queue for destructive operations, Audit Logs, RBAC switcher, SQLite live backup.
- **System Health**: Authentic live probes (`ONLINE`, `DEGRADED`, `OFFLINE`, `NOT CONFIGURED`, `ERROR`) and in-app automated test runner.

## 3. External Services & Honest Limitations
- **Cloud Multimodal AI (`GEMINI_API_KEY`)**: Cloud reasoning, neural OCR, and semantic Vision Q&A require a valid `GEMINI_API_KEY` injected via server environment secrets. When absent, the Model Gateway transparently switches to `omnix-local-core` and Vision falls back to deterministic pixel/change-detection telemetry without fabricating neural classifications.
- **Hardware Camera / Microphone**: Live webcam and speech recognition depend on browser permissions and host hardware availability.
- **Engineering Simulation Scope**: OMNI SIM provides interactive rigid-body kinematics for visualization and prototyping; certified structural FEA or CFD requires specialized external solvers.

## 4. Verification & Test Coverage
- `tests/mathSandbox.test.ts` — Safe math parser & injection rejection
- `tests/dataEngine.test.ts` — CSV/XML parsing, stats, Z-score outliers, regression forecast, NL queries
- `tests/physicsEngine.test.ts` — Gravity, ground restitution, momentum-conserving collisions
- `tests/procedural3d.test.ts` — Composite 3D blueprints, world layouts, OBJ/STL serialization
- `tests/serverIntegration.test.ts` — SQLite schema & FKs, auth/RBAC, VM sandbox, OMNI BRAIN workflow & approval gating, PDF/DOCX/XLSX/CSV/HTML report compilation, health probes
- `tests/onboardingGuide.test.ts` — Interactive onboarding step coverage and completion progress math
- `tests/pluginSystem.test.ts` — Plugin manifest validation (including SSRF host blocks), directory/module discovery, RBAC/granted-scope enforcement, approval gating, and TaskFlow/NebulaVault execution
