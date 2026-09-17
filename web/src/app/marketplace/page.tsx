import { Unavailable } from "@/components/placeholder";

export default function Page() {
  return (
    <Unavailable crumbs={["Marketplace"]} title="Marketplace" instead={{ label: "Games", href: "/games" }}>
      There is no plugin or mod catalogue behind Geeboard yet, so there is nothing to browse. The
      games Geeboard can host, and their versions, are in the game catalogue.
    </Unavailable>
  );
}
