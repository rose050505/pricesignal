/** Narrow checks for an explicit, unsupported use of the cost policy in prose. */
export function costPolicyErrors(text: string, hasCostScenario: boolean): string[] {
  const errors: string[] = [];
  const policy = /\b(?:pass[ -]?(?:through|thru)|(?:cost\s+)?recovery\s+policy)\b/i;
  const benchmark = /\b(?:benchmark|market\s+(?:range|band)|CPI|inflation)\b/i;
  for (const sentence of text.split(/(?<=[.!?;])\s+/)) {
    if (!policy.test(sentence)) continue;
    // Negation must describe the scaling/application, rather than excuse a different claim.
    const affirmative = sentence
      .replace(/\b(?:is|was|are|were)\s+not\s+(?:scaled|adjusted|multiplied|calculated|derived|reduced|discounted|applied)\b[^,;.!?]*/gi, '')
      .replace(/\b(?:does|do|did)\s+not\s+(?:scale|adjust|multiply|change|reduce|apply)\b[^,;.!?]*/gi, '')
      .replace(/\b(?:never|without)\s+(?:apply|applying|scale|scaling|adjust|adjusting|multiply|multiplying)\b[^,;.!?]*/gi, '');
    if (!policy.test(affirmative) || !benchmark.test(affirmative)) continue;
    const appliesToBenchmark = /\b(?:apply|applying|applied)\b.{0,100}\b(?:pass[ -]?(?:through|thru)|recovery\s+policy)\b.{0,30}\bto\s+(?:the\s+)?(?:(?:historical|market|food|CPI)\s+)*(?:benchmark|range|band|CPI|inflation)\b/i.test(affirmative);
    const benchmarkScaled = /\b(?:benchmark|market\s+(?:range|band)|CPI|inflation)\b.{0,75}\b(?:is|was|are|were|has\s+been|have\s+been)\s+(?:\w+\s+)?(?:scaled|adjusted|multiplied|calculated|derived|reduced|discounted)\b.{0,100}\b(?:pass[ -]?(?:through|thru)|recovery\s+policy)\b/i.test(affirmative);
    if (appliesToBenchmark || benchmarkScaled) {
      errors.push('cost policy cannot scale or determine the historical market benchmark');
      continue;
    }
    const application = /\b(?:pass[ -]?(?:through|thru)|recovery\s+policy)\b\s+(?:(?:has\s+been|is|was|already)\s+)?applied\b/i.test(affirmative);
    if (!hasCostScenario && application && !/\b(?:before|until|once|if|would|could)\b/i.test(affirmative)) {
      errors.push('cost pass-through application is unavailable without a valid cost-recovery scenario');
    }
  }
  return errors;
}
