import { type WorkflowCatalogItem, type WorkflowDefinition, type WorkflowValidationResult, type WorkflowVersionSummary } from "../shared/workflow";
export declare function listWorkflows(): Promise<WorkflowCatalogItem[]>;
export declare function getWorkflow(workflowId: string): Promise<WorkflowDefinition | null>;
export declare function saveWorkflow(workflowId: string, input: unknown): Promise<WorkflowDefinition>;
export declare function cloneWorkflow(workflowId: string): Promise<WorkflowDefinition>;
export declare function deleteWorkflow(workflowId: string): Promise<void>;
export declare function listWorkflowVersions(workflowId: string): Promise<WorkflowVersionSummary[]>;
export declare function restoreWorkflowVersion(workflowId: string, version: number): Promise<WorkflowDefinition>;
export declare function validateWorkflow(input: unknown): WorkflowValidationResult;
