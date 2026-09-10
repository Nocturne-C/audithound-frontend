import React, { useState, useCallback } from "react";
import { BookOpenText, Copy } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ArtifactMeta, ArtifactPayload } from "../types";
import { EmptyBlock, StatusPill } from "./Common";

interface InspectorProps {
  activeArtifact: ArtifactMeta | null;
  activeArtifactPayload: ArtifactPayload | null;
  activeArtifactPath: string | null;
  artifactGroups: Array<{ label: string; items: ArtifactMeta[] }>;
  setActiveArtifactPath: (path: string | null) => void;
  onCopyPath: (path: string) => void;
}

export const Inspector = React.memo(function Inspector({
  activeArtifact,
  activeArtifactPayload,
  activeArtifactPath,
  artifactGroups,
  setActiveArtifactPath,
  onCopyPath,
}: InspectorProps) {
  const [artifactGroupsHeight, setArtifactGroupsHeight] = useState<number>(240);

  const handleHorizontalResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = artifactGroupsHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newHeight = Math.max(100, Math.min(600, startHeight + (moveEvent.clientY - startY)));
      setArtifactGroupsHeight(newHeight);
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [artifactGroupsHeight]);
  return (
    <aside className="inspector">
      <div className="inspector-header">
        <div>
          <div className="eyebrow">Artifact dock</div>
          <h3>{activeArtifact?.label ?? "Artifact preview"}</h3>
        </div>
        {activeArtifactPath && (
          <button
            className="icon-button"
            onClick={() => onCopyPath(activeArtifactPath)}
            type="button"
            title="Copy path"
          >
            <Copy size={15} />
          </button>
        )}
      </div>

      <div className="artifact-groups" style={{ height: `${artifactGroupsHeight}px`, flex: "none" }}>
        {artifactGroups.map((group) => (
          <div
            key={group.label}
            className="artifact-group"
          >
            <div className="artifact-group-title">{group.label}</div>
            <div className="artifact-list">
              {group.items.map((artifact) => (
                <button
                  key={artifact.relativePath}
                  className={`artifact-button ${artifact.relativePath === activeArtifactPath ? "is-active" : ""}`}
                  onClick={() => setActiveArtifactPath(artifact.relativePath)}
                  type="button"
                >
                  <div>
                    <span>{artifact.label}</span>
                    <small style={{ display: "block", marginTop: "2px" }}>
                      {artifact.round ? `Round ${artifact.round}` : artifact.kind}
                    </small>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div
        className="split-handle-horizontal"
        onMouseDown={handleHorizontalResizeStart}
      />

      <div className="artifact-preview">
        {activeArtifact && activeArtifactPayload && (
          <ArtifactViewer artifact={activeArtifact} payload={activeArtifactPayload} />
        )}
        {!activeArtifact && (
          <EmptyBlock
            icon={<BookOpenText size={18} />}
            title="No artifact selected"
            body="Pick a prompt, summary, code map or agent trace to inspect it here."
          />
        )}
      </div>
    </aside>
  );
});

// ArtifactViewer Component
interface ArtifactViewerProps {
  artifact: ArtifactMeta;
  payload: ArtifactPayload;
}

export const ArtifactViewer = React.memo(function ArtifactViewer({
  artifact,
  payload,
}: ArtifactViewerProps) {
  const isMarkdown = artifact.kind === "markdown";
  const isJson = payload.kind === "json";

  return (
    <div className="artifact-viewer">
      <div className="artifact-viewer-head" style={{ marginBottom: "12px" }}>
        <div className="artifact-title-row">
          <StatusPill tone="neutral" label={artifact.kind} />
          <code style={{ fontSize: "11px", wordBreak: "break-all" }}>{artifact.relativePath}</code>
          {"mode" in payload && payload.mode === "tail" && (
            <StatusPill tone="safe" label={`tail ${payload.tailLines ?? ""}`.trim()} />
          )}
        </div>
      </div>

      {isMarkdown && payload.kind === "text" && (
        <div className="markdown-surface">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{payload.data}</ReactMarkdown>
        </div>
      )}

      {!isMarkdown && isJson && (
        <pre className="code-surface">{JSON.stringify(payload.data, null, 2)}</pre>
      )}

      {!isMarkdown && !isJson && typeof payload.data === "string" && (
        <pre className="code-surface">{payload.data}</pre>
      )}
    </div>
  );
});
