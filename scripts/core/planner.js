// scripts/core/planner.js
// 生产计划（反馈②：把 Planner 提升为一等公民）
//
// 此前编排逻辑散在 agent-bridge.mjs 的 cmdRun/cmdRunPage 内联调用中。
// 现抽象为：
//   - PRODUCTION_PLAN：有序步骤 + 工具 + 产物 + 约束（needsReview 等）
//   - runProductionPlan：确定性执行器，驱动 SCRIPT→VOICEOVER→SEMANTIC→RENDER，
//     每步产物落盘为不可变 artifact（反馈⑦），needs_review 时交还 AI 交接包。

import { callTool } from "./client.js";
import { patchState, persistArtifact, readState } from "./state.js";
import {
  PROJECT_STATUS,
  buildProductionPlan,
} from "../../src/lib/pipelineContract.js";
import { buildProject, buildScriptText } from "./project.js";
import { applyDecisionsToMessages } from "./decisions.js";

// 计划定义从单一工作流契约派生（pipelineContract.WORKFLOW_STEPS），
// 保证与 STEP_ORDER 永远一致，杜绝 TIMELINE 被漏掉这类漂移。
export const PRODUCTION_PLAN = buildProductionPlan();

// 运行生产计划（人机协同）。输入已解析好的素材。
// 每步进入 RUNNING；失败则把当前步标记为 FAILED 并记录 error（反馈⑧：生产级状态机）。
// 返回：
//   { done:true, output }  |  { skipped:true }  |  { needsReview:true, handoff }
export async function runProductionPlan({
  statePath,
  projectId = "default",
  audioPath,
  scriptText,
  messages = [],
  decisions = [],
  members = [],
  platform = "wechat",
  mode = "single",
  groupName = "",
  out,
  skipRender = false,
  allowApproximate = false,
}) {
  if (!audioPath) throw new Error("runProductionPlan 需要 audioPath");
  if (!scriptText) throw new Error("runProductionPlan 需要 scriptText");

  let activeStep = "SCRIPT";
  try {
    const saved = readState(statePath);
    const canResume =
      saved?.project_id === projectId &&
      saved?.script_text === scriptText &&
      saved?.audio_path === audioPath &&
      Array.isArray(saved?.script_messages) &&
      saved?.align_result?.mapping;
    let parse;
    let msgs;

    if (canResume) {
      parse = { messages: saved.script_messages };
      msgs = saved.script_messages;
      // 关键修复（7.2 残余）：resume 路径同样合并 AI 语义决策，
      // 否则贴纸/动效在复用旧对齐结果时整体丢失。
      if (decisions && decisions.length)
        msgs = applyDecisionsToMessages(msgs, decisions);
      parse.messages = msgs;
    }

    // 1) SCRIPT：解析脚本
    if (!canResume) {
      activeStep = "SCRIPT";
      patchState(statePath, {
        current_step: "SCRIPT",
        status: PROJECT_STATUS.RUNNING,
        project_id: projectId,
        platform,
        mode,
      });
      parse = await callTool("parseScript", { scriptText, platform, mode });
      msgs = parse.messages || [];
      // 关键修复：把语义决策（sticker/effect）合并进解析结果，否则贴纸与动效会在重解析时被丢弃
      if (decisions && decisions.length)
        msgs = applyDecisionsToMessages(msgs, decisions);
      parse.messages = msgs;
      patchState(statePath, {
        current_step: "SCRIPT",
        status: PROJECT_STATUS.SUCCEEDED,
        script_messages: msgs,
        script_text: scriptText,
        project_id: projectId,
        platform,
        mode,
      });
      await persistArtifact(statePath, projectId, "SCRIPT", {
        messages: msgs,
        script_text: scriptText,
        platform,
        mode,
      });
    }

    // 2) VOICEOVER：ASR + 节拍网格 + DP 对齐
    activeStep = "VOICEOVER";
    let align = canResume ? saved.align_result : null;
    if (!align) {
      patchState(statePath, {
        current_step: "VOICEOVER",
        status: PROJECT_STATUS.RUNNING,
      });
      // 轻量自动恢复（反馈⑨）：对齐属外部依赖（ASR/Python），瞬时故障可重试一次，环境类故障不重试。
      let attempt = 0;
      const MAX_ATTEMPTS = 2;
      while (true) {
        try {
          align = await callTool("alignDP", {
            audioPath,
            scriptText,
            model: "small",
            hopLength: 512,
          });
          break;
        } catch (e) {
          attempt++;
          const kind = classifyError(e);
          if (kind === "transient" && attempt < MAX_ATTEMPTS) {
            log(`alignDP 瞬时失败(${kind})，第 ${attempt} 次重试...`);
            patchState(statePath, {
              current_step: "VOICEOVER",
              status: PROJECT_STATUS.RUNNING,
              recover_attempt: attempt,
            });
            continue;
          }
          throw e;
        }
      }
    }
    patchState(statePath, {
      current_step: "VOICEOVER",
      status: PROJECT_STATUS.SUCCEEDED,
      alignment_mode: align.alignment_mode,
      asr_quality_score: align.asr_quality_score,
      mapping_meta: align.mapping_meta,
      beat_grid_len: (align.beat_grid || []).length,
      // TIMELINE 由 alignDP 的 mapping 派生：此处仅标记「产物已生成」，不等同于「用户已确认」。
      timeline_status: PROJECT_STATUS.GENERATED,
      timeline_confirmed: false,
    });
    await persistArtifact(statePath, projectId, "VOICEOVER", align);

    // 3) 需要 AI 语义干预？
    if (align.mapping_meta?.needs_review && !allowApproximate) {
      const handoff = await callTool("aiReview", {
        scriptText,
        beatGrid: align.beat_grid,
        rawSegments: align.asr_segments || [],
        mapping: align.mapping,
        asrStatus: align.asr_status,
        asrError: align.asr_error,
      });
      patchState(statePath, {
        current_step: "SEMANTIC",
        status: PROJECT_STATUS.WAITING_AGENT,
        needs_review: true,
        ai_handoff: handoff,
        align_result: align,
        script_text: scriptText,
        project_id: projectId,
        platform,
        mode,
        audio_path: audioPath,
      });
      return {
        needsReview: true,
        handoff: { align_result: align, handoff },
        statePath,
      };
    }

    if (align.mapping_meta?.needs_review && allowApproximate) {
      patchState(statePath, {
        quality_gate: "bypassed",
        delivery_mode: "approximate_preview",
        preview_warning: "该视频使用近似时间轴，未通过 ASR/对齐质量复核。",
      });
    }

    // 4) 跳过渲染（仅对齐）
    if (skipRender) {
      patchState(statePath, {
        current_step: "TIMELINE",
        timeline_status: PROJECT_STATUS.GENERATED,
        timeline_confirmed: false,
        align_result: align,
      });
      return { skipped: true, statePath };
    }

    // 5) RENDER：合成成片
    activeStep = "RENDER";
    patchState(statePath, {
      current_step: "RENDER",
      status: PROJECT_STATUS.RUNNING,
    });
    const project = buildProject({
      parse: { messages: msgs },
      align,
      opts: {
        platform,
        mode,
        audio: audioPath,
        script: scriptText,
        members,
        groupName,
      },
    });
    const r = await callTool("render", { project, audioPath, outputPath: out });
    if (!r.success) throw new Error("render 失败: " + JSON.stringify(r));
    patchState(statePath, {
      current_step: "RENDER",
      status: PROJECT_STATUS.SUCCEEDED,
      output: out,
    });
    await persistArtifact(statePath, projectId, "RENDER", {
      output: out,
      frameCount: r.frameCount,
      duration: r.duration,
    });

    return {
      done: true,
      output: out,
      statePath,
      preview: !!(align.mapping_meta?.needs_review && allowApproximate),
    };
  } catch (e) {
    // 生产级失败状态：标记当前步 FAILED，记录错误，后续步骤保持 PENDING（可由用户重跑）
    patchState(statePath, {
      current_step: activeStep,
      status: PROJECT_STATUS.FAILED,
      error: e.message,
      error_at: new Date().toISOString(),
    });
    throw e;
  }
}

// 取消当前生产计划（反馈⑧：CANCELLED 流转）
export function cancelProductionPlan(statePath, step = null) {
  patchState(statePath, {
    current_step: step || "RENDER",
    status: PROJECT_STATUS.CANCELLED,
    cancelled_at: new Date().toISOString(),
  });
  return true;
}

// 错误分类（反馈⑨：自动恢复依据）。仅 'transient' 可重试；'env' 为环境缺失（不重试）；其余 'unknown'。
export function classifyError(e) {
  const msg = (e && e.message) || String(e);
  if (
    /timeout|timed out|ECONN|ETIMEDOUT|503|502|busy|rate.?limit|temporary/i.test(
      msg,
    )
  )
    return "transient";
  if (
    /python|ffmpeg|not found|ENOENT|no such file|missing|dependency|module not found|could not find/i.test(
      msg,
    )
  )
    return "env";
  return "unknown";
}

// 把 messages 还原成脚本文本（供 run-page 缺少 scriptText 时复用）
export { buildScriptText };
