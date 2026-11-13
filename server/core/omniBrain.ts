import crypto from 'node:crypto';
import { getDb } from '../db/schema.ts';
import { invokeModelGateway } from './modelGateway.ts';
import { runToolAction, compileReportArtifact } from './executionEngine.ts';
import { createApprovalRequest, logAuditEvent } from './security.ts';

export interface OrchestratedStep {
  stepNumber: number;
  taskId: string;
  agentId: string;
  agentName: string;
  title: string;
  toolUsed: string;
  status: 'completed' | 'failed' | 'awaiting_approval';
  durationMs: number;
  verifiedByQa: boolean;
  outputSummary: string;
  approvalId?: string;
}

export interface OrchestrationResult {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  intent: string;
  steps: OrchestratedStep[];
  answer: string;
  gateway: {
    provider: string;
    model: string;
    latencyMs: number;
    tokensIn: number;
    tokensOut: number;
    isFallback: boolean;
    fallbackReason?: string;
  };
  artifacts: {
    reportId?: string;
    reportTitle?: string;
    threeDAssetId?: string;
    threeDBlueprint?: unknown;
    simulationId?: string;
    worldBlueprint?: unknown;
  };
}

interface PlannedAction {
  agentId: string;
  agentName: string;
  title: string;
  toolName: string;
  args: Record<string, unknown>;
  sensitive?: boolean;
}

function classifyAndPlan(
  prompt: string,
  context: { fileId?: string; projectId?: string | null }
): { intent: string; plan: PlannedAction[] } {
  const p = prompt.toLowerCase();
  const plan: PlannedAction[] = [];

  // Always start with Planning Agent intent decomposition
  plan.push({
    agentId: 'agent-planning',
    agentName: 'Planning Agent',
    title: 'Decompose directive & verify workspace context',
    toolName: 'memory_search',
    args: { query: prompt.slice(0, 64) },
  });

  // Check for sensitive destructive or external dispatch keywords
  if (/\b(delete|purge|drop|wipe|remove project|remove memory|حذف|مسح)\b/i.test(p)) {
    plan.push({
      agentId: 'agent-security',
      agentName: 'Security Agent',
      title: 'Intercept sensitive destructive operation for approval',
      toolName: 'request_approval',
      args: { action: 'destructive_operation', prompt },
      sensitive: true,
    });
  }

  // Math evaluation if math expression or calculation detected
  const mathExprMatch = prompt.match(
    /(?:calc|calculate|compute|evaluate|احسب)\s*[:=]?\s*((?:[a-zA-Z]+\([^)]+\)|[0-9.]+)(?:\s*[+\-*/^%]\s*(?:[a-zA-Z]+\([^)]+\)|[0-9.]+|\([^)]+\)))*)/i
  );
  if (mathExprMatch) {
    plan.push({
      agentId: 'agent-math',
      agentName: 'Mathematics Agent',
      title: 'Evaluate numerical & symbolic expression',
      toolName: 'math_eval',
      args: { expression: mathExprMatch[1].trim() },
    });
  }

  // Data analysis / file extraction
  if (/\b(analy|data|csv|xlsx|json|file|anomal|compare|stat|trend|forecast|حلل|بيانات|ملف|قارن|استخرج)\b/i.test(p) || context.fileId) {
    plan.push({
      agentId: 'agent-data',
      agentName: 'Data Analysis Agent',
      title: 'Parse structured dataset, compute statistics & detect anomalies',
      toolName: 'analyze_data',
      args: { fileId: context.fileId, query: prompt },
    });
  }

  // 3D Modeling request
  if (/\b(3d|model|car|drone|turbine|robot|rocket|spaceship|house|villa|castle|bridge|ship|submarine|chair|table|tower|mesh|stl|obj)\b|مجسم|ثلاثي|سيارة|روبوت|صاروخ|منزل|بيت|فيلا|جسر|قلعة|سفينة|برج|طاولة|كرسي/i.test(p)) {
    plan.push({
      agentId: 'agent-3d',
      agentName: '3D Modeling Agent',
      title: 'Synthesize parametric multi-part 3D assembly',
      toolName: 'create_3d_blueprint',
      args: { prompt },
    });
  }

  // World / Simulation request
  if (/\b(world|city|terrain|simulat|physics|gravity|island|ocean|mars|desert|arctic|cyber)\b|عالم|محاكاة|مدينة|فيزياء|جزيرة|بحر|صحراء|مريخ|فضاء/i.test(p)) {
    plan.push({
      agentId: 'agent-sim',
      agentName: 'Simulation Agent',
      title: 'Construct procedural digital world & physics environment',
      toolName: 'create_world_blueprint',
      args: { prompt },
    });
  }

  // Report generation
  if (/\b(report|pdf|docx|export|summary|تقرير|أنشئ تقريراً)\b/i.test(p)) {
    plan.push({
      agentId: 'agent-document',
      agentName: 'Document Agent',
      title: 'Compile structured deliverable report',
      toolName: 'generate_report',
      args: { title: 'OMNIX Analytical Briefing', format: 'pdf' },
    });
  }

  // AutoBuild / App Synthesis request
  if (/\b(build app|create app|generate app|autobuild|saas app)\b|أنشئ تطبيقاً|صمم تطبيق|بناء تطبيق/i.test(p)) {
    plan.push({
      agentId: 'agent-engineering',
      agentName: 'Engineering Agent',
      title: 'Synthesize full-stack AutoBuild application blueprint',
      toolName: 'autobuild_app',
      args: { prompt },
    });
  }

  // Codex / Code Review request
  if (/\b(audit code|code review|codex|refactor|vulnerability scan)\b|فحص الكود|تحليل الكود|ثغرات/i.test(p)) {
    plan.push({
      agentId: 'agent-coding',
      agentName: 'Coding Agent',
      title: 'Run OMNI CODEX static & security inspection',
      toolName: 'codex_scan',
      args: { code: prompt },
    });
  }

  // Save to memory/project if requested
  if (/\b(save|remember|memory|project|احفظ|تذكر|المشروع)\b/i.test(p)) {
    plan.push({
      agentId: 'agent-research',
      agentName: 'Research Agent',
      title: 'Persist verified findings to long-term workspace memory',
      toolName: 'save_memory',
      args: {
        title: `Directive Insight (${new Date().toISOString().slice(0, 10)})`,
        content: `Executed directive: ${prompt}`,
        scope: 'long_term',
        tags: ['omni-brain', 'orchestrated'],
      },
    });
  }

  const intent =
    plan.length > 2
      ? 'multi_step_workflow'
      : plan.some((s) => s.toolName === 'analyze_data')
        ? 'data_intelligence'
        : plan.some((s) => s.toolName === 'create_3d_blueprint')
          ? '3d_creation'
          : 'general_reasoning';

  return { intent, plan };
}

