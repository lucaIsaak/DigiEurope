import { evaluate, interpolate } from "./engine.js";
import { buildFacts, type Facts } from "./facts.js";
import { RULES } from "./rules.js";
import { computeRequirements } from "./requirements.js";
import type { ProcessInput } from "./process.js";
import { BUILTIN_TEMPLATES } from "./templates.js";
import type { Application, CheckReport, DocumentTemplate, Finding, Rule, RuleState } from "./types.js";

export function evaluateRule(rule: Rule, facts: unknown): "pass" | "fail" | "n/a" {
  if (rule.when && !evaluate(rule.when, facts)) return "n/a";
  return evaluate(rule.pass, facts) ? "pass" : "fail";
}

/** Runs all APPROVED rules against the application. Nothing here is AI: same input, same result. */
export function runChecks(
  app: Pick<Application, "stay" | "documents" | "parents" | "student"> & { info?: Record<string, string> },
  states: Record<string, RuleState>,
  now: Date = new Date(),
  rules: Rule[] = RULES,
  opts: { inputs?: ProcessInput[]; templates?: DocumentTemplate[]; /** rules: only the rules. inputs: only the required inputs. all: both (the default). */ scope?: "all" | "rules" | "inputs" } = {},
): CheckReport {
  const facts: Facts = buildFacts(app, now);
  const findings: Finding[] = [];
  const passed: CheckReport["passed"] = [];
  const scope = opts.scope ?? "all";
  for (const rule of scope === "inputs" ? [] : rules) {
    if (states[rule.id]?.status !== "approved") continue;
    const result = evaluateRule(rule, facts);
    if (result === "fail") {
      findings.push({
        ruleId: rule.id,
        severity: rule.severity,
        documentKind: rule.documentKind,
        title: rule.title,
        fix: { de: interpolate(rule.fix.de, facts), en: interpolate(rule.fix.en, facts) },
        source: rule.source,
      });
    } else if (result === "pass") passed.push({ ruleId: rule.id, title: rule.title });
  }
  // Inputs the office requires for this process. A missing one is only reported when no rule already says so for the same document.
  const requirements = opts.inputs ? computeRequirements(opts.inputs, app, opts.templates ?? BUILTIN_TEMPLATES, now) : undefined;
  for (const r of scope === "rules" ? [] : requirements ?? []) {
    if (!r.applies || !r.required || r.state === "ok") continue;
    if (r.type === "document" && findings.some((f) => f.documentKind === r.ref)) continue;
    findings.push(
      r.type === "document"
        ? {
            ruleId: `INPUT:${r.ref}`, severity: "blocker", documentKind: r.ref,
            title: { de: `${r.label.de} fehlt`, en: `${r.label.en} is missing` },
            fix: { de: `Bitte laden Sie „${r.label.de}“ hoch. Ihr Amt verlangt es für diesen Antrag.`, en: `Please upload “${r.label.en}”. Your office requires it for this application.` },
            source: { label: "Anforderungen des Amtes", url: "" },
          }
        : {
            ruleId: `INPUT:${r.ref}`, severity: "blocker",
            title: { de: `Angabe fehlt: ${r.label.de}`, en: `Information missing: ${r.label.en}` },
            fix: { de: `Bitte beantworten Sie: ${r.label.de}`, en: `Please answer: ${r.label.en}` },
            source: { label: "Anforderungen des Amtes", url: "" },
          },
    );
  }
  const blockers = findings.filter((f) => f.severity === "blocker").length;
  return { requirements, ready: blockers === 0, blockers, warnings: findings.length - blockers, findings, passed };
}
