import { Unavailable } from "@/components/placeholder";

export default function Page() {
  return (
    <Unavailable crumbs={["Plugins"]} title="Plugins and mods" instead={{ label: "Files", href: "/files" }}>
      Geeboard does not install or track plugins and mods yet — no game definition describes them,
      and nothing checks them against a server&apos;s version. A server&apos;s plugin folder can be
      managed by hand through its files in the meantime.
    </Unavailable>
  );
}
