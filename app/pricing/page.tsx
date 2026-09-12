import Link from "next/link";

export const metadata = {
  title: "Pricing",
  description: "Parity pricing — free audits, bring your own key, or team plans.",
};

const TIERS = [
  {
    name: "Free",
    price: "$0",
    cadence: "forever",
    tagline: "See whether you have a problem.",
    features: [
      "5 pages crawled",
      "8 customer questions",
      "One model, memory and search",
      "Full evidence on every finding",
      "3 scans an hour",
    ],
    cta: "Audit my site",
    href: "/",
    emphasis: false,
  },
  {
    name: "Bring your own key",
    price: "$0",
    cadence: "you pay your provider",
    tagline: "Audit the models your customers actually use.",
    features: [
      "25 pages crawled",
      "40 customer questions",
      "Claude, GPT, Gemini or Groq",
      "Generated llms.txt, JSON-LD and copy patches",
      "Your key is never stored",
    ],
    cta: "Use my own key",
    href: "/?byok=1",
    emphasis: true,
  },
  {
    name: "Team",
    price: "$149",
    cadence: "per month",
    tagline: "Keep it true as the site changes.",
    features: [
      "Everything in BYOK",
      "Weekly re-scans and drift alerts",
      "Score history per page",
      "Shared workspace",
      "Priority support",
    ],
    cta: "Talk to us",
    href: "mailto:hello@example.com",
    emphasis: false,
  },
] as const;

export default function PricingPage() {
  return (
    <main className="min-h-screen">
      <nav className="border-border/60 border-b">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="font-mono text-sm font-medium tracking-tight">
            parity
          </Link>
          <div className="text-muted-foreground flex items-center gap-5 text-sm">
            <Link href="/demo" className="hover:text-foreground transition-colors">
              Demo
            </Link>
            <Link href="/study" className="hover:text-foreground transition-colors">
              Study
            </Link>
          </div>
        </div>
      </nav>

      <section className="mx-auto w-full max-w-5xl px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Pricing</h1>
        <p className="text-muted-foreground mt-3 max-w-xl text-pretty">
          The free tier is a real audit, not a teaser. It runs the same pipeline and
          shows the same evidence — it just asks fewer questions.
        </p>

        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className={`flex flex-col rounded-xl border p-6 ${
                tier.emphasis
                  ? "border-foreground/30 bg-muted/40 ring-foreground/10 ring-4"
                  : "border-border"
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-medium">{tier.name}</h2>
                {tier.emphasis && (
                  <span className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
                    Most useful
                  </span>
                )}
              </div>

              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-3xl font-semibold tabular-nums">{tier.price}</span>
                <span className="text-muted-foreground text-sm">{tier.cadence}</span>
              </div>

              <p className="text-muted-foreground mt-3 text-sm text-pretty">
                {tier.tagline}
              </p>

              <ul className="mt-6 flex-1 space-y-2.5">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex gap-2.5 text-sm">
                    <span className="text-muted-foreground mt-0.5 shrink-0">→</span>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={tier.href}
                className={`mt-7 rounded-md px-4 py-2.5 text-center text-sm font-medium transition-opacity hover:opacity-90 ${
                  tier.emphasis
                    ? "bg-foreground text-background"
                    : "border-border border"
                }`}
              >
                {tier.cta}
              </Link>
            </div>
          ))}
        </div>

        <div className="border-border text-muted-foreground mt-12 rounded-xl border border-dashed p-6 text-sm">
          <p className="text-foreground font-medium">
            On bring-your-own-key, plainly.
          </p>
          <p className="mt-2 text-pretty">
            Your key is accepted over POST, held in memory for the length of the scan,
            and never written to our database — there is no column for it. It is never
            logged, never included in an error message, and never part of a cache key.
            If part of your scan is served from an earlier cached run, every such call
            is marked so you can see what you did not pay for.
          </p>
        </div>
      </section>
    </main>
  );
}
