import defaultWorkflow from "./default_workflow.json";
import focusedWorkflow from "./focused_workflow.json";
export const WORKFLOW_NODE_KINDS = [
    "scope",
    "map",
    "investigate",
    "focus",
    "normalize",
    "review",
    "regression",
    "report",
];
export const DEFAULT_WORKFLOW_ID = "general-convergence";
export const DEFAULT_WORKFLOW = defaultWorkflow;
export const FOCUSED_WORKFLOW = focusedWorkflow;
export const BUILT_IN_WORKFLOWS = [DEFAULT_WORKFLOW, FOCUSED_WORKFLOW];
export const BUILT_IN_WORKFLOW_IDS = new Set(BUILT_IN_WORKFLOWS.map((workflow) => workflow.id));
