import { RULES } from '../rules';
import { RULE_CODES, type ActionCandidate, type ActionInputs, type RuleCode, type RuleSetting } from './types';

export interface Evaluation {
  /** Rules that ran; the worker resolves their actions that are no longer in `actions`. */
  ruleCodes: RuleCode[];
  ruleVersions: Record<string, string>;
  actions: ActionCandidate[];
}

/** Runs every enabled rule with its settings over the defaults. Pure. */
export function evaluateRules(inputs: ActionInputs, settings: Partial<Record<RuleCode, RuleSetting>> = {}): Evaluation {
  const ruleCodes: RuleCode[] = [];
  const ruleVersions: Record<string, string> = {};
  const actions: ActionCandidate[] = [];
  for (const code of RULE_CODES) {
    const rule = RULES[code];
    const setting = settings[code];
    // A disabled rule still "runs" with no result, so its open actions resolve.
    ruleCodes.push(code);
    ruleVersions[code] = rule.version;
    if (setting && !setting.enabled) continue;
    actions.push(...rule.evaluate(inputs, { ...rule.defaults, ...(setting?.params ?? {}) }));
  }
  return { ruleCodes, ruleVersions, actions };
}
