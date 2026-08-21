import type { AuditIssue, AuditResult } from "../agents/continuity.js";
import type { StateValidationAuthorityContext, ValidationResult, StateValidatorAgent } from "../agents/state-validator.js";
import type { WriteChapterOutput, WriterAgent } from "../agents/writer.js";
import type { BookConfig } from "../models/book.js";
import type { ContextPackage, RuleStack } from "../models/input-governance.js";
import type { Logger } from "../utils/logger.js";
import type { LengthLanguage } from "../utils/length-metrics.js";
import {
  buildStateDegradedPersistenceOutput,
  retrySettlementAfterValidationFailure,
} from "./chapter-state-recovery.js";

export async function validateChapterTruthPersistence(params: {
  readonly writer: Pick<WriterAgent, "settleChapterState">;
  readonly validator: Pick<StateValidatorAgent, "validate">;
  readonly book: BookConfig;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly title: string;
  readonly content: string;
  readonly persistenceOutput: WriteChapterOutput;
  readonly auditResult: AuditResult;
  readonly previousTruth: {
    readonly oldState: string;
    readonly oldHooks: string;
    readonly oldLedger: string;
  };
  readonly authorityContext?: StateValidationAuthorityContext;
  readonly reducedControlInput?: {
    chapterIntent: string;
    contextPackage: ContextPackage;
    ruleStack: RuleStack;
  };
  readonly language: LengthLanguage;
  readonly logWarn: (message: { zh: string; en: string }) => void;
  readonly logger?: Logger;
}): Promise<{
  readonly validation: ValidationResult;
  readonly chapterStatus: "state-degraded" | null;
  readonly degradedIssues: ReadonlyArray<AuditIssue>;
  readonly persistenceOutput: WriteChapterOutput;
  readonly auditResult: AuditResult;
}> {
  let validation: ValidationResult;
  let chapterStatus: "state-degraded" | null = null;
  let degradedIssues: ReadonlyArray<AuditIssue> = [];
  let persistenceOutput = params.persistenceOutput;
  let auditResult = params.auditResult;

  try {
    validation = await params.validator.validate(
      params.content,
      params.chapterNumber,
      params.previousTruth.oldState,
      persistenceOutput.updatedState,
      params.previousTruth.oldHooks,
      persistenceOutput.updatedHooks,
      params.language,
      params.authorityContext,
    );
  } catch (error) {
    params.logger?.warn(`State validation error for chapter ${params.chapterNumber}: ${String(error)}`);
    const errorDescription = params.language === "en"
      ? `State validation unavailable: ${String(error)}`
      : `状态校验不可用：${String(error)}`;
    const errorIssue: AuditIssue = {
      severity: "warning",
      category: "state-validation",
      description: errorDescription,
      suggestion: params.language === "en"
        ? "Repair chapter state from the persisted body before continuing."
        : "请先基于已保存正文修复本章 state，再继续后续章节。",
    };
    return {
      validation: { passed: true, warnings: [] },
      chapterStatus: "state-degraded",
      degradedIssues: [errorIssue],
      persistenceOutput: buildStateDegradedPersistenceOutput({
        output: persistenceOutput,
        oldState: params.previousTruth.oldState,
        oldHooks: params.previousTruth.oldHooks,
        oldLedger: params.previousTruth.oldLedger,
      }),
      auditResult: {
        ...params.auditResult,
        issues: [...params.auditResult.issues, errorIssue],
      },
    };
  }

  if (validation.warnings.length > 0) {
    params.logWarn({
      zh: `状态校验：第${params.chapterNumber}章发现 ${validation.warnings.length} 条警告`,
      en: `State validation: ${validation.warnings.length} warning(s) for chapter ${params.chapterNumber}`,
    });
    for (const warning of validation.warnings) {
      params.logger?.debug(`  [${warning.category}] ${warning.description}`);
    }
  }

  if (!validation.passed && !validation.repairRequired) {
    // Hard FAIL: the proposed truth-file changes contradict the chapter or
    // authority context. Retry once; if it still fails, degrade the chapter.
    const recovery = await retrySettlementAfterValidationFailure({
      writer: params.writer,
      validator: params.validator,
      book: params.book,
      bookDir: params.bookDir,
      chapterNumber: params.chapterNumber,
      title: params.title,
      content: params.content,
      reducedControlInput: params.reducedControlInput,
      oldState: params.previousTruth.oldState,
      oldHooks: params.previousTruth.oldHooks,
      originalValidation: validation,
      language: params.language,
      logWarn: params.logWarn,
      logger: params.logger,
    });

    if (recovery.kind === "recovered") {
      persistenceOutput = recovery.output;
      validation = recovery.validation;
    } else {
      chapterStatus = "state-degraded";
      degradedIssues = recovery.issues;
      persistenceOutput = buildStateDegradedPersistenceOutput({
        output: persistenceOutput,
        oldState: params.previousTruth.oldState,
        oldHooks: params.previousTruth.oldHooks,
        oldLedger: params.previousTruth.oldLedger,
      });
      auditResult = {
        ...auditResult,
        issues: [...auditResult.issues, ...recovery.issues],
      };
    }
  } else if (!validation.passed && validation.repairRequired) {
    // REPAIR: the chapter itself is valid but the truth-file settlement is
    // missing/stale/incomplete. Blocking the whole chapter on that is too
    // strict — it frequently locked chapters into state-degraded for minor
    // state-card omissions, and the degraded chapter then skipped the
    // truth-file write, so the next chapter re-derived stale state and
    // re-triggered the loop. Accept the settlement output and surface the
    // warnings as audit issues; only a hard FAIL degrades.
    auditResult = {
      ...auditResult,
      issues: [
        ...auditResult.issues,
        ...validation.warnings.map((warning) => ({
          severity: "warning" as const,
          category: "state-validation",
          description: warning.description,
          suggestion: params.language === "en"
            ? "The state card may lag the chapter; reconcile when convenient."
            : "状态卡可能滞后于正文，方便时可顺手补充。",
        })),
      ],
    };
  }

  return {
    validation,
    chapterStatus,
    degradedIssues,
    persistenceOutput,
    auditResult,
  };
}
