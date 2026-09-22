import { useSite } from '../SiteContext';
import { CategorySection, HomeCTA, HomeHero, ProductSection, RentalSteps, SceneSection, ServiceBenefits, Testimonials } from '../components/HomeSections';

export function HomePage() {
  const { mode } = useSite();
  return <>
    <HomeHero mode={mode} />
    <CategorySection mode={mode} />
    {mode !== 'single' && <SceneSection mode={mode} />}
    <ProductSection mode={mode} />
    <ServiceBenefits mode={mode} />
    <RentalSteps />
    <Testimonials />
    <HomeCTA />
  </>;
}
