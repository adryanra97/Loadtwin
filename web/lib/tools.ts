/** Every simulation method, described the same way wherever it is offered. */
export type ToolId = "evaluate" | "autosize" | "patterns" | "failures" | "sensitivity" | "validate" | "ask";

export type Tool = {
  id: ToolId;
  href: string;
  name: string;
  group: "Decide" | "Plan" | "Stress" | "Trust" | "Ask";
  question: string;
  gives: string;
};

export const TOOLS: Record<ToolId, Tool> = {
  evaluate: {
    id: "evaluate",
    href: "/evaluate/",
    name: "Evaluate",
    group: "Decide",
    question: "Does the target setup hold at peak?",
    gives: "Verdict, limiting resource, capacity, breach probability",
  },
  autosize: {
    id: "autosize",
    href: "/autosize/",
    name: "Auto-size",
    group: "Plan",
    question: "What is the cheapest cluster that passes?",
    gives: "Nodes per machine type and monthly cost",
  },
  patterns: {
    id: "patterns",
    href: "/patterns/",
    name: "Load patterns",
    group: "Stress",
    question: "Does it survive a spike, a ramp or a full day?",
    gives: "Time over the SLA and recovery time",
  },
  failures: {
    id: "failures",
    href: "/failures/",
    name: "Failure testing",
    group: "Stress",
    question: "What if a node dies or the database slows down?",
    gives: "Before, during and after, against a healthy run",
  },
  sensitivity: {
    id: "sensitivity",
    href: "/sensitivity/",
    name: "Sensitivity",
    group: "Trust",
    question: "Which setting moves latency the most?",
    gives: "A ranking of inputs and what to change first",
  },
  validate: {
    id: "validate",
    href: "/validate/",
    name: "Validate model",
    group: "Trust",
    question: "How far can I trust the model?",
    gives: "Predicted against measured, from k6, JMeter or Locust",
  },
  ask: {
    id: "ask",
    href: "/ask/",
    name: "Ask LoadTwin",
    group: "Ask",
    question: "“What if traffic doubles on payday?”",
    gives: "A scenario built from your words, simulated and explained",
  },
};

export const MORE_TOOLS: ToolId[] = ["autosize", "patterns", "failures", "sensitivity", "validate", "ask"];

/** What to try after a result, depending on how it went. */
export function nextTools(current: ToolId, verdict?: string): { id: ToolId; why: string }[] {
  const failing = verdict === "FAIL" || verdict === "NOT_ASSESSABLE";
  const shaky = verdict === "PASS_WITH_CONDITIONS";
  const all: { id: ToolId; why: string }[] = failing
    ? [
        { id: "autosize", why: "Find the cheapest setup that does pass." },
        { id: "sensitivity", why: "See which setting would fix it fastest." },
        { id: "validate", why: "Check the model against more of your load-test data." },
        { id: "ask", why: "Try a what-if in plain words." },
      ]
    : shaky
      ? [
          { id: "sensitivity", why: "Find the lever that buys back headroom." },
          { id: "autosize", why: "Price a setup with comfortable headroom." },
          { id: "patterns", why: "See whether a sudden spike tips it over." },
          { id: "failures", why: "Check what happens when a node dies." },
        ]
      : [
          { id: "failures", why: "It passes healthy. Does it survive losing a node?" },
          { id: "patterns", why: "Steady load is easy. Try a spike or a full day." },
          { id: "autosize", why: "It may be oversized. See what is cheaper." },
          { id: "ask", why: "Ask a what-if, like traffic doubling on payday." },
        ];
  return all.filter((t) => t.id !== current).slice(0, 3);
}
