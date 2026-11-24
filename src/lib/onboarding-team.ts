import { AGENT_TEMPLATES } from "./agents";

const GOAL_MAP: Record<string, string[]> = {
  "Improve grades": ["study-coach"],
  "Complete major project": ["project-guide", "code-mentor"],
  "Find internship": ["career-scout"],
  "Prepare for placements": ["career-scout", "interview-coach"],
  "Improve coding": ["code-mentor", "project-guide"],
  "Improve communication": ["writing-buddy"],
};

export const onboardingGoals = Object.keys(GOAL_MAP);

export function onboardingTeam(goals: string[]) {
  let wanted = goals.flatMap((g) => Object.hasOwn(GOAL_MAP, g) ? GOAL_MAP[g] : []);
  if (wanted.length === 0) wanted = ["study-coach", "project-guide", "career-scout"];
  wanted = [...new Set(wanted)].slice(0, 4);
  return AGENT_TEMPLATES.filter(agent => wanted.includes(agent.template));
}
