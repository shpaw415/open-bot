import { describe, expect, test } from "bun:test"
import {
  GLM_REVIEW_MAX_TOKENS,
  glmReviewRequest,
  verdictFromModelResult,
} from "./security"

describe("security review model call", () => {
  test("asks for high reasoning and a json verdict", () => {
    const request = glmReviewRequest("review this plugin")
    expect(request.reasoning_effort).toBe("high")
    expect(request.max_completion_tokens).toBe(GLM_REVIEW_MAX_TOKENS)
    expect(request.max_tokens).toBe(GLM_REVIEW_MAX_TOKENS)
    expect(request).not.toHaveProperty("chat_template_kwargs")
    const format = request.response_format as {
      type: string
      json_schema: { name: string; schema: { required: string[] } }
    }
    expect(format.type).toBe("json_schema")
    expect(format.json_schema.name).toBe("security_verdict")
    expect(format.json_schema.schema.required).toContain("verdict")
  })

  test("reads a verdict from content and ignores reasoning prose", () => {
    const parsed = verdictFromModelResult({
      choices: [
        {
          finish_reason: "length",
          message: {
            content: '{"verdict":"concern","severity":"high","findings":[{"title":"pip install","severity":"medium","detail":"installs a package","path":"setup"}]}',
            reasoning_content: "still thinking about apt-get",
          },
        },
      ],
    })
    expect(parsed.verdict).toBe("concern")
    expect(parsed.exhausted).toBe(false)
    expect(parsed.findings).toHaveLength(1)
  })

  test("does not treat truncated reasoning as a verdict", () => {
    const parsed = verdictFromModelResult({
      choices: [
        {
          finish_reason: "length",
          message: {
            content: "",
            reasoning_content:
              'Let me analyze this plugin. The setup runs {"verdict":"pass"} but I have not finished.',
          },
        },
      ],
    })
    expect(parsed.verdict).toBe("invalid")
    expect(parsed.findings).toEqual([])
    expect(parsed.exhausted).toBe(true)
  })

  test("accepts the legacy response string", () => {
    const parsed = verdictFromModelResult({
      response: '{"verdict":"pass","severity":"low","findings":[]}',
    })
    expect(parsed.verdict).toBe("pass")
    expect(parsed.exhausted).toBe(false)
  })
})
