import { Rpc } from "@opencode/schema/rpc"

const goal = { anyOf: [{ type: "object" }, { type: "null" }] } as const

export const GoalRpc = Rpc.define({
  id: "goal",
  methods: {
    get: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { goal },
        required: ["goal"],
        additionalProperties: false,
      },
    },
  },
  events: {
    changed: {
      schema: {
        type: "object",
        properties: { sessionID: { type: "string" }, goal },
        required: ["sessionID", "goal"],
        additionalProperties: false,
      },
    },
  },
})
