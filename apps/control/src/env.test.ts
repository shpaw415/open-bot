import { expect, test } from "bun:test"
import { names } from "./env"

test("names the persistent desktop volumes", () => {
  const named = names("user@example.com")
  expect(named.home).toBe("ob-home-userexamplecom")
  expect(named.usrLocal).toBe("ob-local-userexamplecom")
})
