import { describe, expect, test } from "bun:test"
import { filterSkills, type SkillSummary } from "./CustomSkills"

const skills: SkillSummary[] = [
  { name: "mémo-vocal", description: "Dicter et transcrire des notes" },
  {
    name: "web-research",
    description: "Deep web research with sources",
    group: "Research",
  },
  {
    name: "stock-watch",
    description: "Watch a portfolio",
    plugin: { id: "stock", name: "Stock Dashboard" },
  },
]

const names = (list: SkillSummary[]) => list.map((skill) => skill.name)

describe("filterSkills — the skills search field", () => {
  test("an empty or blank query keeps every skill, in order", () => {
    expect(names(filterSkills(skills, ""))).toEqual([
      "mémo-vocal",
      "web-research",
      "stock-watch",
    ])
    expect(names(filterSkills(skills, "  "))).toEqual([
      "mémo-vocal",
      "web-research",
      "stock-watch",
    ])
  })

  test("matches name and description, accents and case ignored", () => {
    expect(names(filterSkills(skills, "memo"))).toEqual(["mémo-vocal"])
    expect(names(filterSkills(skills, "SOURCES"))).toEqual(["web-research"])
  })

  test("matches the group label and the plugin name", () => {
    expect(names(filterSkills(skills, "research"))).toEqual(["web-research"])
    expect(names(filterSkills(skills, "dashboard"))).toEqual(["stock-watch"])
  })

  test("no match gives an empty list", () => {
    expect(filterSkills(skills, "introuvable")).toEqual([])
  })
})
