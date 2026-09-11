import { defineConfig } from "vocs/config";

// Pinned to vocs 2.9.0 (see SPIKES.md). `full-static` writes a static site to dist/public.
export default defineConfig({
  title: "Signa Covenant",
  description: "Inspect a Signa Covenant facility on Arc Testnet from the command line, and read its recorded evidence.",
  renderStrategy: "full-static",
  sidebar: [
    {
      text: "Start",
      items: [
        { text: "What Covenant does", link: "/" },
        { text: "Run locally", link: "/run-locally" },
        { text: "Quickstart", link: "/quickstart" },
        { text: "For agents", link: "/agents" },
      ],
    },
    {
      text: "Evidence",
      items: [{ text: "Recorded on Arc Testnet", link: "/evidence" }],
    },
  ],
});
