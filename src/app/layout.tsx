import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { currentBrand } from "@/server/seed";
import { actorFromRole, roleSwitchEnabled } from "@/server/auth";
import { llmStatusLabel } from "@/server/llm";
import { dashboardData } from "@/server/dashboard";

export const metadata: Metadata = { title: "Inkloom AI", description: "Brand governance: claim ledger and guideline calibration" };
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const brand = await currentBrand();
  const role = actorFromRole((await cookies()).get("inkloom_role")?.value).role;
  const d = await dashboardData(brand.id);
  return (
    <html lang="en">
      <body>
        <Sidebar role={role} brand={brand.name} llm={llmStatusLabel()} roleSwitch={roleSwitchEnabled()} queueCount={d.awaiting} />
        <main className="md:ml-60">
          <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">{children}</div>
        </main>
      </body>
    </html>
  );
}
