import { Placeholder } from "@/components/placeholder";

export default function Page() {
  return (
    <Placeholder
      crumbs={["Ashfold", "Audit log"]}
      title="Audit log"
      artboard="AuditLog.dc.html"
    >
      Every privileged action, who took it and what changed.
    </Placeholder>
  );
}
