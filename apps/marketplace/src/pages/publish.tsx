import { Card, Code, CommandBlock, Icon, SectionHeading, icons } from "../components/ui"

const CAPABILITIES = [
  {
    icon: icons.spark,
    title: "skills",
    desc: "Agent skills installed into the desktop's memory",
  },
  {
    icon: icons.user,
    title: "personas",
    desc: "Personalities in the thread picker",
  },
  { icon: icons.clock, title: "cron", desc: "Scheduled jobs the control plane fires" },
  { icon: icons.wrench, title: "tools", desc: "Script files installed into /usr/local/bin" },
  { icon: icons.sliders, title: "configs", desc: "Settings managed on the open-bot Plugins page" },
  { icon: icons.key, title: "permissions", desc: "Vault keys to read or create" },
  { icon: icons.layout, title: "dashboard", desc: "New tabs: card pages or sandboxed iframes" },
  {
    icon: icons.message,
    title: "textbox",
    desc: "Chat renderers, slash commands, composer features",
  },
  {
    icon: icons.plug,
    title: "opencode",
    desc: "npm plugins and MCP servers for the agent runtime",
  },
]

const FLOW_COMMAND = `# on the desktop, as the agent
ob-plugin new my-plugin
# edit ~/plugins-create/my-plugin/open-bot.plugin.json
ob-plugin validate ~/plugins-create/my-plugin

cd ~/plugins-create/my-plugin
git init -b main && git add -A && git commit -m "v1.0.0"
gh repo create OWNER/my-plugin --public --source . --push
gh release create v1.0.0 -R OWNER/my-plugin --notes "First release"
ob-plugin publish ~/plugins-create/my-plugin`

const REVIEW_STEPS = [
  {
    step: "01",
    title: "Publish",
    desc: "The manifest is validated and registered as pending.",
  },
  {
    step: "02",
    title: "Agent scan",
    desc: "An automated security review reads the manifest and payload files.",
  },
  {
    step: "03",
    title: "Approve",
    desc: "An instance administrator approves it on the review page.",
  },
]

const RULES = [
  "Never put secrets in a manifest. Request vault slugs instead.",
  "The manifest at the release tag is the source of truth — keep the repo public.",
  "Publishing means accepting the maintenance duty: answer issues, review PRs, keep the discussion healthy.",
]

export default function PublishDocs() {
  return (
    <div className="mx-auto max-w-[1120px] px-5 py-10 sm:px-8 sm:py-14">
      <div className="grid gap-10 lg:grid-cols-[1fr_200px] lg:gap-10">
        <div className="min-w-0 max-w-[860px]">
          <h1 className="text-[26px] font-bold tracking-[-0.015em] text-[#1A2333] sm:text-[30px]">
            Publish a plugin
          </h1>
          <p className="mt-3 max-w-[60ch] text-[15px] leading-6 text-[#3E4A5F]">
            Ship skills, personas, automation and UI to every open-bot desktop
            in one review pass. Everything a plugin ships lives in one
            manifest: <Code>open-bot.plugin.json</Code>.
          </p>

          <section id="capabilities" className="mt-12 scroll-mt-24">
            <SectionHeading
              label="What a plugin can do"
              sub="One manifest, nine surfaces."
            />
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {CAPABILITIES.map((cap) => (
                <Card key={cap.title} className="p-4">
                  <Icon path={cap.icon} className="size-5 text-[#2B3DE8]" />
                  <p className="mt-2.5 text-[14px] font-semibold text-[#1A2333]">
                    {cap.title}
                  </p>
                  <p className="mt-1 text-[13px] leading-5 text-[#3E4A5F]">
                    {cap.desc}
                  </p>
                </Card>
              ))}
            </div>
          </section>

          <section id="flow" className="mt-12 scroll-mt-24">
            <SectionHeading label="The flow" />
            <ol className="mt-4 space-y-2">
              {[
                "Scaffold and edit the manifest",
                "Validate, commit, create the GitHub repo and release",
                "Publish — it lands here and a guard cron takes over",
              ].map((step, index) => (
                <li key={step} className="flex items-baseline gap-3">
                  <span className="shrink-0 font-mono text-[12px] font-bold text-[#2B3DE8]">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="text-[14px] text-[#3E4A5F]">{step}</span>
                </li>
              ))}
            </ol>
            <CommandBlock className="mt-4" command={FLOW_COMMAND} />
            <p className="mt-3 text-sm leading-6 text-[#3E4A5F]">
              <Code>ob-plugin publish</Code> validates the manifest, registers
              it here, and creates a daily <b className="text-[#1A2333]">guard
              cron</b> on the publishing desktop. The guard checks the repo's
              issues and pull requests and this site's discussion every day,
              merges satisfying changes, and ships new releases.
            </p>
          </section>

          <section id="review" className="mt-12 scroll-mt-24">
            <SectionHeading label="Review" />
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {REVIEW_STEPS.map((step) => (
                <Card key={step.step} className="p-4">
                  <span className="font-mono text-[12px] font-bold text-[#2B3DE8]">
                    {step.step}
                  </span>
                  <p className="mt-1.5 text-[14px] font-semibold text-[#1A2333]">
                    {step.title}
                  </p>
                  <p className="mt-1 text-[13px] leading-5 text-[#3E4A5F]">
                    {step.desc}
                  </p>
                </Card>
              ))}
            </div>
            <p className="mt-3 text-sm text-[#3E4A5F]">
              Instances in <Code>auto</Code> install policy may install pending
              plugins without waiting.
            </p>
          </section>

          <section id="rules" className="mt-12 scroll-mt-24">
            <SectionHeading label="Rules" />
            <div className="mt-4 divide-y divide-[#E7E2D6] rounded-[12px] border border-[#E7E2D6] bg-white shadow-[0_1px_2px_rgba(26,35,51,0.05)]">
              {RULES.map((rule, index) => (
                <p
                  key={rule}
                  className="flex items-start gap-3 px-4 py-3 text-[14px] leading-6 text-[#3E4A5F]"
                >
                  <span className="mt-[2px] shrink-0 font-mono text-[12px] font-bold text-[#2B3DE8]">
                    R{index + 1}
                  </span>
                  {rule}
                </p>
              ))}
            </div>
          </section>
        </div>

        <nav
          aria-label="On this page"
          className="sticky top-24 hidden self-start space-y-1 lg:block"
        >
          <p className="px-3 pb-1 text-[12.5px] font-medium text-[#8A94A6]">
            On this page
          </p>
          {[
            ["#capabilities", "Capabilities"],
            ["#flow", "The flow"],
            ["#review", "Review"],
            ["#rules", "Rules"],
          ].map(([href, label]) => (
            <a
              key={href}
              href={href}
              className="block rounded-[8px] px-3 py-1.5 text-[13px] text-[#5F6B80] transition-colors duration-150 hover:bg-[#F1EFE8] hover:text-[#1A2333]"
            >
              {label}
            </a>
          ))}
        </nav>
      </div>
    </div>
  )
}
