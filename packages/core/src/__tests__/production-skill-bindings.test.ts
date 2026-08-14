import { describe, expect, it } from "vitest";
import {
  NON_LONG_PRODUCTION_CAPABILITIES,
  PRODUCTION_SKILL_IDS,
  mergeActivatedSkillGuidance,
  resolveProductionSkillActivations,
} from "../skills/production-bindings.js";
import type { AgentSkill } from "../skills/types.js";

function skill(id: string): AgentSkill {
  return {
    id,
    name: id,
    description: `${id} description`,
    body: `${id} method`,
    source: "builtin",
  };
}

describe("production skill bindings", () => {
  it("uses distinct professional skills for each production shape", () => {
    expect(PRODUCTION_SKILL_IDS).toMatchObject({
      longWriting: ["inkos-long-writing"],
      shortWriting: ["inkos-short-writing"],
      play: ["inkos-play-world"],
      script: ["inkos-script-writing"],
      storyboard: ["inkos-storyboard"],
      interactiveFilm: ["inkos-interactive-film"],
      translation: ["inkos-translation"],
    });
    for (const capability of NON_LONG_PRODUCTION_CAPABILITIES) {
      expect(PRODUCTION_SKILL_IDS[capability], capability).not.toContain("inkos-long-writing");
      expect(PRODUCTION_SKILL_IDS[capability], capability).not.toContain("inkos-story-review");
    }
  });

  it("resolves host-selected skills and lets project replacements win", () => {
    const builtin = skill("inkos-play-world");
    const replacement = { ...builtin, source: "project" as const, body: "project play method" };
    const resolved = resolveProductionSkillActivations(
      [builtin, replacement, skill("inkos-long-writing")],
      "play",
    );

    expect(resolved).toEqual([{ skill: replacement, resources: [] }]);
  });

  it("merges default and user-requested skills without duplicates", () => {
    const defaultActivation = { skill: skill("inkos-play-world"), resources: [] };
    const userActivation = { skill: skill("detective-evidence"), resources: [] };
    const replacement = {
      skill: { ...defaultActivation.skill, source: "project" as const, body: "replacement" },
      resources: [],
    };

    expect(mergeActivatedSkillGuidance(
      [defaultActivation],
      [userActivation, replacement],
    )).toEqual([replacement, userActivation]);
  });
});
