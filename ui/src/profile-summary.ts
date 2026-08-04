const PROFILE_SECTION_HEADINGS = new Set([
  "relationship",
  "communication style",
  "personality signals",
  "preferences & important facts",
  "preferences and important facts",
  "group purpose & relationship",
  "group purpose and relationship",
  "communication norms",
  "participant dynamics",
  "decisions & commitments",
  "decisions and commitments",
  "helpful response guidance",
  "helpful participation guidance",
  "uncertainties",
]);

const OMITTED_PROFILE_SECTIONS = new Set([
  "helpful response guidance",
  "helpful participation guidance",
  "uncertainties",
]);

function normalizedHeading(value: string): string {
  return value.trim().replace(/:$/u, "").toLocaleLowerCase();
}

function finishSentence(value: string): string {
  const clean = value
    .replace(/^(?:facts?|inference|tentative|confirmed knowledge):\s*/iu, "")
    .replace(/([.!?])\1+$/u, "$1")
    .replace(/\s+/gu, " ")
    .trim();
  if (!clean) return "";
  return /[.!?…]$/u.test(clean) ? clean : `${clean}.`;
}

function relationshipOpening(value: string, subjectName: string): string {
  if (!subjectName || value.toLocaleLowerCase().includes(subjectName.toLocaleLowerCase())) return value;
  const clean = value.replace(/\s*\(configured\)\.?/iu, "").trim();
  const [rawRole, ...details] = clean.split(";");
  const role = rawRole?.trim();
  if (!role || role.length > 45 || /[.!?]/u.test(role)) return value;
  const normalizedRole = role.charAt(0).toLocaleLowerCase() + role.slice(1);
  const article = /^(?:a|an|the)\s/iu.test(normalizedRole)
    ? ""
    : /^[aeiou]/iu.test(normalizedRole) ? "an " : "a ";
  const detail = details.join(";").trim();
  const normalizedDetail = detail ? `${detail.charAt(0).toLocaleLowerCase()}${detail.slice(1)}` : "";
  const connector = /^(?:uses?|prefers?|enjoys?|likes?|communicates?|asks?|offers?|values?|coordinates?|appreciates?|mentions?|works?|seeks?|shows?|avoids?|exercises?)\b/iu.test(normalizedDetail)
    ? " who "
    : " with ";
  return `${subjectName} is ${article}${normalizedRole}${normalizedDetail ? `${connector}${normalizedDetail}` : ""}`;
}

export function isLegacyProfileSummary(summary: string): boolean {
  const lines = summary.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  return lines.some((line) => /^[-*•]\s+/u.test(line))
    || lines.some((line) => PROFILE_SECTION_HEADINGS.has(normalizedHeading(line)));
}

export function profileSummaryParagraph(summary: string, subjectName: string): string {
  const cleanSummary = summary.trim();
  if (!cleanSummary || !isLegacyProfileSummary(cleanSummary)) return cleanSummary.replace(/\s+/gu, " ");

  const sentences: string[] = [];
  let section = "";
  let hasRelationshipOpening = false;
  for (const rawLine of cleanSummary.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = normalizedHeading(line);
    if (PROFILE_SECTION_HEADINGS.has(heading)) {
      section = heading;
      continue;
    }
    if (OMITTED_PROFILE_SECTIONS.has(section)) continue;

    let sentence = line
      .replace(/^[-*•]\s*/u, "")
      .replace(/^(?:facts?|inference|tentative|confirmed knowledge):\s*/iu, "")
      .trim();
    if (!sentence) continue;
    if (section === "relationship" && !hasRelationshipOpening) {
      sentence = relationshipOpening(sentence, subjectName);
      hasRelationshipOpening = true;
    }
    const finished = finishSentence(sentence);
    if (finished) sentences.push(finished);
  }
  return sentences.join(" ");
}
