import { defineConfig } from "vocs/config";

// Pinned to vocs 2.9.0 (see SPIKES.md). `full-static` writes a static site to dist/public.
export default defineConfig({
  title: "Signa Covenant",
  description: "Inspect a Signa Covenant facility on Arc Testnet from the command line, and read its recorded evidence.",
  renderStrategy: "full-static",
  // Sampled from the logo: its bar is #3fb55d on a #10100e ground. The light scheme keeps
  // the darker partner so link text stays legible on white. Served from apps/docs/public.
  iconUrl: "/favicon.png",
  logoUrl: { light: "/mark-on-light.svg", dark: "/mark-on-dark.svg" },
  accentColor: "light-dark(#0e6029, #3fb55d)",
  sidebar: [
    {
      text: "Start",
      items: [
        { text: "What Covenant does", link: "/" },
        { text: "Architecture", link: "/architecture" },
        { text: "Install", link: "/install" },
        { text: "Run locally", link: "/run-locally" },
        { text: "Quickstart", link: "/quickstart" },
        { text: "For agents", link: "/agents" },
      ],
    },
    {
      text: "Guides",
      items: [
        { text: "Inspect a facility", link: "/guides/inspect-a-facility" },
        { text: "Explain a refused draw", link: "/guides/explain-a-refused-draw" },
        { text: "Submit a credential", link: "/guides/submit-a-credential" },
        { text: "Send and reconcile an operation", link: "/guides/send-and-reconcile" },
      ],
    },
    {
      text: "Reference",
      items: [
        { text: "Commands", link: "/reference/commands" },
        { text: "Error codes", link: "/reference/errors" },
        { text: "Credential envelope", link: "/reference/envelope" },
        { text: "Deployment", link: "/reference/deployment" },
      ],
    },
    {
      text: "Evidence",
      items: [{ text: "Recorded on Arc Testnet", link: "/evidence" }],
    },
  ],
});
