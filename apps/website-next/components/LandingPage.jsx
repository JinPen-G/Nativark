'use client';
// Migrated component logic; edit this source directly. No captured runtime is loaded.
import { SiteHeader } from './SiteHeader.jsx';
import { HeroSection } from './sections/HeroSection.jsx';
import { CapabilitiesSection } from './sections/CapabilitiesSection.jsx';
import { DeploymentSection } from './sections/DeploymentSection.jsx';
import { PartnershipSection } from './sections/PartnershipSection.jsx';
import { SiteFooter } from './sections/SiteFooter.jsx';
export function LandingPage() {
  return (
    <div data-theme="dark" className="harness-site relative w-full bg-ds-page">
      <SiteHeader />
      <main className="relative flex flex-col w-full">
        <HeroSection />
        <CapabilitiesSection />
        <DeploymentSection />
        <PartnershipSection />
        <SiteFooter />
      </main>
    </div>
  );
}
