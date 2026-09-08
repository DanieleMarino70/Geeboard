import { Placeholder } from "@/components/placeholder";

export default function Page() {
  return (
    <Placeholder
      crumbs={["Ashfold", "Scheduler"]}
      title="Scheduler"
      artboard="Scheduler.dc.html"
    >
      Cron-backed tasks with a real preview of when each will next fire.
    </Placeholder>
  );
}
