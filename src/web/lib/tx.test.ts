import { describe, expect, it } from "vitest"
import { ArkivQuotaError } from "../../core/arkiv"
import { friendlyError } from "./tx"

const chain = (...messages: string[]) =>
  messages.reduceRight<Error | undefined>((cause, message) => new Error(message, cause ? { cause } : undefined), undefined)

describe("friendlyError", () => {
  it("names the unfunded wallet even though the SDK only says 'execution error without revert data'", () => {
    const e = chain("Transaction failed: Execution error without revert data", "Estimate gas failed", "out of gas: gas required exceeds: 0")
    expect(friendlyError(e)).toMatch(/no test GLM/)
  })

  it("uses the sentence the SDK decodes from an engine revert", () => {
    const e = chain(
      "Transaction failed: entity 0x4fe8…d037 already expires at block 604296, so extending it to 604295 would shorten its life",
      'The contract function "execute" reverted.',
    )
    expect(friendlyError(e)).toBe("entity 0x4fe8…d037 already expires at block 604296, so extending it to 604295 would shorten its life")
  })

  it("explains a network failure in plain words", () => {
    expect(friendlyError(chain("HTTP request failed.", "fetch failed"))).toMatch(/Can’t reach Arkiv/)
  })

  it("passes the app's own validation messages through", () => {
    expect(friendlyError(new Error("Remove phone numbers: personal data must not be written to Arkiv"))).toMatch(/phone/)
    expect(friendlyError(new RangeError("qty must be at most 10000000, got 20000000"))).toMatch(/at most/)
  })

  it("explains the public endpoint's query budget even when viem wraps it as an HTTP failure", () => {
    const wrapped = new Error("HTTP request failed.", { cause: new ArkivQuotaError(2046, "ANON_COST_LIMITED") })
    expect(friendlyError(wrapped)).toMatch(/paused queries from this client for about 34 min \(ANON_COST_LIMITED\)/)
  })
})
