import { evaluate, interpolate } from "./engine.js";
import { buildFacts, type Facts } from "./facts.js";
import { RULES } from "./rules.js";
import type { Application, CheckReport, Finding, Rule, RuleState } from "./types.js";

export function evaluateRule(rule: Rule, facts: unknown): "pass" | "fail" | "n/a" {
  if (rule.when && !evaluate(rule.when, facts)) return "n/a";
  return evaluate(rule.pass, facts) ? "pass" : "fail";
}

/** Runs all APPROVED rules against the application. Nothing here is AI: same input, same result. */
export function runChecks(
  app: Pick<Application, "stay" | "documents" | "parents" | "student">,
  states: Record<string, RuleState>,
  now: Date = new Date(),
  rules: Rule[] = RULES,
): CheckReport {
  const facts: Facts = buildFacts(app, now);
  const findings: Finding[] = [];
  const passed: CheckReport["passed"] = [];
  for (const rule of rules) {
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
  const blockers = findings.filter((f) => f.severity === "blocker").length;
  return { ready: blockers === 0, blockers, warnings: findings.length - blockers, findings, passed };
}
