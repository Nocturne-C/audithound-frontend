
export function CodePreviewSkeleton() {
  // Generates 8 lines of code-like skeletons
  return (
    <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
      {[70, 45, 90, 60, 30, 80, 50, 75].map((width, index) => (
        <div key={index} style={{ display: "flex", alignItems: "center", gap: "14px", height: "18px" }}>
          <div 
            className="shimmer-bg" 
            style={{ width: "32px", height: "12px", borderRadius: "3px", opacity: 0.3 }} 
          />
          <div 
            className="shimmer-bg" 
            style={{ width: `${width}%`, height: "12px", borderRadius: "4px" }} 
          />
        </div>
      ))}
    </div>
  );
}

export function FindingsListSkeleton() {
  // Generates 5 rows of findings
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1px", backgroundColor: "var(--separator)" }}>
      {Array.from({ length: 5 }).map((_, index) => (
        <div 
          key={index} 
          style={{ 
            display: "flex", 
            alignItems: "center", 
            gap: "12px", 
            padding: "10px 14px", 
            backgroundColor: "var(--bg)", 
            height: "42px" 
          }}
        >
          <div 
            className="shimmer-bg" 
            style={{ width: "8px", height: "8px", borderRadius: "50%" }} 
          />
          <div 
            className="shimmer-bg" 
            style={{ width: "140px", height: "12px", borderRadius: "3px" }} 
          />
          <div 
            className="shimmer-bg" 
            style={{ width: "24px", height: "12px", borderRadius: "4px", marginLeft: "auto" }} 
          />
        </div>
      ))}
    </div>
  );
}
