import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { onboardingTeam } from "@/lib/onboarding-team";
import { handleApi } from "@/lib/api";

export const POST = handleApi(async (req, { userId }) => {
  let goals: string[] = [];
  try {
    const body = await req.json();
    if (Array.isArray(body?.goals)) goals = body.goals;
  } catch {}
  const team = onboardingTeam(goals);
  await Promise.all(team.map((template) =>
    db.agent.upsert({
      where: { ownerId_template: { ownerId: userId, template: template.template } },
      update: {},
      create: {
        ownerId: userId, template: template.template, name: template.name, role: template.role,
        description: template.description, icon: template.icon, category: template.category,
        systemPrompt: template.systemPrompt,
      },
    })
  ));
  return NextResponse.json({ ok: true, activated: team.map(agent => agent.template) });
});