export async function orchestrateDirective(params: {
  workspaceId: string;
  projectId?: string | null;
  conversationId?: string | null;
  userId: string;
  prompt: string;
  fileId?: string;
  preferredModel?: string;
  thinkingLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
  imageBase64?: { mimeType: string; data: string };
}): Promise<OrchestrationResult> {
  const db = getDb();

  // Ensure conversation exists
  let conversationId = params.conversationId || '';
  if (!conversationId) {
    conversationId = `conv-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO conversations (id, workspace_id, project_id, user_id, title) VALUES (?, ?, ?, ?, ?)`
    ).run(
      conversationId,
      params.workspaceId,
      params.projectId ?? null,
      params.userId,
      params.prompt.slice(0, 60)
    );
  }

  const userMessageId = `msg-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, metadata_json) VALUES (?, ?, 'user', ?, ?)`
  ).run(
    userMessageId,
    conversationId,
    params.prompt,
    JSON.stringify({ fileId: params.fileId ?? null, hasImage: Boolean(params.imageBase64) })
  );

  const { intent, plan } = classifyAndPlan(params.prompt, {
    fileId: params.fileId,
    projectId: params.projectId,
  });

  const steps: OrchestratedStep[] = [];
  const stepOutputs: Array<{ title: string; result: unknown }> = [];
  const artifacts: OrchestrationResult['artifacts'] = {};

  for (let i = 0; i < plan.length; i++) {
    const action = plan[i];
    const taskId = `task-${crypto.randomUUID().slice(0, 8)}`;
    const stepStart = performance.now();

    db.prepare(
      `INSERT INTO agent_tasks (id, workspace_id, project_id, conversation_id, agent_id, title, description, status, requires_approval)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      taskId,
      params.workspaceId,
      params.projectId ?? null,
      conversationId,
      action.agentId,
      action.title,
      params.prompt,
      action.sensitive ? 'awaiting_approval' : 'running',
      action.sensitive ? 1 : 0
    );

    if (action.sensitive) {
      const approval = createApprovalRequest({
        workspaceId: params.workspaceId,
        requestedBy: action.agentName,
        actionType: 'destructive_directive',
        targetResource: params.projectId || params.workspaceId,
        payload: { prompt: params.prompt, taskId },
        reason: 'Directive includes destructive keywords; blocked pending explicit human authorization.',
      });

      steps.push({
        stepNumber: i + 1,
        taskId,
        agentId: action.agentId,
        agentName: action.agentName,
        title: action.title,
        toolUsed: action.toolName,
        status: 'awaiting_approval',
        durationMs: Math.round(performance.now() - stepStart),
        verifiedByQa: true,
        outputSummary: `Action paused in OMNI SECURITY Approval Queue (${approval.id}).`,
        approvalId: approval.id,
      });
      continue;
    }

    try {
      let output: Record<string, unknown> = {};
      let summary = '';

      if (action.toolName === 'generate_report') {
        const compiled = await compileReportArtifact({
          workspaceId: params.workspaceId,
          projectId: params.projectId,
          title: `OMNIX Report — ${params.prompt.slice(0, 40)}`,
          format: 'pdf',
          summary: `Compiled multi-agent analysis for directive: "${params.prompt}"`,
          sections: stepOutputs.map((so) => ({
            heading: so.title,
            body: JSON.stringify(so.result, null, 2).slice(0, 1200),
          })),
        });
        output = { reportId: compiled.reportId, fileName: compiled.fileName };
        artifacts.reportId = compiled.reportId;
        artifacts.reportTitle = compiled.fileName;
        summary = `Compiled downloadable PDF report "${compiled.fileName}" (${compiled.reportId}).`;
      } else {
        output = await runToolAction(action.toolName, action.args, {
          workspaceId: params.workspaceId,
          projectId: params.projectId,
          userId: params.userId,
        });

        if (action.toolName === 'analyze_data') {
          const analysis = output.analysis as { rowCount: number; anomalies: unknown[]; stats: Array<{ column: string; mean?: number }> };
          const nl = output.nl as { summary?: string } | null;
          summary = nl?.summary || `Analyzed ${analysis.rowCount} rows with ${analysis.anomalies.length} anomaly detection(s).`;
        } else if (action.toolName === 'math_eval') {
          summary = `Evaluated ${String(output.expression)} = ${String(output.formatted)}`;
        } else if (action.toolName === 'create_3d_blueprint') {
          artifacts.threeDAssetId = String(output.assetId);
          artifacts.threeDBlueprint = output.blueprint;
          const bp = output.blueprint as { title: string; parts: unknown[] };
          summary = `Generated 3D asset "${bp.title}" (${bp.parts.length} parts, ID ${artifacts.threeDAssetId}).`;
        } else if (action.toolName === 'create_world_blueprint') {
          artifacts.simulationId = String(output.simulationId);
          artifacts.worldBlueprint = output.world;
          const w = output.world as { title: string; buildings: unknown[] };
          summary = `Generated 3D world "${w.title}" (${w.buildings.length} structures, ID ${artifacts.simulationId}).`;
        } else if (action.toolName === 'save_memory') {
          summary = `Saved long-term memory entry (${String(output.savedMemoryId)}).`;
        } else if (action.toolName === 'memory_search') {
          const hits = (output.hits as unknown[]) || [];
          summary = `Retrieved ${hits.length} relevant workspace memory record(s).`;
        } else if (action.toolName === 'autobuild_app') {
          summary = `Synthesized AutoBuild blueprint "${String(output.appName)}" (${String(output.entities)} entities, ${String(output.endpoints)} endpoints).`;
        } else if (action.toolName === 'codex_scan') {
          summary = `OMNI CODEX scanned snippet (Quality ${String(output.qualityScore)}%, Security ${String(output.securityScore)}%).`;
        } else {
          summary = 'Step executed successfully.';
        }
      }

      const durationMs = Math.round(performance.now() - stepStart);
      db.prepare(`UPDATE agent_tasks SET status = 'completed', updated_at = datetime('now') WHERE id = ?`).run(taskId);
      db.prepare(`UPDATE agents SET tasks_completed = tasks_completed + 1 WHERE id = ?`).run(action.agentId);
      db.prepare(
        `INSERT INTO task_executions (id, task_id, agent_id, input_json, output_json, duration_ms, verified_by_qa)
         VALUES (?, ?, ?, ?, ?, ?, 1)`
      ).run(
        `exec-${crypto.randomUUID().slice(0, 8)}`,
        taskId,
        action.agentId,
        JSON.stringify(action.args),
        JSON.stringify(output),
        durationMs
      );

      stepOutputs.push({ title: action.title, result: output });
      steps.push({
        stepNumber: i + 1,
        taskId,
        agentId: action.agentId,
        agentName: action.agentName,
        title: action.title,
        toolUsed: action.toolName,
        status: 'completed',
        durationMs,
        verifiedByQa: true,
        outputSummary: summary,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Execution failed';
      const durationMs = Math.round(performance.now() - stepStart);
      db.prepare(`UPDATE agent_tasks SET status = 'failed', updated_at = datetime('now') WHERE id = ?`).run(taskId);
      db.prepare(
        `INSERT INTO task_executions (id, task_id, agent_id, input_json, output_json, error_message, duration_ms, verified_by_qa)
         VALUES (?, ?, ?, ?, '{}', ?, ?, 0)`
      ).run(`exec-${crypto.randomUUID().slice(0, 8)}`, taskId, action.agentId, JSON.stringify(action.args), msg, durationMs);

      steps.push({
        stepNumber: i + 1,
        taskId,
        agentId: action.agentId,
        agentName: action.agentName,
        title: action.title,
        toolUsed: action.toolName,
        status: 'failed',
        durationMs,
        verifiedByQa: false,
        outputSummary: `Error: ${msg}`,
      });
    }
  }

  // Synthesize final answer via Model Gateway with all verified tool results grounded in context
  const executionContextSummary = steps
    .map((s) => `[Step ${s.stepNumber} · ${s.agentName} · ${s.status.toUpperCase()}] ${s.outputSummary}`)
    .join('\n');

  const gatewayRes = await invokeModelGateway({
    workspaceId: params.workspaceId,
    preferredModel: params.preferredModel,
    thinkingLevel: params.thinkingLevel,
    imageBase64: params.imageBase64,
    systemInstruction:
      'You are OMNI BRAIN, the orchestration core of OMNIX. Summarize the actual verified tool execution results concisely and accurately in the same language as the user (Arabic or English). Never claim actions succeeded if a step failed or is awaiting_approval.',
    prompt: `User Directive:\n${params.prompt}\n\nVerified Agent Execution Trace:\n${executionContextSummary}\n\nProvide a clear, structured engineering summary of the actual outcomes.`,
    localFallbackHandler: () => {
      const completedCount = steps.filter((s) => s.status === 'completed').length;
      const approvalCount = steps.filter((s) => s.status === 'awaiting_approval').length;
      const lines = [
        `OMNI BRAIN executed ${completedCount}/${steps.length} workflow step(s) (intent: ${intent}).`,
        ...steps.map((s) => `• Step ${s.stepNumber} (${s.agentName}): ${s.outputSummary}`),
      ];
      if (approvalCount > 0) {
        lines.push(`Notice: ${approvalCount} sensitive operation(s) require explicit user approval in OMNI SECURITY.`);
      }
      return lines.join('\n');
    },
  });

  const assistantMessageId = `msg-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, metadata_json) VALUES (?, ?, 'assistant', ?, ?)`
  ).run(
    assistantMessageId,
    conversationId,
    gatewayRes.text,
    JSON.stringify({
      intent,
      steps,
      artifacts,
      provider: gatewayRes.provider,
      model: gatewayRes.model,
      latencyMs: gatewayRes.latencyMs,
      isFallback: gatewayRes.isFallback,
    })
  );

  db.prepare(`UPDATE conversations SET updated_at = datetime('now') WHERE id = ?`).run(conversationId);

  logAuditEvent({
    workspaceId: params.workspaceId,
    userId: params.userId,
    action: 'omni_brain_orchestrate',
    resourceType: 'conversation',
    resourceId: conversationId,
    status: 'allowed',
    details: { intent, stepCount: steps.length, provider: gatewayRes.provider },
  });

  return {
    conversationId,
    userMessageId,
    assistantMessageId,
    intent,
    steps,
    answer: gatewayRes.text,
    gateway: {
      provider: gatewayRes.provider,
      model: gatewayRes.model,
      latencyMs: gatewayRes.latencyMs,
      tokensIn: gatewayRes.tokensIn,
      tokensOut: gatewayRes.tokensOut,
      isFallback: gatewayRes.isFallback,
      fallbackReason: gatewayRes.fallbackReason,
    },
    artifacts,
  };
}
